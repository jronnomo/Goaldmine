# Architecture Blueprint — Auto-legend on goal creation

Date: 2026-05-05
Source PRD: `docs/prds/PRD-auto-legend-on-goal-creation.md`
Requirements: `.feature-dev/2026-05-05-auto-legend-on-goal-creation/phases/requirements.md`
Research: `.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/research-output.md`

> **PRD correction note**: The PRD claims tool count goes 38 → 39 (success criterion §1.3 + acceptance #8). Research confirmed actual baseline is **33** (see research §10). Therefore the locked target is **33 → 34**. QA agent verifies via `tools/list` curl, not source grep.

---

## A. Reconciled facts (locked)

1. **Tool count**: today = 33. After this PR = 34. Update PRD acceptance criterion #8 to read "tools/list returns 34".
2. **`LegendSchema` import**: already present at `src/lib/mcp/tools.ts:24`. Do NOT add a duplicate import in REQ-B1. Requirements.md REQ-B1's instruction to `import { LegendSchema }` is wrong — skip it.
3. **Operating-rules verbatim source**: `src/app/api/mcp/[token]/route.ts:67-89`, constant `COACH_INSTRUCTIONS`. Pull all 10 existing rules from there, not from any system prompt or paraphrase.
4. **Existing rules already include rule 10** (Nutrition logs are food groups/items, not macros). The new auto-legend rule is **rule 11**, NOT rule 10. Requirements.md REQ-D1 incorrectly numbered it 10 — override that and append as 11.
5. **Empty legend on create**: `legend: []` from caller → store DB null. Per research §4 use `Prisma.JsonNull` for explicit-null intent (matches `update_goal_legend`'s update path); for `legend === undefined` use `undefined` (omit field). Both produce a NULL column on create; the distinction is intent.
6. **`prisma.JsonNull` import**: already imported via `Prisma` namespace at `tools.ts:6` (`import { Prisma } from "@/generated/prisma/client"`). For `goal-core.ts`, import `Prisma` from the same path.
7. **Date parsing asymmetry**: form path uses `new Date(targetDateStr)` (UTC midnight bug). MCP path uses `parseDateInput` (USER_TZ midnight). NOT fixed in this PR; documented as known issue.

---

## B. Agent assignment

| Agent | Scope | REQs | Files (no overlap with peer) |
|-------|-------|------|------------------------------|
| Agent 1 (Backend) | Extract core + register MCP tool | REQ-A1 → REQ-B1 sequentially | `src/lib/goal-core.ts` (NEW), `src/lib/goal-actions.ts` (MODIFY), `src/lib/mcp/tools.ts` (MODIFY — adds `create_goal` block only) |
| Agent 2 (Description + Docs) | Sharpen description + author rules doc | REQ-B2 + REQ-D1 in parallel | `src/lib/mcp/tools.ts` (MODIFY — replaces `update_goal_legend` description string only), `docs/server-instructions/goaldmine-rules.md` (NEW) |

**File overlap warning**: Both agents touch `src/lib/mcp/tools.ts`. To avoid merge conflicts:
- Agent 1 inserts a NEW `server.registerTool("create_goal", ...)` block AFTER the existing `update_goal_legend` registration (after `tools.ts:1062`).
- Agent 2 replaces ONLY the `description:` string literal inside the existing `update_goal_legend` registration (around `tools.ts:1037`).
- Both edits are line-disjoint. Orchestrator runs them in parallel using separate worktrees, then merges.

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
  const { objective, targetDate, notes, copyFromGoalId } = input;

  let targets = input.targets ?? null;
  if (!targets && copyFromGoalId) {
    const source = await prisma.goal.findUnique({ where: { id: copyFromGoalId } });
    if (source && source.targets) {
      targets = source.targets as unknown as GoalTarget[];
    }
  }

  const now = new Date();
  const weeks = weeksBetween(now, targetDate);
  const planTemplate = scaffoldPlanFromTemplate(weeks);

  // Legend handling: undefined → omit; [] → JsonNull; non-empty → cast to InputJsonValue.
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
      notes: notes ?? null,
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
- `Legend` type may need to be exported from `src/lib/legend.ts` if not already (`export type Legend = z.infer<typeof LegendSchema>`). Verify and add if missing.
- `GoalTarget` type currently lives in `goal-actions.ts`; importing it back from there is fine (circular-import safe because it's `import type`).
- `prisma.goal.create({ ..., include: { plans: { select: { id: true } } } })` — needed to surface `planId` in the return. The existing server action doesn't need planId; the MCP tool does.

### C.2 MODIFY `src/lib/goal-actions.ts` — refactored `createGoal`

Add at top (with other imports):
```ts
import { createGoalCore } from "@/lib/goal-core";
```

Replace `createGoal` body with:
```ts
export async function createGoal(form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const copyFromGoalId = (form.get("copyFromGoalId") as string | null)?.trim() || null;

  if (!objective) throw new Error("Objective is required");
  if (!targetDateStr) throw new Error("Target date is required");
  const targetDate = new Date(targetDateStr);
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

**Unchanged** (do not touch): `parseTargetsField`, `copyTargetsFromGoal`, `updateGoal`, `deleteGoal`, `addGoalReference`, `removeGoalReference`, the exported `GoalReference` type, the `GoalTarget` type. Form path retains `new Date(targetDateStr)` parsing (pre-existing USER_TZ bug — out of scope).

### C.3 MODIFY `src/lib/mcp/tools.ts` — INSERT `create_goal`

Add import near other lib imports at top:
```ts
import { createGoalCore } from "@/lib/goal-core";
```
(`LegendSchema` is already imported at line 24 — do NOT re-import.)

Insert this block immediately AFTER the `update_goal_legend` registration block (after the closing `);` of that registration, currently around line 1062):

```ts
server.registerTool(
  "create_goal",
  {
    title: "Create a new goal (with optional legend)",
    description:
      "Scaffold a new Goal + Plan + initial PlanRevision in one nested write. The plan is sized to the weeks between today and `targetDate` and seeded from the program template. Pass `legend` inline when the goal flavor differs from the default hike — saves a follow-up update_goal_legend call. See update_goal_legend's description for preset examples (hike, strength, running, snowboard, hybrid-endurance). Use update_goal_targets afterward to set readiness targets. Does NOT auto-deactivate other goals; that is a separate explicit action.",
    inputSchema: {
      objective: z.string().min(1).max(200),
      targetDate: DateKeyShape,
      notes: z.string().optional(),
      copyFromGoalId: z
        .string()
        .optional()
        .describe("Copy targets array from this existing goal (no-op if source has no targets)."),
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
"Replace the goal's legend array (drives the calendar legend AND which icons render in cells). Pass empty array or omit to reset to the built-in default. Each entry = { icon, label, kind } where kind ∈ {trained, hike-completed, hike-planned, override, goal-date}: trained=days a workout exists, hike-completed=logged outdoor day, hike-planned=upcoming hike, override=custom day-level marker, goal-date=the goal's target date pin. Closed enum; new render conditions need a code change.\n\nPreset legends (single-line JSON, pick + adapt to the goal's flavor):\nhike: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🥾\",\"label\":\"Outdoor day\",\"kind\":\"hike-completed\"},{\"icon\":\"🥾\",\"label\":\"Hike planned\",\"kind\":\"hike-planned\"},{\"icon\":\"★\",\"label\":\"Custom day\",\"kind\":\"override\"},{\"icon\":\"🏔️\",\"label\":\"Goal date\",\"kind\":\"goal-date\"}]\nstrength: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏋️\",\"label\":\"Heavy day\",\"kind\":\"override\"},{\"icon\":\"🏆\",\"label\":\"Meet day\",\"kind\":\"goal-date\"}]\nrunning: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏃\",\"label\":\"Long run\",\"kind\":\"override\"},{\"icon\":\"🥇\",\"label\":\"Race day\",\"kind\":\"goal-date\"}]\nsnowboard: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏂\",\"label\":\"Ride day\",\"kind\":\"override\"},{\"icon\":\"🎿\",\"label\":\"Season opener\",\"kind\":\"goal-date\"}]\nhybrid-endurance: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏃\",\"label\":\"Run\",\"kind\":\"override\"},{\"icon\":\"🥾\",\"label\":\"Trail\",\"kind\":\"hike-completed\"},{\"icon\":\"🥾\",\"label\":\"Trail planned\",\"kind\":\"hike-planned\"},{\"icon\":\"🏁\",\"label\":\"Race day\",\"kind\":\"goal-date\"}]\n\nWhen you create or activate a non-hike goal, propose a goal-appropriate legend immediately. Follow 'Propose before applying' — show the proposed legend, get approval, then call this tool (or pass `legend` directly to create_goal). If the user names a flavor ('use the strength legend'), apply the matching preset without further prompting."
```

**Char budget**: developer must measure final string length and report in PR description. Target ≤1800 chars (slack room above the 1500 PRD target). The above string is ~1730 chars; confirm post-paste.

### C.5 NEW `docs/server-instructions/goaldmine-rules.md`

```markdown
# Goaldmine MCP server-instructions — canonical source

Paste applicable sections into the **claude.ai → Goaldmine connector** instructions block. This doc is the source of truth; the deployed server's `COACH_INSTRUCTIONS` constant in `src/app/api/mcp/[token]/route.ts` should stay aligned.

## Coach persona context

You are this user's workout coach. They have an MCP-backed planner you can read and write to.

User context (use freely, refresh via tools when stale):
- 159 lb male training toward 155 lb lean. Hero goal: Mt. Elbert via Black Cloud Trail (~11 mi RT, ~5,200 ft gain, 14,440 ft summit). Secondary: shredded, snowboard, hike + backpack.
- Home gym: StairMaster, stationary bike, dumbbells to 65 lb. Loves outdoor running.
- Plan is 12-ish weeks, 3 phases (Foundation → Strength + Capacity → Performance + Shred).

## Operating rules

1. **Tools over guessing.** For any stateful question (today's plan, trends, baselines, goals), call the relevant read tool first (get_today_plan, recent_history, get_goal, weekly_summary_data, get_baseline_schedule, get_records_summary). Don't invent values.
2. **Propose before applying.** Never silently call apply_plan_revision or apply_day_override. Show the proposed change (summary, reasoning, cascades) and wait for explicit approval.
3. **Cascade explicitly.** If a swap implies downstream shifts, include them in snapshotJson and call them out in reasoning. Don't re-stretch the plan invisibly.
4. **Capture the why.** Every apply_plan_revision needs reasoning that explains the trigger and cascade. apply_day_override needs notes describing why this date diverges.
5. **Strong-app paste → log_workout.** When the user pastes a Strong-app txt, parse it and call log_workout. Don't summarize.
6. **Notes with targetDate are instructions for that future date** — prioritize them when reviewing.
7. **Direct coaching, grounded language.** Push when under-recovering or sandbagging; don't bully. Avoid absolutes like "guaranteed".
8. **Sunday weekly reviews:** weekly_summary_data(-1) → summary → propose adjustments → log_note(type=feedback) on approval.
9. **Baseline-collection days: pair vs replace depends on test character.**
   - **Short tests pair with the workout** — speed/power (sprints, jumps, shuttle), mobility checks (deep squat hold, toe-touch), short skill tests. Total <2 min of effort. Do tests fresh, then run the regular blocks. The app shows both.
   - **Long/heavy tests replace the workout** — long endurance (1.5 mi run, 20 min row, 60 min step-up), max-effort lifts (8-rep DB press max, 10-rep RDL max, max pull-ups), high-volume calisthenics tests. These supersede the day's blocks; suggest skipping the regular work. Stacking max-effort lifts on the same patterns confounds the data and overloads the day.

   The app no longer auto-suppresses the workout — when you read get_today_plan and see baselinesDue, judge the test character and tell the user explicitly whether to do both or defer.
10. **Nutrition logs are food *groups/items*, not macros** (e.g. "97% beef, Kroger hamburger buns, cheddar cheese, frozen vegetables"). There are no calorie/protein fields — estimate from item names + qty when assessing over/under. Compare against the active phase's NutritionGuidance (calorieGuidance, proteinTargetG, habits). Adjust via apply_day_override(nutritionText=…) for one-off days, or apply_plan_revision updating Phase.nutrition.habits for systemic changes — don't just log a feedback note unless the user asked for one.
11. **Auto-legend on goal creation.** When you create a goal via `create_goal` (or activate an existing goal whose `legend` is null) AND the goal's flavor differs from "hike" (the default), propose a goal-appropriate legend before or alongside the goal creation. Read the preset examples in `update_goal_legend`'s description (hike / strength / running / snowboard / hybrid-endurance) and pick or compose one that fits. The closed `kind` enum is `trained | hike-completed | hike-planned | override | goal-date` — work within it. Follow "Propose before applying": show the proposed legend, get user approval, then call `update_goal_legend` (or pass `legend` directly to `create_goal` if the user pre-approved). If the user names a flavor explicitly ("use the running legend"), apply the matching preset without further prompting.

Single user. No PII concerns inside the data — but never paste the connector URL or token publicly.

## Recent changes

- **2026-05-05** — Added rule 11 (Auto-legend on goal creation). Shipped with PR #3 (`feature/auto-legend-on-goal-creation`).
- **2026-05-05** — Initial doc captured rules 1–10 from `src/app/api/mcp/[token]/route.ts:67-89` (PR #2 era).
```

---

## D. Decisions locked

1. **`legend: []` in `create_goal`**: treat as explicit-null intent; pass `Prisma.JsonNull` to nested create. DB ends up NULL. Matches `update_goal_legend` reset semantics. (`legend: undefined` → omit field entirely; same DB result, different intent.)
2. **USER_TZ form bug**: `new Date(targetDateStr)` in `createGoal` server action is pre-existing UTC-midnight bug. NOT fixed in this PR. MCP path uses `parseDateInput` (USER_TZ-correct). Asymmetry documented in PR description as known issue.
3. **Idempotency on double-submit**: not addressed. Same risk in form and MCP. Future work.
4. **`Prisma.JsonNull` vs `undefined` on create**: both yield NULL column. We use `Prisma.JsonNull` only when caller passed `[]` (intent: clear/reset); we use `undefined` (omit field) when caller didn't pass `legend` at all. Mirror this for any other nullable Json on create.
5. **`copyFromGoalId` no-op**: silent no-op when source goal missing or has no targets. Goal still created. Matches existing form behavior.
6. **No new server actions**: only the existing `createGoal` is refactored. `createGoalCore` is a plain helper, NOT a server action — file MUST NOT have `"use server"`.
7. **Tool ordering**: `create_goal` slotted AFTER `update_goal_legend` in `registerWriteTools`. Keeps the goal-cluster contiguous.

---

## E. Risk register (one-liners)

- **Tool count drift**: developer verifies count via `tools/list` curl during QA, not by source grep. Expected: 34.
- **Description char budget**: developer reports the final length of the new `update_goal_legend` description string before commit. Cap: 1800 chars.
- **Test goal cleanup**: smoke-test goals must be prefixed with `Test:` (e.g., `"Test: legend smoke 2026-05-05"`). Orchestrator/QA agent deletes via `prisma.goal.deleteMany({ where: { objective: { startsWith: "Test:" } } })` after acceptance.
- **USER_TZ form bug pre-existing**: documented in PR description, no fix in this PR.
- **`"use server"` on `goal-core.ts`**: top-of-file comment mandatory; reviewer must reject any PR adding the directive.
- **`Legend` type export**: developer verifies `Legend` type is exported from `src/lib/legend.ts`; if absent, add `export type Legend = z.infer<typeof LegendSchema>` as part of REQ-A1.
- **Parallel edits to `tools.ts`**: Agent 1 inserts after line ~1062, Agent 2 replaces description literal at ~line 1037. Worktrees + manual merge if `git` flags conflict.

---

## F. Per-agent prompt openings

### Agent 1 (Backend) — REQ-A1 + REQ-B1

You are **Developer Agent 1** for the auto-legend-on-goal-creation feature. Your scope is the foundation extraction and the new MCP tool registration: **REQ-A1 (extract `createGoalCore` to `src/lib/goal-core.ts` and refactor `createGoal` server action)** then **REQ-B1 (register `create_goal` MCP tool)**, sequentially in that order. The blueprint at `.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-blueprint.md` (sections C.1, C.2, C.3) is your source of truth — it includes a complete code skeleton for `goal-core.ts`, the exact refactored `createGoal` body, and the full `create_goal` registration block. Copy them, fill any gaps (verify `Legend` type export from `src/lib/legend.ts`; add `export type Legend = z.infer<typeof LegendSchema>` if missing), and adjust only when you hit something the blueprint didn't anticipate.

Operate inside a worktree at `.worktrees/agent1-backend` (the orchestrator created it). Your file scope is exactly: `src/lib/goal-core.ts` (NEW), `src/lib/goal-actions.ts` (MODIFY — only `createGoal` body + new import), `src/lib/legend.ts` (MODIFY only if `Legend` type export is missing), `src/lib/mcp/tools.ts` (MODIFY — INSERT a new `create_goal` registration block AFTER the existing `update_goal_legend` block; do NOT touch the `update_goal_legend` description — Agent 2 owns that). Do NOT touch `docs/`. Do NOT add `"use server"` to `goal-core.ts`. Run `npx tsc --noEmit` after each requirement; both must pass before you report done.

### Agent 2 (Description + Docs) — REQ-B2 + REQ-D1

You are **Developer Agent 2** for the auto-legend-on-goal-creation feature. Your scope is text-only: **REQ-B2 (rewrite `update_goal_legend` description in `src/lib/mcp/tools.ts`)** and **REQ-D1 (author `docs/server-instructions/goaldmine-rules.md`)**, in parallel — neither blocks the other. The blueprint at `.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-blueprint.md` (sections C.4 and C.5) gives you the FINAL description string and the FULL doc contents verbatim. Copy them in. Measure the final char count of the description string and report it in your completion summary (cap: 1800 chars).

Operate inside a worktree at `.worktrees/agent2-docs`. Your file scope is exactly: `src/lib/mcp/tools.ts` (MODIFY — replace ONLY the `description:` string literal inside the existing `update_goal_legend` `server.registerTool(...)` call; do NOT touch any other tool, do NOT add new tools — Agent 1 is adding `create_goal` separately and a parallel modification to the same registration would conflict), `docs/server-instructions/goaldmine-rules.md` (NEW). Critical numbering note: the operating-rules constant at `src/app/api/mcp/[token]/route.ts:67-89` already has a rule numbered 10 (Nutrition). The new auto-legend rule is **rule 11**, NOT rule 10 — the requirements doc is wrong on this point and the blueprint overrides it. Run `npx tsc --noEmit` after editing `tools.ts` to confirm no TS regression from the description swap.

---

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-blueprint.md
