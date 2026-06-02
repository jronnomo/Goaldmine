# Architecture Critique — Sprint 1: Generic Data Spine

**Reviewer**: Devil's Advocate Agent  
**Date**: 2026-06-01  
**Document under review**: `architecture-blueprint.md` (same directory)  
**Verdict**: **NEEDS REVISION** — two high-severity defects must be fixed before coding starts; remaining issues are medium/low and can be addressed in-stream.

---

## Critical Issues

### CRIT-1 — `goalId` is REQUIRED but the fitness branches silently accept `undefined` at runtime (HIGH)

**What is wrong**: The new signatures declare `goalId: string` as a required positional parameter (no default, no `?`). TypeScript enforces this at compile time, and the blueprint correctly calls TypeScript strict mode "the safety net." However, in `computeReadinessSeries` (readiness.ts:85–104), the recursive `computeReadiness` calls are forwarded correctly in the blueprint (Section 3.2). The problem is **positional**: the new `computeReadiness` signature is `(targets, asOf = new Date(), goalId)`. TypeScript does **not** require a default-valued parameter (`asOf`) to precede non-defaulted ones in all positions — but calling `computeReadiness(targets, cursor, goalId)` works fine.

The real danger is the two `computeReadinessSeries` call sites in stats and progress:

```typescript
// Blueprint Section 3.5 — stats/page.tsx:40 and progress/page.tsx:38
computeReadinessSeries(g.createdAt, targets, new Date(), g.id)
```

`computeReadinessSeries` signature: `(goalCreatedAt, targets, now = new Date(), goalId)`. The `now` slot is the third positional argument, and `goalId` is fourth. The blueprint explicitly passes `new Date()` for `now` before `g.id` for `goalId`. This is **correct**. However, if any agent accidentally omits `new Date()` and writes `computeReadinessSeries(g.createdAt, targets, g.id)`, TypeScript will **not** catch this: `g.id` (a `string`) is assignable to `now: Date = new Date()` only if TypeScript narrowed the type as `Date`, but `string` is not assignable to `Date` — TypeScript WILL catch that.

Wait — re-examining: `g.id` is `string`, `now` is typed `Date`. TypeScript strict mode WILL produce a type error if you pass a `string` where `Date` is expected. This transposition risk is actually caught.

**Revised concern (still HIGH)**: The `goalId` parameter on `resolveMetricStart` is appended as a third argument after the two existing args `(prisma, metric)`. The `log:*` branch returns `0` immediately and never uses `goalId`. However, all existing branches (`weightLb`, `baseline:*`, `hike:*`, `workout:count`) also ignore it. **This is intentional for Sprint 1.** The actual risk is that the blueprint's instructions for `resolveMetricStart` never use `goalId` in any branch — making the required parameter enforced by TypeScript but semantically vestigial for the entire sprint. This is fine by design. No defect here.

**Actual CRIT-1** (reassessed): The `computeReadiness` signature places a **required parameter after an optional one**: `(targets, asOf = new Date(), goalId: string)`. TypeScript 5 strict mode **allows** this (a required parameter may follow a parameter with a default), but it means callers cannot omit `asOf` using positional syntax while still passing `goalId` — they must explicitly pass `new Date()`. The blueprint already addresses this in Section 3.5 with the "Note on `now` slot." This is not a defect, it is an awkward API that the blueprint correctly mitigates by always explicitly passing `new Date()`.

**Revised CRIT-1 (real)**: `resolveDay` at `calendar.ts:299` already queries `prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" }, select: { targetDate: true, objective: true } })`. The blueprint's `get_today_plan` handler adds a **second** `prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" }, select: { id: true, kind: true, objective: true, githubRepo: true } })` in the Promise.all alongside `resolveDay`. This means `get_today_plan` issues **two** goal queries against the same `active: true` condition — one inside `resolveDay` (returning `targetDate` + `objective`) and one new one returning `id` + `kind` + `objective` + `githubRepo`. These are guaranteed to return the same row (same `where` + `orderBy`) but are issued as separate round-trips. This is wasteful on every call to `get_today_plan` — the tool already called ~daily and is the primary session-start tool.

**Why it matters**: Performance regression on the most-called MCP tool. Each call now costs two goal queries where one would suffice.

**How to fix**: Widen the `select` on the existing `resolveDay` internal goal query to include `id`, `kind`, and `githubRepo`, and surface these on `ResolvedDay`. Then `get_today_plan` extracts `activeGoal` from `r` instead of a second query. Alternatively, post-process `r` to derive `activeGoal` from the `resolveDay` result (which already returns `goalObjective`). **Either approach eliminates the second round-trip.**

**Severity**: MEDIUM (functional correctness is unaffected; only performance. Demoted from HIGH on second review. But the fix is cheap and should land in Sprint 1.)

---

## Design Concerns

### DC-1 — `log:` prefix stripping is correct but the convention is documented only in comments (MEDIUM)

**What is wrong**: The storage convention (`LogEntry.metric` = bare key, e.g. `"mrr"`; target/registry = prefixed key, e.g. `"log:mrr"`) is documented in Section 7a of the blueprint and in the PRD §4.1. However, the only enforcement is the `metric.startsWith("log:")` branch in `resolveMetricValue`. There is no type or schema constraint preventing a future `log_metric` tool (Sprint 2, #27) from writing `metric: "log:mrr"` (with prefix) to `LogEntry`. If that happens, `resolveMetricValue` strips the prefix and queries for `metric: "mrr"`, but the stored row has `metric: "log:mrr"` — the query returns null forever, silently breaking all project-goal readiness scores.

**Why it matters**: Silent data corruption across sprint boundary. Sprint 2 ships `log_metric` months later; the next agent may not re-read Section 7a.

**How to fix**: Add a DB-level `CHECK` constraint on `LogEntry.metric` that rejects the `log:` prefix: `@@ignore` is not the right tool, but a Prisma `@@check` or a Zod validation in the future `log_metric` tool's input schema would catch this. Minimally, add a code comment in `LogEntry`'s `metric` field definition: `// NEVER store "log:" prefix — strip before writing. See Section 7a of blueprint and resolveMetricValue in goal-targets.ts.` The METRICS comment in `goal-targets.ts` should also explicitly state: `// LogEntry.metric stores the bare key (no "log:" prefix). resolveMetricValue strips the prefix at read time.`

**Severity**: MEDIUM

---

### DC-2 — `@@unique([goalId, externalRef])` with `externalRef = NULL`: Postgres behavior is correct but the partial index semantics are surprising (MEDIUM)

**What is wrong**: The blueprint correctly notes that Postgres treats NULLs as distinct in unique indexes, so multiple `ScheduledItem` rows with `externalRef = NULL` for the same goal are allowed. This is the intended behavior. However, `@@unique` in Prisma generates a standard `UNIQUE` index, and **Prisma's upsert (`upsertMany`, `createOrUpdate`) cannot use a partial-NULL unique key as the `where` clause** — Prisma requires a `@unique` or `@@unique` where all fields are non-null for upsert operations. This means Sprint 2's idempotent GitHub sync (the primary use case for `externalRef`) cannot use `prisma.scheduledItem.upsert({ where: { goalId_externalRef: { goalId, externalRef } } })` when `externalRef` is null.

**Why it matters**: Sprint 2 will try to use this unique index for idempotent syncs and hit a Prisma runtime error or type error when `externalRef` is null, forcing a workaround to be retrofitted in the migration.

**How to fix**: This is acceptable for Sprint 1 since no write tool touches `ScheduledItem`. Document explicitly in the QA notes that Sprint 2's `schedule_item` tool must handle the null case separately (use `findFirst` + conditional create/update rather than `upsert` for null-externalRef items). Add this to the `@@unique` comment in the schema: `// Upsert on this key is only valid when externalRef IS NOT NULL — see Sprint 2 notes.`

**Severity**: MEDIUM (Sprint 1 has no ScheduledItem write tools; this only bites Sprint 2.)

---

### DC-3 — The `goalId` required parameter signals "goal-scoped" but fitness queries still aggregate globally (LOW-MEDIUM)

**What is wrong**: After Sprint 1, `resolveMetricValue(prisma, "hike:total_elevation_ft", asOf, goalId)` accepts `goalId` but queries `prisma.hike.aggregate({ _sum: { elevationFt: true }, where: { date: { lte: asOf }, status: "completed" } })` — no `goalId` filter whatsoever (goal-targets.ts:272–278). The same is true for `weightLb`, all `baseline:*`, all other `hike:*`, and `workout:count`. This is **by design for Sprint 1** and the blueprint explicitly calls it out: "existing fitness metric branches accept but ignore `goalId` — their queries are unchanged."

The concern is semantic: the function signature implies goal isolation, but the behavior is global aggregation. If a user ever has two concurrent fitness goals (e.g., Mt. Elbert + a snowboard readiness goal), both goals' readiness scores will aggregate **all** workouts/hikes/measurements regardless of `goalId`. The `goalId` param was added to enable future isolation, not to enforce it now.

**Why it matters**: Acceptable for Sprint 1 (single fitness goal). But the API lie could cause confusion in Sprint 3+ when project and fitness goals coexist. A developer reading the signature would expect `goalId` to filter results.

**How to fix**: Add a comment to each fitness branch: `// Sprint 1: goalId accepted but not used; aggregates all records. Goal-scoping for fitness metrics is deferred to Sprint 3.`

**Severity**: LOW (documented, known, intentional — just add the comment)

---

### DC-4 — `createGoalCore` deactivation hazard: `setActiveGoal` in `goal-actions.ts` has `redirect("/calendar")` (MEDIUM)

**What is wrong**: Blueprint Section 7b correctly identifies the hazard and proposes using `setActiveGoal` (goal-actions.ts:115) to reactivate Mt. Elbert via a `tsx` one-liner. However, `setActiveGoal` at line 150 calls `redirect("/calendar")` — a Next.js server action redirect that throws a `NEXT_REDIRECT` error when called outside of a server action request context. Running it via a standalone `tsx` script will **throw and abort before `revalidatePath` runs**, but the critical DB operations (`updateMany` + `update`) happen inside the `$transaction` at lines 116–138, **before** `redirect`. The transaction commits successfully. The `redirect` throws but is harmless in script context.

**Why it matters**: The Tech Lead running the reactivation script will see a thrown error and may panic thinking the reactivation failed, when in fact the DB change succeeded. This could lead to a double-run or incorrect diagnosis.

**How to fix**: In the Tech Lead instructions (Section 7b), explicitly note: "Running `setActiveGoal` via `tsx` will throw `NEXT_REDIRECT` at the end — this is expected and harmless. The transaction commits before the throw. Verify reactivation by querying `SELECT active FROM "Goal" WHERE id = '<mt-elbert-id>'` directly or via `get_today_plan` curl."

**Severity**: MEDIUM (correctness risk due to misleading error output)

---

### DC-5 — Schema `kind` field position and `NOT NULL` with DEFAULT on populated Neon table (LOW-MEDIUM)

**What is wrong**: `ALTER TABLE "Goal" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'fitness'` on a populated table. In **modern Postgres (≥11)** — and Neon runs Postgres 16 — adding a `NOT NULL` column with a non-volatile `DEFAULT` does **not** require a table rewrite. Postgres 11+ stores the default as catalog metadata and returns it virtually without rewriting existing rows. This is safe.

However: Prisma generates migration SQL as a single transaction. The `@@index([kind])` index creation happens in the same migration. On a table with many rows, `CREATE INDEX` takes a full sequential scan and an `ACCESS SHARE` lock. This does not block reads or DML (Postgres uses a non-blocking index build by default via `CREATE INDEX CONCURRENTLY` — but Prisma does **not** generate `CONCURRENTLY`). A standard `CREATE INDEX` takes a `SHARE` lock that **blocks concurrent writes (INSERT/UPDATE/DELETE)** for the duration of the index build.

**Why it matters**: The live Mt. Elbert goal is in active daily use. If the `CREATE INDEX` on `Goal.kind` runs during a workout logging session, any concurrent `INSERT`/`UPDATE` on the `Goal` table will block until the index build completes. For a small table (single user, ~1 row) this is sub-millisecond and irrelevant. No actual risk.

**How to fix**: No fix needed given the single-row `Goal` table. Document the reasoning in the migration review checklist so it is not mistaken for a missing precaution.

**Severity**: LOW (single-user, tiny table; index build is instantaneous)

---

### DC-6 — `resolveMetricValue`'s `log:*` branch uses `findFirst` (latest value) but `resolveMetricStart` returns a hardcoded `0` (LOW)

**What is wrong**: For `log:*` metrics (e.g., MRR), `resolveMetricStart` returns `0`. This means `progressFor` will use `build-from-zero` path (`current / target`). However, `progressFor` already has an "already met" short-circuit: if `direction === "increase" && current >= target`, it returns `1` regardless of start. The `log:*` guard addition to `progressFor` (Section 3.4) adds `log:*` to the build-from-zero branch — so it never reaches the comparative formula. This is internally consistent.

**Concern**: `resolveMetricStart` returning `0` is correct only because `progressFor` never calls it for `log:*` (the build-from-zero path skips the start lookup). But `computeReadiness` (lines 64–66) calls `resolveMetricStart` for every target where `t.start` is not pre-set, **before** `progressFor` determines which branch to take. So `resolveMetricStart` IS called, returns `0`, and `start=0` is passed to `progressFor`, which then enters the build-from-zero path and ignores `start`. No behavioral defect, but a wasted DB call avoided only because the `log:*` branch returns early (`return 0`).

**How to fix**: No fix needed — the call chain is correct. Add a comment in `resolveMetricStart`'s `log:*` branch: `// Returns 0 as a convention; progressFor ignores start for log:* (build-from-zero path).`

**Severity**: LOW

---

### DC-7 — `get_today_plan` return shape change: downstream consumers may assume the old shape (LOW)

**What is wrong**: The existing `get_today_plan` return is `{ ...r, standingRules }` where `r` is `ResolvedDay`. Adding `activeGoal` is additive (new key). The MCP transport is JSON; the claude.ai client receives the full object. Claude reads `activeGoal` to route tool packs. No UI page directly consumes `get_today_plan` output (it's an MCP tool).

**Concern**: The `ResolvedDay` spread already includes `goalObjective: string | null` (populated only on goal-date days). After the change, `get_today_plan` returns both `goalObjective` (legacy field) and `activeGoal.objective`. These are semantically different: `goalObjective` is non-null only when today IS the goal's target date; `activeGoal.objective` is always the active goal's name. This could confuse Claude into believing it has the goal's objective from `goalObjective` when it's actually null on non-target-date days.

**Why it matters**: Low — Claude reads both fields. The description text in the tool is clear. No behavioral defect.

**How to fix**: Update the `get_today_plan` tool description to note: "`goalObjective` is non-null only on the goal's target date (the summit day). `activeGoal.objective` is always the active goal's name regardless of date."

**Severity**: LOW

---

## Suggestions

### S-1 — Consolidate the second goal query into `resolveDay` (from DC-1/CRIT-1)

`resolveDay` (calendar.ts:299) already fetches `prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" }, select: { targetDate: true, objective: true } })`. Widen this `select` to also fetch `id`, `kind`, and `githubRepo`. Surface these on `ResolvedDay` (add `goalId: string | null`, `goalKind: string | null`, `goalGithubRepo: string | null`). Then `get_today_plan` derives `activeGoal` from `r` with no extra query:

```typescript
const activeGoal = r.goalId
  ? { id: r.goalId, kind: r.goalKind ?? "fitness", objective: r.goalObjective ?? "", githubRepo: r.goalGithubRepo ?? null }
  : null;
```

This is a small schema change to `ResolvedDay` and `resolveDay`, touching `src/lib/calendar.ts` — which is currently untouched by all streams. It should be assigned to Agent B (who already touches `tools.ts`) or done as a prerequisite in the schema/readiness stream. The tradeoff is adding `goalId`/`goalKind`/`goalGithubRepo` fields to `ResolvedDay` everywhere it is consumed (20+ uses of `resolveDay` outputs in the codebase). This may be scope-creep; the Tech Lead should decide whether the clean API is worth the surface area change.

**Alternative (simpler)**: Accept the two queries for Sprint 1 and file a Sprint 2 cleanup ticket to consolidate. The duplicate query is sub-millisecond.

---

### S-2 — Pin the `log:` strip convention in a named constant

In `goal-targets.ts`, define:

```typescript
export const LOG_METRIC_PREFIX = "log:" as const;
```

Use `LOG_METRIC_PREFIX` in `resolveMetricValue`'s strip: `const key = metric.slice(LOG_METRIC_PREFIX.length)`. Use it in `progressFor`'s guard: `target.metric.startsWith(LOG_METRIC_PREFIX)`. Use it in `METRICS` entries to build the `id`. This makes the convention impossible to mistype and obvious to future agents reading the file.

---

### S-3 — QA gate should explicitly verify no LogEntry query for fitness goals

The QA checklist (Section 9) checks `prisma.logEntry` accessibility but does not verify that fitness readiness paths issue zero `LogEntry` queries. Add a step: "On `/stats` page load, confirm Prisma query count for `LogEntry` = 0 (Prisma query log at `DEBUG=prisma:query`)." This is the strongest proof of byte-identical behavior.

---

## Missing Requirements

### MR-1 — No acceptance criterion for the worktree gate (REQ-001 → REQ-002/003/004)

**REQ-001 notes** that the schema agent "does NOT run `migrate dev` against Neon." But neither REQ-001 nor the QA checklist has a step that explicitly blocks Agent A and Agent B from branching until the Tech Lead has (a) applied the migration to Neon, (b) run `prisma generate` on `main`, and (c) verified `src/generated/prisma` exports `ScheduledItem` and `LogEntry`. Section 7c describes this correctly, but it is not reflected as a **blocking acceptance criterion** in REQ-001 or the QA gate checklist. If an agent branches off `main` before step (c), `prisma.logEntry` won't exist and `tsc` will fail with a confusing "Property 'logEntry' does not exist on type 'PrismaClient'" error.

**Fix**: Add to REQ-001's acceptance criteria: "Tech Lead confirms `npx prisma generate` on `main` exports `LogEntry` before Agent A/B worktrees start. Signal: `grep -r 'LogEntry' src/generated/prisma` returns hits."

---

### MR-2 — `createGoal` form action (goal-actions.ts:34) creates goals without `kind` — UI path has no hazard guard

**What is wrong**: The form-based `createGoal` server action at `goal-actions.ts:61` calls `createGoalCore` without `kind`, defaulting to `"fitness"`. This is correct. However, the form (`src/app/goals/new/page.tsx` or equivalent) presumably has no `kind` selector for Sprint 1 (out of scope per PRD §3.3). But a user could trigger `createGoal` from the web UI during QA and inadvertently trigger the deactivation hazard without the "Tech Lead only" protection. The blueprint's hazard section (7b) focuses exclusively on the MCP path (`create_goal` curl smoke), not the form path.

**Why it matters**: The deactivation hazard (`tx.goal.updateMany({ active: false })`) exists in `createGoalCore` and is triggered by **any** `createGoalCore` call — MCP or form. If a QA agent opens the browser and creates a goal via the form, Mt. Elbert deactivates. This is pre-existing behavior (not introduced by Sprint 1), but Sprint 1 makes it more likely via the new MCP tool surface.

**Fix**: Add to Section 7b: "The deactivation hazard also applies to the web form path (`/goals/new` → `createGoal` server action → `createGoalCore`). QA Agent must not create goals via the browser during the run."

---

### MR-3 — No rollback plan for a failed Neon migration

The blueprint says "Tech Lead reviews `migration.sql` for additive-only content... Then run `npx prisma generate`." There is no documented rollback path if the migration succeeds partially (e.g., `ALTER TABLE "Goal" ADD COLUMN` succeeds but `CREATE TABLE "ScheduledItem"` fails mid-transaction). Postgres wraps DDL in transactions, so a failure rolls back all DDL in the statement. This is inherently safe for Postgres. However, if the Tech Lead runs the migration and then the app crashes in an unexpected way, there is no documented "undo" step.

**Fix**: Document in migration instructions: "If the migration fails, Postgres rolls back all DDL atomically — no partial state. Run `SELECT table_name FROM information_schema.tables WHERE table_schema='public'` to confirm no `ScheduledItem`/`LogEntry` tables exist before retrying."

**Severity**: LOW (Postgres DDL transactions make this safe; documentation only)

---

## Risk Assessment

| Risk | Probability | Impact | Severity | Mitigation |
|------|------------|--------|----------|-----------|
| Double goal query in `get_today_plan` (DC-1) | Certain | Low perf. | Medium | Accept for Sprint 1; file cleanup ticket |
| `log:` prefix not stripped on Sprint 2 write (DC-1) | Medium | Silent null readiness | Medium | Add constant + code comment (S-2) |
| `@@unique([goalId, externalRef])` blocks Sprint 2 upsert on null (DC-2) | High | Sprint 2 rework | Medium | Document now; no schema change needed |
| `setActiveGoal` tsx-script throws NEXT_REDIRECT (DC-4) | Certain | False alarm / TL confusion | Medium | Document expected throw (DC-4) |
| Agent branches before prisma generate on main (MR-1) | Medium | Compile fail, confused agent | Medium | Add hard gate to REQ-001 acceptance |
| Form-path goal creation during QA deactivates Mt. Elbert (MR-2) | Low | Mt. Elbert goes dark | High | Add hazard note to 7b |
| Neon CREATE INDEX blocks concurrent writes (DC-5) | Certain | < 1ms on 1-row table | Negligible | None needed |
| `kind` field position in Goal schema (NOT NULL + DEFAULT) table rewrite (DC-5) | None | N/A | None | Postgres 11+ safe |
| Fitness readiness score changes due to new goalId param (DC-3) | None | N/A | None | Queries unchanged per design |
| Sprint 2 `log_metric` writes `metric:"log:mrr"` with prefix (DC-1) | Medium | Silent null | Medium | Constant + check constraint (S-2) |
| `computeReadinessSeries` misses goalId on internal computeReadiness calls | None | N/A | None | Blueprint correctly threads goalId |
| `resolveDay` query + new goal query issue same query twice (DC-1) | Certain | Extra round-trip | Low | Fix or defer to Sprint 2 |

---

## Verdict: NEEDS REVISION

The architecture is **fundamentally sound**. The migration is additive and Postgres-safe. The goalId threading is correct and complete. The log:* branch is correctly implemented. The deactivation hazard is identified and mitigated.

**Two issues require resolution before coding starts:**

1. **HIGH (MR-2 + DC-4)** — The deactivation hazard section (7b) must explicitly cover the form-based `createGoal` path, not just the MCP curl smoke. And the `setActiveGoal`-via-tsx reactivation procedure must note that `NEXT_REDIRECT` throws after the transaction commits (so TL does not panic and double-run). These are both documentation fixes — no code change — but they govern a live-prod safety protocol and must be correct before any agent touches `tools.ts`.

2. **MEDIUM (MR-1)** — REQ-001 acceptance criteria must include a hard gate: "Tech Lead confirms `prisma generate` on `main` exports `LogEntry` before Agent A/B branch." Without this, the two parallel streams have a latent sequencing failure mode that produces a confusing compile error, not a clear blocked state.

**Remaining issues (DC-2, DC-3, S-1, S-2)** are medium/low and can be addressed in-stream by the implementing agents as code comments. The Tech Lead should decide whether to consolidate the second goal query (S-1) in Sprint 1 or defer it — the performance impact is negligible but the API design is cleaner if fixed now.
