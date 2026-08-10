// scripts/import-phase2a.ts
//
// Phase 2A — "Lighter and Upside Down" IMPORT EXECUTOR (design amendment 4,
// docs/program-redesign/03-run-amendments.md; payload spec:
// examples/phase2a-goals-import-spec.md — the sacred text; spec constants +
// builders live in src/lib/phase2a-spec.ts, unit-tested in
// src/lib/phase2a-spec.test.ts).
//
// WHAT IT MATERIALIZES (the owner's REAL program):
//   1.  Program "Phase 2A — Lighter and Upside Down" (2026-08-10 → 2026-12-31),
//       notes = archetype + blocks summary, created DRAFT first (activation is
//       the LAST write).
//   2.  Program.attributionRules — the G4 rule (one AM incline walk credits
//       cut + AWS + handstand-Z2 from a single log call). Executed AFTER the
//       goal steps because goalIds are filled at runtime.
//   3.  Goal 1 (Handstand, cmsmi9k20000004laub50psio) — MUST already exist
//       (identity matters; never re-created): re-parent under the Program,
//       replace targets with the spec v4 9-row repeatability table (gates:
//       rolling:hs_triple20_of6 + Wall HSPU; the three rolling:hs_* rows are
//       ENGINE-NATIVE trackers — RollingParams on each target, value
//       computed from logged attempt sets, regression window-inherent), set
//       attributionHints / legend / targetDate, and set its auto-scaffolded
//       plan(s) inactive.
//   3b. Duplicate-goal resolution (spec v4 header ⚠): the old someday
//       "Handstand" goal (cmq8pz7xp000304ic0wux6r2a) → status "abandoned" +
//       active false + a superseded-by note appended. NEVER deleted (the
//       owner may want the history). Skips when already abandoned.
//   4.  Goal 2 (Reach 10% body fat) — created fresh, fitness, NO plan.
//       createGoalCore has no skip-scaffold option (checked 2026-08-10:
//       CreateGoalCoreInput carries no such flag), so the fitness+targetDate
//       path unavoidably scaffolds a plan — it is deactivated IMMEDIATELY in
//       the same step and reported.
//   5.  Goal 3 (AWS SAA) — created fresh, kind=project, NO targetDate
//       (readiness-gated) → no scaffold by construction.
//   6.  The Goal-1 rotation plan (20 weeks from 2026-08-10): planJson from
//       buildPhase2aRotationTemplate() (7-day split + A/B/C PM skill rotation
//       + the S1/S2/S3 baseline split as SCHEDULED tests + Blocks 0–3 phases
//       + per-block descent nutrition), Plan + initial PlanRevision in one
//       top-level create (Plan is scoped → extension injects userId;
//       PlanRevision is non-scoped → safe to nest — gotchas §B.9/§B.10),
//       then attachPlanToProgramCore + the masked-bug-trap re-read assert.
//   6b. SPEC V4 RECONCILE: when the LIVE plan's planJson.baselineWeek differs
//       from the builder's S1/S2/S3 split, apply a proper PlanRevision (full
//       snapshot = live planJson with only baselineWeek replaced;
//       triggerSource "manual"; reasoning quotes the spec's why-split
//       paragraph) via the same tx pattern apply_plan_revision uses —
//       lintTemplate first (errors refuse), then planRevision.create +
//       plan.update(planJson) in ONE transaction. Skips when content-equal
//       (stableJson — jsonb normalizes key order, so a plain stringify
//       compare would re-revise forever).
//   6c. Milestone DATA POINT: Baseline row "Freestanding Handstand Hold" =
//       10 sec on 2026-08-09 (video-verified; the day BEFORE plan start, so
//       it can never credit the S1 initial checkpoint). Idempotent by
//       (testName, calendar-day) existence check. NOT an S1 result.
//   7.  Scheduled checkpoints (DEXA ×3, practice-exam ×2, monthly photos ×4,
//       + the spec-v2 Sep 15 cluster-decision task on Goal 1) — idempotent via
//       ScheduledItem @@unique([goalId, externalRef]) — plus the weekly
//       weigh-in cadence as ONE standing_rule Note (deliberately NOT 20 rows;
//       standing rules are how recurring cadence works today).
//   8.  PlanDayOverrides: Mirror Lake Aug 14–15 (SACRED TIME — rest-day
//       DayTemplate, never a deload label), deloads Sep 25–27 + Nov 26–29
//       (Nov = maintenance-not-deficit), Sep 4–7 Virginia soft-break
//       note-only overrides, + the spec-v2 Oct 2–5 out-of-town TBD note-only
//       overrides (uncertain window; no-retest/DEXA/practice-exam through
//       Oct 8). PlanDayOverride is non-scoped — planId carries tenancy;
//       written via the raw client (gotcha §B.9 table).
//   9.  SavedMeals: Protein Brookie, Chipotle Protein Bowl (upsert-by-name
//       semantics: existing name → skip).
//   10. Standing rules: nutrition descent block + the spec-v2 Sep 24 – Oct 5
//       disruption-cluster rule (options a/b/c, decide by mid-September).
//   11. Verification block, then — apply mode only — Program → ACTIVE (last).
//   12. Post-import assertions: getActiveProgram().id === rotation plan id;
//       getActiveProgramMembership() lists the 3 member goals.
//
// S1–S3 baseline RESULTS are NOT pre-seeded (spec: log actual results) — the
// 2026-08-09 milestone row (6c) is a historical data point on record, not a
// session result. The stale Pull-Up 25 correction is a printed NOTE, not a
// write.
//
// IDEMPOTENCY: every step re-checks state and SKIPS what already exists
// (Program by name, goals by id/objective, plan by name under Goal 1,
// scheduled items by externalRef, overrides by (planId, date), meals by
// case-insensitive name, standing rules by body first-line, the baselineWeek
// revision by key-order-insensitive content compare, the milestone Baseline
// by (testName, calendar day), the duplicate goal by status=abandoned).
// Re-running is a no-op pass that prints [skip] lines. Partial runs
// self-repair on re-run.
//
// GUARD (mirrors scripts/db-guard.ts semantics — that file self-executes on
// import, so the check is inlined, same as founder-program-backfill.ts):
// --apply refuses unless DB_ENV=development or ALLOW_PROD_DB_WRITE=1.
// DRY-RUN IS THE DEFAULT and is read-only everywhere.
//
// USAGE
//   npx tsx scripts/import-phase2a.ts [--user <userId>] [--dry-run] [--apply]
//
//   --user   target userId. Default: FOUNDER_USER_ID env, else "usr_founder".
//   --apply  actually write. Default is dry-run (prints the full plan of
//            operations against current DB state and writes nothing).

import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma, runWithUser, getDb } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { parseDateKey, dateKey, startOfDay, endOfDay } from "../src/lib/calendar-core";
import { parseDateInput } from "../src/lib/mcp/tool-helpers";
import { canonicalExerciseName } from "../src/lib/exercise-canonical";
import { createGoalCore } from "../src/lib/goal-core";
import {
  attachGoalToProgramCore,
  attachPlanToProgramCore,
  createProgramCore,
  setProgramStatusCore,
  updateProgramCore,
} from "../src/lib/program-core";
import { getActiveProgram, getActiveProgramMembership } from "../src/lib/program";
import { lintTemplate } from "../src/lib/plan-lint";
import { parseAttributionRules, type AttributionRule } from "../src/lib/attribution-rules";
import {
  appendDuplicateGoalNote,
  BASELINE_RESOLUTION_FACT,
  baselineWeekNeedsReconcile,
  BODYFAT_VERIFY_NOTE,
  buildBaselineWeekRevisionSnapshot,
  buildG4AttributionRule,
  buildPhase2aOverrides,
  buildPhase2aRotationTemplate,
  LOG_SNAPSHOT_IMPORT_STATE_FACT,
  PHASE2A_BASELINE_SPLIT_REASONING,
  PHASE2A_BASELINE_SPLIT_SUMMARY,
  PHASE2A_BASELINE_WEEK,
  PHASE2A_CLUSTER_RULE,
  PHASE2A_DUPLICATE_GOAL,
  PHASE2A_GOAL1,
  PHASE2A_GOAL2,
  PHASE2A_GOAL3,
  PHASE2A_MILESTONE_BASELINE,
  PHASE2A_NUTRITION_RULE,
  PHASE2A_PLAN,
  PHASE2A_PROGRAM,
  PHASE2A_SAVED_MEALS,
  PHASE2A_SCHEDULED_ITEMS,
  PHASE2A_WEIGHIN_RULE,
  PULLUP_CORRECTION_NOTE,
  ROLLING_PROTOCOL_NOTE,
  stableJson,
  standingRuleKey,
  type Phase2aScheduledItem,
} from "../src/lib/phase2a-spec";
import type { ProgramTemplate } from "../src/lib/program-template";

// ─────────────────────────────────────────────────────────────────────────────
// Args + guard
// ─────────────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    user: { type: "string" },
    apply: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false }, // accepted for explicitness; dry-run is the default
  },
});

function maskedHost(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "unset";
  try {
    return new URL(raw).host;
  } catch {
    return "<malformed URL>";
  }
}

/** Mirrors scripts/db-guard.ts assertDevDb() (self-executing on import, so
 *  inlined — same as founder-program-backfill.ts). Writes only. */
function assertWriteAllowed(): void {
  if (process.env.ALLOW_PROD_DB_WRITE === "1") {
    process.stderr.write(
      `\n⚠  ALLOW_PROD_DB_WRITE=1 — bypassing dev-DB guard (host: ${maskedHost()}). ` +
        "This import will write the Phase 2A program to the labelled database. Proceed with extreme caution.\n\n",
    );
    return;
  }
  if (process.env.DB_ENV !== "development") {
    throw new Error(
      `Refusing --apply: DB_ENV is not 'development' (host: ${maskedHost()}). ` +
        "Point .env at the Neon dev branch, or set ALLOW_PROD_DB_WRITE=1 for the intentional prod import run.",
    );
  }
}

const apply = args.apply === true;
if (apply && args["dry-run"]) {
  console.error("\n✗ --apply and --dry-run are mutually exclusive.\n");
  process.exit(1);
}
const userId = args.user?.trim() || process.env.FOUNDER_USER_ID || "usr_founder";

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function say(line: string): void {
  console.log(line);
}

function header(step: string, title: string): void {
  say("");
  say(`  ── STEP ${step} · ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

/** Content compare for "already in desired state" skips. Key-order
 *  INSENSITIVE (stableJson sorts object keys): Goal.targets / Goal.legend /
 *  Plan.planJson are Postgres jsonb, which normalizes object key order on
 *  write — a plain JSON.stringify compare of a jsonb round-trip against a
 *  freshly built object can differ on key order alone, which would make
 *  re-runs re-write content-identical state forever. */
function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function ruleMatchesG4(rule: AttributionRule, g4: AttributionRule): boolean {
  const norm = (xs: string[] | undefined) => [...(xs ?? [])].map((s) => s.toLowerCase()).sort();
  return (
    sameJson(norm(rule.match.titleContains), norm(g4.match.titleContains)) &&
    sameJson([...rule.goalIds].sort(), [...g4.goalIds].sort())
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  say("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  say("  PHASE 2A — LIGHTER AND UPSIDE DOWN · IMPORT EXECUTOR (amendment 4)");
  say("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  say(`  mode:     ${apply ? "APPLY (writes enabled)" : "DRY-RUN (read-only, default)"}`);
  say(`  db host:  ${maskedHost()}`);
  say(`  DB_ENV:   ${process.env.DB_ENV ?? "unset"}`);
  say(`  user:     ${userId}`);
  say(`  program:  "${PHASE2A_PROGRAM.name}"  ${PHASE2A_PROGRAM.startedOnKey} → ${PHASE2A_PROGRAM.endsOnKey}`);

  if (apply) assertWriteAllowed();

  // Pure pre-check: lint the rotation template BEFORE any DB work.
  const template = buildPhase2aRotationTemplate();
  const lint = lintTemplate(template, {
    weeks: PHASE2A_PLAN.weeks,
    startedOn: parseDateKey(PHASE2A_PLAN.startedOnKey),
    endsOn: parseDateKey(PHASE2A_PLAN.endsOnKey),
    goalTargetDate: parseDateKey(PHASE2A_GOAL1.targetDateKey),
  });
  say("");
  say(`  lintTemplate(rotation): ${lint.length === 0 ? "CLEAN (0 findings)" : `${lint.length} finding(s)`}`);
  for (const f of lint) say(`    [${f.severity}] ${f.rule}: ${f.message}`);
  if (lint.some((f) => f.severity === "error")) {
    throw new Error("Rotation template fails lintTemplate with error(s) — refusing to import a broken template.");
  }

  /** Blocking problems found during a DRY-RUN. In apply mode fatal() throws
   *  immediately (nothing is written past a broken invariant); in dry-run the
   *  problem is recorded + printed and the preview continues so the FULL plan
   *  of operations is still visible — the process then exits non-zero. */
  const fatalProblems: string[] = [];
  function fatal(msg: string): void {
    if (apply) throw new Error(msg);
    fatalProblems.push(msg);
    say(`  ✗ WOULD HARD-FAIL (--apply): ${msg}`);
  }

  await runWithUser(userId, async () => {
    const db = await getDb();

    // ── STEP 1 · Program (draft first) ────────────────────────────────────
    header("1", `Program "${PHASE2A_PROGRAM.name}" (draft)`);
    let program: { id: string; name: string; status: string; attributionRules: unknown } | null =
      await db.program.findFirst({
        where: { name: PHASE2A_PROGRAM.name },
        select: { id: true, name: true, status: true, attributionRules: true },
      });
    const otherActive = await db.program.findFirst({
      where: { status: "active", ...(program ? { NOT: { id: program.id } } : {}) },
      select: { id: true, name: true },
    });
    if (otherActive) {
      say(`  ⚠ another ACTIVE Program exists: "${otherActive.name}" (${otherActive.id}) — final activation (step 11) will fail until it is archived/completed.`);
    }
    if (program) {
      say(`  [skip] Program already exists: ${program.id} [${program.status}]`);
    } else if (apply) {
      const created = await createProgramCore({
        name: PHASE2A_PROGRAM.name,
        startedOn: parseDateKey(PHASE2A_PROGRAM.startedOnKey),
        endsOn: parseDateKey(PHASE2A_PROGRAM.endsOnKey),
        notes: PHASE2A_PROGRAM.notes,
      });
      program = { id: created.id, name: created.name, status: created.status, attributionRules: created.attributionRules };
      say(`  ✓ created Program ${created.id} [${created.status}] (notes = archetype + blocks summary)`);
    } else {
      say(`  [dry-run] would create Program (draft) "${PHASE2A_PROGRAM.name}" ${PHASE2A_PROGRAM.startedOnKey} → ${PHASE2A_PROGRAM.endsOnKey}`);
      say(`            notes = archetype line + blocks 0–3 summary (see spec)`);
    }
    const programId = program?.id ?? "(new-program)";

    // ── STEP 3 · Goal 1 — Handstand (MUST exist; re-parent + update) ──────
    header("3", "Goal 1 · Freestanding Handstand (existing — re-parent + update)");
    const goal1 = await db.goal.findUnique({
      where: { id: PHASE2A_GOAL1.id },
      select: {
        id: true, objective: true, kind: true, status: true, programId: true,
        targetDate: true, targets: true, attributionHints: true, legend: true,
      },
    });
    if (!goal1) {
      // Diagnostic: name-alike goals under this user (identity is BY ID — a
      // similarly named goal is NOT it and is never touched).
      const lookalikes = await db.goal.findMany({
        where: { objective: { contains: "handstand", mode: "insensitive" } },
        select: { id: true, objective: true, targetDate: true },
      });
      fatal(
        `Goal 1 (Handstand) not found: ${PHASE2A_GOAL1.id}. The spec says this goal ALREADY EXISTS on the old ` +
          `model and must be re-parented, never re-created (identity matters — its history hangs off this id). ` +
          `Verify --user (${userId}) targets the right tenant and that the goal id matches the spec. NOT creating it.` +
          (lookalikes.length > 0
            ? ` Note: ${lookalikes.length} name-alike goal(s) exist under this user (${lookalikes
                .map((l) => `${l.id} "${l.objective}"`)
                .join("; ")}) — different id(s), deliberately not matched.`
            : ""),
      );
    } else if (goal1.status === "achieved") {
      fatal(
        `Goal 1 "${goal1.objective}" is status=achieved — R9: attachGoalToProgramCore rejects achieved goals. ` +
          "This should not be true for the Phase 2A handstand goal; investigate before importing.",
      );
    }

    if (goal1 && goal1.status !== "achieved") {
      say(`  found: "${goal1.objective}" [${goal1.kind}/${goal1.status}]`);

      // 3a. re-parent
      if (goal1.programId === programId) {
        say(`  [skip] already attached to this Program`);
      } else if (apply) {
        const r = await attachGoalToProgramCore(goal1.id, programId);
        say(`  ✓ attached to Program${r.previousProgramId ? ` (MOVED from ${r.previousProgramId})` : ""}`);
      } else {
        say(`  [dry-run] would attach to Program${goal1.programId ? ` (MOVE from ${goal1.programId})` : ""}`);
      }

      // 3b. targets — the spec v4 9-row repeatability table, exactly (full
      // replace; the deep-compare correctly sees prod's log:hs_* table as
      // different — stableJson recurses into the nested RollingParams, so
      // the rolling flip and any future param edit both register). The three
      // rolling:hs_* rows are ENGINE-NATIVE trackers: params on the target,
      // value computed from attempt sets, regression window-inherent.
      const desiredTargets = PHASE2A_GOAL1.targets;
      if (sameJson(goal1.targets, desiredTargets)) {
        say(`  [skip] targets already match the spec v4 9-row table (rolling:hs_* engine-native)`);
      } else if (apply) {
        await db.goal.update({
          where: { id: goal1.id },
          data: { targets: desiredTargets as unknown as Prisma.InputJsonValue },
        });
        say(`  ✓ targets ← spec v4 9-row table (max demoted to 0.12; ENGINE-NATIVE rolling:hs_* trackers carry 0.43 — params on-target, values computed from attempt sets; gates: rolling:hs_triple20_of6 + wall HSPU; chest-to-wall → 120 s; weights sum 1.00)`);
      } else {
        say(`  [dry-run] would replace targets with the spec v4 9-row table (was ${Array.isArray(goal1.targets) ? (goal1.targets as unknown[]).length : 0} rows): max demoted to 0.12; three ENGINE-NATIVE rolling:hs_* trackers (rolling:hs_sessions_10s_of6 {min 10 s, 1 hit, window 6} 0→4 w0.08 · rolling:hs_sessions_20s_of6 {min 20 s, 1 hit, window 6} 0→4 w0.15 · rolling:hs_triple20_of6 {min 20 s, 3 hits, attemptCap 5, window 6} 0→1 w0.20 GATE — engine computes from attempt sets, regression window-inherent); gates rolling:hs_triple20_of6 + wall HSPU, chest-to-wall 30→120 s, canary 0.07; weights sum 1.00`);
      }

      // 3c. attributionHints (canonicalized on write, same as update_goal)
      const desiredHints = PHASE2A_GOAL1.attributionHints.map((h) => canonicalExerciseName(h));
      if (sameJson(goal1.attributionHints, desiredHints)) {
        say(`  [skip] attributionHints already match (${desiredHints.length} hints)`);
      } else if (apply) {
        await db.goal.update({
          where: { id: goal1.id },
          data: { attributionHints: desiredHints as unknown as Prisma.InputJsonValue },
        });
        say(`  ✓ attributionHints ← ${desiredHints.length} canonical skill-work names`);
      } else {
        say(`  [dry-run] would set attributionHints (${desiredHints.length} canonical skill-work names)`);
      }

      // 3d. legend
      if (sameJson(goal1.legend, PHASE2A_GOAL1.legend)) {
        say(`  [skip] legend already set (🤸 / 🎯 / 📏)`);
      } else if (apply) {
        await db.goal.update({
          where: { id: goal1.id },
          data: { legend: PHASE2A_GOAL1.legend as unknown as Prisma.InputJsonValue },
        });
        say(`  ✓ legend ← 🤸 trained · 🎯 goal-date · 📏 baseline`);
      } else {
        say(`  [dry-run] would set legend 🤸 trained · 🎯 goal-date · 📏 baseline`);
      }

      // 3e. targetDate
      const g1DateKey = goal1.targetDate ? dateKey(goal1.targetDate) : null;
      if (g1DateKey === PHASE2A_GOAL1.targetDateKey) {
        say(`  [skip] targetDate already ${g1DateKey}`);
      } else if (apply) {
        await db.goal.update({
          where: { id: goal1.id },
          data: { targetDate: parseDateKey(PHASE2A_GOAL1.targetDateKey) },
        });
        say(`  ✓ targetDate ${g1DateKey ?? "null"} → ${PHASE2A_GOAL1.targetDateKey}`);
      } else {
        say(`  [dry-run] would set targetDate ${g1DateKey ?? "null"} → ${PHASE2A_GOAL1.targetDateKey}`);
      }

      // 3f. deactivate the auto-scaffolded plan(s) — spec: the old scaffold goes
      // inactive. Anything active under Goal 1 that isn't the Phase 2A rotation.
      const g1ActivePlans = await db.plan.findMany({
        where: { goalId: goal1.id, active: true, NOT: { name: PHASE2A_PLAN.name } },
        select: { id: true, name: true, programId: true },
      });
      if (g1ActivePlans.length === 0) {
        say(`  [skip] no active non-rotation plans on Goal 1 (scaffold already inactive or absent)`);
      } else {
        for (const p of g1ActivePlans) {
          if (apply) {
            await db.plan.update({ where: { id: p.id }, data: { active: false } });
            say(`  ✓ deactivated auto-scaffolded plan "${p.name}" (${p.id})${p.programId ? `  [was attached to Program ${p.programId}]` : ""}`);
          } else {
            say(`  [dry-run] would deactivate auto-scaffolded plan "${p.name}" (${p.id})`);
          }
        }
      }
    } else {
      say(`  [blocked] Goal-1 sub-steps (attach / targets / hints / legend / targetDate / scaffold-deactivate) previewed against a MISSING goal — resolved above as a hard-fail.`);
    }
    const goal1Id = goal1?.id ?? "(missing-goal1)";

    // ── STEP 3b · Duplicate-goal resolution (spec v4 header ⚠) ────────────
    // Two handstand goals exist: Goal 1 (KEEP) and the old someday
    // "Handstand" (cmq8pz7xp…) — abandon the latter, NEVER delete it (the
    // owner may want the history). Idempotent: skips when already abandoned.
    header("3b", "Duplicate-goal resolution · old someday Handstand (abandon, never delete)");
    const dupGoal = await db.goal.findUnique({
      where: { id: PHASE2A_DUPLICATE_GOAL.id },
      select: { id: true, objective: true, status: true, active: true, isFocus: true, notes: true },
    });
    if (!dupGoal) {
      say(`  [skip] duplicate goal ${PHASE2A_DUPLICATE_GOAL.id} not found under this user — nothing to resolve`);
    } else if (dupGoal.status === "abandoned") {
      say(`  [skip] "${dupGoal.objective}" (${dupGoal.id}) already abandoned (active=${dupGoal.active}) — resolved on a previous run`);
    } else {
      if (dupGoal.isFocus) {
        say(`  ⚠ the duplicate goal currently holds isFocus — status/active/notes are still updated; isFocus is left for the owner to move deliberately.`);
      }
      if (apply) {
        await db.goal.update({
          where: { id: dupGoal.id },
          data: {
            status: "abandoned",
            active: false,
            notes: appendDuplicateGoalNote(dupGoal.notes),
          },
        });
        say(`  ✓ "${dupGoal.objective}" (${dupGoal.id}) [was ${dupGoal.status}/active=${dupGoal.active}] → status "abandoned", active=false; superseded-by note appended. NOT deleted — history preserved; delete manually if desired.`);
      } else {
        say(`  [dry-run] would resolve "${dupGoal.objective}" (${dupGoal.id}) [currently ${dupGoal.status}/active=${dupGoal.active}]: status → "abandoned", active → false, append note "${PHASE2A_DUPLICATE_GOAL.note}" — never deleted`);
      }
    }

    // Focus snapshot — the import must not change which goal is focused.
    const focusBefore = await db.goal.findFirst({ where: { isFocus: true }, select: { id: true, objective: true } });
    say(`  focus before goal creation: ${focusBefore ? `"${focusBefore.objective}" (${focusBefore.id})` : "none"}`);

    // ── STEP 4 · Goal 2 — Reach 10% body fat (create fresh, NO plan) ──────
    header("4", "Goal 2 · Reach 10% body fat (create fresh, NO plan)");
    let goal2 = await db.goal.findFirst({
      where: { objective: PHASE2A_GOAL2.objective },
      select: { id: true, objective: true, programId: true },
    });
    if (goal2) {
      say(`  [skip] already exists: ${goal2.id}`);
      // Repair path: an interrupted earlier run may have left the unavoidable
      // scaffold active — Goal 2 must stay plan-less.
      const strayPlans = await db.plan.findMany({
        where: { goalId: goal2.id, active: true },
        select: { id: true, name: true },
      });
      for (const p of strayPlans) {
        if (apply) {
          await db.plan.update({ where: { id: p.id }, data: { active: false } });
          say(`  ✓ deactivated stray scaffold plan "${p.name}" (${p.id}) — Goal 2 is metrics-only`);
        } else {
          say(`  [dry-run] would deactivate stray scaffold plan "${p.name}" (${p.id})`);
        }
      }
    } else if (apply) {
      const created = await createGoalCore({
        objective: PHASE2A_GOAL2.objective,
        kind: PHASE2A_GOAL2.kind,
        targetDate: parseDateKey(PHASE2A_GOAL2.targetDateKey),
        notes: PHASE2A_GOAL2.notes,
        targets: [...PHASE2A_GOAL2.targets],
        legend: [...PHASE2A_GOAL2.legend],
        attributionHints: PHASE2A_GOAL2.attributionHints, // null — spec: none
      });
      say(`  ✓ created goal ${created.goal.id} (bodyFatPct start OMITTED — auto-captured at the Sept 3 DEXA)`);
      // createGoalCore has NO skip-scaffold option → a fitness goal with a
      // targetDate ALWAYS scaffolds a plan. Deactivate it immediately: the
      // spec says NO PLAN (metrics only).
      if (created.planId) {
        await db.plan.update({ where: { id: created.planId }, data: { active: false } });
        say(`  ✓ deactivated the auto-scaffolded plan ${created.planId} immediately (createGoalCore offers no skip option — documented)`);
      } else {
        say(`  (no plan was scaffolded — unexpected for fitness+targetDate, but fine)`);
      }
      goal2 = { id: created.goal.id, objective: PHASE2A_GOAL2.objective, programId: null };
    } else {
      say(`  [dry-run] would create fitness goal "${PHASE2A_GOAL2.objective}" targetDate ${PHASE2A_GOAL2.targetDateKey}`);
      say(`            targets: bodyFatPct →10% (w0.45, start omitted → auto-captured at DEXA #1), weightLb 155→143 (w0.40), Pull-Up 25→25 canary (w0.15)`);
      say(`            then IMMEDIATELY deactivate the auto-scaffolded plan (createGoalCore has no skip option — spec: NO plan)`);
    }
    const goal2Id = goal2?.id ?? "(new-goal2)";
    if (goal2 && goal2.programId !== programId) {
      if (apply) {
        await attachGoalToProgramCore(goal2.id, programId);
        say(`  ✓ attached to Program`);
      } else {
        say(`  [dry-run] would attach to Program`);
      }
    } else if (goal2) {
      say(`  [skip] already attached to this Program`);
    } else {
      say(`  [dry-run] would attach to Program`);
    }

    // ── STEP 5 · Goal 3 — AWS SAA (create fresh, project, NO targetDate) ──
    header("5", "Goal 3 · AWS Solutions Architect Associate (project, readiness-gated)");
    let goal3 = await db.goal.findFirst({
      where: { objective: PHASE2A_GOAL3.objective },
      select: { id: true, objective: true, programId: true },
    });
    if (goal3) {
      say(`  [skip] already exists: ${goal3.id}`);
    } else if (apply) {
      const created = await createGoalCore({
        objective: PHASE2A_GOAL3.objective,
        kind: PHASE2A_GOAL3.kind,
        targetDate: PHASE2A_GOAL3.targetDateKey, // null — readiness-gated, no calendar pin
        notes: PHASE2A_GOAL3.notes,
        targets: [...PHASE2A_GOAL3.targets],
        legend: [...PHASE2A_GOAL3.legend],
      });
      say(`  ✓ created project goal ${created.goal.id} (no targetDate → no plan scaffolded: kind-gate + someday path)`);
      goal3 = { id: created.goal.id, objective: PHASE2A_GOAL3.objective, programId: null };
    } else {
      say(`  [dry-run] would create project goal "${PHASE2A_GOAL3.objective}" (NO targetDate — readiness-gated ~Q1 2027)`);
      say(`            targets: log:study_hours 0→120 cumulative (w0.45), log:sections_done 0→23 snapshot (w0.30), log:practice_exam_score 0→80 snapshot GATE (w0.25)`);
    }
    const goal3Id = goal3?.id ?? "(new-goal3)";
    if (goal3 && goal3.programId !== programId) {
      if (apply) {
        await attachGoalToProgramCore(goal3.id, programId);
        say(`  ✓ attached to Program`);
      } else {
        say(`  [dry-run] would attach to Program`);
      }
    } else if (goal3) {
      say(`  [skip] already attached to this Program`);
    } else {
      say(`  [dry-run] would attach to Program`);
    }

    // Focus restore — createGoalCore grabs focus when NO goal holds it; the
    // import must be focus-neutral (Program-first resolution owns Today).
    if (apply) {
      const focusAfter = await db.goal.findFirst({ where: { isFocus: true }, select: { id: true } });
      if (focusAfter && focusAfter.id !== (focusBefore?.id ?? null) && [goal2Id, goal3Id].includes(focusAfter.id)) {
        await db.goal.update({ where: { id: focusAfter.id }, data: { isFocus: false } });
        say(`  ✓ cleared stolen focus from newly created goal (${focusAfter.id}) — import is focus-neutral`);
      }
    } else if (!focusBefore) {
      say(`  [dry-run] NOTE: no goal currently holds focus — createGoalCore would hand focus to the first created goal; the import clears it back (focus-neutral).`);
    }

    // ── STEP 2 · Program.attributionRules — the G4 rule (needs goal ids) ──
    header("2", "Program.attributionRules · G4 incline-walk rule (deferred until goal ids known)");
    const g4 = buildG4AttributionRule({ cut: goal2Id, aws: goal3Id, handstand: goal1Id });
    say(`  rule: titleContains [${g4.match.titleContains!.join(", ")}]`);
    say(`        goalIds [cut=${goal2Id}, aws=${goal3Id}, handstand=${goal1Id}]`);
    say(`        note "${g4.note}"`);
    if (program) {
      const existingRules = parseAttributionRules(program.attributionRules) ?? [];
      if (existingRules.some((r) => ruleMatchesG4(r, g4))) {
        say(`  [skip] an equivalent G4 rule is already on the Program`);
      } else if (apply) {
        await updateProgramCore(program.id, { attributionRules: [...existingRules, g4] });
        say(`  ✓ attributionRules ← ${existingRules.length} existing + G4 rule (via updateProgramCore)`);
      } else {
        say(`  [dry-run] would append the G4 rule via updateProgramCore (${existingRules.length} existing rule(s) kept)`);
      }
    } else {
      say(`  [dry-run] would set attributionRules = [G4 rule] on the new Program via updateProgramCore`);
    }

    // ── STEP 6 · Rotation plan for Goal 1 ─────────────────────────────────
    header("6", `Rotation plan "${PHASE2A_PLAN.name}"`);
    let plan = await db.plan.findFirst({
      where: { goalId: goal1Id, name: PHASE2A_PLAN.name },
      select: { id: true, name: true, active: true, programId: true },
    });
    if (plan) {
      say(`  [skip] plan already exists: ${plan.id} (active=${plan.active})`);
      if (!plan.active && apply) {
        await db.plan.update({ where: { id: plan.id }, data: { active: true } });
        say(`  ✓ re-activated (a previous partial run left it inactive)`);
      }
    } else if (apply) {
      // Plan is scoped → top-level create fires the $extends injection;
      // PlanRevision is non-scoped → safe to nest (§B.9/§B.10). Same pattern
      // as goal-core's buildPlanData scaffold.
      const created = await db.plan.create({
        data: {
          goalId: goal1Id, // real id — apply mode hard-fails at step 3 before this when Goal 1 is missing
          name: PHASE2A_PLAN.name,
          startedOn: parseDateKey(PHASE2A_PLAN.startedOnKey),
          endsOn: parseDateKey(PHASE2A_PLAN.endsOnKey),
          weeks: PHASE2A_PLAN.weeks,
          active: true,
          planJson: template as unknown as Prisma.InputJsonValue,
          revisions: {
            create: {
              triggerSource: "manual",
              summary: "Phase 2A import — initial rotation from the import spec",
              reasoning:
                "Materialized by scripts/import-phase2a.ts from examples/phase2a-goals-import-spec.md: " +
                "7-day week (upper anchor / lower+GTG / mobility / HSPU builder / lower+explosive / long-endurance / recovery) " +
                "with the daily PM A/B/C skill rotation, the S1/S2/S3 baseline split as scheduled week-1 tests on days 1/3/4 " +
                "(results logged when performed, never pre-seeded), phases mapped to Blocks 0–3, and the descent " +
                "nutrition (1,500–1,600 floor, 150–155 g protein non-negotiable, no scheduled refeeds).",
              snapshotJson: template as unknown as Prisma.InputJsonValue,
            },
          },
        },
        select: { id: true, name: true, active: true, programId: true },
      });
      plan = created;
      say(`  ✓ created plan ${created.id} + initial PlanRevision (startedOn ${PHASE2A_PLAN.startedOnKey}, ${PHASE2A_PLAN.weeks} weeks, endsOn ${PHASE2A_PLAN.endsOnKey}, active)`);
    } else {
      say(`  [dry-run] would create Plan + initial PlanRevision: startedOn ${PHASE2A_PLAN.startedOnKey}, weeks ${PHASE2A_PLAN.weeks}, endsOn ${PHASE2A_PLAN.endsOnKey}, active:true`);
      say(`            planJson: 7 DayTemplates + A/B/C PM skill rotation, baselineWeek = S1/S2/S3 split (6 tests on days 1/3/4; retests wk 10 & 19 keep the split), 4 phases = Blocks 0–3, descent nutrition per block`);
    }
    const planId = plan?.id ?? "(new-plan)";

    // attach to Program + the masked-bug-trap assert (re-read programId)
    if (plan && program) {
      if (plan.programId === program.id) {
        say(`  [skip] plan already attached to Program`);
      } else if (apply) {
        await attachPlanToProgramCore(plan.id, program.id);
        say(`  ✓ attached plan to Program (attachPlanToProgramCore)`);
      } else {
        say(`  [dry-run] would attach plan to Program (attachPlanToProgramCore)`);
      }
      if (apply) {
        const reread = await db.plan.findUnique({ where: { id: plan.id }, select: { programId: true } });
        if (reread?.programId !== program.id) {
          throw new Error(
            `HARD FAIL: Plan.programId did not persist (expected ${program.id}, read back ${reread?.programId ?? "null"}) — ` +
              "the masked-bug trap: with isFocus populated the legacy path keeps Today alive and the Program never owns the rotation.",
          );
        }
        say(`  ✓ ASSERT Plan.programId persisted (${reread.programId})`);
      }
    } else {
      say(`  [dry-run] would attach plan to Program, then RE-READ Plan.programId and hard-fail if null (masked-bug trap)`);
    }

    // ── STEP 6b · Plan baselineWeek reconcile — S1/S2/S3 split (spec v4) ──
    // Prod carries the single-session 7-test battery; the spec v4 split is
    // applied as a PROPER PlanRevision (full snapshot = live planJson with
    // only baselineWeek replaced — protocol text lives inside it), using the
    // same tx pattern as the apply_plan_revision tool: lintTemplate first
    // (errors refuse), then planRevision.create + plan.update(planJson) in
    // ONE transaction. Content-equal → skip (idempotent re-run).
    header("6b", "Plan baselineWeek reconcile · S1–S3 split (spec v4, PlanRevision)");
    if (!plan) {
      say(`  [dry-run] plan doesn't exist yet — the step-6 create already carries the v4 S1/S2/S3 baselineWeek; no reconcile revision needed on first import.`);
    } else {
      const planFull = await db.plan.findUniqueOrThrow({
        where: { id: plan.id },
        select: { id: true, planJson: true, weeks: true, startedOn: true, endsOn: true },
      });
      const liveTemplate = planFull.planJson as unknown as ProgramTemplate;
      if (!baselineWeekNeedsReconcile(liveTemplate)) {
        say(`  [skip] live planJson.baselineWeek already matches the v4 S1/S2/S3 split (content compare, key-order-insensitive)`);
      } else {
        const snapshot = buildBaselineWeekRevisionSnapshot(liveTemplate);
        const revLint = lintTemplate(snapshot, {
          weeks: planFull.weeks,
          startedOn: planFull.startedOn,
          endsOn: planFull.endsOn,
          goalTargetDate: parseDateKey(PHASE2A_GOAL1.targetDateKey),
        });
        const revLintErrors = revLint.filter((f) => f.severity === "error");
        say(`  lintTemplate(reconcile snapshot): ${revLint.length === 0 ? "CLEAN (0 findings)" : `${revLint.length} finding(s)`}`);
        for (const f of revLint) say(`    [${f.severity}] ${f.rule}: ${f.message}`);
        const liveDayCount = Array.isArray(liveTemplate.baselineWeek) ? liveTemplate.baselineWeek.length : 0;
        const liveTestCount = (liveTemplate.baselineWeek ?? []).reduce((n, d) => n + (d.tests?.length ?? 0), 0);
        const newTestCount = PHASE2A_BASELINE_WEEK.reduce((n, d) => n + d.tests.length, 0);
        if (revLintErrors.length > 0) {
          fatal(
            `baselineWeek reconcile snapshot fails lintTemplate with ${revLintErrors.length} error(s) — refusing to write a broken revision: ` +
              revLintErrors.map((f) => `[${f.rule}] ${f.message}`).join(" "),
          );
        } else if (apply) {
          const revision = await db.$transaction(async (tx) => {
            const r = await tx.planRevision.create({
              data: {
                planId: planFull.id,
                triggerSource: "manual",
                summary: PHASE2A_BASELINE_SPLIT_SUMMARY,
                reasoning: PHASE2A_BASELINE_SPLIT_REASONING,
                snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
              },
            });
            await tx.plan.update({
              where: { id: planFull.id },
              data: { planJson: snapshot as unknown as Prisma.InputJsonValue },
            });
            return r;
          });
          say(`  ✓ PlanRevision ${revision.id} applied — baselineWeek ${liveDayCount} day(s)/${liveTestCount} test(s) → S1 (day 1) / S2 (day 3) / S3 (day 4), ${newTestCount} tests; Plan.planJson updated in the same tx`);
          say(`    summary: "${PHASE2A_BASELINE_SPLIT_SUMMARY}"  triggerSource: manual`);
        } else {
          say(`  [dry-run] would apply PlanRevision "${PHASE2A_BASELINE_SPLIT_SUMMARY}" (triggerSource manual):`);
          say(`            baselineWeek ${liveDayCount} day(s)/${liveTestCount} test(s) → S1 Mon (day 1: Freestanding Hold + L-Sit) / S2 Wed (day 3: Wall HSPU + Floating Pike) / S3 Thu (day 4: Chest-to-Wall + Pull-Up re-log), ${newTestCount} tests, retests wk 10 & 19 keep the split`);
          say(`            full snapshot = live planJson with only baselineWeek replaced (chest-to-wall hand-distance protocol + retest consistency rule ride inside it); reasoning quotes the spec's why-split paragraph; planRevision.create + plan.update in ONE tx`);
        }
      }
    }

    // ── STEP 6c · Milestone data point — 2026-08-09 video-verified hold ───
    // A DATA POINT on record, NOT an S1 result and NOT pre-seeding: dated
    // the day BEFORE plan start so it can never credit the S1 initial
    // checkpoint window. Idempotent by (testName, calendar day).
    header("6c", "Milestone data point · Freestanding Handstand Hold 10 s (2026-08-09)");
    const msDate = parseDateInput(PHASE2A_MILESTONE_BASELINE.dateKey);
    const msExisting = await db.baseline.findFirst({
      where: {
        testName: PHASE2A_MILESTONE_BASELINE.testName,
        date: { gte: startOfDay(msDate), lte: endOfDay(msDate) },
      },
      select: { id: true, value: true, units: true },
    });
    if (msExisting) {
      say(`  [skip] a "${PHASE2A_MILESTONE_BASELINE.testName}" row already exists on ${PHASE2A_MILESTONE_BASELINE.dateKey} (${msExisting.id}: ${msExisting.value} ${msExisting.units}) — milestone already on record`);
    } else if (apply) {
      const created = await db.baseline.create({
        data: {
          testName: PHASE2A_MILESTONE_BASELINE.testName,
          value: PHASE2A_MILESTONE_BASELINE.value,
          units: PHASE2A_MILESTONE_BASELINE.units,
          date: msDate,
          notes: PHASE2A_MILESTONE_BASELINE.notes,
        },
        select: { id: true },
      });
      say(`  ✓ Baseline ${created.id}: "${PHASE2A_MILESTONE_BASELINE.testName}" = ${PHASE2A_MILESTONE_BASELINE.value} ${PHASE2A_MILESTONE_BASELINE.units} on ${PHASE2A_MILESTONE_BASELINE.dateKey} (USER_TZ) — data point, not S1; S1 confirms or raises it`);
    } else {
      say(`  [dry-run] would create Baseline "${PHASE2A_MILESTONE_BASELINE.testName}" = ${PHASE2A_MILESTONE_BASELINE.value} ${PHASE2A_MILESTONE_BASELINE.units} on ${PHASE2A_MILESTONE_BASELINE.dateKey} (USER_TZ via parseDateInput)`);
      say(`            notes: "${PHASE2A_MILESTONE_BASELINE.notes}"`);
      say(`            idempotent by (testName, date) — a DATA POINT, not an S1 result (dated before plan start; cannot credit the S1 checkpoint window)`);
    }

    // ── STEP 7 · Scheduled checkpoints + weigh-in standing rule ───────────
    header("7", "Scheduled items (DEXA ×3 · practice exams ×2 · photos ×4 · cluster decision ×1) + weigh-in rule");
    const goalIdFor = (key: Phase2aScheduledItem["goalKey"]) =>
      key === "bodycomp" ? goal2Id : key === "aws" ? goal3Id : goal1Id;
    for (const item of PHASE2A_SCHEDULED_ITEMS) {
      const gid = goalIdFor(item.goalKey);
      const existing =
        gid.startsWith("(") // dry-run placeholder — goal doesn't exist yet
          ? null
          : await db.scheduledItem.findFirst({
              where: { goalId: gid, externalRef: item.externalRef },
              select: { id: true },
            });
      if (existing) {
        say(`  [skip] ${item.externalRef} already exists (${existing.id})`);
      } else if (apply) {
        const created = await db.scheduledItem.create({
          data: {
            goalId: gid,
            date: parseDateKey(item.dateKey),
            type: item.type,
            title: item.title,
            detail: item.detail,
            status: "planned",
            externalRef: item.externalRef,
          },
          select: { id: true },
        });
        say(`  ✓ ${item.dateKey}  [${item.goalKey}]  "${item.title}"  (${created.id})`);
      } else {
        say(`  [dry-run] would create ${item.dateKey}  [${item.goalKey}/${item.type}]  "${item.title}"  externalRef=${item.externalRef}`);
      }
    }
    // Weekly weigh-ins: ONE standing rule, not 20 rows (documented decision —
    // standing rules are how recurring cadence works today; the coach surfaces
    // them every session, and get_today_plan is not driven by 20 dated rows).
    const weighKey = standingRuleKey(PHASE2A_WEIGHIN_RULE);
    const weighExisting = await db.note.findFirst({
      where: { type: "standing_rule", body: { startsWith: weighKey } },
      select: { id: true },
    });
    if (weighExisting) {
      say(`  [skip] weigh-in standing rule already exists (${weighExisting.id})`);
    } else if (apply) {
      const n = await db.note.create({
        data: { body: PHASE2A_WEIGHIN_RULE.body, type: "standing_rule", lastAcknowledgedAt: new Date() },
        select: { id: true },
      });
      say(`  ✓ weigh-in cadence standing rule created (${n.id}) — Sun/Mon weekly, NOT materialized as 20 rows`);
    } else {
      say(`  [dry-run] would create the Sun/Mon weigh-in cadence as ONE standing_rule Note (not 20 ScheduledItem rows)`);
    }

    // ── STEP 8 · Plan-day overrides ───────────────────────────────────────
    header("8", "Overrides · Mirror Lake (sacred) + deloads + soft break + Oct TBD trip");
    const overrides = buildPhase2aOverrides();
    for (const ov of overrides) {
      const date = parseDateKey(ov.dateKey);
      const existing =
        planId.startsWith("(")
          ? null
          : await prisma.planDayOverride.findUnique({
              where: { planId_date: { planId, date } },
              select: { id: true },
            });
      if (existing) {
        say(`  [skip] ${ov.dateKey}  ${ov.label} — override already exists (${existing.id})`);
      } else if (apply) {
        // PlanDayOverride is non-scoped (no userId column) — planId carries
        // tenancy; direct create via the raw client per gotcha §B.9.
        const created = await prisma.planDayOverride.create({
          data: {
            planId,
            date,
            workoutJson: ov.workoutJson
              ? (ov.workoutJson as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            nutritionText: ov.nutritionText ?? null,
            mobilityText: ov.mobilityText ?? null,
            notes: ov.notes,
          },
          select: { id: true },
        });
        say(`  ✓ ${ov.dateKey}  ${ov.label}${ov.workoutJson ? `  [day swap: "${ov.workoutJson.title}"]` : "  [note-only]"}  (${created.id})`);
      } else {
        say(`  [dry-run] would create ${ov.dateKey}  ${ov.label}${ov.workoutJson ? `  [day swap: "${ov.workoutJson.title}"]` : "  [note-only]"}`);
      }
    }

    // ── STEP 9 · Saved meals ──────────────────────────────────────────────
    header("9", "SavedMeals · Protein Brookie + Chipotle Protein Bowl");
    for (const meal of PHASE2A_SAVED_MEALS) {
      const existing = await db.savedMeal.findFirst({
        where: { name: { equals: meal.name, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (existing) {
        say(`  [skip] "${existing.name}" already saved (${existing.id})`);
      } else if (apply) {
        const created = await db.savedMeal.create({
          data: {
            name: meal.name,
            items: meal.items as unknown as Prisma.InputJsonValue,
            macros: meal.macros as unknown as Prisma.InputJsonValue,
            defaultServings: meal.defaultServings,
          },
          select: { id: true },
        });
        say(`  ✓ "${meal.name}" (${meal.macros.calories} cal / ${meal.macros.fatG}F / ${meal.macros.proteinG}P / ${meal.macros.carbsG}C)  (${created.id})`);
      } else {
        say(`  [dry-run] would save "${meal.name}" (${meal.macros.calories} cal / ${meal.macros.fatG}F / ${meal.macros.proteinG}P / ${meal.macros.carbsG}C)`);
      }
    }

    // ── STEP 10 · Standing rules (the descent + the disruption cluster) ───
    header("10", "Standing rules · the descent + Sep 24 – Oct 5 cluster");
    const nutriKey = standingRuleKey(PHASE2A_NUTRITION_RULE);
    const nutriExisting = await db.note.findFirst({
      where: { type: "standing_rule", body: { startsWith: nutriKey } },
      select: { id: true },
    });
    if (nutriExisting) {
      say(`  [skip] descent standing rule already exists (${nutriExisting.id})`);
    } else if (apply) {
      const n = await db.note.create({
        data: { body: PHASE2A_NUTRITION_RULE.body, type: "standing_rule", lastAcknowledgedAt: new Date() },
        select: { id: true },
      });
      say(`  ✓ descent standing rule created (${n.id}) — 1,500–1,600 floor · 150–155 g protein non-negotiable · unplanned high days · pull-up canary · 10-floor-day soft flag · no pre-peak deficit chasing`);
    } else {
      say(`  [dry-run] would create the descent standing rule (floor 1,500–1,600 · protein floor · unplanned high days · canary watch · 10-consecutive-floor-days soft flag · Greek-yogurt default · no pre-peak deficit chasing)`);
    }
    // Spec-v2 delta: the disruption-cluster rule (same first-line idempotency).
    const clusterKey = standingRuleKey(PHASE2A_CLUSTER_RULE);
    const clusterExisting = await db.note.findFirst({
      where: { type: "standing_rule", body: { startsWith: clusterKey } },
      select: { id: true },
    });
    if (clusterExisting) {
      say(`  [skip] disruption-cluster standing rule already exists (${clusterExisting.id})`);
    } else if (apply) {
      const n = await db.note.create({
        data: { body: PHASE2A_CLUSTER_RULE.body, type: "standing_rule", lastAcknowledgedAt: new Date() },
        select: { id: true },
      });
      say(`  ✓ disruption-cluster standing rule created (${n.id}) — options a/b/c decide by mid-Sep · maintenance on travel days in BOTH windows · rolling-window rates provisional until 6 fresh sessions post-Oct 5`);
    } else {
      say(`  [dry-run] would create the Sep 24 – Oct 5 disruption-cluster standing rule (a: absorb / b: shift Deload #1 to Oct 2–5 / c: front-load Block 1 — decide by mid-September · maintenance on all travel days in BOTH windows · rolling-window caveat · Oct 2–8 scheduling exclusion)`);
    }

    // ── STEP 11 · Verification block, then activate LAST ──────────────────
    header("11", "Verification" + (apply ? " → activate Program LAST" : " (dry-run summary)"));
    if (apply && program && plan) {
      const members = await db.goal.findMany({
        where: { programId: program.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, objective: true, kind: true, status: true, targets: true },
      });
      const planRow = await db.plan.findUnique({
        where: { id: plan.id },
        select: { id: true, programId: true, active: true, weeks: true },
      });
      const ovRows = await prisma.planDayOverride.findMany({
        where: { planId: plan.id },
        orderBy: { date: "asc" },
        select: { date: true },
      });
      const itemCount = await db.scheduledItem.count({
        where: { externalRef: { startsWith: "phase2a:" } },
      });
      const mealCount = await db.savedMeal.count({
        where: { name: { in: PHASE2A_SAVED_MEALS.map((m) => m.name) } },
      });

      say(`  Program:        ${program.id} "${program.name}" [${program.status}]`);
      say(`  Member goals (${members.length}):`);
      for (const m of members) {
        const tCount = Array.isArray(m.targets) ? (m.targets as unknown[]).length : 0;
        say(`    - ${m.id}  [${m.kind}/${m.status}]  "${m.objective}"  targets=${tCount}`);
      }
      say(`  Rotation plan:  ${planRow?.id}  active=${planRow?.active}  weeks=${planRow?.weeks}  programId=${planRow?.programId}`);
      if (planRow?.programId !== program.id) throw new Error("VERIFY FAIL: rotation plan programId mismatch");
      if (members.length !== 3) throw new Error(`VERIFY FAIL: expected 3 member goals, found ${members.length}`);
      say(`  Override dates (${ovRows.length}): ${ovRows.map((o) => dateKey(o.date)).join(", ")}`);
      say(`  Scheduled items (phase2a:*): ${itemCount}`);
      say(`  Saved meals: ${mealCount}`);

      const status = await setProgramStatusCore(program.id, "active");
      say(`  ✓ Program status: ${status.previousStatus} → ${status.status}  (activation LAST, after all content landed)`);
    } else {
      say(`  [dry-run] would verify: Program + 3 member goals w/ target counts (9/3/3), plan.programId assert,`);
      say(`            ${buildPhase2aOverrides().length} override dates, ${PHASE2A_SCHEDULED_ITEMS.length} scheduled items, ${PHASE2A_SAVED_MEALS.length} saved meals —`);
      say(`            then setProgramStatusCore(program, "active") as the FINAL write.`);
    }

    // ── STEP 12 · Post-import assertions (apply mode) ─────────────────────
    header("12", "Post-import assertions");
    if (apply && program && plan) {
      const active = await getActiveProgram();
      if (active?.id !== plan.id) {
        throw new Error(
          `ASSERT FAIL: getActiveProgram().id = ${active?.id ?? "null"}, expected rotation plan ${plan.id}. ` +
            "Program-first resolution is not serving the Phase 2A rotation.",
        );
      }
      say(`  ✓ getActiveProgram().id === rotation plan id (${plan.id})`);
      const membership = await getActiveProgramMembership();
      const memberIds = new Set(membership?.memberGoals.map((g) => g.id) ?? []);
      const want = [goal1Id, goal2Id, goal3Id];
      if (!membership || membership.memberGoals.length !== 3 || !want.every((id) => memberIds.has(id))) {
        throw new Error(
          `ASSERT FAIL: getActiveProgramMembership() lists [${[...memberIds].join(", ")}], expected exactly [${want.join(", ")}].`,
        );
      }
      say(`  ✓ getActiveProgramMembership() lists the 3 member goals`);
      say(`  (nothing else computed here — the §1 gate script owns the rest)`);
    } else {
      say(`  [dry-run] would assert getActiveProgram().id === new plan id and membership lists exactly the 3 goals.`);
    }

    // ── Output-only notes ─────────────────────────────────────────────────
    say("");
    say("  ── NOTES (printed, never written) ──────────────────────────────");
    say(`  • ${PULLUP_CORRECTION_NOTE}`);
    say(`  • ${ROLLING_PROTOCOL_NOTE}`);
    say(`  • ${BODYFAT_VERIFY_NOTE}`);
    // Spec v4 ⚠ verification answers — stated as FACTS (verified against
    // src/lib/goal-targets.ts resolveMetricValue/resolveMetricStart and
    // src/lib/readiness.ts computeReadiness, not guessed).
    say(`  • ${BASELINE_RESOLUTION_FACT}`);
    say(`  • ${LOG_SNAPSHOT_IMPORT_STATE_FACT}`);
    say(
      "  • Rotation horizon: 20 weeks ends Dec 27 (endsOn 2026-12-28 = startedOn + 140 d, lint-clean); the Program window runs to Dec 31 — " +
        "the spec's own Christmas-travel tension (rung-2 test preferred ~Dec 20–22, BEFORE traveling).",
    );
    if (fatalProblems.length > 0) {
      say("");
      say(`  ✗ DRY-RUN FOUND ${fatalProblems.length} BLOCKING PROBLEM(S) — --apply would hard-fail:`);
      for (const p of fatalProblems) say(`    - ${p}`);
      process.exitCode = 1;
    }
    say("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? `\n✗ ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
