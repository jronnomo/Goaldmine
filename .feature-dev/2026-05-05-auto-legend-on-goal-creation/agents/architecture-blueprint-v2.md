# Architecture Blueprint v2 — Auto-legend on goal creation

Date: 2026-05-05
Source PRD: `docs/prds/PRD-auto-legend-on-goal-creation.md`
Requirements: `.feature-dev/2026-05-05-auto-legend-on-goal-creation/phases/requirements.md`
Research: `.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/research-output.md`
v1 blueprint: `architecture-blueprint.md`
Critique: `architecture-critique.md`

> **PRD correction note (carried from v1)**: PRD claims tool count goes 38 → 39. Actual baseline is **33** (research §10). Locked target is **33 → 34**. QA verifies via `tools/list` curl.

---

## A. Reconciled facts (locked)

Carried verbatim from v1:

1. **Tool count**: today = 33. After this PR = 34. Update PRD acceptance criterion #8 to read "tools/list returns 34".
2. **`LegendSchema` import**: already present at `src/lib/mcp/tools.ts:24`. Do NOT re-import.
3. **Operating-rules verbatim source**: `src/app/api/mcp/[token]/route.ts:67-89`, constant `COACH_INSTRUCTIONS`. Pull all 10 existing rules from there.
4. **Existing rules already include rule 10** (Nutrition). The new auto-legend rule is **rule 11**.
5. **Empty legend on create**: `legend: []` from caller → store DB null via `Prisma.JsonNull`; `legend === undefined` → omit field. Both yield NULL column; the distinction is intent.
6. **`Prisma` namespace import**: already at `tools.ts:6`. Same path for `goal-core.ts`: `import { Prisma } from "@/generated/prisma/client"`.

**v2 resolutions added (one-liner each):**

7. **Blocker 1 (Critique §B) — `LegendSchema` accepts `[]`**: Zod schema acceptance of `[]` is fine; runtime normalizes `[] → JsonNull` (= "no legend, fall back to default"). `create_goal` description explicitly states "`legend: []` and omitting `legend` are equivalent — both leave the goal on the default legend; pass an array of entries to set a custom one." PRD §6 wording fixed in phase-7 doc cleanup, not this blueprint.
8. **Blocker 2 (Critique §F) — Triple-source drift**: `COACH_INSTRUCTIONS` constant in `src/app/api/mcp/[token]/route.ts:67-89` gets rule 11 appended at the END (preserves 1-10 numbering). In-repo doc + deployed `instructions` field stay aligned. User still pastes once into claude.ai connector; final report supplies the paste block. New requirement REQ-D2 covers this (folded into REQ-D1's checklist).
9. **Concern D (USER_TZ asymmetry)**: form path now uses `parseDateKey` from `@/lib/calendar` (matches CLAUDE.md gotcha #5). Both surfaces store the same UTC-encoded USER_TZ midnight. **Caveat (audited)**: `parseDateKey` at `src/lib/calendar.ts:509-512` does NOT itself validate the input format — it `split("-").map(Number)` and trusts the result. So the form's existing `Number.isNaN(targetDate.getTime())` guard is RETAINED to catch malformed inputs (e.g. `"not-a-date"` → NaN parts → `userTzWallClockToUTC(NaN,NaN,NaN)` → invalid Date). Net: 1-line import + 1-line replacement; existing NaN guard stays.
10. **Concern A (validation guards in core)**: `createGoalCore` now contains `objective`/`targetDate` guards (`!objective.trim()` and `Number.isNaN(targetDate.getTime())`). Form retains its own UI-friendly guards. Belt-and-suspenders; one error envelope reaches the user (form throws first; if a future caller skips the form path, core still throws).
11. **Concern H (`scaffoldPlanFromTemplate(1)` audit)**: developer reads `src/lib/plan.ts` as a one-time recon before implementing REQ-A1. If the function throws on `weeks=1`, add `if (weeks < 2) throw new Error("targetDate too soon — need at least 2 weeks")` inside `createGoalCore` after `weeksBetween`. Result recorded in §E risk register at QA time.
12. **Concern K (notes normalization)**: `createGoalCore` normalizes `notes: notes?.trim() || null`. Eliminates `""` vs `null` divergence between form and MCP paths.

---

## B. Agent assignment

| Agent | Scope | REQs | Files (no overlap with peer) |
|-------|-------|------|------------------------------|
| Agent 1 (Backend) | Extract core + register MCP tool + fix form USER_TZ | REQ-A1 → REQ-B1 sequentially | `src/lib/goal-core.ts` (NEW), `src/lib/goal-actions.ts` (MODIFY — `createGoal` body + `parseDateKey` import), `src/lib/legend.ts` (MODIFY only if `Legend` type export missing), `src/lib/mcp/tools.ts` (MODIFY — INSERT `create_goal` block only) |
| Agent 2 (Description + Docs) | Sharpen description + author rules doc + append rule 11 to `COACH_INSTRUCTIONS` | REQ-B2 + REQ-D1 (incl. D2) in parallel | `src/lib/mcp/tools.ts` (MODIFY — replace `update_goal_legend` description literal only), `docs/server-instructions/goaldmine-rules.md` (NEW), `src/app/api/mcp/[token]/route.ts` (MODIFY — append rule 11 to `COACH_INSTRUCTIONS` only) |

**File overlap re-check (v2)**:
- `tools.ts`: Agent 1 inserts after the `update_goal_legend` registration's closing `);` (around line 1062). Agent 2 replaces ONLY the description literal at ~line 1037. Line-disjoint.
- `[token]/route.ts`: Agent 2 only. Disjoint from Agent 1's footprint.
- `goal-actions.ts`: Agent 1 only.
- `goal-core.ts` / `legend.ts`: Agent 1 only.
- `goaldmine-rules.md`: Agent 2 only.

No conflict introduced by v2's expansion. Worktrees + parallel safe.

---

## C. File-level changes

### C.1 NEW `src/lib/goal-core.ts`

```ts
// Plain async helper (NO "use server"). Importable from MCP route handlers and from src/lib/goal-actions.ts.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { scaffoldPlanFromTemplate, weeksBetween } from "@/lib/plan";
import type { GoalTarget } from "@/lib/goal-actions";
import type { Legend } from "@/lib/legend";

export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date;
  notes?: string | null;
  copyFromGoalId?: string | null;
  targets?: GoalTarget[] | null;
  legend?: Legend;
}

export interface CreateGoalCoreResult {
  goal: { id: string };
  planId: string;
}

export async function createGoalCore(
  input: CreateGoalCoreInput,
): Promise<CreateGoalCoreResult> {
  const { objective, targetDate, copyFromGoalId } = input;

  // v2 — Concern A: defensive guards inside core. Form callers also pre-check
  // for UI-friendly messages; this is the contract boundary for any caller.
  if (!objective.trim()) throw new Error("objective required");
  if (Number.isNaN(targetDate.getTime())) throw new Error("invalid targetDate");

  // v2 — Concern K: normalize notes to null when blank. Form already does this;
  // MCP callers may pass "" which would otherwise round-trip as empty string.
  const normalizedNotes = input.notes?.trim() || null;

  let targets = input.targets ?? null;
  if (!targets && copyFromGoalId) {
    const source = await prisma.goal.findUnique({ where: { id: copyFromGoalId } });
    if (source && source.targets) {
      targets = source.targets as unknown as GoalTarget[];
    }
  }

  const now = new Date();
  const weeks = weeksBetween(now, targetDate);

  // v2 — Concern H: developer must verify scaffoldPlanFromTemplate(1) does not
  // throw before shipping. If it does, uncomment the guard below.
  // if (weeks < 2) throw new Error("targetDate too soon — need at least 2 weeks");

  const planTemplate = scaffoldPlanFromTemplate(weeks);

  // Legend handling: undefined → omit; [] → JsonNull (default); non-empty → cast.
  const legendForCreate: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.legend === undefined
      ? undefined
      : input.legend.length === 0
        ? Prisma.JsonNull
        : (input.legend as unknown as Prisma.InputJsonValue);

  const goal = await prisma.goal.create({
    data: {
      objective,
      targetDate,
      notes: normalizedNotes,
      targets: targets ?? undefined,
      ...(legendForCreate === undefined ? {} : { legend: legendForCreate }),
      plans: {
        create: {
          name: `${objective} — ${weeks}-week plan`,
          startedOn: now,
          endsOn: targetDate,
          weeks,
          active: true,
          planJson: planTemplate as unknown as object,
          revisions: {
            create: {
              triggerSource: "manual",
              summary: "Initial plan from program template",
              reasoning: `Scaffolded from the program template, scaled to ${weeks} weeks across ${planTemplate.phases.length} phases.`,
              snapshotJson: planTemplate as unknown as object,
            },
          },
        },
      },
    },
    include: { plans: { select: { id: true } } },
  });

  const planId = goal.plans[0]?.id ?? "";
  return { goal: { id: goal.id }, planId };
}
```

Notes for developer:
- `Legend` type may need to be exported from `src/lib/legend.ts` (`export type Legend = z.infer<typeof LegendSchema>`). Verify and add if missing.
- `GoalTarget` import is `import type` — circular-safe; type-only imports are erased.
- `include: { plans: { select: { id: true } } }` adds a small per-call cost but surfaces `planId` for the MCP return shape. Form caller doesn't use it.
- **Concern H audit task**: dev opens `src/lib/plan.ts`, locates `scaffoldPlanFromTemplate`, traces the `weeks=1` branch. Record outcome (throws? clamps? returns 1-week plan?) in PR description and risk register entry.

### C.2 MODIFY `src/lib/goal-actions.ts` — refactored `createGoal` (v2: USER_TZ fix)

Add at top (with other imports):

```ts
import { createGoalCore } from "@/lib/goal-core";
import { parseDateKey } from "@/lib/calendar";
```

Replace `createGoal` body with:

```ts
export async function createGoal(form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const copyFromGoalId = (form.get("copyFromGoalId") as string | null)?.trim() || null;

  // UI-friendly guards (kept). Core re-checks defensively.
  if (!objective) throw new Error("Objective is required");
  if (!targetDateStr) throw new Error("Target date is required");

  // v2 — Concern D: align with MCP path; both routes store USER_TZ midnight via
  // calendar helper instead of `new Date(yyyy-mm-dd)` (which yields UTC midnight,
  // rendering one calendar cell early in MT). HTML <input type="date"> returns
  // yyyy-mm-dd; parseDateKey accepts that. parseDateKey itself does not validate
  // the format (it Number-coerces the split parts), so the NaN guard below is
  // retained to catch malformed input.
  const targetDate = parseDateKey(targetDateStr);
  if (Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date");

  const targets = parseTargetsField(form.get("targets"));

  const { goal } = await createGoalCore({
    objective,
    targetDate,
    notes,
    copyFromGoalId,
    targets,
  });

  revalidatePath("/goals");
  revalidatePath("/stats");
  redirect(`/goals/${goal.id}`);
}
```

**Unchanged** (do not touch): `parseTargetsField`, `copyTargetsFromGoal`, `updateGoal`, `deleteGoal`, `addGoalReference`, `removeGoalReference`, `GoalReference` and `GoalTarget` types.

### C.3 MODIFY `src/lib/mcp/tools.ts` — INSERT `create_goal`

Add import near other lib imports at top:

```ts
import { createGoalCore } from "@/lib/goal-core";
```

(`LegendSchema` is already imported at line 24 — do NOT re-import.)

Insert this block immediately AFTER the `update_goal_legend` registration block (after the closing `);` of that registration, around line 1062):

```ts
server.registerTool(
  "create_goal",
  {
    title: "Create a new goal (with optional legend)",
    description:
      "Scaffold a new Goal + Plan + initial PlanRevision in one nested write. The plan is sized to the weeks between today and `targetDate` and seeded from the program template. Pass `legend` inline when the goal flavor differs from the default hike — saves a follow-up update_goal_legend call. See update_goal_legend's description for preset examples (hike, strength, running, snowboard, hybrid-endurance). `legend: []` and omitting `legend` are equivalent — both leave the goal on the default legend; pass an array of entries to set a custom one. `targetDate` must be `YYYY-MM-DD`; resolve any relative dates (\"tomorrow\", \"next Friday\") yourself before calling. Past targetDate is accepted (clamps to a 1-week plan ending in the past); only call with past dates intentionally. `copyFromGoalId` copies the targets array from any existing goal regardless of status (no-op if source missing or has no targets). If you receive an unclear response, call `list_goals` BEFORE retrying — duplicates are NOT auto-prevented. Use update_goal_targets afterward to set readiness targets. Does NOT auto-deactivate other goals.",
    inputSchema: {
      objective: z.string().min(1).max(200),
      targetDate: DateKeyShape,
      notes: z.string().optional(),
      copyFromGoalId: z
        .string()
        .optional()
        .describe("Copy targets array from this existing goal (any status; no-op if missing or empty)."),
      legend: LegendSchema.optional().describe(
        "Calendar legend for this goal. Pass an empty array or omit to leave the goal on the default legend.",
      ),
    },
  },
  async ({ objective, targetDate, notes, copyFromGoalId, legend }) =>
    safe(async () => {
      const parsed = parseDateInput(targetDate);
      const { goal, planId } = await createGoalCore({
        objective,
        targetDate: parsed,
        notes: notes ?? null,
        copyFromGoalId: copyFromGoalId ?? null,
        legend,
      });
      return {
        goalId: goal.id,
        planId,
        message: `Goal created: ${objective}${legend && legend.length > 0 ? " (with custom legend)" : ""}`,
      };
    }),
);
```

### C.4 MODIFY `src/lib/mcp/tools.ts` — REWRITE `update_goal_legend` description

Replace ONLY the `description:` string literal inside the existing `update_goal_legend` registration. Final string (verbatim):

```
"Replace the goal's legend array (drives the calendar legend AND which icons render in cells). Pass empty array or omit to reset to the built-in default. Each entry = { icon, label, kind } where kind ∈ {trained, hike-completed, hike-planned, override, goal-date}: trained=days a workout exists, hike-completed=logged outdoor day, hike-planned=upcoming hike, override=custom day-level marker, goal-date=the goal's target date pin. Closed enum; passing a `kind` outside this set fails Zod validation and returns an error envelope — new render conditions need a code change. `icon` is a free-form string (any emoji or character); only `kind` is enumerated.\n\nPreset legends (single-line JSON, pick + adapt to the goal's flavor):\nhike: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🥾\",\"label\":\"Outdoor day\",\"kind\":\"hike-completed\"},{\"icon\":\"🥾\",\"label\":\"Hike planned\",\"kind\":\"hike-planned\"},{\"icon\":\"★\",\"label\":\"Custom day\",\"kind\":\"override\"},{\"icon\":\"🏔️\",\"label\":\"Goal date\",\"kind\":\"goal-date\"}]\nstrength: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏋️\",\"label\":\"Heavy day\",\"kind\":\"override\"},{\"icon\":\"🏆\",\"label\":\"Meet day\",\"kind\":\"goal-date\"}]\nrunning: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏃\",\"label\":\"Long run\",\"kind\":\"override\"},{\"icon\":\"🥇\",\"label\":\"Race day\",\"kind\":\"goal-date\"}]\nsnowboard: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏂\",\"label\":\"Ride day\",\"kind\":\"override\"},{\"icon\":\"🎿\",\"label\":\"Season opener\",\"kind\":\"goal-date\"}]\nhybrid-endurance: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏃\",\"label\":\"Run\",\"kind\":\"override\"},{\"icon\":\"🥾\",\"label\":\"Trail\",\"kind\":\"hike-completed\"},{\"icon\":\"🥾\",\"label\":\"Trail planned\",\"kind\":\"hike-planned\"},{\"icon\":\"🏁\",\"label\":\"Race day\",\"kind\":\"goal-date\"}]\n\nWhen you create or activate a non-hike goal, propose a goal-appropriate legend immediately. Follow 'Propose before applying' — show the proposed legend, get approval, then call this tool (or pass `legend` directly to create_goal). If the user names a flavor ('use the strength legend'), apply the matching preset without further prompting."
```

**Char budget**: developer must measure final string length and report in PR description. Cap: 1800 chars. v1 estimate ~1730; v2 added "Closed enum…error envelope" + "icon is free-form" (~150 chars), pushing close to 1880 — **dev must measure**; if over 1800, drop the `hybrid-endurance` preset first (longest, least-used).

**Emoji caution**: copy emojis from this blueprint or the requirements doc directly; do not retype `🏋️` / `🏔️` / `🥾` (they include variation selectors that can normalize away). Verify rendering via `tools/list` curl during QA.

### C.5 NEW `docs/server-instructions/goaldmine-rules.md`

Doc body — pull rules 1-10 verbatim from `src/app/api/mcp/[token]/route.ts:67-89` (do NOT paraphrase). Append rule 11 fresh.

```markdown
# Goaldmine MCP server-instructions — canonical source

Paste applicable sections into the **claude.ai → Goaldmine connector** instructions block. This doc is the source of truth; the deployed server's `COACH_INSTRUCTIONS` constant in `src/app/api/mcp/[token]/route.ts:67-89` is kept in lock-step (rules 1-10 already there; rule 11 appended in this PR).

## Coach persona context

You are this user's workout coach. They have an MCP-backed planner you can read and write to.

User context (use freely, refresh via tools when stale):
- 159 lb male training toward 155 lb lean. Hero goal: Mt. Elbert via Black Cloud Trail (~11 mi RT, ~5,200 ft gain, 14,440 ft summit). Secondary: shredded, snowboard, hike + backpack.
- Home gym: StairMaster, stationary bike, dumbbells to 65 lb. Loves outdoor running.
- Plan is 12-ish weeks, 3 phases (Foundation → Strength + Capacity → Performance + Shred).

## Operating rules

> Rules 1-10 are reproduced verbatim from `COACH_INSTRUCTIONS` in `src/app/api/mcp/[token]/route.ts:67-89`. If you change wording here, update that constant in the SAME PR.

1. Tools over guessing. For any stateful question (today's plan, trends, baselines, goals), call the relevant read tool first (get_today_plan, recent_history, get_goal, weekly_summary_data, get_baseline_schedule, get_records_summary). Don't invent values.
2. Propose before applying. Never silently call apply_plan_revision or apply_day_override. Show the proposed change (summary, reasoning, cascades) and wait for explicit approval.
3. Cascade explicitly. If a swap implies downstream shifts, include them in snapshotJson and call them out in reasoning. Don't re-stretch the plan invisibly.
4. Capture the why. Every apply_plan_revision needs reasoning that explains the trigger and cascade. apply_day_override needs notes describing why this date diverges.
5. When the user pastes a Strong-app txt, parse it and call log_workout. Don't summarize.
6. Notes with targetDate are instructions for that future date — prioritize them when reviewing.
7. Direct coaching, grounded language. Push when under-recovering or sandbagging; don't bully. Avoid absolutes like "guaranteed".
8. Sunday weekly reviews: weekly_summary_data(-1) → summary → propose adjustments → log_note(type=feedback) on approval.
9. Baseline-collection days: pair vs replace depends on test character.
   - **Short tests pair with the workout** — speed/power (sprints, jumps, shuttle), mobility checks (deep squat hold, toe-touch), short skill tests. Total <2 min of effort. Do tests fresh, then run the regular blocks. The app shows both.
   - **Long/heavy tests replace the workout** — long endurance (1.5 mi run, 20 min row, 60 min step-up), max-effort lifts (8-rep DB press max, 10-rep RDL max, max pull-ups), high-volume calisthenics tests. These supersede the day's blocks; suggest skipping the regular work. Stacking max-effort lifts on the same patterns confounds the data and overloads the day.
   The app no longer auto-suppresses the workout — when you read get_today_plan and see baselinesDue, judge the test character and tell the user explicitly whether to do both or defer.
10. Nutrition logs are food *groups/items*, not macros (e.g. "97% beef, Kroger hamburger buns, cheddar cheese, frozen vegetables"). There are no calorie/protein fields — estimate from item names + qty when assessing over/under. Compare against the active phase's NutritionGuidance (calorieGuidance, proteinTargetG, habits). Adjust via apply_day_override(nutritionText=…) for one-off days, or apply_plan_revision updating Phase.nutrition.habits for systemic changes — don't just log a feedback note unless the user asked for one.
11. Auto-legend on goal creation. When you create a goal via `create_goal` (or activate an existing goal whose `legend` is null) AND the goal's flavor differs from "hike" (the default), propose a goal-appropriate legend before or alongside the goal creation. Read the preset examples in `update_goal_legend`'s description (hike / strength / running / snowboard / hybrid-endurance) and pick or compose one that fits. The closed `kind` enum is `trained | hike-completed | hike-planned | override | goal-date` — work within it. Follow "Propose before applying": show the proposed legend, get user approval, then call `update_goal_legend` (or pass `legend` directly to `create_goal` if the user pre-approved). If the user names a flavor explicitly ("use the running legend"), apply the matching preset without further prompting.

Single user. No PII concerns inside the data — but never paste the connector URL or token publicly.

## Recent changes

- **2026-05-05** — Added rule 11 (Auto-legend on goal creation). Shipped with PR #3 (`feature/auto-legend-on-goal-creation`). `COACH_INSTRUCTIONS` constant updated in same PR.
- **2026-05-05** — Initial doc captured rules 1–10 from `src/app/api/mcp/[token]/route.ts:67-89` (PR #2 era).
```

### C.6 MODIFY `src/app/api/mcp/[token]/route.ts` — append rule 11 to `COACH_INSTRUCTIONS` (NEW IN V2)

The constant `COACH_INSTRUCTIONS` currently ends with rule 10's paragraph followed by a blank line and the "Single user. No PII…" tail (line ~88). Append rule 11 immediately AFTER rule 10's paragraph and BEFORE the blank-line + "Single user…" tail. Preserve existing 1-10 numbering exactly.

**Exact text to append** (insert immediately after rule 10's terminal period — `…asked for one.` — and before the existing blank line that precedes "Single user."):

```
\n11. Auto-legend on goal creation. When you create a goal via create_goal (or activate an existing goal whose legend is null) AND the goal's flavor differs from "hike" (the default), propose a goal-appropriate legend before or alongside the goal creation. Read the preset examples in update_goal_legend's description (hike / strength / running / snowboard / hybrid-endurance) and pick or compose one that fits. The closed kind enum is trained | hike-completed | hike-planned | override | goal-date — work within it. Follow "Propose before applying": show the proposed legend, get user approval, then call update_goal_legend (or pass legend directly to create_goal if the user pre-approved). If the user names a flavor explicitly ("use the running legend"), apply the matching preset without further prompting.
```

(The leading `\n` is the literal newline that joins rule 11 onto rule 10's paragraph in the template literal — same single-newline separator pattern rules 1-10 already use.)

Notes for developer:
- The constant is a JavaScript template literal (`` ` `` delimited). Keep the existing single-newline-between-rules pattern; do NOT add an extra blank line.
- Do NOT touch backticks within the rule text (the constant uses plain text, not nested code spans). The doc-md version in C.5 keeps backticks for readability; the route.ts constant strips them to avoid any template-literal escaping confusion.
- After editing, run `npx tsc --noEmit` and `npm run dev`; hit `/api/mcp/$TOKEN` once with the streamable transport and confirm the `instructions` field in the initialize response includes "11. Auto-legend on goal creation."

---

## D. Decisions locked

1. **`legend: []` in `create_goal`**: explicit-null intent → `Prisma.JsonNull` to nested create → DB NULL. Mirrors `update_goal_legend` reset semantics. `legend: undefined` → omit field; same DB result, different intent. (v2: `create_goal` description explicitly says these two are equivalent for the default-legend path.)
2. **USER_TZ form bug — FIXED in v2** (Concern D). Form path now uses `parseDateKey` from `@/lib/calendar`. NaN guard retained because `parseDateKey` does not validate format itself. Both surfaces store identical UTC-encoded USER_TZ midnight.
3. **Idempotency on double-submit**: not addressed in code. Mitigated in `create_goal` description with explicit "call list_goals before retrying" instruction. Future work: optional `idempotencyKey` parameter.
4. **`Prisma.JsonNull` vs `undefined` on create**: both yield NULL; we use `JsonNull` only when caller passed `[]` (intent: clear/reset); `undefined` (omit field) when caller didn't pass `legend`. Mirror this pattern for any other nullable Json on create.
5. **`copyFromGoalId` no-op**: silent no-op when source goal missing or has no targets. Goal still created. Matches existing form behavior. Description says "any status".
6. **No new server actions**: only the existing `createGoal` is refactored. `createGoalCore` is a plain helper, NOT a server action — file MUST NOT have `"use server"`.
7. **Tool ordering**: `create_goal` slotted AFTER `update_goal_legend` in `registerWriteTools`. Stability over alphabetical order.
8. **Validation guards (v2)**: form-level guards stay (UI-friendly); core-level guards added (defensive). Two layers; one error envelope reaches the user.
9. **Notes normalization (v2)**: `notes?.trim() || null` inside core. MCP `""` and form `""` both store as NULL.
10. **`COACH_INSTRUCTIONS` rule 11 (v2)**: appended in same PR as the doc + tool description rewrite. User pastes once into claude.ai connector after deploy; final report includes the paste block.

---

## E. Risk register (one-liners)

- **Tool count drift**: developer verifies count via `tools/list` curl during QA. Expected: 34.
- **Description char budget (v2)**: dev reports the final length of new `update_goal_legend` description. v2 additions push estimate to ~1880 chars vs 1800 cap — **measure first**; if over, drop `hybrid-endurance` preset.
- **Test goal cleanup**: smoke-test goals prefixed with `Test:`. Orchestrator (NOT QA agent — explicit owner per Critique §K) runs `prisma.goal.deleteMany({ where: { objective: { startsWith: "Test:" } } })` ONCE after final acceptance, before merging.
- **USER_TZ form bug — FIXED in v2**, but verify in QA: create a goal via form for a known date, query DB, confirm `targetDate` matches MCP-path output for the same date string.
- **`"use server"` on `goal-core.ts`**: top-of-file comment mandatory; reviewer rejects any PR adding the directive.
- **`Legend` type export**: dev verifies and adds `export type Legend = z.infer<typeof LegendSchema>` to `src/lib/legend.ts` if missing.
- **Parallel edits to `tools.ts`**: line-disjoint per §B; manual merge if `git` flags conflicts.
- **`scaffoldPlanFromTemplate(1)` audit (v2 — Concern H)**: dev reads `src/lib/plan.ts` during REQ-A1, records outcome in PR description. If function throws on `weeks=1`, uncomment the guard in `goal-core.ts`. Audit result entry template: "_scaffoldPlanFromTemplate(1) behavior: [throws | returns single-week plan | clamps to N weeks] — guard [needed | not needed]._"
- **Emoji variation selectors (v2)**: dev copies emoji from blueprint/requirements doc; verifies rendering via `tools/list` curl.
- **Connector paste alignment (v2)**: final report instructs user to paste rule 11 (or full doc) into claude.ai connector. `COACH_INSTRUCTIONS` is now canonical alongside the doc; the connector text is the third surface and only stays aligned by manual paste.
- **`tsconfig` `verbatimModuleSyntax`**: critique §K flagged as theoretical concern. Cheap pre-check: dev greps `tsconfig.json`; if enabled, ensure `import type { GoalTarget }` syntax is used (already specified in C.1).

---

## F. Per-agent prompt openings

### Agent 1 (Backend) — REQ-A1 + REQ-B1

You are **Developer Agent 1** for the auto-legend-on-goal-creation feature. Your scope is the foundation extraction, the new MCP tool registration, and a small USER_TZ alignment fix on the form path: **REQ-A1 (extract `createGoalCore` to `src/lib/goal-core.ts`, refactor `createGoal` server action, switch form's date parsing to `parseDateKey`)** then **REQ-B1 (register `create_goal` MCP tool)**, sequentially in that order. The blueprint v2 at `.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-blueprint-v2.md` (sections C.1, C.2, C.3) is your source of truth — complete code skeletons for `goal-core.ts`, the refactored `createGoal` body (incl. `parseDateKey`), and the `create_goal` registration block. Copy them verbatim and fill any gaps: verify `Legend` type export from `src/lib/legend.ts` (add `export type Legend = z.infer<typeof LegendSchema>` if missing); audit `scaffoldPlanFromTemplate(1)` in `src/lib/plan.ts` and record the result in your PR notes (uncomment the `weeks < 2` guard in `goal-core.ts` if the function throws).

Operate inside a worktree at `.worktrees/agent1-backend` (orchestrator created it). Your file scope is exactly: `src/lib/goal-core.ts` (NEW), `src/lib/goal-actions.ts` (MODIFY — `createGoal` body, `createGoalCore` import, `parseDateKey` import), `src/lib/legend.ts` (MODIFY only if `Legend` type export missing), `src/lib/mcp/tools.ts` (MODIFY — INSERT a NEW `create_goal` registration block AFTER the existing `update_goal_legend` block; do NOT touch the `update_goal_legend` description — Agent 2 owns that). Do NOT touch `docs/`. Do NOT touch `src/app/api/mcp/[token]/route.ts` (Agent 2 owns the rule 11 append). Do NOT add `"use server"` to `goal-core.ts`. Run `npx tsc --noEmit` after each requirement; both must pass before you report done.

### Agent 2 (Description + Docs + COACH_INSTRUCTIONS) — REQ-B2 + REQ-D1 (incl. D2)

You are **Developer Agent 2** for the auto-legend-on-goal-creation feature. Your scope is text-only across three surfaces: **REQ-B2 (rewrite `update_goal_legend` description in `src/lib/mcp/tools.ts`)** and **REQ-D1 / D2 (author `docs/server-instructions/goaldmine-rules.md` AND append rule 11 to `COACH_INSTRUCTIONS` constant in `src/app/api/mcp/[token]/route.ts`)**, in parallel — none blocks the others. The blueprint v2 at `.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-blueprint-v2.md` (sections C.4, C.5, C.6) gives you the FINAL description string, the FULL doc contents, and the EXACT rule 11 text to append to the route constant. Copy them verbatim. Measure the description string's final length and report it in your completion summary (cap: 1800 chars; if over, drop the `hybrid-endurance` preset first).

Operate inside a worktree at `.worktrees/agent2-docs`. Your file scope is exactly: `src/lib/mcp/tools.ts` (MODIFY — replace ONLY the `description:` string literal inside the existing `update_goal_legend` `server.registerTool(...)` call; do NOT touch any other tool, do NOT add new tools — Agent 1 is adding `create_goal` separately, parallel modification of the same registration would conflict), `docs/server-instructions/goaldmine-rules.md` (NEW), `src/app/api/mcp/[token]/route.ts` (MODIFY — append rule 11 to the END of the `COACH_INSTRUCTIONS` template literal; preserve existing 1-10 numbering and the trailing "Single user…" tail). The doc's rules 1-10 must be pulled VERBATIM from the constant in `[token]/route.ts:67-89` — do NOT paraphrase from memory. Run `npx tsc --noEmit` after each edit. Manual smoke: hit `/api/mcp/$TOKEN` once and confirm the initialize response's `instructions` field contains "11. Auto-legend on goal creation."

---

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-blueprint-v2.md
