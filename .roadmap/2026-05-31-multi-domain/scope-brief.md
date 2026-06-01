# Scope Brief — Multi-Domain Goal Engine

**Date:** 2026-05-31 · **Board:** Goaldmine Roadmap (#8) · **Repo:** jronnomo/workout-planner

## Problem
Goaldmine's `Goal` + targets/readiness + `Note` + calendar/override machinery are domain-neutral, but every *tracking primitive* (`Workout`/`Hike`/`NutritionLog`/`Baseline`/`Measurement`), `Plan.planJson`, the readiness `METRICS` registry + value resolvers (`resolveMetricValue` switches on `weightLb`/`baseline:*`/`hike:*`/`workout:count`), and the MCP tools are **single-vertical (physical fitness)**. There's no generic "planned action" or "logged observation" concept, so a non-fitness goal can't be planned, scheduled, or scored.

## Target end-state (v1)
A **generic goal spine** that runs *new* verticals alongside the untouched fitness vertical:
- **`ScheduledItem`** — a planned, dated action for any goal (task, milestone, launch step). Hikes/workouts stay on their own tables (coexist; no migration in v1).
- **`LogEntry`** — a point-in-time observation/value for any goal (MRR snapshot, downloads, "shipped X").
- **Generic metrics** — a new metric namespace whose `resolveMetricValue` reads the latest `LogEntry` for that key, so *any numeric goal* scores in readiness with zero new tables.
- **Per-domain TYPED MCP tool packs** — generic data underneath, but typed/keyword-rich tools on top (the `list_planned_hikes` discoverability lesson). A "project" pack for software goals.
- **GitHub-tracked software-project vertical** — link a `Goal` to a GitHub repo/project; goaldmine MCP tools read issues/board/milestones/commits/PRs and mirror milestones onto the calendar as `ScheduledItem`s; the check-in loop coaches the launch.
- **Goal-type-aware UI** — Today/calendar/plan adapt to the goal type (a project's Today = today's tasks + log MRR, not a workout hero).

## Driving verticals (validate every generic decision against BOTH)
1. **Fitness** (existing Mt. Elbert program) — must keep working **untouched**.
2. **Software project** — **chewgether** (Chewabl, RN/Expo, repo `jronnomo/Chewgether`): ship to App Store + reach **$1,000/mo**. Grounded launch path (from repo scan): real Apple Dev account + bundle-ID ownership (currently `app.rork.*`), **build monetization (no IAP/subscription exists yet)**, TestFlight beta, store metadata/screenshots, submit for review, launch, growth → $1k MRR. `$1k/mo` is a **metric on this goal**, not a separate finance vertical.

## Explicit non-goals (v1)
- **No fitness migration** — fitness tables/tools stay as-is; generic spine coexists.
- **No standalone personal-finance vertical** — deferred.
- **No self-serve / in-app planning (Option B)** — the operator runs `/roadmap` to seed plans; capture "self-serve planner" as a **Backlog** epic, do not design now.
- **No multi-tenancy / auth / GitHub OAuth platform work** — single user; deferred.
- **No autonomous code-generation for end-users** — goaldmine is planner/tracker/coach; humans build the code.

## Key architectural seams
- `prisma/schema.prisma` — new `ScheduledItem` + `LogEntry` models (goalId FK, date, type, payload JSON, status); additive, Neon-safe.
- `src/lib/goal-targets.ts` / `src/lib/readiness.ts` — new metric namespace + `resolveMetricValue`/`resolveMetricStart` case backed by `LogEntry`.
- `src/lib/mcp/tools.ts` — new "project" typed tool pack (schedule/list/complete items, log metrics) + GitHub-tracking tools; registered/described for discoverability.
- `src/app/**` — goal-type-aware Today/calendar surfaces (coexist with fitness rendering).
- Coaching prompt / MCP instructions — goal-type awareness so Claude uses the right pack.

## Driving use-case for the check-in loop
Same daily/weekly rhythm as fitness, but for the launch: "what ships this week, what's blocked, MRR trend, next milestone" — read from `LogEntry` + the linked GitHub project.
