# Plan — Multi-tenant foundation (Phase 0)

**Initiative:** single-user → per-user data ownership — the foundation under the public-SaaS transformation. **Scope:** Phase 0 ONLY (data ownership + isolation). **NOT here:** dashboard auth/sessions, OAuth MCP connector, onboarding/signup, billing, abuse, legal (later phases). **Board:** #8. Full architecture detail: `.roadmap/2026-06-30-multi-tenant-foundation/agents/architecture.md`.

## Target end-state
Every owned row carries a `userId`; every read/write is scoped to the current user; a 2nd user is fully isolated from the founder. The founder's app behaves identically post-migration. Auth still resolves to the founder via one seam — Phase 1 swaps that seam to real identity with no other changes.

## Key decisions (from the architecture pass)
- **Table classes:** 13 OWNED (add `userId` FK), 7 CHILD (**denormalize `userId` on Plan/LogEntry/ScheduledItem/DayRenderJob**; parent-scope WorkoutExercise/Set/PlanDayOverride/PlanRevision), 1 SHARED (FoodLibrary stays global). `Program` is legacy global → make OWNED + mark for deprecation.
- **FoodLibrary trap:** per-user fields (usageCount/isFavorite/lastAmount/lastUnit) live on the SHARED barcode-unique row → **split** a global `Food` + a per-user `FoodUsage(userId, foodId, …)`.
- **Unique constraints:** all 4 `@@unique` are already parent-scoped (safe); `FoodLibrary.barcode @unique` stays global (correct for a shared table).
- **Current-user seam:** `getCurrentUserId()` (page boundary, via `React.cache` — NO module-global, Next 16 concurrency) + `resolveUserIdFromToken(token)` (MCP, wired at `route.ts:17` post-token-validation). Phase 0 both return the founder; **this is the single Phase-1 swap site.**
- **Isolation = belt + suspenders** (untrusted public users): **Prisma `$extends` scoped client** as the primary app-layer filter (covers all ~147 prisma sites uniformly via a `forUser(userId)` factory replacing the `db.ts` singleton per-request) **+ Postgres RLS** as the DB backstop (`SET LOCAL app.current_user_id` in-transaction — Neon pooled-connection-safe; simple once children carry `userId`).
- **Migration = 3-step additive** (nullable → backfill founder → `NOT NULL`), never required-with-default (a default silently mis-owns new rows).
- **Dev/prod split (GATING):** Neon dev branch + `.env.local` shadowing `.env` (which currently = prod). Migrate/seed against dev only.

## The pervasive surfaces
- **MCP:** ~147 prisma call sites (115 in tools.ts); ~48 tool handlers close over the module `prisma` — the scoped-client extension wins here (no per-handler edits).
- **Focus singleton:** ~35 `isFocus` sites — write-critical: `goal-core.ts:168/403/413` (`updateMany({isFocus:false})` clears focus globally → must scope to userId). Plus ~25 active-plan sites.
- **Lib anchors needing a `userId` thread:** `goal-focus.ts` (getFocusGoal/getActiveGoalsWithPlans), `program.ts` (getActiveProgram), `calendar.ts` (resolveDay + ResolveDayCtx + the global workout fetch :854), `rarity.ts` (computeStackRarity :358), records/recap. Most goal-child reads already pass `goalId` → additive once the parent Goal is owned.

## Epics → sprints (build order = gating → unblocks)
1. **E0 — Dev/prod DB separation** (GATING, do first): Neon dev branch, `.env.local`, migrate-against-dev workflow, `.gitignore`.
2. **E1 — User model + founder seed**: minimal `User` (id + identity placeholders), founder row, `FOUNDER_USER_ID` env.
3. **E2 — Additive `userId` migration + backfill**: nullable `userId` on OWNED + denormalized CHILD; backfill all existing rows to founder; `@@index([userId,…])`.
4. **E3 — Current-user seam**: `getCurrentUserId` + `resolveUserIdFromToken`; wire `route.ts` + page boundaries.
5. **E4 — Scoped Prisma client extension**: `forUser(userId)` `$extends` factory; replace the `db.ts` singleton with per-request scoping; thread through `registerAll(server,{userId})` + the lib anchors.
6. **E5 — Focus + active-program per-user refactor**: scope the goal-core write sites + ~35 focus reads + active-plan reads.
7. **E6 — FoodLibrary split**: shared `Food` + per-user `FoodUsage`; migrate the nutrition tools/UI.
8. **E7 — `NOT NULL` promotion + final indexes** (once all reads/writes scoped + verified on dev).
9. **E8 — RLS backstop**: policies + `SET LOCAL app.current_user_id` per transaction.
10. **E9 — Isolation verification + seed updates**: 2nd test user; adversarial cross-tenant read/write tests; seeds assign founder userId; founder-behaves-identically regression.

## Critical path
E0 gates everything → E1 → E2 → E3 (the seam) unblocks E4/E5 → E4 (scoped client) makes scoping uniform → E5 (focus refactor) → E7 (NOT NULL) → E8 (RLS) → E9 (verify). E6 (FoodLibrary) is parallelizable after E2.

## Risks (Plan DA to attack)
- Migration safety on Neon (the additive 3-step; backfill correctness for denormalized children from parents).
- The `goal-core.ts` global `isFocus` writes — a missed scope cross-contaminates tenants.
- Prisma `$extends` doesn't cover `$queryRaw` — audit raw SQL; RLS covers that gap.
- RLS + Neon pooled connections — GUC must be `SET LOCAL` in-transaction or it leaks across pooled requests.
- The `db.ts` singleton → per-request scoped client: server-component concurrency (no module-global mutable).
- Scope creep into Phase 1 (auth) — the seam must cleanly defer; verify no story secretly needs sessions.

---

## Revised (post Plan-DA) — the binding epic structure

**Plan DA: REVISE → folded. The architecture (3-step migration, $extends-primary, seam-deferral) holds; the delivery mechanism + scope were wrong.**

### Key corrections
1. **ALS is the mechanism (was absent).** `$extends` returns a NEW client; the `db.ts:18` module-global singleton can't be per-request without it. `db.ts` exports BOTH the raw `prisma` (seeds/migrations/tests/non-request) AND `getDb()` (reads an `AsyncLocalStorage<ScopedDb>`; set post-auth in route.ts + Next middleware). **59 production files** import `prisma` directly → a mechanical-but-large `getDb()` migration.
2. **`$extends` does NOT intercept NESTED writes.** `goal-core.ts:167` creates a Plan nested in Goal.create → the Plan child lands WITHOUT `userId`. Refactor to a two-step create (Goal, then Plan with derived userId). Same care for goal-less `Hike` creates (`hike-core.ts:174`).
3. **DROP RLS (old E8) from Phase 0.** Zero `$queryRaw/$executeRaw` sites (grep-confirmed) → nothing to backstop; `SET LOCAL` needs every query in a transaction (bigger than E4). `$extends` scoping is sufficient alone. RLS → Phase 1 (design: interactive `$transaction` + `SET LOCAL` at request start).
4. **E5 overstated → 4 write sites only.** The ~35 `isFocus` READS self-fix once the scoped client injects `userId` into the where. Explicit work = the cross-tenant WRITE traps: `goal-core.ts:413` (`updateMany` no-where clears ALL tenants' focus), `goal-core.ts:403` (pre-`$transaction` unscoped read), `note-actions.ts:34` (`resolveAllPendingNotes` bulk), `day-log-actions.ts:226` (`unskipDay` `deleteMany`). Document the render-job reaper (`render-jobs/peek` + `render-tools.ts:264,377`) as SYSTEM-scoped (not user).
5. **FoodLibrary split → DEFER to Phase 1.** One user in Phase 0 → the per-user fields on the shared row cause zero isolation bugs; triggered by user 2.
6. **E2 indexes** must include the game/engine ALL_TIME scans (`engine.ts:963-1039`): `@@index([userId, startedAt])` on Workout, `@@index([userId, date])` on Hike/Baseline/NutritionLog/Note/MobilityCheckin/BodyMetric/GameBonusXp.

### Final epics (revised order)
- **E0 — Dev/prod DB split** (GATING): Neon dev branch, `.env.local` shadow, migrate-against-dev, `.gitignore`.
- **E1 — User model + founder seed**: `User` model; rewrite `seed.ts` to create the founder + emit `FOUNDER_USER_ID` → `.env.local` (resolves the seam chicken-and-egg).
- **E2 — Additive `userId` migration + backfill + indexes**: nullable `userId` on 13 OWNED + denormalized on Plan/LogEntry/ScheduledItem/DayRenderJob; backfill (Goal first → JOIN children); the compound `userId` indexes incl. game-engine scans.
- **E3 — Current-user seam**: `getCurrentUserId()` (page boundary, `React.cache`) + `resolveUserIdFromToken(token)` (MCP, at `route.ts:17` post-validation). Phase 0 → founder; the ONE Phase-1 swap site.
- **E4a — ALS + scoped-client infra**: `AsyncLocalStorage`, `forUser(userId)` `$extends` factory, `getDb()` accessor; set the store in `route.ts` + middleware; `db.ts` dual export.
- **E4b — `prisma`→`getDb()` migration** (the big one, own sprint, atomic): ~59 files; + the nested-create two-step fix (`goal-core.ts:167`) + goal-less Hike create.
- **E4c — Test-mock migration**: update the 8+ `vi.mock("@/lib/db")` suites for the dual export / `getDb()`.
- **E5 — Global-write scoping**: the 4 write traps + document the system-scoped render reaper.
- **E7 — `NOT NULL` promotion + final indexes** (after all scoped + verified on dev). **E7-1 shipped (2026-07-01):** guard-based enforcement — raw-create sites set `userId: FOUNDER_USER_ID`, `npm run db:verify-owned` asserts 0 unowned rows; hard schema NOT NULL deferred to Phase 1 (would break 29 getDb-injected create sites' types).
- **E9 — Isolation verification**: seed a 2nd user; adversarial cross-tenant read/write tests (no leak); founder-behaves-identically regression.

- **E9-1 — Broad cross-tenant isolation verification (Phase-0 done-bar)**: `scripts/verify-tenant-isolation-full.ts` — 16-model per-model read sweep, lib-anchor isolation (getFocusGoal / getActiveProgram / resolveDay / computeWeeklyRecap / getExerciseSummaries), write isolation, founder-regression checks. Run via `npm run db:verify-isolation`. **Shipped 2026-07-01: ALL assertions PASS, exit 0.**

---

## Phase 0 COMPLETE (E0–E9 shipped)

All epics in the Phase-0 scope have shipped:
- **E0** — Dev/prod DB split (Neon dev branch + `.env.local`)
- **E1** — User model + founder seed
- **E2** — Additive `userId` migration + backfill + compound indexes
- **E3** — Current-user seam (`getCurrentUserId` / `resolveUserIdFromToken`)
- **E4a** — ALS + scoped-client infra (`AsyncLocalStorage`, `forUser`, `getDb`)
- **E4b** — `prisma→getDb()` migration (~59 files) + nested-create two-step fixes
- **E4c** — Test-mock migration for dual-export `db.ts`
- **E5** — Global-write scoping (4 write traps: focus-switch / bulk-note / unskip-day / read isolation)
- **E7** — NOT NULL guard enforcement + `db:verify-owned` (0 unowned rows asserted)
- **E9** — Adversarial isolation harness (E5) + broad cross-tenant done-bar (E9-1)

The data layer is **certifiably multi-tenant-ready**. A second user is fully isolated across all 16 scoped models. The founder's data and behavior are unchanged.

### Deferred to Phase 1 (noted, NOT decomposed here)
- **Hard NOT NULL schema constraint** — deferred because 29 `getDb()`-injected create sites would break TypeScript types; the guard + `db:verify-owned` enforces at the application layer for now.
- **RLS backstop** — Postgres Row-Level Security (`SET LOCAL app.current_user_id`; Neon pooled-connection-safe). No `$queryRaw` sites in Phase 0 — `$extends` scoping is sufficient alone. Design when Phase 1 brings untrusted public users.
- **FoodLibrary → Food + FoodUsage split** — per-user fields (usageCount/isFavorite/lastAmount/lastUnit) on the shared barcode-unique row cause zero bugs in Phase 0 (single user); triggered by user 2 coming online.
- **getDb() leaky-read select: cleanup** — audit call sites that call `getDb()` without explicit `select:` and return full rows (potential over-scoping in multi-tenant reads).
- **Dashboard auth/sessions** — real Next.js session middleware; `getCurrentUserId()` throws on unauthenticated.
- **OAuth MCP connector** — real per-user token resolution in `resolveUserIdFromToken`; the Phase-0 "return founder" shortcut is replaced.
- **Onboarding / signup / billing** — first-run flow, per-user account creation, subscription management.

### Critical path
E0 → E1 → E2 → E3 → **E4a → E4b** (the bottleneck) → E4c → E5 → E7 → E9. E4b gates everything downstream; size it generously.
