# PRD: Auto-legend on goal creation

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-05-05
**Status**: Draft
**GitHub Issue**: N/A — feature branch + PR
**Branch**: `feature/auto-legend-on-goal-creation`

---

## 1. Overview

### 1.1 Problem Statement

PR #2 (just merged) introduced per-goal calendar legends — a goal can carry an array of `{icon, label, kind}` entries that drive both the calendar legend Card AND which icons render in cells. New goals start with `legend: null` and fall back to `DEFAULT_LEGEND` (the hike-flavored 5 entries tuned for the current Mt. Elbert program).

Two adjacent gaps remain:

1. **No `create_goal` MCP tool.** Goals are created exclusively via the `GoalCreateForm` web form which calls a `createGoal` server action that scaffolds a Goal + Plan + initial PlanRevision in a nested write. Claude in claude.ai cannot create goals, so it cannot drive a "create goal + set legend" flow end-to-end. Claude is reduced to a reactive role: the user creates the goal in the UI, then asks Claude to update the legend separately.
2. **No convention nudges Claude.** The `update_goal_legend` tool description (PR #2) is a flat verb description without iconography presets or any "do this on goal creation" instruction. Claude will not propose a goal-appropriate legend on its own — it has to be asked.

The result today: creating a goal whose flavor differs from "hike" leaves the calendar showing boots and a mountain on a powerlifting or running goal until the user manually intervenes. The UX is broken at the seams between the web form and the MCP-backed coaching loop.

### 1.2 Proposed Solution

Two complementary surfaces, both shipped in this PR:

1. **In-repo — extract `createGoalCore` + new `create_goal` MCP tool + sharpen `update_goal_legend` description with inline preset legends.** The `createGoal` server action's data work is extracted into a reusable async helper `createGoalCore(input)` (no `redirect`, no `revalidatePath`); the existing server action and the new MCP tool both wrap it. The MCP tool accepts the same fields as the form (objective, targetDate, optional notes, optional copyFromGoalId) plus an optional `legend` parameter so Claude can create + iconographize in a single round-trip. The `update_goal_legend` description gets 4–5 inline preset legends (hike / strength / running / snowboard / hybrid-endurance) that Claude reads as part of the tool, with a clear cue: "When you create or activate a non-hike goal, propose a goal-appropriate legend immediately, following 'Propose before applying.'"

2. **Out-of-repo — author `docs/server-instructions/goaldmine-rules.md`** as the canonical source of the user's "claude.ai Workout Planner" connector instructions. The doc captures the existing rules (Tools-over-guessing, Propose before applying, Cascade explicitly, etc. — pulled from the system prompt) AND adds a new rule for auto-legend-on-goal-creation. The PR's final report renders the new paragraph as a paste-ready block the user copies into the connector config UI.

The architecture stays clean: Claude is the brain, the MCP is the dumb data layer. No regex on `goal.objective`, no server-side preset library exposed as data — presets live in the tool description (which IS the prompt Claude reads) plus the in-repo doc (which is for the human user). When the closed `LegendKind` enum needs to grow (e.g., for a new render condition), that's a code change; everything else is reasoning.

### 1.3 Success Criteria

- A new MCP tool `create_goal(objective, targetDate, notes?, copyFromGoalId?, legend?)` is registered and round-trips correctly in `tools/list` and `tools/call`.
- Calling `create_goal` with `legend` set in one call produces a Goal whose `legend` is the array passed (verified by `get_goal`).
- Calling `create_goal` without `legend` leaves `legend: null`, which falls through to `DEFAULT_LEGEND` in the calendar.
- The `update_goal_legend` description, when fetched via `tools/list`, contains preset legends for at least: hike, strength, running, snowboard, hybrid endurance (5 flavors).
- `docs/server-instructions/goaldmine-rules.md` exists, is comprehensive (covers the existing rules plus the new auto-legend rule), and is readable as a standalone source of truth.
- The PR's final report includes a paste-ready paragraph for the user to add to the claude.ai connector configuration.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass.
- The existing `GoalCreateForm` web flow still works identically (same redirect target, same Plan + PlanRevision scaffolding, same revalidation paths).
- Tool count goes from 38 → 39.

---

## 2. User Stories

| ID     | As Gabe (the user)... | I want to... | So that... | Priority |
|--------|-----------------------|--------------|------------|----------|
| US-001 | starting a new goal in claude.ai | tell Claude my objective + target date and have it create the goal *and* propose a goal-appropriate calendar legend in one conversation | I'm not stuck creating the goal in the web form, then context-switching to chat to fix the calendar | Must |
| US-002 | a strength-leaning user (future) | see iron-bell / trophy icons on heavy days and meet day instead of boots and mountains | the calendar reflects what I'm actually training | Must |
| US-003 | unsure of icon choices | have Claude offer 4-5 sensible options I can approve or tweak | I get fast guidance without having to pick from an arbitrary emoji palette | Should |
| US-004 | creating goals via the web form (existing flow) | the web form behavior to be unchanged | I haven't lost the ability to start a goal from the PWA | Must |
| US-005 | reading the connector config | one canonical doc to consult that captures all the operating rules | I'm not relying on chat memory or scattered notes | Should |
| US-006 | dropping a non-hike legend explicitly | tell Claude "use the running legend" and have it apply | I don't have to dictate every icon manually | Should |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. **Extract `createGoalCore` helper** in `src/lib/goal-actions.ts` (or a new `src/lib/goal-core.ts`) — pure async function, no `revalidatePath`, no `redirect`. Takes `{ objective, targetDate: Date, notes?, copyFromGoalId?, targets?, legend? }` and returns `{ goal: Goal, planId: string }`. Performs the existing nested write (Goal + Plan + initial PlanRevision via `scaffoldPlanFromTemplate`).
2. **Refactor `createGoal` server action** to wrap `createGoalCore`, then call `revalidatePath("/goals")`, `revalidatePath("/stats")`, and `redirect`. Existing callers (the `GoalCreateForm`) must see no behavior change.
3. **Add `create_goal` MCP write tool** in `src/lib/mcp/tools.ts`. Inputs: `objective` (string ≥ 1), `targetDate` (yyyy-mm-dd via `parseDateInput`), `notes?` (string), `copyFromGoalId?` (string), `legend?` (`LegendSchema.optional()` from `src/lib/legend.ts`). Returns `{ goalId, planId, message }`. Wraps `createGoalCore`. Slot after `update_goal_legend` (matching the goal-cluster ordering).
4. **Sharpen `update_goal_legend` description** in `src/lib/mcp/tools.ts` to:
   - Document the closed `kind` enum and what each kind controls.
   - Embed 5 inline preset legends as JSON examples: `hike` (current default), `strength` (🏋️ heavy day / 🏆 meet day), `running` (🏃 long run / 🥇 race day), `snowboard` (🏂 ride day / 🎿 season opener), `hybrid-endurance` (🏃 + 🥾 mix for HYROX/triathlon).
   - Include a usage cue: "When you create or activate a non-hike goal, propose a goal-appropriate legend immediately. Follow the existing 'Propose before applying' rule — show the proposed legend, get user approval, then call this tool. If the user explicitly names a flavor (e.g., 'use the strength legend'), apply the matching preset."
5. **Author `docs/server-instructions/goaldmine-rules.md`** containing:
   - The full set of existing operating rules (Tools-over-guessing, Propose-before-applying, Cascade-explicitly, Capture-the-why, Strong-paste-parse, Notes-with-targetDate priority, Direct-coaching tone, Sunday-weekly-reviews, Baseline-collection-day pairing — pulled from the existing system prompt verbatim where possible).
   - One new rule: **"Auto-legend on goal creation"** — concrete language matching the convention shipped in this PR. Captures: when to propose, what to consult, how to apply, and the closed-kind constraint.
   - A "Recent changes" footer naming the PR/commit so future readers know when each rule was added.
6. **PR final report** must render the new auto-legend-rule paragraph as a paste-ready code block (markdown), labeled with explicit instructions for the user ("Append this to your claude.ai → Goaldmine connector instructions block").

### 3.2 Secondary Requirements

7. **`create_goal` reload-the-connector reminder** in PR description and final report (since the MCP tool surface grew).
8. **Verify the `legend` parameter on `create_goal` accepts the same `LegendSchema` Zod validator** as `update_goal_legend` — share the schema, don't duplicate.
9. **`create_goal` should NOT auto-deactivate other goals.** Match the existing server action behavior (the form does not deactivate either; explicit deactivation is a separate user action).
10. **`create_goal` `copyFromGoalId` field** must be a no-op when the source goal has no targets, identical to the form behavior.

### 3.3 Out of Scope

- **Server-side legend inference from `objective` string.** Explicitly rejected by the user — would create a brittle code-maintained preset library and contradict the "Claude reasons, MCP stores" architecture.
- **Goal deletion / activation MCP tools.** Existing flows (web form / `update_goal_targets` / status field) cover this. Adding more tools is scope creep.
- **Calendar UI changes.** Pure tool-surface + docs change.
- **Adding new `LegendKind` values.** The closed enum stays as-is (`trained`, `hike-completed`, `hike-planned`, `override`, `goal-date`). Future kinds need a code change.
- **Auto-prompting from MCP responses** (e.g., `create_goal` responding with "and now propose a legend"). The convention lives in the tool description + server-instructions, not in response payloads.
- **Migrating the existing Mt. Elbert goal's legend to a non-null value.** It can stay null (uses default) until the user asks to change it.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

**No changes.** Existing schema (post-PR-#2) covers everything: `Goal.legend Json?` is already in place.

### 4.2 MCP Tool Surface

#### New: `create_goal`

| Field | Purpose | R/W | Notes |
|-------|---------|------|------|
| `create_goal` | Create a new goal + scaffold a plan in one call | Write | Mirrors `createGoal` server action |

**Title**: `Create a new goal (with optional legend)`

**Description**: Mention nested-write behavior, point at `update_goal_targets` / `update_goal_legend` as follow-ups, suggest setting legend in this call when the goal flavor differs from hike. Reference the `legend` examples in `update_goal_legend`'s description.

**Input schema (Zod)**:

```ts
inputSchema: {
  objective: z.string().min(1).max(200),
  targetDate: DateKeyShape, // yyyy-mm-dd → parseDateInput
  notes: z.string().optional(),
  copyFromGoalId: z.string().optional()
    .describe("Copy targets array from this existing goal"),
  legend: LegendSchema.optional()
    .describe("Calendar legend for this goal — set inline to skip a follow-up update_goal_legend call. See update_goal_legend description for preset examples by goal flavor."),
}
```

**Return shape**:

```ts
{ goalId: string, planId: string, message: string }
```

**Sample curl**:

```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_goal","arguments":{
    "objective":"Squat 405 by Sept",
    "targetDate":"2026-09-15",
    "notes":"Powerlifting meet prep",
    "legend":[
      {"icon":"●","label":"Trained","kind":"trained"},
      {"icon":"🏋️","label":"Heavy day","kind":"override"},
      {"icon":"🏆","label":"Meet day","kind":"goal-date"}
    ]
  }}}'
```

#### Modified: `update_goal_legend` description

Same Zod inputSchema. New description text embeds five preset legend JSON blocks as examples. The kind enum is documented inline. The "propose before applying" + "auto-legend on goal creation" cues are explicit.

### 4.3 Server Actions

`createGoal` in `src/lib/goal-actions.ts` is refactored:
- Body extracted into `createGoalCore({ objective, targetDate, notes, copyFromGoalId, targets, legend })` (returns `{ goal, planId }`).
- Server action becomes: parse FormData → call `createGoalCore` → `revalidatePath("/goals")` + `revalidatePath("/stats")` → `redirect(\`/goals/${goalId}\`)`.
- No behavior change for existing callers.

`createGoalCore` location: top of `src/lib/goal-actions.ts` (above the server action that wraps it). It is a plain async function with `"use server"` directive **at file top** (already present); since `createGoalCore` doesn't take FormData and isn't a top-level export from this server-actions file with `"use server"`, **decision**: extract `createGoalCore` to a separate file `src/lib/goal-core.ts` with no `"use server"` directive so it can be safely imported from the MCP route handler.

| File | Function | Mutation | revalidatePath calls | Redirect? |
|------|----------|----------|---------------------|-----------|
| `src/lib/goal-core.ts` (new) | `createGoalCore(input)` | Goal+Plan+PlanRevision nested create | none | no |
| `src/lib/goal-actions.ts` | `createGoal(form)` (existing) | wraps `createGoalCore` | `/goals`, `/stats` | yes — `/goals/${id}` |
| `src/lib/mcp/tools.ts` | `create_goal` MCP tool | wraps `createGoalCore` | none (MCP path) | no |

### 4.4 Pages / Components

No changes. `GoalCreateForm.tsx` is untouched (still calls `createGoal` server action which still redirects).

### 4.5 Date / Time Semantics

- `create_goal` accepts `targetDate` as `DateKeyShape` (`yyyy-mm-dd` Zod regex) and parses with `parseDateInput`. Same convention as every other date-taking MCP tool. Verifies USER_TZ midnight, not UTC.
- `createGoalCore` takes `targetDate: Date` (already-parsed). Both server action and MCP tool parse before calling.

### 4.6 Override-Awareness

Not applicable. Goal creation does not interact with `PlanDayOverride`.

### 4.7 Third-Party Dependencies

None. Pure refactor + new tool registration + docs.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions

No UI changes. The MCP tool surface and a docs file are the only deliverables.

### 5.2 Navigation Flow

Unchanged.

### 5.3 Responsive + Mobile-First Spec

Not applicable.

### 5.4 Accessibility

Not applicable.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| `create_goal` with `targetDate` in the past | Fails Zod regex if not yyyy-mm-dd; otherwise allowed (matches existing form which doesn't validate past dates). Document, don't reject. |
| `create_goal` with `legend: []` | Empty array is invalid per `LegendSchema` (it has no kinds, but Zod accepts empty arrays as valid arrays). Decision: `[]` stores as `null` in DB (matches `update_goal_legend` semantics — empty array = reset). |
| `create_goal` with `copyFromGoalId` pointing at non-existent goal | Silently no-op on targets (matches existing form behavior — `findUnique` returns null, no targets copied). Goal still created. |
| `create_goal` with `legend` containing unknown `kind` | Zod schema rejects → `safe()` returns error envelope. |
| Concurrent `create_goal` calls with same objective/date | Both succeed (no uniqueness constraint on Goal). Existing behavior. |
| `update_goal_legend` description over MCP token limit | Mitigation: keep preset JSON compact (single-line each); validated during QA. |
| Network failure during `create_goal` write | Prisma transaction rolls back the nested write. Error envelope returned. |
| `docs/server-instructions/goaldmine-rules.md` falls out of sync with actual claude.ai connector text | Acknowledged: this doc is informational, not enforcement. The PR final report instructs the user to paste the new section into the connector. |

---

## 7. Security Considerations

- MCP bearer-token coverage: `create_goal` registers via `registerWriteTools(server)` which is wrapped by the same auth guard as every other write tool. No new public surface.
- Input validation: full Zod schema on every input. `parseDateInput` for date strings.
- No `dangerouslySetInnerHTML` (no UI surface).
- No raw SQL — Prisma only.
- The new docs file is markdown and committed; no runtime concern.
- `createGoalCore` is plain TypeScript, not a server action. Importing it into `src/lib/mcp/tools.ts` does not expose it to the public surface — only the MCP HTTP handler can call it.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run build` succeeds.
4. [ ] `src/lib/goal-core.ts` exists, exports `createGoalCore({ objective, targetDate, notes?, copyFromGoalId?, targets?, legend? })`.
5. [ ] `src/lib/goal-actions.ts` `createGoal` server action wraps `createGoalCore` and preserves existing `revalidatePath` + `redirect` behavior.
6. [ ] `src/lib/mcp/tools.ts` registers `create_goal` (write tool) — title + description + Zod inputSchema present.
7. [ ] `src/lib/mcp/tools.ts` `update_goal_legend` description includes 5 preset legend JSON examples (hike, strength, running, snowboard, hybrid-endurance) AND an "auto-legend on goal creation" cue.
8. [ ] MCP `tools/list` curl returns 39 tools (was 38).
9. [ ] MCP `tools/call create_goal` with valid args returns `{ goalId, planId, message }` and creates a Goal + Plan + PlanRevision row.
10. [ ] MCP `tools/call create_goal` with `legend` set persists `goal.legend` correctly (verified by `get_goal`).
11. [ ] MCP `tools/call create_goal` without `legend` leaves `goal.legend === null`.
12. [ ] `GoalCreateForm` web flow: creating a goal via `/goals` form still redirects to `/goals/<id>` and creates Goal + Plan + PlanRevision identically (no regression).
13. [ ] `docs/server-instructions/goaldmine-rules.md` exists and is well-formatted markdown.
14. [ ] The doc captures all existing operating rules from the system prompt PLUS the new auto-legend-on-goal-creation rule.
15. [ ] The PR description / final report renders the new auto-legend rule as a paste-ready markdown code block.
16. [ ] All Date math goes through `@/lib/calendar` (`parseDateInput` for the MCP tool's `targetDate` string).
17. [ ] No `prisma/schema.prisma` changes.
18. [ ] No new server actions; only the existing `createGoal` is refactored.
19. [ ] No `text-emerald-500` / `text-amber-500` / `text-red-500` / hardcoded blue hex regressions introduced (per Goaldmine rebrand gates).

---

## 9. Open Questions

*(Resolved during Phase 1 discovery — no remaining questions for development.)*

- ~~Stack on PR #2 or merge first?~~ → Merge PR #2 first (done), branch from main.
- ~~Add `create_goal` MCP tool?~~ → Yes (US-001 is Must Have).
- ~~Where do legend presets live?~~ → Inline in the `update_goal_legend` description text. Tool description IS the prompt.
- ~~Server-instructions doc shape?~~ → Both: `docs/server-instructions/goaldmine-rules.md` (canonical) + paste-ready paragraph in PR final report.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build

- `npx tsc --noEmit` — must be clean.
- `npm run lint` — no new errors.
- `npm run build` — Turbopack production build succeeds.

### 10.2 MCP curl smoke

```sh
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"

# Confirm tool count
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -c 'import sys, json; d=json.load(sys.stdin); print(len(d["result"]["tools"]))'
# Expect 39

# Create a non-hike goal with custom legend in one call
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_goal","arguments":{
    "objective":"Test goal with legend",
    "targetDate":"2026-12-31",
    "notes":"smoke test",
    "legend":[
      {"icon":"●","label":"Trained","kind":"trained"},
      {"icon":"🏋️","label":"Heavy","kind":"override"},
      {"icon":"🏆","label":"Meet","kind":"goal-date"}
    ]
  }}}' | python3 -m json.tool
# Expect { goalId, planId, message }

# Read it back — confirm legend persisted
# (paste returned goalId)
GOAL_ID="..."
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_goal\",\"arguments\":{\"goalId\":\"$GOAL_ID\"}}}" \
  | python3 -c 'import sys, json; d=json.load(sys.stdin); print(json.dumps(json.loads(d["result"]["content"][0]["text"]).get("legend"), indent=2))'

# Create a hike-flavored goal without legend — confirm null
curl -s ... 'create_goal' { objective, targetDate } # no legend
# get_goal → legend === null

# Cleanup smoke goals via web (or leave; they're test artifacts)
```

### 10.3 Browser smoke

1. `npm run dev`
2. Visit `/goals` and create a goal via the form — verify redirect to `/goals/<id>` works AND no console errors.
3. Visit `/calendar` — confirm legend renders default (since web-form goals are still legend=null).

### 10.4 Migration verification

N/A — no Prisma migration in this PR.

---

## 11. Appendix

### 11.1 Discovery Notes

User-confirmed decisions (Phase 1):
- Workflow: feature branch + PR (matches recent rebrand + legend convention).
- PR #2 to be merged first (done before Phase 3).
- Add `create_goal` MCP tool (Must Have).
- Legend presets live inline in `update_goal_legend` description (tool description = prompt).
- Both in-repo doc (`docs/server-instructions/goaldmine-rules.md`) AND paste-ready paragraph in final report.
- Skip UX research (no UI surface).

### 11.2 References

- PR #1: rebrand → https://github.com/jronnomo/workout-planner/pull/1 (merged)
- PR #2: goal-driven legend → https://github.com/jronnomo/workout-planner/pull/2 (merged, this PR builds on it)
- `src/lib/legend.ts` — `LegendSchema`, `LegendKindSchema`, `DEFAULT_LEGEND`, `resolveLegend`, `findLegendEntry`
- `src/lib/goal-actions.ts:32` — existing `createGoal` server action (to be refactored)
- `src/lib/plan.ts` — `scaffoldPlanFromTemplate`, `weeksBetween` (consumed by `createGoalCore`)
