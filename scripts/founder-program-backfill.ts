// scripts/founder-program-backfill.ts
//
// #279 (Sprint 17 — Seam flip) — Founder Phase 2A PROGRAM + MEMBERSHIP
// backfill: migrates the founder's real goal setup onto the new Program
// model (one Program row, N member goals, one rotation plan) WITHOUT
// disrupting the live Today page.
//
// SCOPE (deliberate): this script builds the Program container ONLY —
// create Program → attach existing goals by id → attach the rotation plan →
// assert Plan.programId persisted → activate. It does NOT create goals,
// targets, scheduled items, or saved meals; the full Phase 2A import
// (examples/phase2a-goals-import-spec.md) is a later story that runs on top
// of this scaffolding.
//
// Uses the program-core functions directly (createProgramCore /
// attachGoalToProgramCore / attachPlanToProgramCore / setProgramStatusCore)
// under the target user's identity via runWithUser() — the same code paths
// the MCP tools exercise, so every guard (R9 achieved-goal rejection,
// membership-before-content, one-active-per-user) surfaces naturally here
// instead of being reimplemented.
//
// THE MASKED-BUG TRAP (plan critique / architecture doc): forgetting to set
// Plan.programId silently falls through — with isFocus still populated the
// Today page keeps resolving via the legacy path and everything LOOKS fine
// until the legacy path is retired. This script therefore RE-READS
// Plan.programId after attaching and HARD-FAILS if it did not persist.
//
// R9 NON-GOAL: achieved goals and their completion snapshots are never
// touched — attachGoalToProgramCore rejects status='achieved' goals, and the
// preflight here surfaces them as errors before any write.
//
// USAGE
//   npx tsx scripts/founder-program-backfill.ts \
//     --name "Phase 2A — Lighter and Upside Down" \
//     --started 2026-08-10 [--ends 2026-12-31] \
//     --goals <goalId,goalId,...> --rotation-goal <goalId> \
//     [--user <userId>] [--apply] [--allow-resolution-change]
//
//   --goals            comma-separated EXISTING goal ids to attach (explicit
//                      mapping per the owner's instruction — never inferred).
//   --rotation-goal    the member goal whose latest ACTIVE Plan becomes the
//                      Program's rotation plan (attach_plan). Must be one of
//                      --goals (membership before content).
//   --user             target userId. Default: FOUNDER_USER_ID env, else
//                      "usr_founder".
//   --apply            actually write. DEFAULT IS DRY-RUN: preflight + the
//                      planned operations are printed and nothing is written.
//   --allow-resolution-change
//                      skip the hard equivalence gate (see below) when the
//                      rotation plan is INTENTIONALLY not the current Today
//                      driver. Without it, --apply fails loud if the resolved
//                      plan would change.
//
// GUARD (matches db-guard.ts semantics — db-guard.ts self-executes on import,
// so the check is mirrored inline): --apply refuses unless DB_ENV=development
// or ALLOW_PROD_DB_WRITE=1 (loud stderr warning). The real founder cutover on
// prod is the ALLOW_PROD_DB_WRITE=1 run, per the deploy runbook. Dry-run is
// read-only and allowed anywhere.
//
// IDEMPOTENCY / RE-RUN SAFETY: fails loud (before any write) when the user
// already has an ACTIVE Program or any Program with the same name — no
// duplicate Program rows, no duplicate attachment. There is no partial-state
// auto-repair: if a previous --apply died midway (draft Program left behind),
// archive/delete that row and re-run.
//
// TODAY-RESOLUTION EQUIVALENCE (script-level assertion, #279 AC): captures
// getActiveProgram() BEFORE the writes (legacy isFocus-tiebreak path, since
// the user has no active Program yet) and AFTER activation (Program-first
// path), and byte-compares the JSON snapshots. When the rotation plan is the
// plan already driving Today, the two are identical — the backfill changes
// WHERE resolution comes from, not WHAT it resolves. A mismatch hard-fails
// unless --allow-resolution-change is passed.
//
// ROLLBACK (trivial, two levels — matches src/lib/program.ts getActiveProgram
// branch semantics):
//   1. PAUSE the Program layer:  set_program_status(programId, 'archived')
//      (or: npx tsx -e with setProgramStatusCore). Program rows now exist but
//      none is active → getActiveProgram() returns null ("no rotation
//      today") — a safe, visible stop. Membership stays intact for
//      re-activation.
//   2. FULL legacy restore: DELETE the user's Program row(s). Goal.programId
//      and Plan.programId are onDelete: SetNull, so membership clears itself
//      and the zero-Program-rows gate re-routes resolution through the
//      pre-existing isFocus-tiebreak path, byte-identical to pre-backfill.
//      (Archiving alone deliberately does NOT regress to the legacy path —
//      a retired-Program user must not silently fall back; see the branch-3
//      doc comment in src/lib/program.ts.)

import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma, runWithUser, getDb } from "../src/lib/db";
import { getActiveProgram } from "../src/lib/program";
import { parseDateKey, dateKey } from "../src/lib/calendar-core";
import {
  createProgramCore,
  attachGoalToProgramCore,
  attachPlanToProgramCore,
  setProgramStatusCore,
} from "../src/lib/program-core";

// ─────────────────────────────────────────────────────────────────────────────
// Args + guard
// ─────────────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    name: { type: "string" },
    started: { type: "string" },
    ends: { type: "string" },
    goals: { type: "string" },
    "rotation-goal": { type: "string" },
    user: { type: "string" },
    apply: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false }, // accepted for explicitness; dry-run is the default
    "allow-resolution-change": { type: "boolean", default: false },
  },
});

function usageFail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  console.error(
    "Usage: npx tsx scripts/founder-program-backfill.ts --name <name> --started yyyy-mm-dd " +
      "[--ends yyyy-mm-dd] --goals <id,id,...> --rotation-goal <id> [--user <userId>] " +
      "[--apply] [--allow-resolution-change]",
  );
  process.exit(1);
}

function maskedHost(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "unset";
  try {
    return new URL(raw).host;
  } catch {
    return "<malformed URL>";
  }
}

/** Mirrors scripts/db-guard.ts assertDevDb() (that file self-executes on
 *  import, so it cannot be imported here). Writes only — dry-run is read-only. */
function assertWriteAllowed(): void {
  if (process.env.ALLOW_PROD_DB_WRITE === "1") {
    process.stderr.write(
      `\n⚠  ALLOW_PROD_DB_WRITE=1 — bypassing dev-DB guard (host: ${maskedHost()}). ` +
        "This backfill will write to the labelled database. Proceed with extreme caution.\n\n",
    );
    return;
  }
  if (process.env.DB_ENV !== "development") {
    throw new Error(
      `Refusing --apply: DB_ENV is not 'development' (host: ${maskedHost()}). ` +
        "Point .env at the Neon dev branch, or set ALLOW_PROD_DB_WRITE=1 for the intentional prod cutover run.",
    );
  }
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function main(): Promise<void> {
  const name = args.name?.trim();
  const started = args.started?.trim();
  const ends = args.ends?.trim();
  const goalsCsv = args.goals?.trim();
  const rotationGoalId = args["rotation-goal"]?.trim();
  const apply = args.apply === true;
  const allowResolutionChange = args["allow-resolution-change"] === true;

  if (apply && args["dry-run"]) usageFail("--apply and --dry-run are mutually exclusive.");
  if (!name) usageFail("--name is required.");
  if (!started || !DATE_KEY_RE.test(started)) usageFail("--started is required (yyyy-mm-dd).");
  if (ends && !DATE_KEY_RE.test(ends)) usageFail("--ends must be yyyy-mm-dd.");
  if (!goalsCsv) usageFail("--goals is required (comma-separated goal ids).");
  if (!rotationGoalId) usageFail("--rotation-goal is required.");

  const goalIds = [...new Set(goalsCsv.split(",").map((s) => s.trim()).filter(Boolean))];
  if (goalIds.length === 0) usageFail("--goals parsed to zero ids.");
  if (!goalIds.includes(rotationGoalId)) {
    usageFail(
      "--rotation-goal must be one of --goals — attach_plan requires the plan's goal to be a Program member " +
        "(membership before content).",
    );
  }

  const userId = args.user?.trim() || process.env.FOUNDER_USER_ID || "usr_founder";

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  FOUNDER PHASE 2A — PROGRAM + MEMBERSHIP BACKFILL (#279)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  mode:        ${apply ? "APPLY (writes enabled)" : "DRY-RUN (read-only, default)"}`);
  console.log(`  db host:     ${maskedHost()}`);
  console.log(`  DB_ENV:      ${process.env.DB_ENV ?? "unset"}`);
  console.log(`  user:        ${userId}`);
  console.log(`  program:     "${name}"  window ${started} → ${ends ?? "(open-ended)"}`);
  console.log(`  goals:       ${goalIds.join(", ")}`);
  console.log(`  rotation:    ${rotationGoalId}`);
  console.log("");

  if (apply) assertWriteAllowed();

  return runWithUser(userId, async () => {
    const db = await getDb();
    const problems: string[] = [];

    // ── Preflight 1: no pre-existing Program conflicts (fail-loud idempotency) ──
    const existingPrograms = await db.program.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    for (const p of existingPrograms) {
      if (p.status === "active") {
        problems.push(
          `User already has an ACTIVE Program "${p.name}" (${p.id}) — already backfilled? ` +
            `Archive it first (set_program_status → archived) if this run is intentional.`,
        );
      }
      if (p.name === name) {
        problems.push(
          `A Program named "${name}" already exists (${p.id}, status=${p.status}) — refusing to create a duplicate. ` +
            `Delete/rename the leftover row (a previous partial run?) and re-run.`,
        );
      }
    }
    if (existingPrograms.length > 0) {
      console.log(`  existing Program rows for this user: ${existingPrograms.length}`);
      for (const p of existingPrograms) console.log(`    - ${p.id}  [${p.status}]  "${p.name}"`);
    } else {
      console.log("  existing Program rows for this user: none (zero-Program legacy tenant — expected pre-backfill)");
    }

    // ── Preflight 2: resolve every goal id (explicit mapping, never inferred) ──
    const goals: { id: string; objective: string; kind: string; status: string; programId: string | null }[] = [];
    for (const id of goalIds) {
      const g = await db.goal.findUnique({
        where: { id },
        select: { id: true, objective: true, kind: true, status: true, programId: true },
      });
      if (!g) {
        problems.push(`Goal not found for this user: ${id}`);
        continue;
      }
      goals.push(g);
      if (g.status === "achieved") {
        problems.push(
          `Goal "${g.objective}" (${g.id}) is status=achieved — R9: achieved goals are retired and cannot be ` +
            `attached (attachGoalToProgramCore will reject it). Drop it from --goals.`,
        );
      }
      if (g.programId) {
        problems.push(
          `Goal "${g.objective}" (${g.id}) already belongs to Program ${g.programId} — refusing to silently MOVE it. ` +
            `Detach it first if the move is intentional.`,
        );
      }
    }
    console.log("");
    console.log("  resolved goals:");
    for (const g of goals) {
      console.log(
        `    - ${g.id}  [${g.kind}/${g.status}]  "${g.objective}"${g.id === rotationGoalId ? "   ← rotation owner" : ""}`,
      );
    }

    // ── Preflight 3: the rotation goal's latest ACTIVE plan ──
    const rotationPlan = await db.plan.findFirst({
      where: { goalId: rotationGoalId, active: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, startedOn: true, programId: true },
    });
    if (!rotationPlan) {
      problems.push(
        `Rotation goal ${rotationGoalId} has no ACTIVE plan — activate one first (set_plan_active) or pick a ` +
          `different --rotation-goal.`,
      );
    } else {
      console.log("");
      console.log(
        `  rotation plan: ${rotationPlan.id}  "${rotationPlan.name}"  startedOn=${dateKey(rotationPlan.startedOn)}` +
          `${rotationPlan.programId ? `  (already programId=${rotationPlan.programId}!)` : ""}`,
      );
      if (rotationPlan.programId) {
        problems.push(
          `Rotation plan ${rotationPlan.id} already has programId=${rotationPlan.programId} — leftover from a ` +
            `previous run? Clear it (or archive/delete that Program) before re-running.`,
        );
      }
    }

    // ── Preflight 4: pre-backfill Today resolution snapshot ──
    const pre = await getActiveProgram();
    const preJson = JSON.stringify(pre);
    console.log("");
    console.log(
      pre
        ? `  pre-backfill Today driver: plan ${pre.id} "${pre.name}" (legacy isFocus-tiebreak path)`
        : "  pre-backfill Today driver: none (no active plan resolves)",
    );

    if (problems.length > 0) {
      console.log("");
      console.log("  ✗ PREFLIGHT FAILED:");
      for (const p of problems) console.log(`    - ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log("");
    console.log("  ✓ preflight clean");
    console.log("");

    const planned = [
      `1. createProgramCore  name="${name}" startedOn=${started} endsOn=${ends ?? "null"}  (status starts 'draft')`,
      ...goals.map((g, i) => `${i + 2}. attachGoalToProgramCore  "${g.objective}" (${g.id})`),
      `${goals.length + 2}. attachPlanToProgramCore  plan ${rotationPlan!.id} "${rotationPlan!.name}"`,
      `${goals.length + 3}. ASSERT Plan.programId persisted (re-read; HARD-FAIL if null — the masked-bug trap)`,
      `${goals.length + 4}. setProgramStatusCore → 'active'  (one-active-per-user enforcement)`,
      `${goals.length + 5}. ASSERT Today-resolution equivalence (getActiveProgram byte-compare vs pre-backfill)`,
    ];

    if (!apply) {
      console.log("  PLANNED OPERATIONS (dry-run — nothing written):");
      for (const line of planned) console.log(`    ${line}`);
      console.log("");
      console.log("  Re-run with --apply to execute. Rollback after apply: set_program_status → 'archived'");
      console.log("  (pause: 'no rotation today'), or DELETE the Program row (FKs SetNull → full legacy restore).");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return;
    }

    // ── APPLY ──
    console.log("  APPLYING:");

    const program = await createProgramCore({
      name,
      startedOn: parseDateKey(started),
      endsOn: ends ? parseDateKey(ends) : null,
    });
    console.log(`    ✓ Program created: ${program.id} "${program.name}" [${program.status}]`);

    for (const g of goals) {
      const r = await attachGoalToProgramCore(g.id, program.id);
      console.log(`    ✓ attached goal "${r.goalObjective}" (${r.goalId})${r.changed ? "" : " [no-op]"}`);
    }

    const attach = await attachPlanToProgramCore(rotationPlan!.id, program.id);
    console.log(`    ✓ attached rotation plan "${attach.planName}" (${attach.planId})${attach.changed ? "" : " [no-op]"}`);

    // THE assertion (#279 AC): re-read Plan.programId and hard-fail if it did
    // not persist — this is the exact failure mode that silently falls
    // through while isFocus still populates the legacy path, masking the bug.
    const reread = await db.plan.findUnique({
      where: { id: rotationPlan!.id },
      select: { programId: true },
    });
    if (reread?.programId !== program.id) {
      throw new Error(
        `HARD FAIL: Plan.programId did not persist (expected ${program.id}, read back ` +
          `${reread?.programId ?? "null"}). The Program layer would silently never own the rotation while ` +
          `isFocus keeps the legacy path alive. Investigate before re-running; rollback: delete Program ${program.id}.`,
      );
    }
    console.log(`    ✓ ASSERT Plan.programId persisted (${reread.programId})`);

    const status = await setProgramStatusCore(program.id, "active");
    console.log(`    ✓ Program status: ${status.previousStatus} → ${status.status}`);

    // ── Post-state verification block ──
    const post = await getActiveProgram();
    const postJson = JSON.stringify(post);
    const identical = preJson === postJson;

    const members = await db.goal.findMany({
      where: { programId: program.id },
      select: { id: true, objective: true, kind: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    const attachedPlans = await db.plan.findMany({
      where: { programId: program.id },
      select: { id: true, name: true, active: true },
    });

    console.log("");
    console.log("  ━━ VERIFICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Program:        ${program.id}  "${program.name}"  [${status.status}]`);
    console.log(`  Members (${members.length}):`);
    for (const m of members) console.log(`    - ${m.id}  [${m.kind}/${m.status}]  "${m.objective}"`);
    console.log(`  Rotation plans (${attachedPlans.length}):`);
    for (const p of attachedPlans) console.log(`    - ${p.id}  "${p.name}"  active=${p.active}`);
    console.log(`  Plan.programId assert:  PASS`);
    console.log(
      `  Today-resolution equivalence:  ${identical ? "PASS (byte-identical snapshot)" : "CHANGED"}` +
        (post ? `  → now resolves plan ${post.id} "${post.name}"` : "  → now resolves null"),
    );

    if (!identical && !allowResolutionChange) {
      throw new Error(
        "HARD FAIL: the resolved Today plan changed vs pre-backfill " +
          `(pre=${pre ? `${pre.id} "${pre.name}"` : "null"}, post=${post ? `${post.id} "${post.name}"` : "null"}). ` +
          "The backfill must be resolution-neutral (#279 AC). If this change is INTENTIONAL (the rotation plan " +
          "deliberately differs from the current driver), re-run with --allow-resolution-change. " +
          `Rollback now: set_program_status(${program.id}, 'archived') → 'no rotation today', or DELETE the ` +
          "Program row for the full legacy restore.",
      );
    }
    if (!identical) {
      console.log("  (accepted via --allow-resolution-change)");
    }
    console.log("");
    console.log(`  Rollback: set_program_status(${program.id}, 'archived')  → Program layer off, 'no rotation today'`);
    console.log(`            DELETE Program row ${program.id}               → FKs SetNull, full legacy isFocus restore`);
    console.log("  Achieved goals & completion snapshots: untouched (R9 non-goal).");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? `\n✗ ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
