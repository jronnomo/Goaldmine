# Research Output — Auto-legend on goal creation

Date: 2026-05-05
Branch target: `feature/auto-legend-on-goal-creation`
Source PRD: `/Users/ggronnii/Development/workout-planner/docs/prds/PRD-auto-legend-on-goal-creation.md`
Requirements: `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-auto-legend-on-goal-creation/phases/requirements.md`

> Read-only recon. No source files were modified.

---

## 1. Existing `createGoal` server action — exact structure

**File**: `/Users/ggronnii/Development/workout-planner/src/lib/goal-actions.ts`

### `parseTargetsField` (lines 19–30, verbatim)

```ts
function parseTargetsField(raw: FormDataEntryValue | null): GoalTarget[] | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("targets must be an array");
    return parsed as GoalTarget[];
  } catch (e) {
    throw new Error(`Invalid targets JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

### `createGoal` (lines 32–87, verbatim)

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

  let targets: GoalTarget[] | null = parseTargetsField(form.get("targets"));
  if (!targets && copyFromGoalId) {
    const source = await prisma.goal.findUnique({ where: { id: copyFromGoalId } });
    if (source && source.targets) {
      targets = source.targets as unknown as GoalTarget[];
    }
  }

  const now = new Date();
  const weeks = weeksBetween(now, targetDate);
  const planTemplate = scaffoldPlanFromTemplate(weeks);

  const goal = await prisma.goal.create({
    data: {
      objective,
      targetDate,
      notes,
      targets: targets ?? undefined,
      plans: {
        create: {
          name: `${objective} — ${weeks}-week plan`,
          startedOn: now,
          endsOn: targetDate,
          weeks,
          active: true,
          planJson: planTemplate as unknown as object,
          // Seed an initial revision so future revisions have a clean
          // predecessor to compare against.
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
  });

  revalidatePath("/goals");
  revalidatePath("/stats");
  redirect(`/goals/${goal.id}`);
}
```

### Steps inside the action

1. **FormData parse** (lines 33–36) — pulls `objective`, `targetDate`, `notes`, `copyFromGoalId`.
2. **Validation** (lines 38–41) — empty checks; `new Date(targetDateStr)` + `Number.isNaN` guard. NOTE: this uses a raw `new Date()` (no `parseDateInput`), so a bare `yyyy-mm-dd` from the form is parsed as **UTC midnight** — already a USER_TZ correctness risk in the existing code, called out in `quality-tools.md` gotcha #5.
3. **Targets resolution** (lines 43–49) — `parseTargetsField` from FormData; if absent and `copyFromGoalId` set, tries to copy from source goal. `findUnique` returns `null` silently if missing → no targets copied, goal still created.
4. **Plan scaffolding** (lines 51–53) — `weeksBetween(now, targetDate)` → `scaffoldPlanFromTemplate(weeks)`.
5. **Nested write** (lines 55–82) — `prisma.goal.create` creates Goal, nested Plan (`active: true`), nested initial PlanRevision (`triggerSource: "manual"`). `targets: targets ?? undefined` skips field on null. Plan/revision JSON stored as `as unknown as object`.
6. **Revalidate** (lines 84–85) — `/goals` and `/stats`.
7. **Redirect** (line 86) — `/goals/${goal.id}`.

---

## 2. Helpers consumed by the nested write

**File**: `/Users/ggronnii/Development/workout-planner/src/lib/plan.ts`

### Signatures

```ts
// plan.ts:10
export function scaffoldPlanFromTemplate(weeks: number): ProgramTemplate

// plan.ts:45
export function weeksBetween(start: Date, end: Date): number
```

- `scaffoldPlanFromTemplate` returns a `ProgramTemplate` (defined in `src/lib/program-template.ts`) — the same shape as `PROGRAM_TEMPLATE` but with `totalWeeks` and `phases[].weeks` rewritten to fit the goal's duration.
- `weeksBetween` returns an integer ≥ 1 (clamped via `Math.max(1, ...)`).

### `planJson` shape

The current code passes the `ProgramTemplate` through an inline cast: `planJson: planTemplate as unknown as object` (`goal-actions.ts:68`) and `snapshotJson: planTemplate as unknown as object` (`goal-actions.ts:76`). There is **no dedicated `PlanJson` type or wrapping function** — the `ProgramTemplate` interface is the de-facto shape, but Prisma sees it only as `object` / `Json`.

The same `as unknown as object` cast appears no place else for plan json — both sites are inside `createGoal`. (Other write tools like `apply_plan_revision` use `Prisma.InputJsonValue` casts; see §6.)

---

## 3. `prisma.goal.create` nested-write pattern

The full block is quoted under §1. Key shape: `goal.create({ data: { ..., plans: { create: { ..., revisions: { create: {...} } } } } })`.

### Idempotency

**Not idempotent.** No unique constraint on `Goal` (objective + targetDate are not constrained — see `prisma/schema.prisma`). A double-submit (form-resubmit, MCP retry, claude.ai network blip) will create **N goals** with N nested plans and N initial revisions. PR-introduced `create_goal` MCP tool inherits this risk: a flaky network triggering a retry produces duplicates. Mitigations to consider in §11.

### `targets: targets ?? undefined` — Prisma quirk

`Goal.targets` is a nullable `Json` column. On Prisma `create`, the `targets` field accepts:

- **Skip / use DB default**: `undefined` → field omitted from the SQL insert; column gets DB default (here, `null`).
- **Explicit JSON null**: `Prisma.JsonNull` → SQL inserts JSON-null (semantically `null` in JSON, distinct from SQL NULL on some DB engines, but Postgres treats both essentially the same for nullable Json columns).
- **Explicit SQL NULL**: passing literal `null` is **rejected by the TypeScript type** of `XxxCreateInput` for nullable Json fields when the field is optional — Prisma wants `Prisma.JsonNull` or `Prisma.DbNull` for explicit nulls. That's why the existing code uses `?? undefined` instead of `?? null` (TS would complain).

So `targets: targets ?? undefined` means: "if I have a parsed array, store it; if null, skip the field entirely (column ends up null)." This is the safest pattern for **create** with nullable Json fields.

The `prisma.goal.update` calls in `goal-actions.ts:118` (`updateGoal`) and `goal-actions.ts:94` (`copyTargetsFromGoal`) use the same `?? undefined` pattern — and that works because in the **update** path, undefined means "don't change this column" (which is what the form wants when it doesn't include `targets`).

---

## 4. `Prisma.JsonNull` vs undefined vs null on create vs update

### Create semantics (REQ-A1's `legend` handling)

For `Goal.legend` (nullable `Json?`) on **create**:

| Caller intent              | What to pass            | Result in DB      |
|----------------------------|-------------------------|-------------------|
| Skip / leave default null  | `legend: undefined`     | Column = NULL     |
| Explicitly null            | `legend: Prisma.JsonNull` | Column = JSON null (effectively NULL on Postgres) |
| Provide an array           | `legend: arr as Prisma.InputJsonValue` | Column = JSON array |
| Pass literal `null`        | TypeScript error        | n/a               |

So for REQ-A1's three cases:
- `legend === undefined` (caller omitted): use `targets`-style `?? undefined` → field skipped, DB null. Correct.
- `legend === []` (caller cleared): per PRD §6 + REQ-B1 + existing `update_goal_legend` semantics, treat empty array as "no legend / reset". Code path: `legend && legend.length > 0 ? cast : Prisma.JsonNull` (or `undefined` — both yield NULL on create). Use `Prisma.JsonNull` to match the update semantics for consistency, since the user explicitly asked for "reset".
- `legend === [entries]` (caller set): cast to `Prisma.InputJsonValue` and store.

### Update semantics (existing `update_goal_legend`)

`tools.ts:1047-1050`:
```ts
const next =
  legend && legend.length > 0
    ? (legend as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;
```

On **update**, `Prisma.JsonNull` is required to clear a Json column to null because `undefined` means "don't change it". On **create**, both `undefined` and `Prisma.JsonNull` produce a null column, but the meanings differ semantically. Recommend `createGoalCore` use the same `Prisma.JsonNull` for empty array (matches mental model with `update_goal_legend`) and `undefined` only when the field truly was omitted.

---

## 5. `"use server"` and importing into MCP

### "use server" files in `src/lib/`

```
src/lib/day-actions.ts:1     "use server";
src/lib/goal-actions.ts:1    "use server";
src/lib/plan-actions.ts:1    "use server";
src/lib/workout-actions.ts:1 "use server";
```

All four start with `"use server"` and **every** export from these files is treated by Next as a server action — Next 15+ enforces this strictly (any non-async export from a `"use server"` file is a build error, and even async helpers become RPC endpoints if exported).

### Existing imports from `goal-actions.ts`

```
src/app/goals/[id]/page.tsx:11           import type { GoalReference } from "@/lib/goal-actions";
src/components/GoalCreateForm.tsx:4      import { createGoal } from "@/lib/goal-actions";
src/components/GoalReferences.tsx:4      import { addGoalReference, removeGoalReference, type GoalReference } from "@/lib/goal-actions";
src/components/GoalEditForm.tsx:4        import { copyTargetsFromGoal, deleteGoal, updateGoal } from "@/lib/goal-actions";
```

All consumers are **either client components calling actions OR pages importing the `GoalReference` type**. No file imports a non-action helper from a `"use server"` file. The convention is clear: `"use server"` files only export actions (or types).

### Verdict on `goal-core.ts`

REQ-A1's choice to extract `createGoalCore` to a **new** file `src/lib/goal-core.ts` **without** `"use server"` is correct:

- Importing a non-async (or even async-but-non-action) helper from a `"use server"` file would either fail at build time or expose `createGoalCore` as a public RPC endpoint — neither is desired.
- The MCP route handler in `src/app/api/mcp/route.ts` is a regular API route, not a server action context. It can safely import plain helpers but cannot import server actions in the action-call sense.
- The new file has **no** `"use server"` directive. It's just a regular module.

**Sanity warning for the developer agent**: the orchestrator, devil's-advocate, or anyone tempted to add `"use server"` to `goal-core.ts` to "be consistent" must be prevented — it would re-create exactly the problem we're solving (see §11 risk register).

---

## 6. MCP tool registration patterns to mirror exactly

### `update_goal_legend` (file `src/lib/mcp/tools.ts`, lines 1032–1062)

```ts
server.registerTool(
  "update_goal_legend",
  {
    title: "Set or clear a goal's calendar legend",
    description:
      "Replace the goal's legend array (drives the calendar legend AND which icons render in cells). Pass an empty array OR omit `legend` to reset to the built-in default. Each entry = { icon, label, kind } where kind ∈ {trained, hike-completed, hike-planned, override, goal-date}. Use this when the active goal changes flavor (e.g., pivot from hiking to powerlifting): swap 🥾 entries for goal-appropriate icons. The kind enum is closed; new render conditions require a code change.",
    inputSchema: {
      goalId: z.string(),
      legend: LegendSchema.optional().describe(
        "Full legend array. Pass empty array or omit to reset to the default legend.",
      ),
    },
  },
  async ({ goalId, legend }) =>
    safe(async () => {
      const next =
        legend && legend.length > 0
          ? (legend as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      await prisma.goal.update({
        where: { id: goalId },
        data: { legend: next },
      });
      return {
        message:
          legend && legend.length > 0
            ? `Legend updated (${legend.length} entries)`
            : "Legend reset to default",
      };
    }),
);
```

Note: `LegendSchema.optional()` is wired directly inside the `inputSchema` object literal — McpServer treats inputSchema as a mapping of field-name → ZodType. `.optional()` makes the field optional in the resulting tool JSON Schema (`required` array excludes it). No wrapping needed.

### `update_goal_targets` (lines 833–852)

```ts
server.registerTool(
  "update_goal_targets",
  {
    title: "Update a goal's readiness targets",
    description:
      "Replace the targets array. Each target = { metric, label, target, weight, units, direction, rationale? }. Weights should sum near 1.",
    inputSchema: {
      goalId: z.string(),
      targets: z.array(z.unknown()),
    },
  },
  async ({ goalId, targets }) =>
    safe(async () => {
      await prisma.goal.update({
        where: { id: goalId },
        data: { targets: targets as Prisma.InputJsonValue },
      });
      return { message: "Targets updated" };
    }),
);
```

### `Prisma.InputJsonValue` cast convention

The cast is always `value as Prisma.InputJsonValue` (or `value as unknown as Prisma.InputJsonValue` when going through a typed array). Examples:

- `tools.ts:640` — `items: input.items as Prisma.InputJsonValue` (log_nutrition)
- `tools.ts:665` — `data.items = input.items as Prisma.InputJsonValue` (update_nutrition)
- `tools.ts:727` — `snapshotJson: snapshot as Prisma.InputJsonValue` (apply_plan_revision)
- `tools.ts:732` — `data: { planJson: snapshot as Prisma.InputJsonValue }`
- `tools.ts:786` / `tools.ts:790` — uses ternary with `Prisma.JsonNull` for nullable cases (apply_day_override)
- `tools.ts:848` — `targets: targets as Prisma.InputJsonValue` (update_goal_targets)
- `tools.ts:1026` — `references: next as unknown as Prisma.InputJsonValue` (add_goal_reference)
- `tools.ts:1049` — `legend as unknown as Prisma.InputJsonValue` (update_goal_legend)

`Prisma` is imported from `@/generated/prisma/client` at `tools.ts:6`.

### `parseDateInput` consumption pattern

`parseDateInput` is defined at `tools.ts:78-83`:

```ts
function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

Example consumer — `log_hike` (lines 560–594):

```ts
server.registerTool(
  "log_hike",
  {
    title: "Log a hike",
    description: "Use status='completed' (default) or 'planned' for upcoming hikes.",
    inputSchema: {
      date: z.string(),                       // not DateKeyShape — accepts any string
      route: z.string(),
      // ... other fields ...
    },
  },
  async (input) =>
    safe(async () => {
      const h = await prisma.hike.create({
        data: {
          date: parseDateInput(input.date),   // ← bare yyyy-mm-dd treated as USER_TZ midnight
          // ... other fields ...
        },
      });
      return { id: h.id, message: "Hike logged" };
    }),
);
```

REQ-B1's `create_goal` should use **`DateKeyShape`** (the Zod regex-validated yyyy-mm-dd) for `targetDate`, then `parseDateInput(targetDate)` in the handler. This matches the pattern used by `apply_day_override`, `clear_day_override`, etc.

---

## 7. `LegendSchema` import surface

**File**: `/Users/ggronnii/Development/workout-planner/src/lib/legend.ts`

The export is on line 50:

```ts
export const LegendSchema = z.array(LegendEntrySchema);
```

Where `LegendEntrySchema` (lines 32–46) is a `z.object({ icon, label, kind })` and `LegendKindSchema` (lines 22–28) is a closed `z.enum([...])`.

`LegendSchema.optional()` returns a `ZodOptional<ZodArray<ZodObject<...>>>` — directly usable in an `inputSchema` field. The MCP SDK's `registerTool` consumes the inputSchema as a `{ [name]: ZodTypeAny }` map and converts it to JSON Schema; `.optional()` correctly translates to the field being absent from the `required` array. No wrapping needed.

`LegendSchema` is already imported in `tools.ts:24`:

```ts
import { LegendSchema } from "@/lib/legend";
```

So **no new import is required for REQ-B1**. (REQ-B1's text in requirements.md mentions it might need re-adding — it does not. Already present.)

---

## 8. `redirect` from server actions vs MCP

`createGoal` ends with `redirect(\`/goals/${goal.id}\`)` (`goal-actions.ts:86`). In a server action context (form submit), Next intercepts the thrown `NEXT_REDIRECT` error and returns an HTTP 303 to the client.

**Inside the MCP route**, the call chain is:

```
POST /api/mcp
 → handler() in src/app/api/mcp/route.ts        (regular API route)
 → registerAll(server) → registerWriteTools     (just registers handlers)
 → transport.handleRequest(req)                  (dispatches to tool handler)
 → safe(async () => { ... createGoalCore() ... }) (catches and serializes errors)
```

If the tool handler called `redirect()`, it would throw `NEXT_REDIRECT` inside `safe()`. The `safe()` wrapper would catch it as a normal Error and return `{ isError: true, content: [{ text: "Error: NEXT_REDIRECT;..." }] }` — the response would be a JSON-RPC error envelope, not a redirect, AND the error message would leak Next internals.

**Both** `/api/mcp/route.ts` and `/api/mcp/[token]/route.ts` are regular API route handlers. Neither is a server action context. Confirmed: `redirect()` cannot be reached from MCP. The PRD's decision to extract a no-redirect core is the correct call.

---

## 9. Existing operating-rules text — verbatim source found

The existing connector instructions are stored **in-repo** as a single string constant `COACH_INSTRUCTIONS` at:

**`/Users/ggronnii/Development/workout-planner/src/app/api/mcp/[token]/route.ts:67-89`**

This is the canonical source of the operating rules text — REQ-D1's documentation can pull verbatim from here rather than from the system prompt or paraphrasing. The string covers:

- User context paragraph (159 lb, Mt. Elbert hero goal, home gym, 12-ish weeks).
- Operating rules 1–10 (the 10th — "Nutrition logs are food groups/items, not macros" — is missing from the requirements doc's enumeration; REQ-D1 should add it).
- Closing line about single user / no PII / never paste the connector URL.

**Important**: the requirements.md REQ-D1 lists rules 1–9 + a NEW rule 10 (auto-legend). But the in-repo text already has a rule 10 (nutrition logs). The doc author should:
- Either renumber the auto-legend rule to **11** and keep nutrition as 10.
- Or insert auto-legend somewhere mid-list and shift others.

This is a content decision the doc author / orchestrator must resolve. **The Architect Agent should flag this discrepancy** in their plan.

The instructions block in `[token]/route.ts` IS what the deployed MCP server returns to claude.ai as part of `initialize`. It's also presumably the text the user pasted into the claude.ai connector config. So `goaldmine-rules.md` has two synchronization requirements going forward:
1. Keep `COACH_INSTRUCTIONS` in `[token]/route.ts` aligned with the doc.
2. Tell the user (in PR final report) to re-paste into the claude.ai connector settings.

The route handler at `src/app/api/mcp/route.ts:27-28` has a much shorter `instructions` string (just one sentence). The `[token]` route has the full set. Both routes register the same tools; only the `instructions` differs. Worth noting for the doc author — they may want to recommend syncing both routes or deprecating the short one.

---

## 10. Tool count baseline

```
$ grep -c 'server.registerTool(' src/lib/mcp/tools.ts
33
```

**Current count is 33, not 38 as the PRD claims.** Verified by line-by-line scan; result confirmed: 11 read-tool registrations + 22 write-tool registrations = 33.

If `create_goal` is added per REQ-B1, the new total will be **34**, not 39.

The PRD's "38 → 39" success criterion (PRD §1.3) and REQ-B1 acceptance ("`tools/list` curl returns 39 tools") are **incorrect**. The Architect Agent and QA gate should adjust the expected count to **34**. This is a documentation-only fix; the feature mechanics are unaffected.

(Possible explanation: PRD author may have counted including `update_goal_legend` registration alongside hypothetical other PR #2 additions that didn't ship, or counted across multiple files. The repo-grep is authoritative.)

---

## 11. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | `createGoalCore` returns wrong shape — server action expects `goal.id` for redirect | Med | High (breaks form) | Type the return as `{ goal: { id: string }, planId: string }` and have BOTH callers destructure. Add explicit return type annotation in `goal-core.ts`. |
| 2 | `goal-core.ts` accidentally given `"use server"` — re-creates the import problem | Low | High (build / runtime errors, possibly silent RPC exposure) | Reviewer + lint check. Add a top-of-file comment: `// NOT a server action file — do not add "use server".` Optional: add an ESLint rule banning `"use server"` directive from this filename. |
| 3 | Double-submit creates duplicate goals (no unique constraint) | Med (claude.ai retry on flaky network; user double-clicks form) | Med (DB clutter, user confusion, multiple active plans) | Existing form behavior is also vulnerable; PR doesn't worsen it. Consider an optional `idempotencyKey` parameter or short-window dedup as future work — explicitly OUT OF SCOPE for this PR. Document the risk. |
| 4 | Prisma `null` vs `Prisma.JsonNull` mishandled on create — TS compile error or wrong semantics | Med | Low | Use the §4 table. Prefer `Prisma.JsonNull` for explicit-null intent (matches `update_goal_legend`). Use `undefined` only for "field omitted by caller". |
| 5 | `update_goal_legend` description token bloat (REQ-B2 adds 5 preset JSON blobs) | Med | Med (claude.ai context-window pressure; tool list latency) | REQ-B2 caps at ~1500 chars; QA gate measures actual length post-edit. Compact JSON, single-line presets. |
| 6 | Test goals piling up in Neon during smoke (every dev iteration creates a goal) | High (will happen on every smoke run) | Low (DB clutter; deactivated plans show in UI) | Document a cleanup snippet for QA: `prisma.goal.deleteMany({ where: { objective: { startsWith: "Test goal" } } })`. Or: smoke against a transaction wrapper. Recommendation: list cleanup steps in QA-Agent prompt. |
| 7 | Operating-rules numbering conflict (existing rule 10 = nutrition; REQ-D1 wants rule 10 = auto-legend) | High (will hit during D1 doc authoring) | Low (cosmetic but confusing) | Architect must decide: renumber auto-legend to 11 OR re-order. Recommendation: append as 11 to preserve historical numbering. Reflect in `[token]/route.ts:67-89` if the user wants the deployed instructions updated. |
| 8 | PRD tool count (38 → 39) mismatched with reality (33 → 34) | High (confirmed) | Low (only affects acceptance gate text) | Architect updates the expected count before agents run. QA verifies actual count. |
| 9 | `legend && legend.length > 0` check vs Zod accepting `[]` as valid array | Med | Low | Zod array schemas accept empty arrays by default. The runtime guard `legend.length > 0` is the gate; this matches `update_goal_legend` semantics. Document explicitly in `create_goal` description: "empty array = no legend = use default." |
| 10 | `createGoalCore` raw `new Date(targetDate)` (form path) vs `parseDateInput` (MCP path) yield different dates for the same yyyy-mm-dd string | Med | Med (a goal created via form may have targetDate at UTC midnight; via MCP at MT midnight) | The form path currently uses `new Date(targetDateStr)` already (existing bug). REQ-A1 doesn't require fixing the form-side parser, but the developer agent SHOULD switch the form path to `parseDateKey()` from `@/lib/calendar` to align both paths. Out of strict scope but a cheap fix. |
| 11 | Server action callers (`GoalCreateForm`) may not gracefully handle `createGoalCore` errors that no longer redirect | Low | Med | The action still wraps `createGoalCore` and adds redirect after. Errors thrown inside core propagate up to the action; Next's error boundary catches them as before. Confirm by smoke-testing form with invalid copyFromGoalId. |
| 12 | `LegendSchema` already imported but the requirements doc says "import LegendSchema" | Low | Low | Developer agent ignores the unnecessary instruction; importer dedup handled by lint. No-op. |

---

## File path index (absolute)

- `/Users/ggronnii/Development/workout-planner/src/lib/goal-actions.ts`
- `/Users/ggronnii/Development/workout-planner/src/lib/plan.ts`
- `/Users/ggronnii/Development/workout-planner/src/lib/legend.ts`
- `/Users/ggronnii/Development/workout-planner/src/lib/mcp/tools.ts`
- `/Users/ggronnii/Development/workout-planner/src/app/api/mcp/route.ts`
- `/Users/ggronnii/Development/workout-planner/src/app/api/mcp/[token]/route.ts` (canonical operating-rules text, lines 67–89)
- `/Users/ggronnii/Development/workout-planner/src/components/GoalCreateForm.tsx` (caller of `createGoal`)
- `/Users/ggronnii/Development/workout-planner/src/components/GoalEditForm.tsx`
- `/Users/ggronnii/Development/workout-planner/src/components/GoalReferences.tsx`
- `/Users/ggronnii/Development/workout-planner/src/app/goals/[id]/page.tsx`

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/research-output.md
