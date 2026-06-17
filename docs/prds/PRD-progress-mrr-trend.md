# PRD — Progress page: gate weight chart + project MRR trend (#74)

**Slug:** progress-mrr-trend · **Issue:** #74 (board #8, Sprint 7, P1, Medium) · **Date:** 2026-06-17
**Depends on:** #67 (registry). Research: `.feature-dev/2026-06-17-progress-mrr-trend/agents/research-output.md`.
**UX-research:** skipped — refactor + reuse. Gates an existing card and reuses the existing `HistoryChart` component for the MRR trend (`units="$"`); no new design-system work; honest empty state per the honesty-first invariant.

## 1. Goal
`src/app/progress/page.tsx` always renders the fitness Weight card. Make it (a) render only when the focus goal actually tracks weight (a `weightLb` target), and (b) for a **project** focus goal render a project-appropriate **MRR-over-time trend** (reuse `MilestoneBurnDown` + an MRR sparkline from `LogEntry` metric `"mrr"`), honestly empty when no MRR is logged.

## 2. Scope
**In:**
- `src/app/progress/page.tsx` (server component) — gate the Weight card on weight-target presence; add a project MRR-trend section for a project focus goal.
- A small **MRR trend** rendering: reuse the existing client `HistoryChart` (`{date:string, value:number}[]`, `units` prop) with `units="$"`; honest empty placeholder when there are no MRR rows.
**Out:** the readiness section; `WeightChart`/`HistoryChart`/`ReadinessChart` internals; any new Recharts component; Prisma/schema/MCP changes. `goal-presentation.ts` and `MilestoneBurnDown.tsx` are touched only if the Architect finds it necessary (see §3.4) — default is a small helper / sibling, not a rewrite.

## 3. Design (Architect to finalize; research-grounded defaults)
### 3.1 Weight-target detection (replaces bare-kind gating)
The fitness stat slots are workouts/volume/prs/elevation — there is **no** `weightLb` slot, so "equivalently a fitness presentation slot" from the AC is NOT a slot check; detect via the goal's targets:
```ts
const focusGoal = activeGoals.find(g => g.isFocus) ?? activeGoals[0] ?? null;
const hasWeightTarget = ((focusGoal?.targets as unknown as GoalTarget[] | null) ?? [])
  .some(t => t.metric === "weightLb");
```
Gate the Weight card (page.tsx ~177–202) on `hasWeightTarget && weights.length > 0` (keep the existing non-empty check). A fitness goal with no `weightLb` target → no empty weight chart (§8.5 mis-gate guardrail). The live Elbert goal HAS a `weightLb` target → card unchanged.

### 3.2 Project MRR trend
For a **project focus goal** (`focusGoal.kind === "project"`), render in place of / below the weight area:
- `MilestoneBurnDown` (already self-gating at ~173 — unchanged).
- An **MRR trend**: server-side `prisma.logEntry.findMany({ where:{ goalId: focusGoal.id, metric:"mrr", value:{ not:null } }, orderBy:{ date:"asc" } })`, mapped to `{ date: row.date.toISOString(), value: row.value! }[]`, passed to `<HistoryChart data={mrrPoints} units="$" />`.
- **Honest empty state:** when `mrrPoints.length === 0`, render a muted placeholder ("No MRR logged yet — log MRR to see your trend.") instead of an empty chart. Chewgether (0 rows) hits this.

### 3.3 Server/client boundary + USER_TZ
- Dates serialized to ISO strings server-side before crossing to the client `HistoryChart` (CRIT-2 — no `Date` instances cross). `value` is a plain number.
- No custom date bucketing needed (plot raw logged points). Any server-side dateKey work uses `@/lib/calendar`; the client chart's axis labels follow the EXISTING chart pattern (`toLocaleDateString` client-side — `USER_TZ` is a server-only env var, matching `WeightChart`/`HistoryChart` today). No raw `getDate/setHours` introduced.
- `progress/page.tsx` stays a server component.

### 3.4 The two optional touches (Architect decides)
- `goal-presentation.ts`: **likely no change** — weight detection is a `targets[]` check, not a presentation field. Add a helper ONLY if it reads cleaner AND keeps the module pure (no Prisma). Default: no edit.
- `MilestoneBurnDown.tsx`: **default = leave unchanged**; add the MRR trend as a sibling in `page.tsx` (lower risk than extending the burn-down component). Touch it only if the chosen layout requires it.

## 4. Acceptance criteria
1. Weight card renders only when the focus goal has a `weightLb` target (not a bare `kind === "fitness"` check).
2. A fitness goal with no `weightLb` target renders NO empty weight chart.
3. Project focus goal: `MilestoneBurnDown` + an MRR-over-time trend render in place of the weight card; MRR sourced from `LogEntry` metric `"mrr"`.
4. Chewgether (0 MRR rows): MRR trend shows the honest empty placeholder (not a broken/empty chart); milestone burn-down still shows 0/7.
5. Date math via `@/lib/calendar` server-side; no raw `Date`/`getDate`/`setHours`; client labels follow existing chart pattern.
6. Fitness un-regressed: for the Elbert focus goal (has `weightLb`) the Weight card, `WeightChart`, current/start/Δ stats, and `MilestoneBurnDown` gating are pixel-identical.
7. `progress/page.tsx` stays a server component; no `Date` instance crosses server→client (MRR points are `{date:string, value:number}`).
8. `npx tsc --noEmit`, changed-file lint, `npm run build`, `npx vitest run` pass.

## 5. Verification
tsc · eslint (changed files) · build · vitest. Dev-server render of `/progress`: fitness focus → weight card + WeightChart unchanged + milestone burn-down only if a project goal exists; switch focus context / use `goalId` reasoning to confirm a project goal shows MilestoneBurnDown 0/7 + the honest "No MRR logged yet" placeholder (Chewgether has 0 MRR rows). `grep -nE "setHours|getDate\(|getMonth\(|getFullYear" src/app/progress/page.tsx` → no new raw primitives.
