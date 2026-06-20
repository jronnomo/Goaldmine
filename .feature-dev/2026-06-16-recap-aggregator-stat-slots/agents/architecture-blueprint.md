# Architecture Blueprint — Recap Aggregator stat slots + weeks-to-target (#68)

Single file: `src/lib/recap.ts`. Depends on `@/lib/goal-presentation` (#67, shipped). No Prisma/MCP/schema change. Design detail in `docs/prds/PRD-recap-aggregator-stat-slots.md` §3.

## New imports (top of recap.ts)
- `import { presentationForGoal, fmtComma, fmtVolume, fmtElevation, type StatSlot } from "@/lib/goal-presentation";`
- `import type { TargetProgress } from "@/lib/readiness";` (for ctx.breakdown — type-only)

## Type changes
1. `RecapProgramHeader` (≈70–74): add
   - `weeksToTarget: number | null;`
   - `targetDateLabel: string | null;`
2. NEW exported type:
   ```ts
   export type ResolvedStatSlot = { key: string; label: string; value: string; isNull: boolean };
   ```
3. `WeeklyRecap` (≈84–107): add `statSlots: ResolvedStatSlot[];` (place near the legacy stat fields; keep all legacy fields).

## New function (module scope, exported) — `resolveStatSlot`
```ts
type StatSlotCtx = {
  recap: { workoutsCompleted: number; volumeLb: number | null; prCount: number; hikeElevationFt: number | null };
  logLatest: Map<string, number | null>;
  scheduledAgg: Map<string, { done: number; total: number }>;
  breakdown: TargetProgress[];
  targets: GoalTarget[];   // reserved for targetCurrent; not consumed by v1 slots
};

export function resolveStatSlot(slot: StatSlot, ctx: StatSlotCtx): ResolvedStatSlot {
  const base = { key: slot.key, label: slot.label };
  switch (slot.source.from) {
    case "recapField": {
      const v = ctx.recap[slot.source.field];           // number | null
      return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
    }
    case "logLatest": {
      const v = ctx.logLatest.get(slot.source.metricKey) ?? null;
      return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
    }
    case "scheduledItem": {
      const agg = ctx.scheduledAgg.get(slot.source.itemType) ?? { done: 0, total: 0 };
      return { ...base, value: `${agg.done}/${agg.total}`, isNull: agg.total === 0 };
    }
    case "targetCurrent": {
      const metric = slot.source.metric;
      const b = ctx.breakdown.find((x) => x.target.metric === metric);
      const v = b?.current ?? null;
      return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
    }
  }
}
```
Helper `fmtByFormat(v: number | null, f: StatFormat): string`:
- `int` → `v === null ? "—" : String(v)`
- `volumeLb` → `fmtVolume(v)`  (already handles null → "—")
- `elevationFt` → `fmtElevation(v)`
- `currency` → `v === null ? "—" : "$" + fmtComma(v)`
- `percent` → `v === null ? "—" : \`${v}%\``
- `ratioOfTotal` → never reaches here (scheduledItem builds the string inline); but handle defensively → `v === null ? "—" : String(v)`.

## `computeWeeklyRecap` restructure
1. Week window — unchanged.
2. **Goal-first:** `const goal = await (opts?.goalId ? prisma.goal.findFirst({where:{id:opts.goalId}}) : prisma.goal.findFirst({where:{isFocus:true}, orderBy:{updatedAt:"desc"}}));` (lift the exact existing query out of the Promise.all).
3. `const presentation = presentationForGoal(goal);`
4. `const logKeys = presentation.statSlots.filter(s => s.source.from==="logLatest").map(s => (s.source as {metricKey:string}).metricKey);`
   `const schedTypes = presentation.statSlots.filter(s => s.source.from==="scheduledItem").map(s => (s.source as {itemType:string}).itemType);`
5. Always-batch (the remaining 5 fetches, minus goal): `const [workouts, allExerciseSummaries, hikes, plan, gameState] = await Promise.all([...]);`
6. **Gated project fetch:**
   ```ts
   const logLatest = new Map<string, number | null>();
   const scheduledAgg = new Map<string, { done: number; total: number }>();
   if (goal && (logKeys.length || schedTypes.length)) {
     await Promise.all([
       ...logKeys.map(async (k) => {
         const row = await prisma.logEntry.findFirst({ where: { goalId: goal.id, metric: k, value: { not: null } }, orderBy: { date: "desc" } });
         logLatest.set(k, row?.value ?? null);
       }),
       ...schedTypes.map(async (t) => {
         const groups = await prisma.scheduledItem.groupBy({ by: ["status"], where: { goalId: goal.id, type: t }, _count: { _all: true } });
         let done = 0, total = 0;
         for (const g of groups) { total += g._count._all; if (g.status === "done") done += g._count._all; }
         scheduledAgg.set(t, { done, total });
       }),
     ]);
   }
   ```
   (Steps 5+6 satisfy "no project query for fitness" — both lists empty ⇒ guard false. The AC calls this a "single gated Promise.all"; a base Promise.all + a guarded project Promise.all is the clean expression of that intent — acceptable.)
7. Volume / PRs / hike elevation — unchanged (still use `workouts`/`hikes`).
8. Goal + readiness — unchanged. Capture `breakdown` for ctx: in the `has-data` branch `snapshot.breakdown`; otherwise `[]`. Keep a `let breakdown: TargetProgress[] = []` and assign in the snapshot branch.
9. **Header:** after computing the program-week header, augment with weeks-to-target:
   ```ts
   let weeksToTarget: number | null = null;
   let targetDateLabel: string | null = null;
   if (presentation.headerStyle === "weeks-to-target" && goal?.targetDate) {
     weeksToTarget = Math.max(0, Math.round((startOfDay(goal.targetDate).getTime() - startOfDay(asOf).getTime()) / (7 * 86_400_000)));
     targetDateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: process.env.USER_TZ ?? "America/Denver" }).format(goal.targetDate);
   }
   ```
   Add `weeksToTarget`/`targetDateLabel` into ALL three `header` objects (no-plan ~293, with-plan ~310 → use the computed values; fallback ~460 → null/null).
   NOTE: the fitness program-week path keeps weeksToTarget/targetDateLabel null (headerStyle !== "weeks-to-target"). For a project goal there is no `plan`, so it hits the `!plan` branch (~293) — make that branch use the computed weeksToTarget/targetDateLabel (not hard null). Cleanest: compute weeksToTarget/targetDateLabel BEFORE building header, and include them in whichever header object is built.
10. **statSlots:**
    ```ts
    const statSlots = presentation.statSlots.map((s) =>
      resolveStatSlot(s, { recap: { workoutsCompleted, volumeLb, prCount, hikeElevationFt }, logLatest, scheduledAgg, breakdown, targets }));
    ```
    (place after workoutsCompleted is computed). Add `statSlots` to the main return object.
11. **Catch fallback (~455):** add header `weeksToTarget:null, targetDateLabel:null`; add
    `statSlots: DEFAULT_PRESENTATION.statSlots.map(s => resolveStatSlot(s, { recap:{workoutsCompleted:0, volumeLb:null, prCount:0, hikeElevationFt:null}, logLatest:new Map(), scheduledAgg:new Map(), breakdown:[], targets:[] }))`
    → yields `["0","—","0","—"]`, matching today's error-card parity. Import `DEFAULT_PRESENTATION` from `@/lib/goal-presentation`.

## Invariants / guardrails
- **Byte-identical fitness:** legacy fields untouched; fitness slots resolve via `recapField` to the same strings. `workoutsCompleted`/`prCount` are `int`; `volumeLb`/`hikeElevationFt` are nullable → `fmtVolume`/`fmtElevation` reproduce "2,370 lb"/"5,200 ft"/"—".
- **No project query for fitness:** the `logKeys.length || schedTypes.length` guard.
- **USER_TZ:** weeksToTarget uses `startOfDay` + epoch (existing pattern); label uses `Intl … timeZone: USER_TZ`. No bare `getDate()`/`setHours`.
- **Do NOT touch** `recap-card.tsx` (that's #69) or the highlight logic (still reads legacy fields).
- **CRIT-2:** `weekStart/weekEnd` stay server-only; `ResolvedStatSlot` is plain strings/bools (client-safe) — fine to pass to the card later.

## Verification (Developer must run)
`npx tsc --noEmit` (0 new errors) · `npx eslint src/lib/recap.ts` (clean) · `npm run build` (green) · `grep -nE "setHours|setDate|getHours|getDate\(|getMonth\(|getFullYear" src/lib/recap.ts` shows no NEW bare primitives (pre-existing `.getTime()` is fine). Optionally a `tsx` scratch calling `computeWeeklyRecap` for the fitness goal + Chewgether to print `statSlots`/`header` — but build + inspection is the gate for this story.
