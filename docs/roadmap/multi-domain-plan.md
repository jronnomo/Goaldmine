# Roadmap: Multi-Domain Goal Engine

**Author**: Claude (Planning Lead) + Gabe · **Date**: 2026-05-31 · **Status**: Draft · **Board**: Goaldmine Roadmap (#8)

Scope brief: `.roadmap/2026-05-31-multi-domain/scope-brief.md`.

## 1. Problem & End-State
Goaldmine's goal/targets/readiness/notes/calendar are domain-neutral, but tracking primitives, `Plan.planJson`, the readiness metric resolvers, and the MCP tools are fitness-only. End-state (v1): a **generic spine** (`ScheduledItem` + `LogEntry` + LogEntry-backed metrics) with **per-domain typed MCP packs**, a **GitHub-tracked software-project vertical**, and **goal-type-aware UI** — all coexisting with the untouched fitness vertical.

## 2. Driving Verticals
1. **Fitness** (Mt. Elbert) — untouched, coexists.
2. **Software project** — chewgether (`jronnomo/Chewgether`): App Store + $1,000/mo. Real launch path: Apple Dev/bundle-ID ownership, build monetization (none today), TestFlight, store metadata, submit, launch, growth → $1k MRR.

## 3. Non-Goals (v1)
No fitness migration · no standalone finance vertical · no self-serve/Option-B planning (Backlog epic) · no multi-tenancy/auth/OAuth · no autonomous code-gen.

## 4. Target Architecture

### 4.1 Data model (Prisma — additive, Neon-safe)
- **`Goal.kind`** — `String @default("fitness")` (`"fitness" | "project"`; extensible). Drives UI path, tool pack, coaching. Existing goals default to fitness → zero behavior change.
- **`ScheduledItem`** — `{ id, goalId FK, date DateTime, type String, title String, detail String?, payload Json?, status String @default("planned") /* planned|done|skipped */, completedAt DateTime?, externalRef String? /* e.g. gh issue/milestone id */, createdAt, updatedAt }`. Indexes `(goalId, date)`, `(goalId, status)`, `@@unique([goalId, externalRef])` (idempotent GitHub mirroring). The generic analog of planned hikes/workouts — **fitness keeps its own tables; this is for new verticals**.
- **`LogEntry`** — `{ id, goalId FK, date DateTime, metric String, value Float?, text String?, payload Json?, source String? /* manual|github|claude */, createdAt }`. Indexes `(goalId, metric, date)`. The generic observation: MRR snapshots, downloads, "shipped X".
- **Goal↔GitHub link** — add nullable `Goal.githubRepo String?` (`owner/name`) + `Goal.githubProjectNumber Int?` (and store a PAT/source ref in env or a `GoalIntegration` row — see 4.3). Keep minimal in v1.

### 4.2 Readiness / metrics generalization
- New metric namespace **`log:<key>`** in `goal-targets.ts` METRICS + `resolveMetricValue`/`resolveMetricStart` (`readiness.ts`): value = latest `LogEntry.value` for `(goalId, metric=key)` as-of date; start = earliest. This makes MRR→$1k (`log:mrr`), downloads (`log:downloads`), milestone-completion (`log:milestones_done` or derive from ScheduledItem done-count) all scorable with **no new tables per domain**. `progressFor` already handles increase/decrease + build-from-zero — reuse.
- **Milestone-completion metric** option: a computed metric `items:done_ratio` = done ScheduledItems / total (no LogEntry needed). Decide in Architect phase whether to add as a second generic resolver.

### 4.3 MCP tool surface (typed per-domain packs)
- **Project pack** (new, registered for any goal; typed + keyword-rich for discoverability — the `list_planned_hikes` lesson):
  - `schedule_item`, `list_scheduled_items(goalId?, from?, to?, status?)`, `complete_item`, `update_scheduled_item`, `delete_scheduled_item`.
  - `log_metric(goalId, metric, value|text, date?)`, `list_log_entries(goalId, metric?, from?, to?)`.
- **GitHub-tracking pack** (new): `link_github_project(goalId, repo, projectNumber?)`, `get_project_overview(goalId)` (open issues, board columns, milestones w/ due dates, recent commits, open PRs), `list_project_issues(goalId, state?, label?, milestone?)`, `sync_github_milestones(goalId)` (mirror GH milestones → `ScheduledItem`s via `externalRef`, idempotent), and light writes `set_issue_status`/`move_card`/`close_milestone`. Auth: a server-side GitHub token (env `GITHUB_TOKEN`) scoped to the user's repos (single-user); calls via GitHub REST/GraphQL from the route handler. Apply the existing `decodeArgsDeep` guard.
- The generic decode guard + stateless transport are unchanged.

### 4.4 UI seams (goal-type-aware; coexist)
- **Today (`page.tsx`)** branches on the active goal's `kind`: fitness → existing workout hero; project → "today's `ScheduledItem`s + log MRR/progress + next milestone + recent commits". Shared shell, two bodies.
- **Calendar** renders `ScheduledItem`s for non-fitness goals (markers/legend per type) alongside the existing fitness cells; the cell builder gains a ScheduledItem source.
- **Plan** for a project goal = phases + milestones (from ScheduledItems), not a weeklySplit rotation. A project goal may have a lightweight `Plan` (phases only) or none.
- **Progress** hub shows the goal's readiness over its `log:*` metrics + a milestone burn-down.

### 4.5 Coaching / prompt
- The MCP server instructions + `get_today_plan`/goal reads surface `Goal.kind` and the relevant pack so Claude knows: fitness goal → workout/nutrition tools; project goal → project + GitHub packs, weekly launch review against MRR/milestones.

## 5. Phasing (→ epics → sprints)
- **Epic A — Generic data spine** (`ScheduledItem`, `LogEntry`, `Goal.kind`, `log:*` readiness metric). Unblocks everything. *Sprint 1.*
- **Epic B — Project MCP tool pack** (schedule/list/complete items, log/list metrics; typed). Makes a project goal plannable/trackable via claude.ai. *Sprint 2.*
- **Epic C — GitHub-tracking integration** (link, overview/issues/milestones reads, milestone→ScheduledItem sync, light writes). *Sprint 3.*
- **Epic D — Goal-type-aware UI** (Today/calendar/plan/progress branch on `kind`; coexist with fitness). *Sprint 4.*
- **Epic E — Chewgether goal MVP + coaching** (seed the real goal: kind=project, targets `log:mrr`→1000 + milestone metric, link repo, sync milestones; goal-type-aware coaching prompt). *Sprint 5.*
- **Backlog** — self-serve planner (Option B), fitness convergence onto the spine, standalone finance vertical, multi-tenancy/OAuth.

Each sprint leaves `main` deployable; A→B→C→D are a dependency chain, E integrates.

## 6. Risks & Open Questions
- **Migration safety** — all additive (new tables + nullable `Goal.kind`/github fields); existing rows default to fitness. Verify with `prisma migrate diff`.
- **Abstraction-from-one-example** — every generic decision validated against chewgether, not just fitness. ScheduledItem must fit both a "hike" and "submit to App Store"; LogEntry must fit both a weigh-in and an MRR snapshot.
- **GitHub auth** — single-user server token in env is fine for v1; multi-tenant OAuth is explicitly deferred. Don't leak the token through MCP responses.
- **UI coexistence cost** — two Today/calendar bodies. Accept the duplication; keep branches shallow and shared-shelled.
- **Calendar ScheduledItem source** — the cell builder (`getCalendarMonth`) must gain a ScheduledItem query without disturbing fitness markers (recall the override-baseline bug — be override/source-aware).
- **Connector reload** — every MCP surface change needs a claude.ai connector reload; note on each MCP story.
- **Open**: milestone-completion as a `log:*` metric vs a computed `items:done_ratio` resolver — Architect to decide.

## 7. Architect + Critique resolutions (baked into the stories)
Status: **APPROVE-WITH-FIXES**. Blueprint: `agents/plan-blueprint.md`; critique: `agents/plan-critique.md`.

**Settled decisions (Architect):**
- `Goal.kind` = open `String @default("fitness")` (NOT a Prisma/Postgres enum — avoids `ALTER TYPE` lock issues; existing rows default to fitness, zero migration).
- Milestone-completion = a **`log:milestones_done` LogEntry metric**, NOT a live-computed ratio — because `computeReadinessSeries` reconstructs historical scores via `resolveMetricValue(asOf=pastDate)`; a live ratio would stamp today's value on every past point and corrupt the readiness chart.
- `@@unique([goalId, externalRef])` is idempotent-safe (Postgres UNIQUE ignores NULLs, so non-GitHub items never collide).
- GitHub pack = REST + one GraphQL call (Projects v2 columns); **no new npm dep**; token sanitized in catch blocks via explicit `replace(process.env.GITHUB_TOKEN, "***")`.
- Split `tools.ts` into `registerProjectTools` + `registerGitHubTools` helpers called from `registerAll` (reviewability); decode-guard monkey-patch unchanged.

**Critical fixes (must be reflected in the stories):**
- **C1 — `resolveMetricValue` goalId cascade is 5 sites, not 0.** `resolveMetricValue`/`resolveMetricStart` gain a **required** `goalId` (not optional — optional silently bleeds chewgether's `log:mrr` into a fitness goal). Update all callers in the SAME story: `readiness.ts:63,94` (`computeReadiness`, `computeReadinessSeries`), `stats/page.tsx:39-40`, `progress/page.tsx:37-38`, `goals/[id]/page.tsx:80`. Fitness metrics (`weightLb`/`baseline:*`/`hike:*`) ignore goalId → fitness readiness stays byte-identical. **This lives in Epic A.**
- **C2 — Today is `Program`-driven, not `Goal`-driven.** `src/app/page.tsx` uses `getActiveProgram()` (the `Program` table) and never reads the active `Goal`. Activating a project goal does NOT deactivate the fitness `Program`, so Today would still render fitness. Epic D needs an **active-context resolution** story FIRST: Today fetches the active `Goal`, and if `kind === "project"` renders the project body, else the existing Program-based fitness body. Define the precedence explicitly (active project goal wins over a lingering Program, or surface both — decide in Epic D's first story).
- **C3 — Calendar legend is a closed enum (3-file change).** Rendering `ScheduledItem`s on the calendar requires: a new kind in `src/lib/legend.ts` (the `LegendKindSchema` enum + its MCP tool description), a render branch in `CalendarMonth.tsx`, AND a `MarkerIcon` variant — missing any one = silent no-render. Epic D's calendar story must list all three files in acceptance criteria.
