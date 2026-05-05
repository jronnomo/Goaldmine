# Auto-Legend on Goal Creation — Atomic Requirements

Source PRD: `docs/prds/PRD-auto-legend-on-goal-creation.md`
Branch: `feature/auto-legend-on-goal-creation`

Streams (A/B/C/D) capture the dependency structure. A1 ships the shared core; B + C consume it. D is independent docs work that can run anytime.

---

## STREAM A — Core extraction (foundation, blocks B)

### REQ-A1 — Extract `createGoalCore` to `src/lib/goal-core.ts`
**Files**: NEW `src/lib/goal-core.ts`; MODIFY `src/lib/goal-actions.ts`
**Description**:
- Create `src/lib/goal-core.ts` exporting an async function `createGoalCore({ objective, targetDate, notes, copyFromGoalId, targets, legend })` that:
  - Calls `weeksBetween(now, targetDate)` and `scaffoldPlanFromTemplate(weeks)` (existing helpers from `src/lib/plan.ts`).
  - If `targets` not provided AND `copyFromGoalId` set: read source goal's targets, copy if present.
  - Performs the nested write: Goal + Plan + initial PlanRevision.
  - Stores legend if provided (cast as `Prisma.InputJsonValue`); empty array → `Prisma.JsonNull`; undefined → omit.
  - Returns `{ goal: { id }, planId }`.
  - **No** `revalidatePath`, **no** `redirect`. **No** `"use server"` directive on the file (so it's importable from MCP route handler).
- Refactor `src/lib/goal-actions.ts` `createGoal` server action to:
  - Parse FormData (existing).
  - Call `createGoalCore({...})`.
  - `revalidatePath("/goals")`, `revalidatePath("/stats")`.
  - `redirect(\`/goals/${goal.id}\`)`.
  - Preserve all existing error messages / validation paths.
- Move the `parseTargetsField` helper if needed; otherwise keep it in `goal-actions.ts` and call before invoking `createGoalCore`.

**Acceptance**:
- `src/lib/goal-core.ts` exists; no `"use server"`; exports `createGoalCore` typed.
- `src/lib/goal-actions.ts` `createGoal` is shorter, calls `createGoalCore`, retains revalidate + redirect.
- `npx tsc --noEmit` clean.
- Web form flow at `/goals` creates Goal + Plan + PlanRevision and redirects to `/goals/<id>` (manual smoke).

**Complexity**: M
**Dependencies**: none (foundation).

---

## STREAM B — MCP tools (depends on A1)

### REQ-B1 — Register `create_goal` MCP tool
**Files**: `src/lib/mcp/tools.ts`
**Description**:
- Add `import { createGoalCore } from "@/lib/goal-core";` and `import { LegendSchema } from "@/lib/legend";` at the top of `tools.ts` (legend already imported per PR #2).
- Inside `registerWriteTools(server)`, after `update_goal_legend` registration, add `create_goal`:
  - Title: "Create a new goal (with optional legend)"
  - Description: explains it scaffolds Goal + 12-ish-week Plan + initial PlanRevision in one call. Recommends setting `legend` inline when goal flavor differs from the default hike. Cross-references `update_goal_legend` for preset examples. Mentions `update_goal_targets` as a follow-up for readiness targets.
  - Input schema (Zod):
    ```ts
    inputSchema: {
      objective: z.string().min(1).max(200),
      targetDate: DateKeyShape,
      notes: z.string().optional(),
      copyFromGoalId: z.string().optional(),
      legend: LegendSchema.optional(),
    }
    ```
  - Handler wrapped in `safe()`. Calls `parseDateInput(targetDate)`, then `createGoalCore({...})`, returns `{ goalId: goal.id, planId, message: \`Goal created: ${objective}\${legend ? " (with custom legend)" : ""}\` }`.
- Empty-legend semantics: if caller passes `legend: []`, treat as "no legend" (store null). Match `update_goal_legend` behavior.

**Acceptance**:
- `tools/list` curl returns 39 tools (was 38) and `create_goal` is present with expected title + description.
- `tools/call create_goal` with valid args returns `{ goalId, planId, message }`.
- `tools/call create_goal` with `legend` set persists the legend (verified via `get_goal`).
- `tools/call create_goal` without `legend` leaves `legend === null`.
- TypeScript compiles.

**Complexity**: M
**Dependencies**: REQ-A1.

### REQ-B2 — Sharpen `update_goal_legend` description
**Files**: `src/lib/mcp/tools.ts`
**Description**:
- Replace the `update_goal_legend` description string with one that:
  1. States the closed `kind` enum and what each kind controls (1 sentence each).
  2. Embeds 5 inline preset legend JSON blocks: `hike`, `strength`, `running`, `snowboard`, `hybrid-endurance`. Each preset is a compact JSON array of legend entries, on a single line, prefixed with the flavor name.
  3. Adds a usage cue: "When you create or activate a non-hike goal, propose a goal-appropriate legend immediately. Follow 'Propose before applying' — show the proposed legend, get approval, then call this tool. If the user names a flavor (e.g., 'use the strength legend'), apply the matching preset."
- Keep the description under ~1500 characters (token budget). Confirm length before commit.

**Reference preset content** (final wording at agent's discretion; semantics fixed):
- `hike`: `[{"icon":"●","label":"Trained","kind":"trained"},{"icon":"🥾","label":"Outdoor day","kind":"hike-completed"},{"icon":"🥾","label":"Hike planned","kind":"hike-planned"},{"icon":"★","label":"Custom day","kind":"override"},{"icon":"🏔️","label":"Goal date","kind":"goal-date"}]`
- `strength`: `[{"icon":"●","label":"Trained","kind":"trained"},{"icon":"🏋️","label":"Heavy day","kind":"override"},{"icon":"🏆","label":"Meet day","kind":"goal-date"}]`
- `running`: `[{"icon":"●","label":"Trained","kind":"trained"},{"icon":"🏃","label":"Long run","kind":"override"},{"icon":"🥇","label":"Race day","kind":"goal-date"}]`
- `snowboard`: `[{"icon":"●","label":"Trained","kind":"trained"},{"icon":"🏂","label":"Ride day","kind":"override"},{"icon":"🎿","label":"Season opener","kind":"goal-date"}]`
- `hybrid-endurance`: `[{"icon":"●","label":"Trained","kind":"trained"},{"icon":"🏃","label":"Run","kind":"override"},{"icon":"🥾","label":"Trail","kind":"hike-completed"},{"icon":"🥾","label":"Trail planned","kind":"hike-planned"},{"icon":"🏁","label":"Race day","kind":"goal-date"}]`

Note: presets DON'T need to use every kind — only the kinds relevant to the flavor. Removing `hike-completed`/`hike-planned` from a preset means the boot icons disappear from the calendar entirely for that goal (the legend Card hides them too). This is correct.

**Acceptance**:
- `tools/list` curl returns the new description for `update_goal_legend`.
- All 5 preset names appear in the description text.
- Description length under 1800 chars (slack room above the 1500 target).
- TypeScript compiles.

**Complexity**: S
**Dependencies**: none (parallel with A1/B1).

---

## STREAM D — Documentation (independent)

### REQ-D1 — Author `docs/server-instructions/goaldmine-rules.md`
**Files**: NEW `docs/server-instructions/goaldmine-rules.md`
**Description**:
- Create the file with these sections:
  1. **Title + intent**: "Goaldmine MCP server-instructions — canonical source. Paste applicable sections into the claude.ai → Goaldmine connector instructions block."
  2. **Coach persona context** (1 paragraph): single-user fitness coach, MCP-backed planner, hero/secondary goals.
  3. **Operating rules** (numbered list, copy from existing system prompt):
     - 1. Tools over guessing
     - 2. Propose before applying
     - 3. Cascade explicitly
     - 4. Capture the why
     - 5. Strong-app paste → log_workout
     - 6. Notes with targetDate priority
     - 7. Direct coaching, grounded language
     - 8. Sunday weekly reviews
     - 9. Baseline-collection day pairing
  4. **NEW rule 10. Auto-legend on goal creation** — full paragraph:
     > "When you create a goal via `create_goal` (or activate an existing goal whose `legend` is null) AND the goal's flavor differs from 'hike' (the default), propose a goal-appropriate legend before or alongside the goal creation. Read the preset examples in `update_goal_legend`'s description (hike / strength / running / snowboard / hybrid-endurance) and pick or compose one that fits. The closed `kind` enum is `trained | hike-completed | hike-planned | override | goal-date` — work within it. Follow 'Propose before applying': show the proposed legend, get user approval, then call `update_goal_legend` (or pass `legend` directly to `create_goal` if the user pre-approved). If the user names a flavor explicitly ('use the running legend'), apply the matching preset without further prompting."
  5. **Recent changes footer**:
     > "2026-05-05: Added rule 10 (Auto-legend on goal creation) — PR #3."

**Acceptance**:
- File exists at the exact path.
- Markdown renders cleanly (no broken headings, lists, code fences).
- All 10 rules present.
- Word count of rule 10 between 100 and 200 words.

**Complexity**: S
**Dependencies**: none.

---

## Cross-cutting acceptance (REQ-X)

- `npx tsc --noEmit` returns 0 errors.
- `npm run lint` introduces no new errors (pre-existing lint hits in unrelated files are not blockers).
- `npm run build` succeeds.
- MCP `tools/list` returns 39 tools (was 38 after PR #2).
- `create_goal` round-trips end-to-end: create with legend → `get_goal` returns the legend → no legend → `get_goal` returns null.
- `GoalCreateForm` web flow unchanged: submit → goal created → redirect to `/goals/<id>`.
- No `prisma/schema.prisma` changes.

## Suggested agent assignment

- **Agent 1 (Foundation + MCP)**: REQ-A1 + REQ-B1 sequentially (B1 depends on A1 — same agent for tight ownership, or two agents with strict ordering).
- **Agent 2 (Description + docs)**: REQ-B2 + REQ-D1 in parallel with Agent 1 — both are text-only, zero cross-file dependencies with Agent 1's work.

The orchestrator will sequence: A1 → B1 (Agent 1, sequential) || B2 + D1 (Agent 2, parallel).
