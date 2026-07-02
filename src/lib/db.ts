// src/lib/db.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

// ---------------------------------------------------------------------------
// 1. Raw singleton — UNCHANGED. Used by seeds, scripts, migrations, tests,
//    and all existing code that imports `prisma` directly. Do NOT remove or
//    alter this export; 67 files depend on it.
// ---------------------------------------------------------------------------
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ---------------------------------------------------------------------------
// 2. Scoped-model set — 17 models that have a `userId` FK.
//    Non-scoped models (User, FoodLibrary, WorkoutExercise, Set,
//    PlanDayOverride, PlanRevision) are passed through untouched.
//    FoodLibrary stays non-scoped (shared catalog); FoodUsage is scoped.
//
//    Source of truth: PRD §"Grounded context" + `ModelName` enum in
//    src/generated/prisma/internal/prismaNamespace.ts lines 386–409.
//    If you add a new model with userId, add it here AND to the PRD.
// ---------------------------------------------------------------------------
const SCOPED_MODELS = new Set<string>([
  "Workout",
  "Measurement",
  "FootageMarker",
  "Baseline",
  "Note",
  "Hike",
  "NutritionLog",
  "MobilityCheckin",
  "Goal",
  "Program",
  "GameBonusXp",
  "BodyMetric",
  "ScheduledItem",
  "LogEntry",
  "Plan",
  "DayRenderJob",
  "FoodUsage", // E-1: per-user food state (usage count, favorites, last portion)
]);
// Auth.js models (Account, Session, VerificationToken) are intentionally excluded —
// auth infrastructure is cross-user by design; the adapter uses raw `prisma` directly.
// C-1 OAuth server models (OAuthClient, OAuthAuthCode, OAuthAccessToken, OAuthRefreshToken)
// are also excluded — pre-auth infrastructure; route handlers use raw `prisma` directly.

// ---------------------------------------------------------------------------
// 3. Pure injection helper — EXPORTED for unit-testing without a live DB.
//
//    Takes the raw args object from an `$allOperations` callback, injects
//    `userId` into the correct field per operation, and returns the mutated
//    args. The extension calls this; tests call it directly.
//
//    TYPE SAFETY NOTE: Several args shapes use XOR types
//    (e.g. WorkoutCreateArgs.data = XOR<WorkoutCreateInput, WorkoutUncheckedCreateInput>)
//    where the relational form does NOT expose `userId` as a scalar (it uses
//    `user?: UserCreateNestedOne...`). At runtime, Prisma's query engine
//    resolves `userId` as a scalar regardless of which XOR branch the caller
//    used. TypeScript cannot express this, so we cast the affected fields to
//    `any`. Casts are isolated here — call sites using `ScopedClient` still
//    see correctly-typed APIs. Confirmed against:
//      - models/Workout.ts line 1774 (WorkoutCreateArgs.data XOR)
//      - models/Workout.ts line 1784 (WorkoutCreateManyArgs.data single|array)
//      - models/Workout.ts line 1908 (WorkoutUpsertArgs.create XOR)
//
//    INJECTION MATRIX (verified against generated types in models/Workout.ts):
//
//    READ ops (inject into args.where):
//      findUnique, findUniqueOrThrow  — WorkoutWhereUniqueInput includes
//        `userId?: StringNullableFilter | string | null` (line 329); safe.
//        Returns null/throws if the record belongs to another user — correct
//        ownership-mismatch behavior. Do NOT rewrite to findFirst.
//      findFirst, findFirstOrThrow, findMany, count, aggregate, groupBy
//
//    WRITE — where-side (inject into args.where):
//      update, updateMany, updateManyAndReturn, delete, deleteMany
//
//    WRITE — create (inject into args.data, cast to any):
//      create
//
//    WRITE — createMany / createManyAndReturn (inject into each data row):
//      createMany, createManyAndReturn
//      args.data is `WorkoutCreateManyInput | WorkoutCreateManyInput[]`
//      (lines 1784 + 1803) — must branch on Array.isArray.
//
//    WRITE — upsert (inject into args.where AND args.create, NOT args.update):
//      Reasoning: args.where must carry userId so we don't match another
//      user's record; args.create must carry userId so a new row is owned;
//      args.update intentionally excluded — an update that matches shouldn't
//      rewrite the userId field (ownership is set at create time only).
//      NOTE: injecting userId into upsert.where means targeting another user's
//      row no-matches → silent create (safe; no cross-user leak; E4b audits
//      upsert sites to confirm this behavior is intentional at each callsite).
//      WorkoutUpsertArgs shape confirmed at models/Workout.ts lines 1888–1913.
//
//    RAW-QUERY BYPASS: `$queryRaw`, `$executeRaw`, and `*Unsafe` variants do
//    NOT enter the `$extends` callback — they bypass the extension entirely and
//    are NEVER scoped. E4b/E5 must hand-scope any raw queries. No raw sites
//    exist in `src/lib/mcp/` today, but E4b's audit MUST grep
//    `\$queryRaw|\$executeRaw` and hand-scope each one.
// ---------------------------------------------------------------------------

// Operations scoped via args.where (reads + ownership-scoped writes)
const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

/**
 * Pure args-transformation helper. Injects `userId` into the correct field
 * of `args` for the given `model` + `operation`. Returns the (mutated) args
 * object — the extension calls `query(injectUserId(...))`.
 *
 * Exported for direct use in unit tests (`db.scoped.test.ts`).
 *
 * IMPORTANT: `$queryRaw`, `$executeRaw`, and `*Unsafe` variants BYPASS this
 * extension entirely — they are never scoped. E4b/E5 must hand-scope raw queries.
 * No raw sites exist in `src/lib/mcp/` today; E4b's audit must grep
 * `\$queryRaw|\$executeRaw` and hand-scope each one.
 */
export function injectUserId(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  // Gate: pass through non-scoped models entirely
  if (!SCOPED_MODELS.has(model)) return args;

  // WHERE-side injection (reads + destructive writes that scope by owner)
  if (WHERE_OPS.has(operation)) {
    args.where = { ...(args.where as Record<string, unknown> | undefined), userId };
    return args;
  }

  // CREATE — inject into data (cast required; see type safety note above)
  if (operation === "create") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args.data = { ...(args.data as any), userId };
    return args;
  }

  // CREATEMANY / CREATEMANYANDRETURN — inject into each row
  if (operation === "createMany" || operation === "createManyAndReturn") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = args.data as any;
    args.data = Array.isArray(data)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.map((row: any) => ({ ...row, userId }))
      : { ...data, userId };
    return args;
  }

  // UPSERT — inject into where (ownership lookup) and create (new row owner)
  // NOT into update (ownership must not change on an existing record).
  // Injecting userId into where means targeting another user's row no-matches
  // → silent create (safe; E4b audits upsert sites).
  if (operation === "upsert") {
    args.where = { ...(args.where as Record<string, unknown> | undefined), userId };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args.create = { ...(args.create as any), userId };
    // args.update is left as-is intentionally
    return args;
  }

  // Any future operation not in the matrix passes through (safe default)
  return args;
}

// ---------------------------------------------------------------------------
// 4. Extension factory + ScopedClient type
//
//    `_makeExtension` is the internal factory used solely to derive the
//    `ScopedClient` type. It is NOT exported. `forUser` is the public API.
//
//    The `as unknown as ScopedClient` cast in `forUser` is required because
//    TypeScript cannot prove the return type of `prisma.$extends({ query:
//    { $allModels: { $allOperations: ... } } })` is assignable to the type
//    derived from `_makeExtension` — they are identical at runtime but the
//    type system doesn't reduce through generic extension chains. Using
//    `_makeExtension` to anchor the type and casting in `forUser` keeps casts
//    minimal and centralized.
// ---------------------------------------------------------------------------

// Internal factory — ONLY used for type derivation and as the implementation
// called by forUser. The closure captures `userId` at call time.
function _makeExtension(userId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: (args: Record<string, unknown>) => Promise<any>;
        }) {
          return query(injectUserId(model, operation, args, userId));
        },
      },
    },
  });
}

/** The type of a user-scoped Prisma client. Structurally compatible with
 *  `PrismaClient` model accessors; NOT nominally identical (it's a branded
 *  Prisma extension type). E4b call sites do `const db = await getDb()` and
 *  then `db.workout.findMany(...)` — the full model API is preserved.
 *
 *  Derived from `_makeExtension` (not from `forUser`) to avoid circular
 *  type references.
 *
 *  Source: node_modules/@prisma/client/runtime/client.d.ts lines 897–936
 *  (`$extends` + `DynamicQueryExtensionArgs`).
 */
export type ScopedClient = ReturnType<typeof _makeExtension>;

// ---------------------------------------------------------------------------
// 5. forUser — memoized per userId
//
//    Safe to memoize because:
//    - The extended client shares the underlying connection pool with `prisma`;
//      it carries no request-specific state.
//    - The userId is baked into the closure; calls for the same userId are
//      behaviorally identical across requests.
//    - _scopeCache is bounded by distinct users ever seen (one entry in Phase 0).
//      Multi-tenant growth adds entries lazily but bounded by user count,
//      not request count.
// ---------------------------------------------------------------------------
const _scopeCache = new Map<string, ScopedClient>();

/**
 * Returns a Prisma client that auto-injects `userId` into every query's
 * `where` (reads) or `data` (writes) for the 17 user-scoped models.
 * Non-scoped models (User, FoodLibrary, WorkoutExercise, Set,
 * PlanDayOverride, PlanRevision) are passed through untouched.
 * FoodLibrary is non-scoped (shared catalog); use FoodUsage for per-user state.
 *
 * Result is memoized per userId so repeated calls within the same process
 * return the same object (no allocation overhead per request).
 *
 * Exported so tests and edge callers can construct a scoped client directly
 * without going through the ALS mechanism.
 */
export function forUser(userId: string): ScopedClient {
  const cached = _scopeCache.get(userId);
  if (cached) return cached;
  const client = _makeExtension(userId) as unknown as ScopedClient;
  _scopeCache.set(userId, client);
  return client;
}

// ---------------------------------------------------------------------------
// 6. AsyncLocalStorage — stores the ScopedClient directly (not userId)
//    so getStore() returns the ready-to-use client without a re-lookup.
//
//    Module: node:async_hooks — available natively in Node.js v25.7.0
//    (runtime = "nodejs" in route.ts line 8). No polyfill needed.
//    Source: Research Output §Problem 4(a).
// ---------------------------------------------------------------------------

/** ALS that carries the per-request ScopedClient through the MCP tool
 *  call tree. Set by `runWithUser`; read by `getDb`.
 *
 *  Not directly exported. Use `runWithUser` to set it and `getDb` to read.
 *  If you need the ALS for advanced use (e.g. E5 global-write traps),
 *  export it at that time — keep the surface minimal for now.
 */
const _userScope = new AsyncLocalStorage<ScopedClient>();

// ---------------------------------------------------------------------------
// 7. runWithUser — opens the ALS scope for a request handler
//
//    Usage in route.ts:
//      return runWithUser(userId, () => transport.handleRequest(req));
//
//    The callback `fn` may return a Promise — ALS propagates through all
//    async continuations rooted in that call (confirmed in Research §4a).
//    The scope remains active throughout the entire async execution of fn,
//    including across `await` boundaries inside transport.handleRequest.
// ---------------------------------------------------------------------------

/**
 * Opens an AsyncLocalStorage scope for `userId` and executes `fn` within it.
 * Returns whatever `fn()` returns (including a Promise<Response>).
 *
 * Call sites must NOT `await` before calling `runWithUser` if they need the
 * scope to cover their async work — pass the async fn as the callback.
 *
 * @example
 *   // In route.ts:
 *   return runWithUser(userId, () => transport.handleRequest(req));
 */
export function runWithUser<T>(userId: string, fn: () => T): T {
  return _userScope.run(forUser(userId), fn);
}

// ---------------------------------------------------------------------------
// 8. getDb — the primary call-site accessor for E4b+
//
//    Returns the ALS-scoped client if a scope is active (MCP route context),
//    else creates/reuses the founder-scoped client (RSC / server-action context
//    where getCurrentUserId resolves via React.cache → FOUNDER_USER_ID in Phase 0).
//
//    IMPORT CYCLE ANALYSIS (confirmed safe, A-2 updated):
//      db.ts → imports getCurrentUserId from @/lib/auth/current-user
//      current-user.ts (Phase 1) → dynamically imports auth from @/lib/auth/auth
//        (static import would create: current-user.ts → auth.ts → prisma ← db.ts → cycle)
//      Dynamic import defers resolution past module init, breaking the TDZ crash.
//      No static import cycle remains.
// ---------------------------------------------------------------------------

/**
 * Returns the active user-scoped Prisma client.
 *
 * - In the MCP route (after `runWithUser`): returns the ALS-stored client
 *   (synchronous store lookup, no await).
 * - In RSC / server-actions: falls back to `forUser(await getCurrentUserId())`
 *   which in Phase 0 returns the founder-scoped client. No middleware or ALS
 *   needed for the dashboard path.
 *
 * Phase-0 founder fallback is intentional.
 * Phase-1 contract — `getCurrentUserId()` MUST throw on unauthenticated
 * access; a non-throwing default would let a handler that forgot `runWithUser()`
 * silently mis-scope. Flag for the E3 swap review.
 *
 * E4b call-site pattern:
 *   const db = await getDb();
 *   const workouts = await db.workout.findMany({ where: { status: "completed" } });
 *   // userId is injected automatically — no manual filter needed.
 *
 * CRITICAL LIMITATION — NESTED WRITES:
 *   `$extends` does NOT fire for nested relation writes. If you write:
 *     db.goal.create({ data: { plans: { create: { name: "..." } } } })
 *   the extension injects userId into Goal but NOT the nested Plan.
 *   That Plan row gets null userId. E4b MUST split every nested create into
 *   two sequential top-level calls. See docs/project-gotchas.md §B-9.
 *
 * When NOT to use getDb:
 *   - Seeds (`prisma/seed.ts`): use raw `prisma` — the seed runs outside
 *     a user context and must set userId explicitly.
 *   - Scripts (`scripts/*`): same — raw `prisma`.
 *   - Migrations: raw `prisma` (no user context).
 *   - System-scoped queries (e.g., looking up User by email for auth):
 *     use raw `prisma` — these cross user boundaries by design.
 */
export async function getDb(): Promise<ScopedClient> {
  return _userScope.getStore() ?? forUser(await getCurrentUserId());
}
