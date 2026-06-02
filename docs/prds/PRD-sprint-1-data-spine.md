# PRD: Sprint 1 — Generic Data Spine (Multi-Domain)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-01
**Status**: In Development
**GitHub Issue**: #20, #21, #22, #23, #56 (board #8 — Goaldmine Roadmap)
**Branch**: main (direct-to-main; worktree dev)

---

## 1. Overview

### 1.1 Problem Statement
goaldmine is converging from a single-purpose fitness tracker into a generic, multi-domain AI **goal engine**. Before any project-domain feature (chewgether's App-Store launch, MRR tracking, GitHub milestones) can be built, the database and core scoring engine need a generic spine: a place to schedule arbitrary dated items, a place to log arbitrary metric/text entries, a goal-domain discriminator, and a Goal↔GitHub link. The readiness engine must also become goal-scoped so one goal's logged metrics can never contaminate another goal's score. **All of this must land with the fitness vertical byte-identical** — the live Mt. Elbert program is in active daily use.

### 1.2 Proposed Solution
Five tightly-coupled backend stories, no UI:

1. **#20 — Additive Prisma migration**: add `Goal.kind` (default `"fitness"`), `Goal.githubRepo`, `Goal.githubProjectNumber`, and two new models `ScheduledItem` and `LogEntry`, both FK'd to `Goal` with `onDelete: Cascade`. Migration is CREATE TABLE + ADD COLUMN only — no drops, no type changes.
2. **#21 — Goal-scope the readiness engine**: thread a **required** `goalId` through `computeReadiness`, `computeReadinessSeries`, `resolveMetricValue`, `resolveMetricStart`, and all 5 call sites. TypeScript strict-mode missing-argument errors are the safety net proving no call site was missed. Existing fitness metric branches accept but ignore `goalId` — their queries are unchanged, so fitness readiness is byte-identical.
3. **#22 — `log:*` metric namespace**: a new metric family backed by `LogEntry`, scored from zero like `hike:*`/`workout:count`. Register `log:mrr` and `log:milestones_done` in the METRICS registry.
4. **#23 — Expose `Goal.kind` over MCP**: `create_goal` accepts `kind`, `list_goals` returns `kind`, `get_today_plan` gains an `activeGoal` object so Claude can route to the right tool pack from turn one.
5. **#56 — Sprint 1 QA gate**: prove migration additive, fitness readiness identical, tsc/build green.

### 1.3 Success Criteria
- `prisma migrate diff` against the pre-change snapshot shows only `CREATE TABLE` / `ADD COLUMN`.
- `src/generated/prisma` exports `ScheduledItem` and `LogEntry` types.
- Fitness goal readiness **score and breakdown are byte-identical** on `/stats`, `/progress`, and `/goals/[id]` before vs. after.
- A `log:mrr` target against a project goal scores correctly from `LogEntry` rows; returns null/0 with no rows.
- `get_today_plan` returns `activeGoal.kind="fitness"` for Mt. Elbert.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all green.
- **The live Mt. Elbert goal remains `active=true`** at the end of the run (see §7 hazard).

---

## 2. User Stories

| ID | As... | I want... | So that... | Priority |
|----|-------|-----------|------------|----------|
| US-001 | Gabe (operator) | the DB to have generic scheduled-item + log-entry tables and a goal `kind` | future project-domain features have somewhere to write, with zero disruption to fitness data | Must Have |
| US-002 | Gabe via Claude | readiness scoring scoped to a single goal | chewgether's MRR can never bleed into the Mt. Elbert readiness score | Must Have |
| US-003 | Gabe via Claude | `log:mrr` / `log:milestones_done` to be scoreable targets | a project goal shows real progress against revenue/milestone targets | Must Have |
| US-004 | Gabe via Claude | `create_goal`/`list_goals`/`get_today_plan` to know a goal's `kind` | Claude routes to the correct tool pack from the first turn without an extra `get_goal` call | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. `Goal.kind String @default("fitness")` with `@@index([kind])`; nullable `githubRepo String?`, `githubProjectNumber Int?`.
2. `ScheduledItem` and `LogEntry` models exactly per §4.1, each with `onDelete: Cascade` and the specified indexes/unique.
3. `computeReadiness`, `computeReadinessSeries`, `resolveMetricValue`, `resolveMetricStart` all take a **required** `goalId`. All 5 call sites updated.
4. `log:*` branch in `resolveMetricValue` (latest `LogEntry.value` for `{goalId, metric, date ≤ asOf, value not null}`), `resolveMetricStart` returns `0`, `progressFor` build-from-zero guard adds `log:*`.
5. `METRICS` gains `log:mrr` and `log:milestones_done`.
6. `create_goal` accepts `kind` (enum, default `"fitness"`), persisted via `createGoalCore`; `list_goals` returns `kind`; `get_today_plan` returns `activeGoal { id, kind, objective, githubRepo }` (or null).

### 3.2 Secondary Requirements
- None. Keep scope to exactly the 5 stories.

### 3.3 Out of Scope
- Any new MCP **project** tools (`schedule_item`, `log_metric`, etc.) — Sprint 2.
- `set_active_goal` MCP tool — Sprint 2 (#47). **Important**: this means Sprint 1 has no MCP path to reactivate a goal; the create_goal smoke test must be reverted manually (§7).
- Any UI/page that renders `kind`, `ScheduledItem`, or `LogEntry` — Sprint 4.
- Seeding the chewgether goal — Sprint 5.
- Updating `CLAUDE.md`/`quality-tools.md` for the spine — that's #55, parked in Sprint 5.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

```prisma
model Goal {
  // ... existing fields unchanged ...
  kind                 String   @default("fitness") // fitness | project
  githubRepo           String?  // e.g. "owner/repo"
  githubProjectNumber  Int?
  // ... existing relations ...
  scheduledItems       ScheduledItem[]
  logEntries           LogEntry[]
  // ... existing indexes ...
  @@index([kind])
}

model ScheduledItem {
  id          String    @id @default(cuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  date        DateTime  // USER_TZ midnight, written via parseDateInput by future tools
  type        String    // e.g. "milestone" | "task" | "review"
  title       String
  detail      String?
  payload     Json?
  status      String    @default("planned") // planned | done | skipped
  completedAt DateTime?
  externalRef String?   // e.g. GitHub milestone node id, for idempotent sync
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, date])
  @@index([goalId, status])
  @@unique([goalId, externalRef])
}

model LogEntry {
  id        String   @id @default(cuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  date      DateTime // USER_TZ midnight
  metric    String   // e.g. "mrr", "milestones_done" (NO "log:" prefix in storage)
  value     Float?
  text      String?
  payload   Json?
  source    String?
  createdAt DateTime @default(now())

  @@index([goalId, metric, date])
  @@index([goalId, date])
}
```

**Metric-key convention (decided, must be honored):** the `log:` prefix is a **registry/target-side namespace only**. `LogEntry.metric` is stored **without** the prefix. So a target `metric: "log:mrr"` reads `LogEntry` rows where `metric = "mrr"`. `resolveMetricValue` strips the prefix: `const key = metric.slice("log:".length)`. This matches #22's acceptance criterion (`metric: key`) and #22's example (`LogEntry(metric="mrr", value=500)` satisfies target `log:mrr`).

Migration plan:
- Name: `multi_domain_spine` → `npx prisma migrate dev --name multi-domain-spine`, then `npx prisma generate`.
- ⚠ **Neon-shared with prod.** Tech Lead reviews the generated `migration.sql` with the user and confirms additive-only (CREATE TABLE × 2, ALTER TABLE Goal ADD COLUMN × 3, CREATE INDEX) before applying. **No backfill needed** — `kind` defaults to `"fitness"` so all existing Goal rows inherit it; new columns are nullable.
- `@@unique([goalId, externalRef])`: Postgres treats NULLs as distinct, so multiple ScheduledItems with `externalRef = NULL` per goal are allowed. Verify this assumption holds (it does for standard Postgres unique indexes) — documented so QA checks it.

### 4.2 MCP Tool Surface

| Tool | Purpose | R/W | Notes |
|------|---------|-----|-------|
| `create_goal` | add `kind` input | Write | enum default `"fitness"`; threads through `createGoalCore` → `Goal.kind` |
| `list_goals` | add `kind` to each goal | Read | one-field addition to the existing map |
| `get_today_plan` | add `activeGoal` object | Read | new `prisma.goal.findFirst({ where:{active:true}, orderBy:{updatedAt:"desc"} })`; null if none |

`create_goal` new input field:
```ts
kind: z.enum(["fitness", "project"]).default("fitness").describe(
  "Goal domain; determines which tool pack Claude uses. fitness = workout/hike/baseline tools; project = schedule_item/log_metric/GitHub tools."
)
```
`get_today_plan` `activeGoal` shape: `{ id: string, kind: string, objective: string, githubRepo: string | null } | null`.

Sample curls in §10.2.

### 4.3 Server Actions
`createGoalCore` (`src/lib/goal-core.ts`) gains an optional `kind?: "fitness" | "project"` on `CreateGoalCoreInput`, defaulting to `"fitness"` when persisting (`kind: input.kind ?? "fitness"`). The form caller (`src/lib/goal-actions.ts`) is unaffected — it simply doesn't pass `kind`, so the default applies. **No new server actions, no `revalidatePath` changes** (no UI renders `kind` yet).

### 4.4 Pages / Components
N/A — backend only. The three modified `page.tsx` files (`stats`, `progress`, `goals/[id]`) change **only** the readiness call arguments (add `g.id`); their rendered output is unchanged.

### 4.5 Date / Time Semantics
- New models store `DateTime` columns that future tools will write via `parseDateInput` — but **no tool in Sprint 1 writes them**, so no date-input code ships here.
- `resolveMetricValue`'s `log:*` branch compares `date: { lte: asOf }` — `asOf` is already a `Date`, consistent with every sibling branch. No new `@/lib/calendar` usage required.
- `computeReadinessSeries` week-cursor math is untouched (still `addDays`/`startOfWeekMonday`).

### 4.6 Override-Awareness
N/A — no `PlanDayOverride` changes; readiness/metrics are orthogonal to day overrides.

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications
N/A — no UI in this sprint. (`/stats`, `/progress`, `/goals/[id]` must render **identically**; that's a regression check, not a UI change.)

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| Existing Goal rows after migration | inherit `kind="fitness"` via default; render unchanged |
| Project goal target `log:mrr`, no LogEntry rows | `resolveMetricValue` → null, `progressFor` → null, target excluded from score (`missing`) |
| `log:mrr` target with `LogEntry(metric="mrr", value=500)`, target 1000 | progress = 0.5 (build-from-zero) |
| Fitness goal (no `log:*` targets) | **no** LogEntry query executed; score byte-identical |
| `get_today_plan` with no active goal | `activeGoal: null` |
| `create_goal` without `kind` | stored row has `kind="fitness"` |
| Two ScheduledItems with `externalRef=NULL` same goal | both allowed (Postgres NULL-distinct unique) |
| Migration run against Neon | additive only; existing fitness data untouched |

---

## 7. Security Considerations & Critical Hazard

- **No new public routes**; MCP bearer-token coverage unchanged.
- Input validation: `kind` is a closed Zod enum; rejects anything outside `fitness`/`project`.
- Prisma-only; no raw SQL.

### ⚠ CRITICAL HAZARD — create_goal deactivates the live goal
`createGoalCore` (`goal-core.ts:78-80`) runs `tx.goal.updateMany({ data: { active: false } })` inside its transaction — **creating ANY goal deactivates Mt. Elbert.** The Neon DB is shared with prod, and `set_active_goal` (the reactivation tool) does not exist until Sprint 2. Therefore:
- The #23 acceptance criterion *"curl smoke: create_goal with kind='project'"* **must NOT be run casually against Neon.**
- **Tech Lead handles this smoke step manually** with guaranteed cleanup: create the test goal → verify `kind="project"` via `get_goal` → **delete the test goal AND re-activate the Mt. Elbert goal** (direct `prisma.goal.update`/script, since no MCP reactivation tool exists) → confirm `get_today_plan` shows Mt. Elbert active again before finishing.
- QA Agent must **verify the live goal is `active=true` at the end** and flag if not.

---

## 8. Acceptance Criteria

1. [ ] `prisma/schema.prisma` adds `Goal.kind`/`githubRepo`/`githubProjectNumber`, `ScheduledItem`, `LogEntry`, the two Goal relations, and `@@index([kind])` exactly per §4.1.
2. [ ] Generated `migration.sql` is additive-only (CREATE TABLE ×2, ADD COLUMN ×3, CREATE INDEX) — no DROP/ALTER TYPE.
3. [ ] `npx prisma migrate dev --name multi-domain-spine` applies cleanly to Neon; `npx prisma generate` succeeds; `src/generated/prisma` exports `ScheduledItem` + `LogEntry`.
4. [ ] `computeReadiness`/`computeReadinessSeries`/`resolveMetricValue`/`resolveMetricStart` require `goalId`; all 5 call sites pass the goal id.
5. [ ] `log:*` branch reads `LogEntry` filtered by `goalId` + key (prefix stripped); `resolveMetricStart` returns 0; `progressFor` build-from-zero includes `log:*`.
6. [ ] `METRICS` contains `log:mrr` and `log:milestones_done` with the exact specs from #22.
7. [ ] Fitness readiness **score + breakdown byte-identical** before/after (verified by computing against Mt. Elbert targets) — **no** LogEntry query for any fitness metric.
8. [ ] `create_goal` accepts `kind` (default fitness), persists to `Goal.kind`; `list_goals` returns `kind`; `get_today_plan` returns `activeGoal{id,kind,objective,githubRepo}|null`.
9. [ ] `npx tsc --noEmit` 0 errors; `npm run lint` no new errors; `npm run build` succeeds.
10. [ ] MCP curl: `get_today_plan.activeGoal.kind === "fitness"`; `list_goals[*].kind` present.
11. [ ] **Mt. Elbert goal is `active=true` at end of run** (create_goal smoke reverted).
12. [ ] All Date math stays in `@/lib/calendar`; no raw `setHours/getDate/getMonth/getFullYear` introduced in app code.

---

## 9. Open Questions
*(empty — all resolved in Phase 1)*

- ~~Does `LogEntry.metric` store the `log:` prefix?~~ → No. Prefix is registry-side only; storage is bare key (`mrr`). §4.1.
- ~~How is the create_goal-deactivates-goal hazard handled in QA?~~ → Tech-Lead-handled with cleanup + reactivation. §7.
- ~~Generated client committed or regenerated per worktree?~~ → Gitignored (`/src/generated/prisma`); each worktree runs `prisma generate`. Build order: #20 merges to main first, then #21/#22/#23 worktrees branch off updated main.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit` (the required-`goalId` change makes missing call sites a compile error — that's the safety net) · `npm run lint` · `npm run build`.

### 10.2 MCP curl smoke
```sh
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
# get_today_plan → expect activeGoal.kind == "fitness"
curl -s -X POST http://localhost:3000/api/mcp -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_today_plan","arguments":{}}}'
# list_goals → expect each goal has kind
curl -s ... -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_goals","arguments":{}}}'
```
**create_goal kind="project" smoke — Tech-Lead only, with revert (see §7).**

### 10.3 Browser smoke
`npm run dev`; open `/stats`, `/progress`, `/goals/[id]` at 390 px; confirm the readiness score + breakdown are **unchanged** from current main.

### 10.4 Migration verification
Confirm `prisma migrate dev` succeeds; `migration.sql` additive; `prisma generate` regenerates; existing Mt. Elbert goal still renders; a quick `SELECT kind FROM "Goal"` shows `fitness`.

---

## 11. Appendix

### 11.1 Discovery Notes
Pre-planned via `/roadmap` (commit d274fd0). Issues #20–23 + #56 carry file-level touches, exact signatures, and line numbers — verified against current code (2026-06-01): call sites at `stats:39-40`, `progress:37-38`, `goals/[id]:80`; `Goal` model at `schema.prisma:163`; `create_goal` at `tools.ts:2420` → `createGoalCore` at `goal-core.ts:32`. Build sequencing: #20 is a hard gate (regenerates the client); #21→#22 share `readiness.ts`+`goal-targets.ts` (sequential, one stream); #23 touches only `tools.ts` (parallel stream).

### 11.2 References
- Board #8 issues #20, #21, #22, #23, #56
- `docs/roadmap/multi-domain-plan.md`
- Commit d274fd0 (roadmap plan + backlog)
