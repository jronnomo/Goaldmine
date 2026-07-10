# Architecture Blueprint — #232 log-sheet self-fetch

## 1. `src/lib/log-sheet-data.ts` (new)
Relocate `TodayMealLite` here verbatim; add `LogSheetData`; `getLogSheetData(now = new Date())` is the exact layout.tsx:140-195 pipeline, byte-identical logic. Doc-comment "server-only: uses getDb()/Prisma" (matches `calendar.ts`/`compare-core.ts` convention) — **no** `import "server-only"` guard: grep confirms the package isn't installed/used anywhere in the repo; every server-only module relies on a comment, not the package. Adding a dependency for one file breaks convention for zero benefit (a client-component import of this file already fails the build via `getDb`'s Prisma import — same protection). `now` is an **optional param, default `new Date()`** — rejected: hardcode internally, since a param lets the test assert exact `startOfDay`/`endOfDay` call args without mocking global `Date`.

```ts
import { getDb } from "@/lib/db";
import { startOfDay, endOfDay, resolveDay } from "@/lib/calendar";
import { getQuickPickFoods, listLibraryFoods } from "@/lib/food-actions";
import { type NutritionItem, parseStoredItems } from "@/lib/nutrition-log-ops";
import { sumLoggedDayMacros, sumPlanTargetMacros, hasAnyMacros, type DayMacros } from "@/lib/nutrition-macros";
import type { LibraryFood } from "@/lib/food-types";

export type TodayMealLite = {
  id: string; mealType: string; items: NutritionItem[]; notes: string | null; dateISO: string;
  macros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null; sodiumMg: number | null };
};
export type LogSheetData = {
  todaysMeals: TodayMealLite[]; quickPickFoods: LibraryFood[]; libraryFoods: LibraryFood[];
  trackedSoFar: DayMacros; dayTarget: DayMacros | null;
};
function toNutritionItems(raw: unknown): NutritionItem[] { return parseStoredItems(raw); }

export async function getLogSheetData(now: Date = new Date()): Promise<LogSheetData> {
  const db = await getDb();
  const [rawMeals, quickPickFoods, libraryFoods, today] = await Promise.all([
    db.nutritionLog.findMany({
      where: { date: { gte: startOfDay(now), lte: endOfDay(now) } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, mealType: true, items: true, notes: true,
        calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, sodiumMg: true },
    }),
    getQuickPickFoods(), listLibraryFoods(),
    resolveDay(now), // override-aware — only source of today's plan target
  ]);
  const todaysMeals: TodayMealLite[] = rawMeals.map((m) => ({
    id: m.id, mealType: m.mealType, items: toNutritionItems(m.items), notes: m.notes,
    dateISO: m.date.toISOString(),
    macros: { calories: m.calories, proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG, fiberG: m.fiberG, sodiumMg: m.sodiumMg },
  }));
  const trackedSoFar: DayMacros = sumLoggedDayMacros(todaysMeals.map((m) => m.macros));
  const planTarget = sumPlanTargetMacros(today.nutritionPlan);
  const dayTarget: DayMacros | null = hasAnyMacros(planTarget) ? planTarget : null;
  return { todaysMeals, quickPickFoods, libraryFoods, trackedSoFar, dayTarget };
}
```

`libraryFoods` typed `LibraryFood[]`: `listLibraryFoods()` returns `LibraryFoodRow[]` (structurally extends `LibraryFood`) — same widening layout.tsx already relies on implicitly; no cast.

## 2. Route handler — `src/app/api/log-sheet-data/route.ts` (new)
```ts
import { auth } from "@/lib/auth/auth";
import { runWithUser } from "@/lib/db";
import { getLogSheetData } from "@/lib/log-sheet-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Prisma needs Node APIs — matches mcp/route.ts, peek/route.ts
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return runWithUser(session.user.id, async () => {
    const data = await getLogSheetData();
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  });
}
```

`Response.json(body, init)` (standard Web API, already used in `peek/route.ts`) carries the `no-store` header — no `NextResponse` import needed. **Never** `getCurrentUserId()` here — it `redirect()`s to `/signin` (current-user.ts:28), surfacing as a 307 in a route handler that the client `fetch` follows silently into HTML, not a clean 401 JSON. Route stays OFF `isPublicPath` — middleware's cookie-presence gate (307 no-cookie) + this handler's `auth()` check (401 JSON) are the two layers PRD §7 wants.

## 3. `layout.tsx` refactor
Replace lines 142-195 (Promise.all meal block + derivations) with one call; **do not touch** line 169's `goalCount` statement or its #233 boundary comments (:166-168, :73-75) — nothing else in the file reads `rawMeals`/`quickPickFoods`/`libraryFoods`/`today`/`trackedTodayMacros`/`planTarget`/`dayTargetMacros` outside the `<BottomNav>` JSX (confirmed via whole-file read).

Imports: drop `startOfDay`/`endOfDay`/`resolveDay`/`getQuickPickFoods`/`listLibraryFoods`/`parseStoredItems`/`sumLoggedDayMacros`/`sumPlanTargetMacros`/`hasAnyMacros`/`DayMacros`/`NutritionItem`; add `import { getLogSheetData } from "@/lib/log-sheet-data"; export type { TodayMealLite } from "@/lib/log-sheet-data";`.
```ts
  const logSheet = await getLogSheetData();
  const goalCount = await getGoalCount(); // unchanged — #233 boundary comment stays put
```
JSX: `todaysMeals={logSheet.todaysMeals} quickPickFoods={logSheet.quickPickFoods} libraryFoods={logSheet.libraryFoods} trackedSoFar={logSheet.trackedSoFar} dayTarget={logSheet.dayTarget}`. `const db = await getDb()` at :140 becomes dead (nothing else in the signed-in branch uses `db`) — delete it and the `getDb` import (only other use is the :6 import; safe to drop both).

`TodayMealLite` stays re-exported from `@/app/layout` so **BottomNav.tsx's import line is untouched** (decision below).

## 4. LogLauncher state machine
**Type import split**: `LogLauncher.tsx` switches its `TodayMealLite` import to `@/lib/log-sheet-data` directly (it's being substantially rewritten anyway) and also imports `LogSheetData`. `BottomNav.tsx` keeps `import type { TodayMealLite } from "@/app/layout"` unchanged, so its only diff is the one-line prop add (§6) — the layout re-export exists precisely to make that possible.

**Every current prop's fate**: `todaysMeals` (mealSoFar calc, "Logged today" list + `MealEditButton`) → `data.todaysMeals`. `quickPickFoods` (→ `MealEditButton`, `LogNutritionForm`) → `data.quickPickFoods`. `libraryFoods`/`trackedSoFar`/`dayTarget` (→ `LogNutritionForm` header only) → `data.libraryFoods`/`data.trackedSoFar`/`data.dayTarget`. `latestWeight` (→ `LogMeasurementForm`) **unchanged** — not part of `LogSheetData` (PRD §3.1 lists only the 4 meal-block props); stays hardcoded `null` from BottomNav. `onClose` unchanged. New prop `open?: boolean` (undefined ⇒ closed, so a prop-less pre-#233 mount degrades safely). The 5 meal props stay optional, now serving as **initial data only**.

**State shape** — 4 named phases, each carrying `data` so a background refetch failure never blinks away a good render:
```ts
type LogSheetState =
  | { phase: "idle"; data: null }
  | { phase: "loading"; data: LogSheetData | null }   // data present ⇒ background refresh, no skeleton
  | { phase: "ready"; data: LogSheetData }
  | { phase: "error"; data: LogSheetData | null; message: string; code?: number };
```
Seed: if any of the 5 meal props is defined, build `initialData` from props (`quickPickFoods ?? []`, `libraryFoods ?? []`, `trackedSoFar ?? ZERO_MACROS`, `dayTarget ?? null`), start `{ phase: "ready", data: initialData }`; else `{ phase: "idle", data: null }`.

**Open-transition effect** (prev-open ref, matches `BottomSheet`'s own ref-driven pattern) fires on **every** closed→open transition (AC-2), including when initial data exists — response silently replaces identical prop data (§6 "zero visible change"):
```ts
const prevOpenRef = useRef(false), reqIdRef = useRef(0), abortRef = useRef<AbortController | null>(null);
useEffect(() => {
  if (open && !prevOpenRef.current) void fetchData();
  prevOpenRef.current = !!open;
}, [open]);
```
**fetchData / latest-wins** — each open aborts the prior controller and bumps `reqIdRef`; the abort-catch plus `id !== reqIdRef.current` checks guard a stale response landing after a newer one:
```ts
async function fetchData() {
  const id = ++reqIdRef.current;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  setState((prev) => ({ phase: "loading", data: prev.data })); // never clears existing data
  try {
    const res = await fetch("/api/log-sheet-data", { signal: controller.signal });
    if (id !== reqIdRef.current) return; // superseded by a newer open
    if (res.status === 401) { setState({ phase: "error", data: null, message: "Session expired — sign in again.", code: 401 }); return; }
    if (!res.ok) throw new Error(`log-sheet-data ${res.status}`);
    const data: LogSheetData = await res.json();
    if (id === reqIdRef.current) setState({ phase: "ready", data });
  } catch {
    if (controller.signal.aborted) return; // superseded/aborted, not user-facing
    if (id === reqIdRef.current) setState((prev) => ({ phase: "error", data: prev.data, message: "Couldn't load — try again." }));
  }
}
```
**Render rule**: `const data = state.data; const showSkeleton = data === null && state.phase === "loading";` — everything keyed off `todaysMeals`/etc. today reads `data` (nullable) instead; guards mirror today's `todaysMeals != null` check, so the JSX diff is a rename, not a rewrite.

**Error UI**: `phase === "error"` renders inline text + accent Retry (`onClick={() => void fetchData()}`) below stale-but-present `data`, or instead of row content when `data` is null. `code === 401` swaps copy to "Your session expired. Sign in again." + `<Link href="/signin">Sign in</Link>`.

**Retry cap**: no automatic retry — user-click-initiated only. Rejected: exponential-backoff auto-retry — PRD §3.2 rules out a rate-limit bucket for this route; an auto-retry loop on a flaky connection would hammer an unthrottled endpoint. A manual button bounds request rate to human click speed.

**`refetch()`**: `fetchData` itself is exposed (no wrapper needed) — passed down as `onMutated` to `MealEditButton` instances in the "Logged today" list.

**LogNutritionForm / MealComposer submit**: create mode calls `logNutrition(formData)` via `useFormFeedback`'s `createSubmit`, on success runs `resetCreate()` — **does not close the sheet**, no `onSuccess` hook exposed today. Decision: **skip refetch wiring on the create path this story** — the new meal appears in "Logged today" on the next closed→open transition (AC-2 already guarantees that fetch); AC-3 only demands edit/delete refetch in-sheet. Rejected: add `onLogged` to `LogNutritionForm`/`MealComposer` now — a third component beyond PRD §3.1 item 5's explicit `MealEditButton`-only scope, for a gap no AC calls out.

## 5. `MealEditButton.tsx`
Add `onMutated?: () => void`. `onSaved={() => { onMutated?.(); close(); }}` (was `onSaved={close}`).
```ts
async function handleDeleted() { // was: void deleteNutrition(meal.id)
  await deleteNutrition(meal.id);
  onMutated?.();
  close();
} // onDeleted={() => { void handleDeleted(); }}
```
**Await-then-callback**, not callback-after-void. `deleteNutrition` returns `Promise<NutritionSnapshot>` (workout-actions.ts:336) — today's fire-and-forget `void` is harmless because nothing observes completion. `onMutated` makes ordering load-bearing: firing before the DB write lands lets the refetch return the row mid-delete, flashing the "deleted" meal back — the exact stale-render bug this story exists to kill. `NutritionToday.tsx`'s existing usage passes no `onMutated` — unaffected (optional prop).

## 6. `BottomNav.tsx`
Literal one-line addition inside the existing `<LogLauncher ... />` call (no import/type changes):
```tsx
<LogLauncher latestWeight={null} onClose={() => setLogOpen(false)} open={logOpen} todaysMeals={todaysMeals} ... />
```

## 7. Tests
**`src/lib/log-sheet-data.test.ts`** — mirror `leaky-reads.test.ts`'s calendar mock shape:
```ts
vi.mock("@/lib/db", () => ({ prisma: {}, getDb: vi.fn() })); // dual-export convention
vi.mock("@/lib/calendar", () => ({ startOfDay: (d: Date) => d, endOfDay: (d: Date) => d,
  resolveDay: vi.fn().mockResolvedValue({ nutritionPlan: null }) }));
vi.mock("@/lib/food-actions", () => ({ getQuickPickFoods: vi.fn().mockResolvedValue([]), listLibraryFoods: vi.fn().mockResolvedValue([]) }));
```
`getDb` mock resolves `{ nutritionLog: { findMany: vi.fn() } }`. Cases: (1) `findMany` called with `where.date.gte`/`lte` both `now` (identity mocks make this exactly assertable); (2) raw row → `dateISO` is `date.toISOString()`; (3) null macro fields pass through as `null` (no zero-collapse — only `sumLoggedDayMacros` collapses, at sum level); (4) plan macros summing >0 → `dayTarget` equals the sum, `nutritionPlan: null` → `dayTarget: null`; (5) `getQuickPickFoods`/`listLibraryFoods` results pass through unchanged.

**`src/lib/auth/route-access.test.ts`**: add `["/api/log-sheet-data", "log-sheet-data API"]` to `PROTECTED_CASES`.

## 8. Verification
```sh
# 401 unauthed
curl -s -i http://localhost:3000/api/log-sheet-data | head -1   # expect: HTTP/1.1 401
# authed — sign in in a browser, copy the `authjs.session-token` cookie value
# from devtools (dev = HTTP, no __Secure- prefix; middleware.ts:17-19):
curl -s -i http://localhost:3000/api/log-sheet-data \
  -H "Cookie: authjs.session-token=<value>" | tee /tmp/route.json
# diff todaysMeals/trackedSoFar/dayTarget against the /nutrition page's numbers
# for the same account/day (no direct layout-HTML comparison available).
```

Browser demo (phone width, signed in): open the Log sheet — Network tab shows `GET /api/log-sheet-data` fire; sheet renders instantly if props existed (no skeleton flash), response swaps in. Edit an existing meal's macros → Save: Network tab shows a **second** `GET /api/log-sheet-data`, "Logged today" row + "Today so far" line update **in place, sheet still open, no navigation** — the AC-3 fix. Repeat for Delete (row disappears, totals drop, no flash of the deleted row). Toggle devtools offline, tap a row to force a fetch, confirm inline error + Retry; go back online, click Retry, confirm recovery.
