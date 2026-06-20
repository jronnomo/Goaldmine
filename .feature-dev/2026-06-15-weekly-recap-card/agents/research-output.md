# Research Output — Weekly Recap Card

**Agent**: Research Agent
**Date**: 2026-06-15
**Feature**: Weekly Recap Card (PRD at `docs/prds/PRD-weekly-recap-card.md`)

---

## Existing Patterns

### Tool registration pattern (representative example — `compute_readiness`, tools.ts lines 911–953)

```ts
server.registerTool(
  "compute_readiness",
  {
    title: "...",
    description: "...",
    inputSchema: {
      goalId: z.string().optional().describe("..."),
      asOf: DateKeyShape.optional().describe("..."),
    },
  },
  async ({ goalId, asOf }) =>
    safe(async () => {
      // fetch goal, compute, return plain object
      const snap = await computeReadiness(targets, asOfDate, goal.id);
      return { goalId: goal.id, objective: goal.objective, ...snap };
    }),
);
```

All read tools return via `safe()` which wraps the resolved value in `{ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }`. Write tools follow the same shape. No tool currently returns an image content block — this is new ground.

### weekly_summary_data week-window pattern (tools.ts lines 1081–1119)

```ts
const now = new Date();
const thisMonday = startOfWeekMonday(now);
const monday = addDays(thisMonday, weekOffset * 7);
const sunday = endOfWeekSunday(monday);

// then parallel Prisma queries: { gte: monday, lte: sunday }
return { monday, sunday, weekOffset, workouts, ... };
```

`computeWeeklyRecap` must mirror this exactly: `startOfWeekMonday` / `endOfWeekSunday` / `addDays` from `@/lib/calendar`. `weekOffset * 7` applied to `thisMonday`.

### Focus goal query pattern

Consistent across `resolveDay`, `getBaselineSchedule`, `_computeGameState`, `compute_readiness`:

```ts
prisma.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
  select: { id: true, objective: true, targets: true, ... },
})
```

Targets cast as `(goal.targets as unknown as GoalTarget[] | null) ?? []` before use.

### Volume computation (engine.ts lines 507–530)

```ts
for (const exercise of workout.exercises) {
  for (const set of exercise.sets) {
    if (set.weightLb !== null && set.reps !== null) {
      totalVolumeLb += set.weightLb * set.reps;  // weightLb * reps = volume
    }
    // durationSec-only sets count for cardio, NOT volume
  }
}
```

`Set.weightLb: Float?`, `Set.reps: Int?`, `Set.durationSec: Int?` (schema lines 48–57).

---

## Related Existing Code

| File | Key exports / shapes | Notes |
|------|---------------------|-------|
| `src/lib/calendar-core.ts` | `USER_TZ`, `startOfWeekMonday(d)`, `endOfWeekSunday(d)`, `addDays(d, n)`, `startOfDay(d)`, `endOfDay(d)`, `dateKey(d)`, `parseDateKey(k)` | Pure — no Prisma. Client-safe. All return USER_TZ-aligned instants. `addDays` returns start-of-day in USER_TZ. |
| `src/lib/calendar.ts` | Re-exports everything from calendar-core plus server-only helpers (`resolveDay`, `weekConflicts`, etc.) | Server-only (imports Prisma transitively). For `computeWeeklyRecap` use `@/lib/calendar`. |
| `src/lib/readiness.ts` | `computeReadiness(targets: GoalTarget[], asOf: Date, goalId: string): Promise<ReadinessSnapshot>`, `ReadinessSnapshot = { score: number; breakdown: TargetProgress[]; missing: GoalTarget[] }`, `TargetProgress = { target, current, start, progress }` | Lines 60–89. `score` is `0..100`. Returns `score: 0, missing: all` when no usable data. |
| `src/lib/metrics-registry.ts` | `GoalTarget = { metric, label, units, direction, target, start?, weight, rationale? }`, `Direction = "increase" \| "decrease"`, `GoalTargetSchema` (Zod) | Client-safe. Lines 12–24. `targets` Json field cast as `GoalTarget[] \| null`. |
| `src/lib/goal-targets.ts` | Re-exports `GoalTarget`, `Direction`, `LOG_METRIC_PREFIX` from metrics-registry; adds `resolveMetricValue(prisma, metric, asOf, goalId)` + `resolveMetricStart(prisma, metric, goalId)` | Server-only. `computeReadiness` imports from here. |
| `src/lib/records.ts` | `getExerciseSummaries(): Promise<ExerciseSummary[]>`, `ExerciseSummary = { name, equipment, sessionCount, totalSets, primary, bestValue, bestRaw, bestDate: Date }`, `canonicalExerciseName(name)`, `EXERCISE_ALIAS_GROUPS` | Lines 55–65 for shape. `bestDate` is the `workout.startedAt` Date of the all-time best set. |
| `src/lib/program.ts` | `getActiveProgram(): Promise<ActiveProgramSnapshot \| null>`, `ActiveProgramSnapshot = { id, name, startedOn: Date, template: ProgramTemplate, confirmedThroughDate }`, `getTodayContext(program, now)` | Lines 24–97. `getActiveProgram()` prefers focus goal's plan via `orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }]`. |
| `src/lib/game/engine.ts` | `computeGameState: () => Promise<GameState>` (React-cached). `GameState.streak = { current: number, longest: number, todayCounted: boolean }` | Lines 1047–1054. No args — deduplicated within a React render pass. |
| `src/lib/game/types.ts` | `GameState.streak: { current, longest, todayCounted }` | Lines 34–38. |
| `src/lib/mcp/tool-helpers.ts` | `jsonResult(value)`, `errorResult(msg)`, `safe<T>(fn)`, `parseDateInput(s)` | Lines 1–34. `safe()` only supports the text-block shape. An `imageResult(buffer, stats)` helper is needed. |
| `src/lib/mcp/tools.ts` | `registerAll(server)` + every tool registration. `weekly_summary_data` at lines 1063–1120. `compute_readiness` at lines 911–953. | Imports `addDays`, `startOfWeekMonday`, `endOfWeekSunday` from `@/lib/calendar`. |
| `src/app/api/mcp/route.ts` | `export const runtime = "nodejs"` (line 7). Stateless handler; registers all tools per request. | Node.js runtime confirmed — enables `next/og` with the Node.js satori build. |
| `src/app/progress/page.tsx` | Server component, `export const dynamic = "force-dynamic"`. Shows goal readiness cards with `computeReadiness`. A "Share recap" link entry point to `/recap` goes here. | Lines 61–180. The entry point must be added here; BottomNav is full (5/5 slots). |
| `src/components/BottomNav.tsx` | 5 fixed tabs: Today, Plan (Log — sheet), Progress, More (sheet). `match` for "Progress" covers `/progress`, `/stats`, `/baselines`. | Lines 33–67. No 6th slot. `/recap` entry comes via Progress hub only. `match` should be widened to cover `/recap` so the Progress tab stays lit when viewing `/recap`. |
| `prisma/schema.prisma` | `Goal.targets: Json?`, `Goal.isFocus: Boolean`, `Goal.objective: String`, `Plan.startedOn: DateTime`, `Plan.weeks: Int`, `Plan.active: Boolean`, `Plan.planJson: Json`, `Hike.elevationFt: Int`, `Hike.status: String`, `Workout.startedAt: DateTime`, `Workout.status: String`, `Set.weightLb: Float?`, `Set.reps: Int?`, `Set.durationSec: Int?` | Goal lines 169–208; Plan lines 246–275; Hike lines 115–133; Set lines 45–58. |
| `scripts/render-icons.ts` | Uses `@resvg/resvg-js` (devDependency) to rasterize `public/icon.svg` → PWA PNGs. | Build-time only. NOT available in production server code. |

---

## Dependencies

### `next/og` / `ImageResponse` — Viability Verdict: CONFIRMED USABLE

**Module path**: `next/og` → `node_modules/next/og.js` → `./dist/server/og/image-response` (confirmed in codebase).

**Runtime branch** (from `node_modules/next/dist/server/og/image-response.js` line 12):
```js
return import(process.env.NEXT_RUNTIME === 'edge'
  ? 'next/dist/compiled/@vercel/og/index.edge.js'
  : 'next/dist/compiled/@vercel/og/index.node.js');
```

Since the MCP route (`src/app/api/mcp/route.ts`) declares `export const runtime = "nodejs"`, the Node.js build is always selected. The new image route handlers should also declare `export const runtime = "nodejs"` (not edge) to use the same build and stay consistent with the MCP endpoint.

**Buffer extraction** for the MCP tool:
```ts
const response = new ImageResponse(<jsx>, { width: 1080, height: 1920, fonts: [...] });
const arrayBuffer = await response.arrayBuffer();
const pngBuffer = Buffer.from(arrayBuffer);
const base64 = pngBuffer.toString("base64");
```
`ImageResponse` is a `Response` subclass — `arrayBuffer()` works on it directly (confirmed from `image-response.d.ts`: `class ImageResponse extends Response`).

**Fonts**: `next/dist/compiled/@vercel/og/` bundles `Geist-Regular.ttf`. The bundled font is used as the default fallback, but passing an explicit font via `fonts: [{ name, data: ArrayBuffer, weight, style }]` is safer and gives full control over which typeface renders. For route handlers, use `fs.readFileSync` at module scope or inside the handler to load a `.ttf` from `src/app/recap/`. For the MCP tool, read the same file path (absolute) at call time, since the MCP handler runs in Node.js. Satori requires `ArrayBuffer`, not `Buffer` — use `.buffer` property: `fs.readFileSync(path).buffer`.

**Satori JSX constraints** (applies to all ImageResponse JSX):
- Flexbox-only layout (no Grid, no position:absolute is partially supported)
- Inline styles only — no Tailwind, no CSS vars
- No `<img src="data:…">` (use `fetch` to get image data and pass as ArrayBuffer, or use explicit URLs)
- No runtime DOM APIs
- `tw=""` prop not needed; use `style={{}}` objects with camelCase
- Supported HTML subset: `<div>`, `<span>`, `<p>`, `<h1..6>`, `<img>`, `<svg>` — no `<a>`, `<input>`, `<button>`

**@resvg/resvg-js**: Listed in `devDependencies` only. Used solely by `scripts/render-icons.ts` at build time. NOT deployable on Vercel in server routes without moving to `dependencies` AND dealing with native `.node` binding issues. Do NOT use `@resvg` in any app code. `next/og`'s bundled Node build uses its own `resvg.wasm` internally.

**No new npm packages required.** All needed packages are already present: `next` (includes `next/og`), `react` (for JSX in templates), `zod` (input schema), `@modelcontextprotocol/sdk` (tool registration), `@prisma/client` (data fetching).

**No Prisma migration.** Feature is purely read-only over existing models.

---

## Risks & Considerations

### Risk 1 — `ImageResponse` in a non-route MCP tool handler (highest risk)

The MCP tool `generate_recap_card` runs inside `registerAll()` called from `src/app/api/mcp/route.ts`. That route has `runtime = "nodejs"`. `ImageResponse` is a plain class (no route context needed) that starts a `ReadableStream` backed by `@vercel/og`. Calling it outside a route handler is valid in Node.js — there is no `Request`/`Response` context requirement. The `arrayBuffer()` method resolves once the stream is consumed.

**Gotcha**: `@vercel/og/index.node.js` dynamically imports WASM (`resvg.wasm`, `yoga.wasm`). In a stateless MCP route (fresh `McpServer` per request), these WASM modules are re-loaded each call unless Node.js module-level caching applies (it does for CommonJS `require`, but the dynamic `import()` may not deduplicate across requests). This is acceptable for a low-frequency tool but may add ~100–200ms to the first call. For the `/recap/card` route handler the WASM is loaded once per cold start — no issue.

**Action**: The `recap-card.tsx` JSX template must be a pure module (no `"use client"`, no DOM/browser APIs). Shared between route handler and MCP tool — both call `renderRecapCard(recap: WeeklyRecap, template: string): Promise<Buffer>` which internally constructs `ImageResponse` and calls `arrayBuffer()`.

### Risk 2 — USER_TZ week math for weekOffset

The week boundary shifts by `weekOffset * 7` days applied to `startOfWeekMonday(now)`, identical to `weekly_summary_data`. `endOfWeekSunday` returns `23:59:59.999` in USER_TZ. `dayOfProgram` must use `startOfDay(weekEnd)` not raw UTC arithmetic. DST transitions during the week are handled by `addDays` in `calendar-core.ts` which normalizes through `userTzWallClockToUTC`.

**Action**: never use raw `Date.getTime()` subtraction for day counting — use `Math.round((startOfDay(weekEnd).getTime() - startOfDay(plan.startedOn).getTime()) / 86400000)`. Both `startOfDay` calls ensure USER_TZ midnight, eliminating DST drift.

### Risk 3 — PR canonicalization caveat for week PRs

`getExerciseSummaries()` returns one row per canonical exercise with an ALL-TIME `bestDate`. "PRs this week" is computed by filtering `bestDate ∈ [monday, sunday]`. This correctly identifies exercises whose all-time PR happened during the target week. However, if two PRs were set in the same week on the same exercise, only one row exists (the later one). The `prs[]` array in `WeeklyRecap` should be the filtered `ExerciseSummary[]` rows, and `prCount` is that filtered length.

**Caveat**: exercises not yet in `EXERCISE_ALIAS_GROUPS` that have spelling variants will split into separate buckets, potentially under-counting or double-counting. This is a known limitation (documented in memory `exercise-alias-map-hand-curated`). No new variants need to be added for the recap — it consumes the existing summaries.

### Risk 4 — Empty/no-targets states

`computeReadiness` returns `{ score: 0, breakdown: [], missing: [] }` when `targets.length === 0`. With `usable.length === 0` (no data for any target), `score = 0`. The recap must distinguish:
- `goal.targets` is null/empty → `progressPct = null`, render "Set goal targets" affordance
- `targets` exist but all missing data → `progressPct = null` (or `0` — treat as no-data)
- `snapshot.score === 0` with `missing.length > 0` → display "—" not "0%"

The PRD says "focus goal readiness has only missing targets → progressPct shown as '—', not 0%". Check: `snapshot.missing.length === targets.length` → all missing → render as `null`.

### Risk 5 — No active plan (header "Week N / Day M" omission)

`getActiveProgram()` returns `null` when no active plan exists. The PRD says: "No active program → header omits 'Week/Day of 90'; show just the date range." `computeWeeklyRecap` should handle `plan === null` gracefully: set `programWeek = null`, `dayOfProgram = null`, `totalProgramDays = null`.

### Risk 6 — Satori JSX constraints in shared template

The `recap-card.tsx` JSX template must be strictly satori-compatible. Key constraints:
- No Tailwind class names — inline styles only
- No CSS custom properties (`var(--accent)`) — hardcode hex values from the chosen template palette
- Image elements need explicit `width`/`height` — or avoid `<img>` entirely and use SVG/div shapes
- Text must use a font passed in `fonts:[]` — without an explicit font, satori falls back to its default sans-serif which may look wrong at 1080px

### Risk 7 — `streak.current` is always live (not historical)

`computeGameState()` uses React `cache()` and computes the current-moment streak. For a past week (weekOffset < 0), `streak.current` will reflect today's streak, not the streak as it stood at the end of that week. This is documented in PRD §6 as a known caveat. The recap shows `streakDays = gameState.streak.current` with a note that it's current-session. No workaround exists without replaying the engine to that week's end — out of scope.

---

## Conventions Checklist

1. **USER_TZ date math**: All date operations use `@/lib/calendar` functions — `startOfWeekMonday`, `endOfWeekSunday`, `addDays`, `startOfDay`, `endOfDay`, `dateKey`, `parseDateKey`. No raw `setHours`/`getDate`/`new Date("yyyy-mm-dd")` in any new app code. The `addDays` in `@/lib/calendar` returns start-of-day midnight (NOT the `addDays` in `records.ts` which returns end-of-day — different semantics, per engine.ts CRITICAL RULES comment line 9).

2. **Prisma via singleton**: All DB access through `import { prisma } from "@/lib/db"`. No new Prisma clients.

3. **Types from `@/generated/prisma/client`**: `import { Prisma } from "@/generated/prisma/client"` for namespace types. Run `npx prisma generate` after any schema edit (none required here).

4. **`safe()` wrapper for all MCP tools**: Every tool's handler body wraps in `safe(async () => { ... })` for consistent error shape. The new `generate_recap_card` tool needs a new helper (e.g., `imageAndJsonResult`) that returns both an `image` content block and a `text` block without using `safe()` directly — but errors should still return `errorResult(message)`.

5. **MCP image content block shape** (from `@modelcontextprotocol/sdk` v1.29.0 `ImageContentSchema`):
   ```ts
   { type: "image" as const, data: string /* base64 */, mimeType: "image/png" }
   ```
   The `data` field is the raw base64 string (no `data:image/png;base64,` prefix).

6. **No hardcoded Elbert references in recap code**: `grep -ri "elbert" src/lib/recap*` must return empty. The progress bar uses `computeReadiness(goal.targets, weekEnd, goal.id)` — goal-generic.

7. **Mobile-first 390px for the `/recap` page controls**: Tap targets ≥ 44px, `var(--accent)`/`var(--card)`/`var(--border)` CSS tokens, `max-w-md mx-auto`. The 1080×1920 card canvas uses hardcoded template hex colors (CSS vars unavailable in satori).

8. **Server components by default**: `src/app/recap/page.tsx` is a server component; add `"use client"` only for `RecapClient.tsx` (week selector + template switcher + download buttons).

9. **`export const runtime = "nodejs"`**: All new route handlers under `src/app/recap/` must declare this — same as `src/app/api/mcp/route.ts` line 7 — so the Node.js satori build of `@vercel/og` is selected.

10. **`export const dynamic = "force-dynamic"`**: Image route handlers and the `/recap` page should declare this (consistent with `src/app/progress/page.tsx` line 12) since they read live DB state.

11. **No `revalidatePath` needed**: The feature is read-only (no mutations). No server actions, no revalidation.

12. **BottomNav `match` update**: The Progress tab's `match` predicate (BottomNav.tsx line 57–61) should include `/recap` so the Progress tab stays highlighted when the user is on `/recap`. This is a one-line addition to the existing `||` chain.

13. **No new npm dependencies**: All required packages are present. Do NOT add `@resvg/resvg-js` to `dependencies` (native binding, devDep only, build issues on Vercel). Do NOT add `satori` directly (bundled inside `@vercel/og` inside Next). Do NOT add any image processing library.

---

## Key Questions — Concrete Answers

### Q1. next/og under Turbopack/Next 16 — verdict

**YES, `import { ImageResponse } from "next/og"` works in both route handlers and from the MCP tool handler.** The module exists at `node_modules/next/og.js` (confirmed present). It is a plain `Response` subclass — no route context is required. The MCP route's `runtime = "nodejs"` triggers the `index.node.js` satori build. Call `await response.arrayBuffer()` on the `ImageResponse` instance to get raw PNG bytes.

Route handlers under `src/app/recap/` must declare `export const runtime = "nodejs"`. No edge runtime.

Fonts: explicitly pass a font file as `ArrayBuffer` in `fonts: [{ name: "MyFont", data: await fs.promises.readFile(fontPath), weight: 400, style: "normal" }]`. The bundled `Geist-Regular.ttf` at `node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf` can be used as the default typeface. The `data` field is `ArrayBuffer`; use `Buffer` → `.buffer` coercion if reading via `fs.readFileSync`.

### Q2. Focus goal query and targets type

```ts
// Query (mirrors compute_readiness MCP tool, tools.ts line 932–934)
const goal = await prisma.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
});
const targets = (goal?.targets as unknown as GoalTarget[] | null) ?? [];
```

`GoalTarget` type (metrics-registry.ts lines 12–24):
```ts
type GoalTarget = {
  metric: string;     // e.g. "baseline:Pull-Up Max Reps", "weightLb", "hike:total_elevation_ft"
  label: string;      // human label
  units: string;      // "reps", "lb", "ft", etc.
  direction: "increase" | "decrease";
  target: number;
  start?: number;
  weight: number;     // 0..1
  rationale?: string;
}
```

For the recap, call `computeReadiness(targets, weekEnd, goal.id)` where `weekEnd = endOfWeekSunday(monday)`. Result: `{ score: 0..100, breakdown, missing }`.

### Q3. Program week + day-of-program formula

From `getTodayContext` in `src/lib/program.ts` (lines 58–97), adapted for `weekEnd`:

```ts
const plan = await getActiveProgram(); // returns ActiveProgramSnapshot | null
// plan.startedOn: Date, plan.template.totalWeeks: number

if (!plan) { programWeek = null; dayOfProgram = null; totalProgramDays = null; }
else {
  const totalProgramDays = plan.template.totalWeeks * 7;
  const startMidnight = startOfDay(plan.startedOn);         // USER_TZ
  const refDay = startOfDay(weekEnd);                        // USER_TZ, clamp to today for current week
  const daysSinceStart = Math.max(0, Math.round(
    (refDay.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)
  ));
  const programWeek = Math.min(plan.template.totalWeeks, Math.floor(daysSinceStart / 7) + 1);
  const dayOfProgram = Math.max(1, Math.min(totalProgramDays, daysSinceStart + 1));
}
```

`plan.template.totalWeeks` comes from `plan.planJson` cast as `ProgramTemplate`. `Plan.weeks` DB column (schema line 253) mirrors `totalWeeks` — either works, but `plan.template.totalWeeks` is the authoritative value (`Plan.weeks` is the stored integer that should match).

### Q4. PRs-this-week approach

No existing function returns "records set in a date range." The approach:

```ts
const allExerciseSummaries = await getExerciseSummaries(); // all-time PRs with bestDate
const weekPRs = allExerciseSummaries.filter(
  (s) => s.bestDate >= monday && s.bestDate <= sunday
);
prCount = weekPRs.length;
prs = weekPRs; // ExerciseSummary[]
```

**Canonicalization caveat**: `getExerciseSummaries()` applies `canonicalExerciseName()` and `EXERCISE_ALIAS_GROUPS` from `records.ts` (lines 121–147). Unmapped spelling variants create separate buckets. For new exercises added this week that aren't in the alias map, the count may be fragmented. This is an accepted limitation — do not patch it within the recap feature.

**Limitation for past weeks**: `bestDate` is the workout.startedAt of the all-time PR. If Gabe set a PR in week 3 and then a better PR in week 5, week 3 shows zero PRs for that exercise. For the current partial week (weekOffset=0), this is accurate. For past weeks, it reflects "exercises whose all-time best happened in that week" which is correct per the PRD.

### Q5. MCP image content block shape

From `@modelcontextprotocol/sdk` v1.29.0, `ImageContentSchema` (types.d.ts lines 1934–1943):

```ts
// ImageContentSchema fields:
{ type: "image"; data: string /* base64 */; mimeType: string; annotations?: {...} }
```

The `generate_recap_card` tool returns a multi-block array:
```ts
{
  content: [
    { type: "image" as const, data: pngBase64, mimeType: "image/png" },
    { type: "text" as const, text: JSON.stringify(recapStats, null, 2) },
  ]
}
```

Add to `tool-helpers.ts` (NOT `safe()` — this is a new variant):
```ts
export function imageAndJsonResult(pngBuffer: Buffer, stats: unknown) {
  return {
    content: [
      { type: "image" as const, data: pngBuffer.toString("base64"), mimeType: "image/png" },
      { type: "text" as const, text: JSON.stringify(stats, null, 2) },
    ],
  };
}
```

Error path still uses `errorResult(message)` (returns `isError: true`).

### Q6. Volume definition

Volume = sum of `(set.weightLb * set.reps)` across ALL sets of ALL exercises of ALL completed workouts in the week. Duration-only sets (cardio machines, planks) contribute zero volume. Source: engine.ts lines 507–531 (`totalVolumeLb += set.weightLb * set.reps`).

For the recap's weekly volume query (mirror `weekly_summary_data` pattern):
```ts
const workouts = await prisma.workout.findMany({
  where: { startedAt: { gte: monday, lte: sunday }, status: "completed" },
  include: { exercises: { include: { sets: true } } },
});
let volumeLb = 0;
for (const w of workouts) {
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (s.weightLb !== null && s.reps !== null) volumeLb += s.weightLb * s.reps;
    }
  }
}
```

---

## 10-Line Summary of Most Important Findings

1. **`next/og` is confirmed present and usable** in Next 16.2.4 (`node_modules/next/og.js` exists). The MCP route's `export const runtime = "nodejs"` selects the Node.js satori build — no edge runtime needed. All new routes must also declare `runtime = "nodejs"`.

2. **`ImageResponse` can be called from inside the MCP tool handler** — it's a plain `Response` subclass with no route context dependency. Extract PNG bytes via `await imageResponse.arrayBuffer()` then `Buffer.from(...)`.

3. **Fonts must be passed explicitly as ArrayBuffer.** Use `Geist-Regular.ttf` bundled at `node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf`, or add a custom `.ttf` under `src/app/recap/`. Read with `fs.readFileSync(path).buffer`.

4. **Do NOT use `@resvg/resvg-js` in app code** — it is `devDependency` only, used solely for PWA icon generation. `next/og` uses its own bundled `resvg.wasm` internally.

5. **MCP image content block**: `{ type: "image" as const, data: base64string, mimeType: "image/png" }` (no `data:...` prefix). Add `imageAndJsonResult(buffer, stats)` to `tool-helpers.ts` — `safe()` is text-only.

6. **Week bounds pattern**: `startOfWeekMonday(now)` → `addDays(thisMonday, weekOffset * 7)` → `endOfWeekSunday(monday)`. Mirrors `weekly_summary_data` exactly. `computeWeeklyRecap` must not re-derive this.

7. **Progress % = `computeReadiness(targets, weekEnd, goal.id).score`**. Goal fetched via `isFocus: true` + `orderBy: { updatedAt: "desc" }`. Targets cast from `goal.targets as unknown as GoalTarget[] | null`. Show `null` (not `0%`) when all targets are missing.

8. **No "PRs in a date range" function exists** — use `getExerciseSummaries()` filtered to `bestDate ∈ [monday, sunday]`. This captures exercises whose all-time PR happened during that week. Canonicalization via existing `EXERCISE_ALIAS_GROUPS` is automatic.

9. **BottomNav has 5/5 slots** — no 6th tab. Entry to `/recap` is a "Share recap" link on the Progress page (`src/app/progress/page.tsx`). The Progress tab's `match` predicate needs `/recap` added so it stays highlighted.

10. **Volume = `sum(weightLb * reps)` per set**, matching engine.ts exactly. `dayOfProgram` uses `Math.round` day subtraction between `startOfDay(weekEnd)` and `startOfDay(plan.startedOn)` (both USER_TZ midnight). `programWeek = Math.min(totalWeeks, Math.floor(daysSinceStart / 7) + 1)`.
