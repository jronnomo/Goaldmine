// scripts/backfill-attribution.ts
//
// Design amendment 2 (docs/program-redesign/03-run-amendments.md): apply the
// auto-link engine's rules over ALL historical activity rows — Workouts,
// Hikes, NutritionLogs, LogEntries — for one user (founder by default).
//
// SAME LOGIC AS THE LIVE HOOKS, by construction: this script imports the
// shared evaluators (src/lib/attribution.ts), the shared context loader
// (loadAttributionContext) and the shared writer (writeAutoLinks) from
// src/lib/attribution-hooks.ts — nothing is re-implemented. Per-type gates
// mirror the hooks exactly:
//   workout    — status='completed' only (skipDay placeholders never link);
//                hint ∩ + Program attributionRules (evaluateWorkoutLinks).
//   hike       — mirror goalId; a legacy null goalId resolves to the CURRENT
//                focus goal (evaluateMirrorLinkGoalIds), any status (planned
//                rows mirror at plan time in the live hook too).
//   nutrition  — active fitness-kind member goals only
//                (evaluateNutritionLinks; rules never apply to meals in v1).
//   log_entry  — mirror goalId (evaluateMirrorLinkGoalIds).
//
// RETROACTIVITY (documented owner decision, amendment A2): membership,
// attributionHints, attributionRules and the focus goal are read AS OF NOW —
// retroactive attribution reflects the CURRENT rules, not historical state.
//
// IDEMPOTENT: writes go through writeAutoLinks (one top-level scoped
// createMany with skipDuplicates per activity — ON CONFLICT DO NOTHING on
// @@unique([activityType, activityId, goalId])). Existing rows, explicit or
// auto, are never touched; re-running is always safe.
//
// SCOPING: everything runs inside runWithUser(<target user>) so getDb() and
// getActiveProgramMembership() resolve to the target user and every link row
// gets userId injected by the $extends extension (same seam the live hooks
// use; measure-export.ts / verify-legacy-program-coverage.ts precedent).
//
// Usage:
//   npx tsx scripts/backfill-attribution.ts                 # dry-run, founder
//   npx tsx scripts/backfill-attribution.ts --user <id>     # dry-run, other user
//   npx tsx scripts/backfill-attribution.ts --apply         # write links (guarded)
//
// --apply refuses non-development DB_ENV unless ALLOW_PROD_DB_WRITE=1
// (founder-cutover.ts convention). Dry-run is read-only and allowed anywhere.
//
// Exit codes: 0 = success (including "no active Program — nothing to
// backfill"); 1 = guard refusal / unknown user / unexpected error.

import "dotenv/config";
import { prisma, runWithUser, getDb } from "../src/lib/db";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";
import { startOfDay, dateKey } from "../src/lib/calendar";
import { ACTIVITY_LINK_TYPE, type ActivityLinkType } from "../src/lib/activity-links";
import {
  evaluateWorkoutLinks,
  evaluateNutritionLinks,
  evaluateMirrorLinkGoalIds,
} from "../src/lib/attribution";
import { loadAttributionContext, writeAutoLinks } from "../src/lib/attribution-hooks";

const SAMPLE_SIZE = 20;

// ── Args + guards ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const userFlagIdx = argv.indexOf("--user");
const targetUserId =
  userFlagIdx >= 0 ? argv[userFlagIdx + 1] : (process.env.FOUNDER_USER_ID ?? FOUNDER_USER_ID);

if (userFlagIdx >= 0 && !targetUserId) {
  console.error("✗  --user requires a user id argument");
  process.exit(1);
}

const dbEnv = process.env.DB_ENV;
if (apply && dbEnv !== "development" && process.env.ALLOW_PROD_DB_WRITE !== "1") {
  console.error(
    `\n✗  REFUSED: --apply with DB_ENV="${dbEnv ?? "(not set)"}" — this mode writes ActivityGoalLink rows.` +
      `\n   Run against the dev Neon branch (DB_ENV=development), or set ALLOW_PROD_DB_WRITE=1` +
      `\n   for the documented prod import runbook. Dry-run (no --apply) is allowed anywhere.\n`,
  );
  process.exit(1);
}

// ── Report plumbing ───────────────────────────────────────────────────────────

interface PlannedLink {
  activityType: ActivityLinkType;
  activityId: string;
  activityDate: Date;
  goalIds: string[]; // NEW links only (already-linked pairs excluded)
}

interface TypeReport {
  scanned: number;
  wouldCreate: number;
  alreadyLinked: number;
  planned: PlannedLink[];
}

function emptyReport(): TypeReport {
  return { scanned: 0, wouldCreate: 0, alreadyLinked: 0, planned: [] };
}

/** Split an evaluation into new-vs-existing against the current link table. */
function classify(
  report: TypeReport,
  existing: ReadonlySet<string>,
  activityType: ActivityLinkType,
  activityId: string,
  activityDate: Date,
  goalIds: readonly string[],
): void {
  report.scanned++;
  if (goalIds.length === 0) return;
  const fresh: string[] = [];
  for (const goalId of goalIds) {
    if (existing.has(`${activityType}|${activityId}|${goalId}`)) report.alreadyLinked++;
    else fresh.push(goalId);
  }
  if (fresh.length > 0) {
    report.wouldCreate += fresh.length;
    report.planned.push({ activityType, activityId, activityDate, goalIds: fresh });
  }
}

async function main(): Promise<void> {
  const host = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "(no DATABASE_URL)";
  console.log(`DB_ENV: ${dbEnv ?? "(not set)"}  host: ${host}`);
  console.log(
    `Backfill attribution for user ${targetUserId} — ${apply ? "--apply: links WILL be written" : "dry-run (pass --apply to write)"}\n`,
  );

  // Raw client for the cross-user User probe only (non-scoped by design).
  const user = await prisma.user.findUnique({
    where: { id: targetUserId! },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`✗  User not found: ${targetUserId}`);
    process.exit(1);
  }
  console.log(`User: ${user.id} (${user.email ?? "no email"})`);

  const exitCode = await runWithUser(user.id, async (): Promise<number> => {
    // The SAME context the live hooks load — membership + hints + parsed
    // rules, as of now (amendment A2 retroactivity).
    const ctx = await loadAttributionContext();
    if (!ctx) {
      console.log("\nno active Program — nothing to backfill (exit 0)");
      return 0;
    }

    const activeMembers = ctx.memberGoals.filter((g) => g.status === "active");
    console.log(
      `Active Program: ${ctx.programId} — ${ctx.memberGoals.length} member goal(s) ` +
        `(${activeMembers.length} active), ${ctx.hintsByGoal.size} with hints, ` +
        `${ctx.rules?.length ?? 0} attribution rule(s)\n`,
    );

    const db = await getDb();

    // Existing links (this user's) → "type|activityId|goalId" for the
    // already-linked split. skipDuplicates would skip them on write anyway —
    // this is for honest dry-run counts.
    const existingRows = await db.activityGoalLink.findMany({
      select: { activityType: true, activityId: true, goalId: true },
    });
    const existing = new Set(
      existingRows.map((r) => `${r.activityType}|${r.activityId}|${r.goalId}`),
    );
    console.log(`Existing ActivityGoalLink rows: ${existing.size}`);

    // Focus goal — the hike hook's null-goalId fallback, resolved as of now.
    const focusGoal = await db.goal.findFirst({
      where: { isFocus: true },
      select: { id: true },
    });
    const focusGoalId = focusGoal?.id ?? null;

    const reports = new Map<ActivityLinkType, TypeReport>([
      [ACTIVITY_LINK_TYPE.workout, emptyReport()],
      [ACTIVITY_LINK_TYPE.hike, emptyReport()],
      [ACTIVITY_LINK_TYPE.nutrition, emptyReport()],
      [ACTIVITY_LINK_TYPE.logEntry, emptyReport()],
    ]);

    // — Workouts (completed only — the hook's status gate) —
    const workouts = await db.workout.findMany({
      where: { status: "completed" },
      select: {
        id: true,
        title: true,
        source: true,
        startedAt: true,
        exercises: { select: { name: true } },
      },
      orderBy: { startedAt: "asc" },
    });
    for (const w of workouts) {
      const goalIds = evaluateWorkoutLinks(
        {
          exerciseNames: w.exercises.map((e) => e.name),
          workoutTitle: w.title ?? null,
          source: w.source ?? null,
        },
        ctx.memberGoals,
        ctx.hintsByGoal,
        ctx.rules,
      );
      classify(
        reports.get(ACTIVITY_LINK_TYPE.workout)!,
        existing,
        ACTIVITY_LINK_TYPE.workout,
        w.id,
        startOfDay(w.startedAt),
        goalIds,
      );
    }

    // — Hikes (all statuses — planned rows mirror at plan time live, too) —
    const hikes = await db.hike.findMany({
      select: { id: true, date: true, goalId: true },
      orderBy: { date: "asc" },
    });
    for (const h of hikes) {
      const goalIds = evaluateMirrorLinkGoalIds(h.goalId ?? focusGoalId, ctx.memberGoals);
      classify(
        reports.get(ACTIVITY_LINK_TYPE.hike)!,
        existing,
        ACTIVITY_LINK_TYPE.hike,
        h.id,
        startOfDay(h.date),
        goalIds,
      );
    }

    // — NutritionLogs (fitness-kind members only; same set for every row) —
    const nutritionGoalIds = evaluateNutritionLinks(ctx.memberGoals);
    const nutritionLogs = await db.nutritionLog.findMany({
      select: { id: true, date: true },
      orderBy: { date: "asc" },
    });
    for (const n of nutritionLogs) {
      classify(
        reports.get(ACTIVITY_LINK_TYPE.nutrition)!,
        existing,
        ACTIVITY_LINK_TYPE.nutrition,
        n.id,
        startOfDay(n.date),
        nutritionGoalIds,
      );
    }

    // — LogEntries (goalId mirror) —
    const logEntries = await db.logEntry.findMany({
      select: { id: true, date: true, goalId: true },
      orderBy: { date: "asc" },
    });
    for (const e of logEntries) {
      const goalIds = evaluateMirrorLinkGoalIds(e.goalId, ctx.memberGoals);
      classify(
        reports.get(ACTIVITY_LINK_TYPE.logEntry)!,
        existing,
        ACTIVITY_LINK_TYPE.logEntry,
        e.id,
        startOfDay(e.date),
        goalIds,
      );
    }

    // — Report —
    console.log("\nPer-type would-link report (NEW links only):");
    let totalNew = 0;
    let totalExisting = 0;
    const allPlanned: PlannedLink[] = [];
    for (const [type, r] of reports) {
      totalNew += r.wouldCreate;
      totalExisting += r.alreadyLinked;
      allPlanned.push(...r.planned);
      console.log(
        `  ${type.padEnd(12)} scanned=${String(r.scanned).padStart(4)}  ` +
          `would-create=${String(r.wouldCreate).padStart(4)}  already-linked=${r.alreadyLinked}`,
      );
    }
    console.log(`  ${"TOTAL".padEnd(12)} would-create=${totalNew}  already-linked=${totalExisting}`);

    const sampleRows = allPlanned
      .flatMap((p) => p.goalIds.map((g) => ({ ...p, goalId: g })))
      .slice(0, SAMPLE_SIZE);
    if (sampleRows.length > 0) {
      console.log(`\nSample (first ${sampleRows.length} of ${totalNew}):`);
      for (const row of sampleRows) {
        console.log(
          `  ${row.activityType.padEnd(12)} ${row.activityId}  → ${row.goalId}  ` +
            `activityDate=${dateKey(row.activityDate)}`,
        );
      }
    }

    if (!apply) {
      console.log(`\ndry run — nothing written. Re-run with --apply to create ${totalNew} link(s).`);
      return 0;
    }

    // — Apply: the SAME writer the live hooks use, per activity —
    let created = 0;
    for (const p of allPlanned) {
      created += await writeAutoLinks(db, p.activityType, p.activityId, p.activityDate, p.goalIds);
    }
    console.log(`\n--apply: created ${created} ActivityGoalLink row(s) (source="auto").`);
    if (created !== totalNew) {
      console.log(
        `  note: created (${created}) != planned (${totalNew}) — rows linked concurrently were skipped by the unique constraint.`,
      );
    }
    return 0;
  });

  process.exit(exitCode);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
