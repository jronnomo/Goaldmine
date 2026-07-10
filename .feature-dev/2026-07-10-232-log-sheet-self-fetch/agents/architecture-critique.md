# Devil's Advocate — #232 log-sheet self-fetch

Every claim below checked against source at HEAD (files read whole where cited). Line refs are current, not blueprint's.

---

## Critical

### C1 — Create path is excluded, but the PRD explicitly puts it in scope (blueprint §4 "LogNutritionForm / MealComposer submit")

Traced the actual submit flow, not the blueprint's summary:

- `LogNutritionForm` (`src/components/LogNutritionForm.tsx:21-41`) is a thin wrapper: `<MealComposer mode="create" .../>`.
- `MealComposer`'s create-mode submit (`src/components/MealComposer.tsx:1166-1176`):
  ```ts
  onSubmit={(e) => { e.preventDefault();
    createSubmit(logNutrition, { successMsg: "✓ Meal logged", onSuccess: resetCreate }); }}
  ```
  `createSubmit` is `useFormFeedback().submit` (`src/lib/use-form-feedback.ts:56-71`): `await action(fd)` (i.e. `logNutrition` completes, including its `revalidatePath` calls) **then** `onSuccess` fires. So ordering is safe to hook — the DB write has landed by the time `onSuccess` runs.
- Nothing in this path closes the sheet. `resetCreate()` only clears local form state (`MealComposer.tsx:472-492`). `LogLauncher`'s own `expanded === "meal"` accordion state is untouched, and the outer `BottomSheet` stays open (`onClose` is never called). Blueprint's claim "does not close the sheet" is correct.
- **But the "Logged today" list rendered above the form** (`LogLauncher.tsx:179-208`) is driven by `todaysMeals`/`data.todaysMeals` — the exact list the blueprint's own state machine now owns. Nothing refetches it after a create. Log a meal → the sheet stays open, showing the pre-submit list and the pre-submit "Today so far" line. **This is the headline bug from a different entry point, verbatim.**

The blueprint rejects wiring this ("a third component beyond PRD §3.1 item 5's explicit MealEditButton-only scope, for a gap no AC calls out"). That is contradicted by the PRD itself, three separate places:

1. **AC-3** (PRD-232 line 91): *"In-sheet edit/delete/**log** refetches — list + macro line update without navigation (THE bug, demo'd in browser)"* — "log" is explicitly listed alongside edit/delete.
2. **§6 Edge Cases** (line 78): *"In-sheet **log**/edit/delete | Refetch; list + totals update in place with sheet open"* — same three-way list, again.
3. **§9 Open Questions** (line 100): *"Architect to resolve: LogNutritionForm submit path (does it close the sheet? **wire refetch accordingly**)"* — the PRD explicitly delegates this exact decision to the architect and tells them to wire it, not to rule it out. The blueprint answered "does it close the sheet?" (no) but skipped "wire refetch accordingly."

**Fix (cheap, symmetric to the already-planned `onMutated` wiring for `MealEditButton`):**
- Add `onLogged?: () => void` to `LogNutritionForm`'s props and forward it into `MealComposer`'s create-mode props.
- In `MealComposer`'s create submit: `onSuccess: () => { resetCreate(); onLogged?.(); }`.
- In `LogLauncher`: `<LogNutritionForm ... onLogged={fetchData} />` (reuse the exposed `fetchData`/`refetch`, same function already wired to `MealEditButton`'s `onMutated`).

~6 lines across 2 files. Does not require closing the sheet, does not touch `logNutrition` itself, ordering is already safe (verified above).

### C2 — `await`-then-`close()` in `MealEditButton` leaves the Delete button live and unguarded during the round trip (blueprint §5)

Blueprint's proposed `handleDeleted`:
```ts
async function handleDeleted() {
  await deleteNutrition(meal.id);
  onMutated?.();
  close();
}
```
`deleteNutrition` returns `Promise<NutritionSnapshot>` after `await db.nutritionLog.delete(...)` (`src/lib/workout-actions.ts:336-338`) — confirmed, the ordering rationale (refetch must land after the write) is correct and real: the original `void deleteNutrition(meal.id); close();` was safe only because `close()` unmounted `MealComposer` immediately, before anyone could observe staleness.

The rewrite keeps `MealComposer` mounted (`src/components/MealComposer.tsx:74` — `{open && (<MealComposer .../>)}` only unmounts on `close()`) for the full network round trip. Nothing disables the Delete affordance during that window:
- `ConfirmButton`'s `onConfirm` is untyped as async (`() => void`) and isn't awaited by the button itself (`ConfirmButton.tsx:70-77`) — it disarms and returns immediately.
- Its `disabled` prop is wired to `editPending || editSaved` (`MealComposer.tsx:1139`) — both belong to the **Save** transition (`startEdit`), never touched by the delete path.
- Result: for the duration of `await deleteNutrition(...)`, the sheet shows the (about-to-be-deleted) meal with a re-armable Delete button and no busy indicator. A slow network turns this into a visible regression versus today's instant-close behavior.

**Fix:** reorder — close the *inner* edit sheet immediately (matches current UX, unmounts `MealComposer` synchronously since `open && (...)` gates it), then await and fire the outer refetch in the background:
```ts
async function handleDeleted() {
  close();                        // same as today — no visible change
  await deleteNutrition(meal.id); // DB write lands
  onMutated?.();                  // outer LogLauncher refetch, now safe
}
```
This still satisfies the exact ordering constraint the blueprint identified (refetch after the write) without introducing a stale, interactive Delete button.

---

## Concerns

### D1 — Effect will likely trip `react-hooks/exhaustive-deps`, risking the "lint no new" gate (AC-7)

Blueprint's open-transition effect (§4):
```ts
useEffect(() => {
  if (open && !prevOpenRef.current) void fetchData();
  prevOpenRef.current = !!open;
}, [open]);
```
`fetchData` is a plain function defined in the component body, referenced but omitted from deps. The codebase has this exact pattern elsewhere and always suppresses it explicitly: `BarcodeScanner.tsx:292,309`, `ScanFoodSheet.tsx:205`, `useFoodComposer.tsx:246` all carry `// eslint-disable-next-line react-hooks/exhaustive-deps`. The blueprint's snippet has no such comment. If the rule is `error` (not `warn`) in this config, this is a new lint failure — worth confirming and adding the disable line to match convention, or the AC-7 "lint no new" check fails at implementation time.

### D2 — Fully-logged-out client hits the 307, not the 401, and `fetch` swallows it silently

Blueprint reasoned carefully about `getCurrentUserId()`'s 307 hazard *inside the route handler* (§2: "surfacing as a 307 in a route handler that the client fetch follows silently into HTML, not a clean 401 JSON") and correctly avoided it by using `auth()` instead. But the same hazard exists one layer up, unaddressed: `/api/log-sheet-data` is deliberately kept off `isPublicPath` (`src/lib/auth/route-access.ts`), so when there is **no session cookie at all** (not merely an expired-but-present one), `middleware.ts:116-128` 307-redirects to `/signin` before the route handler ever runs. A same-origin `fetch()` follows redirects by default — the client receives a 200 HTML page, `res.ok` is true, and `await res.json()` throws a `SyntaxError`. That lands in the generic `catch` (not the `code === 401` branch), so the user sees "Couldn't load — try again" instead of the friendlier "Your session expired. Sign in again." + sign-in link the blueprint designed specifically for this scenario. The 401/sign-in-hint path only fires for a cookie-present-but-invalid session (e.g. revoked server-side), not the more common fully-logged-out case. Not fatal (degrades to a working retry button), but it's the one edge case the blueprint scrutinized elsewhere and didn't extend here. Cheap fix if wanted: check `res.redirected` or a non-JSON content-type and route to the same 401 UI.

### D3 — The "layout re-export contradicts the AC" premise (my own attack-axis instructions) does not hold up

I verified this directly rather than taking it on faith: grepped the PRD, the research report, and the blueprint for the literal claim "BottomNav.tsx/LogLauncher.tsx update their import" — it does not appear anywhere. What the PRD actually says is item 2 (layout.tsx): *"type import updated"* (about layout.tsx's own import, which the blueprint does update — from a local declaration to a re-export of `@/lib/log-sheet-data`), and **AC-6**: *"layout/BottomNav compile unchanged in shape; #233 boundary comments intact."* AC-6 is evidence **for** keeping `BottomNav.tsx`'s `import type { TodayMealLite } from "@/app/layout"` unchanged, not against it — a re-export is exactly what makes BottomNav's diff a one-line prop add. This axis's premise was wrong; no fix needed here.

---

## Suggestions

- **S1** — `LogLauncher`'s `mealSoFar` line (`sumLoggedDayMacros(todaysMeals.map((m) => m.macros))`) duplicates a computation `LogSheetData.trackedSoFar` already provides pre-summed server-side. The blueprint's render-rule rename (`todaysMeals` → `data.todaysMeals`) is a fine mechanical pass but leaves this redundant client-side re-sum in place. Could read `data.trackedSoFar` directly instead. Not required — both derive from the same source and will always agree.
- **S2** — No abort on close-without-reopen: a fetch started by an open that's closed before it resolves keeps running until a later open supersedes it via `reqIdRef`/`abortRef.current?.abort()`. Verified this does **not** cause a stale-data flash (the double guard — abort-in-flight via `controller.signal.aborted`, and post-await `id !== reqIdRef.current` — correctly handles both "aborted mid-flight" and "already resolved but superseded" cases in the open→close→open-fast race the task asked me to check). Purely a wasted-request nit; optional cleanup-on-close if it matters.
- **S3** — Pre-existing, unrelated to #232: `MealComposer.tsx:49-52`'s comment claims edit-mode Delete is non-destructive with the "BottomSheet host defers the commit behind a ~5s Undo window" — but `MealEditButton` (the only consumer of the sheet-host contract) commits immediately with no undo affordance (confirmed: no "undo" string anywhere in `MealEditButton.tsx` or `NutritionToday.tsx`). The blueprint's C2 fix doesn't need to address this, but since it's rewriting this exact handler, it's a cheap opportunity to either implement the documented undo window or correct the stale comment. Flagging only — out of #232's scope.

### Verified sound (no finding, checked because the task asked)

- **Route/auth** (§2): `Response.json(data, {headers})` composition is correct Web API usage; `runtime="nodejs"` + `dynamic="force-dynamic"` matches every sibling route (`mcp/route.ts`, `mcp/[token]/route.ts`, `peek/route.ts`, `[...nextauth]/route.ts`) — redundant-but-conventional, not a bug. There is no prior *JSON* 401 precedent in this codebase (existing 401/404s are plain `Response("...", {status})` text) so "establishes a new precedent" (PRD §4) is accurate, not a fabricated claim.
- **Abort/latest-wins**: race-walked open→close→open-fast with fetch A slow / B fast — the abort call at the top of each `fetchData` plus the `id !== reqIdRef.current` guard after `await fetch` correctly prevents A's response (whether aborted mid-flight or merely late) from ever landing after B's. No gap found.
- **Test plan import paths**: `startOfDay`/`endOfDay` are re-exported from `@/lib/calendar` (sourced from `calendar-core.ts`, `calendar.ts:25-48`) matching the blueprint's `vi.mock("@/lib/calendar", ...)` target; `getQuickPickFoods`/`listLibraryFoods` genuinely live in `@/lib/food-actions.ts:479,501`; the dual-export `{ prisma, getDb: vi.fn() }` mock shape matches the established convention (`compare.test.ts:10-13`, `food-isolation.test.ts:36-39`).
- **Scope**: no rate-limit or MCP surface touched anywhere in the blueprint; matches PRD §3.2 out-of-scope list.
- **Pre-open mount safety**: the effect only fires on `open && !prevOpenRef.current`; initial mount has `open=false` (matches `BottomNav`'s `useState(false)` for `logOpen`), so no fetch before first open — including the props-less/post-#233 mount AC-5 asks about.

---

## Verdict: **APPROVE-WITH-FIXES**

Top 3:
1. **C1 (blocking)**: create-path (`LogNutritionForm`/`MealComposer`) is wrongly excluded from refetch wiring — AC-3, the Edge Cases table, and §9 Open Questions all explicitly put "log" in scope. Fix: `onLogged` callback, LogLauncher → LogNutritionForm → MealComposer create `onSuccess`, mirroring the planned `onMutated` wiring (~6 lines).
2. **C2 (blocking)**: `MealEditButton`'s `await deleteNutrition(); onMutated(); close();` leaves Delete clickable and unguarded during the round trip — reorder to `close(); await deleteNutrition(); onMutated();` to preserve today's instant-close UX while keeping the refetch-after-write ordering.
3. **D1**: add the codebase's standard `// eslint-disable-next-line react-hooks/exhaustive-deps` to the open-transition effect or it likely trips AC-7's "lint no new" gate.

Everything else — state machine shape, route auth pattern, abort/latest-wins race handling, test-mock import paths — checked out against source. The layout re-export "AC contradiction" attack axis I was given did not survive verification (AC-6 actually supports it).
