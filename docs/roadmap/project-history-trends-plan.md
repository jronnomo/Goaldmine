# Plan — Project history & trends UI parity

**Initiative:** give project goals the metric-history/trends surfaces fitness goals have. **Scope:** Solid parity. **Placement:** Trends tab/sub-route on goals/[id]. **Board:** #8.

## Ground truth (from gap map)
- Gap is **100% UI** — all data + read paths exist (`LogEntry` indexed `[goalId,metric,date]`; `ScheduledItem.completedAt`; `list_log_entries`). No schema/write-tool change.
- Only `log:mrr` has a trend today, inline on focus-gated `/progress` (progress/page.tsx:64-78). No generic per-metric trend; no goal-level trends view; no per-metric browse; milestone "burndown" is a current-count snapshot, not over-time.
- **Reuse:** `HistoryChart` (generic `{date,value}`+units+domain — already charts MRR), `BodyMetricsSection` one-chart-per-key pattern, `baselines/exercise/[name]` detail-page shape, `Card`/`CollapsibleCard`.
- **Seam:** kind-aware sub-route already exists — `goals/[id]/plan → ProjectPlanView` (plan/page.tsx:30). `goals/[id]/trends → ProjectTrendsView` mirrors it. `BottomNav` is kind-blind (leave it).

## Target design

### Data spine (new, reusable)
`getLogMetricSeries(target: GoalTarget, goalId, opts?) → { points: {date,value,tooltip?}[], label, units }` in a server module (e.g. `src/lib/metric-series.ts`):
- Query `LogEntry` for `target.metric` (strip `log:`), `goalId`, date asc.
- **Cumulative-aware (A1):** if `target.cumulative`, emit the running total at each point (accumulation curve); else raw logged values (snapshot).
- Label/units from the registry (`@/lib/metrics-registry`) falling back to `target.label`/`target.units`.
- Generalizes the inline MRR query; `/progress` MRR block refactors to call it (kills duplication, single source).

### UI
- **New route `goals/[id]/trends/page.tsx`** → kind-branch to `ProjectTrendsView` (project goals only; fitness goals keep existing surfaces — link only when `kind==='project'`).
- **`ProjectTrendsView`** — one `HistoryChart` Card per `log:` target (BodyMetricsSection pattern), each with a "view all" link to the per-metric detail; plus a **MilestoneTimeline** section.
- **Per-metric detail `goals/[id]/metric/[key]/page.tsx`** (mirror `baselines/exercise/[name]`): summary header + `HistoryChart` + reverse-chron readings list (`list_log_entries` data); optional inline delete (uses the shipped `delete_metric`).
- **`MilestoneTimeline`** component — `ScheduledItem`s by `completedAt` (done) + upcoming by `date`; distinct from the counts-only `MilestoneBurnDown`.
- **Nav affordance** — a "Trends" link on `goals/[id]` (and optionally a "View trends" on `ProjectTodayView`), gated to project goals.
- Empty states (no readings yet → "log a metric to see its trend"); mobile-first 390px; server components by default, chart islands `'use client'`.

### Coach parity (optional, small)
`get_metric_history` is body-metric-only today. Either extend it or add a thin `get_log_metric_series` MCP read tool so the coach can discuss project trends too. (Nice-to-have; the dashboard is the primary deliverable.)

## Phasing
- **Sprint 1 — Trends spine + charts:** `getLogMetricSeries` + `goals/[id]/trends` + `ProjectTrendsView` (per-metric charts) + nav link. Ships "I can see every metric's trend."
- **Sprint 2 — Browse + timeline:** per-metric detail/browse page + `MilestoneTimeline` + `/progress` MRR refactor onto the shared series fn.
- **Sprint 3 — Verify + polish (+ coach tool):** validate across rhino (multi-metric) / Chewgether (MRR unchanged) / ocarina (cumulative accumulation); empty states; optional MCP trend tool.

## Risks (Plan DA to pressure-test)
- **Cumulative series correctness** — running-total curve must reuse A1's cumulative semantics; off-by-one/dedup of same-day entries.
- **Multi-metric scaling** — N targets → N series queries; parallelize; rhino has 4.
- **Shared goals/[id] page** — the Trends link must be project-gated; don't disturb fitness goal detail.
- **Refactoring the /progress MRR block** — touches a fitness-shared page; output must stay identical.
- **"Generic but secretly MRR-shaped"** — validate every story against rhino + ocarina, not just MRR.
- **Registry vs ad-hoc metrics** — practice_hours/followers aren't in the METRICS registry; label/units must fall back to the GoalTarget.

## Epics (→ Phase 3 stories)
- **A — Trends data spine** (getLogMetricSeries + /progress refactor)
- **B — Per-goal Trends view** (route + ProjectTrendsView + per-metric charts + nav)
- **C — Metric browse + milestone timeline** (detail page + MilestoneTimeline)
- **D — Verify & polish** (multi-vertical validation, empty states, optional coach tool)

---

## Revised (post Plan-DA) — the binding spec

**3 must-fix spec changes + refinements folded in. Now a 2-sprint plan (not 3).**

1. **Cumulative series is a DISTINCT algorithm** (not a generalization of the MRR query, not `resolveMetricValue`'s scalar aggregate). `getLogMetricSeries` has two explicit paths:
   - **snapshot:** flat-map rows → points; latest-wins for same-day.
   - **cumulative (A1 flag):** group rows by USER_TZ day → sum within day → **prefix-sum across days** = the accumulation curve. Same-day collapsing is a NAMED requirement (`log_metric` creates multiple same-day rows by design).
2. **Domain lives in the data spine.** Return type gains `domain: [number,number]`: cumulative → `[0, max*1.1]`; `units==='%'` → `[0,100]`; snapshot → padded dataMin/dataMax (BodyMetricsSection pattern). Centralized so engagement_rate (%) and ocarina (cumulative-from-0) render honestly.
3. **CUT the /progress MRR refactor** — pure regression risk on the focus goal's surface, zero user value. `getLogMetricSeries` stays additive; `/progress` untouched.

**Other folds:**
- `goals/[id]/trends` server route: `if (goal.kind !== 'project') notFound();` right after the goal fetch (mirror plan/page.tsx:30). No redirect.
- **USER_TZ date axis** (currently buggy in the MRR chart): the server emits pre-formatted USER_TZ date labels; the chart does NOT re-format the ISO instant client-side.
- **Promise.all** the N per-target series (rhino has 4 — don't serialize).
- **MilestoneTimeline is NOT a new component** — inline a two-section list in ProjectTrendsView (completed by `completedAt` desc / upcoming by `date` asc; `completedAt` is never surfaced today, so it adds value). Cut the component story.
- Per-metric detail route kept (justified for rhino's 4 metrics × many entries); `decodeURIComponent(params.key)`; `notFound()` guard. **Inline-delete is its OWN explicit P3 story** (a mutation/server-action), not a buried "optional."
- Empty states: per-card (no readings) AND whole-view (no log: targets / none logged) — different copy/CTA.

## Final epics → stories (2 sprints)
**EPIC A — Trends data spine**
- A1 (M, dense — load-bearing): `getLogMetricSeries(target, goalId)` — snapshot + cumulative paths, same-day collapse, domain rule, registry/target label-units fallback, USER_TZ date labels. Returns `{points, label, units, domain}`.

**EPIC B — Per-goal Trends view**
- B1 (L): `goals/[id]/trends` route (`notFound()` non-project) → ProjectTrendsView — one HistoryChart Card per log: target (Promise.all), per-metric "view all" link, inline two-section milestone list, empty states.
- B2 (S): "Trends" nav link on goals/[id] (project-gated) + ProjectTodayView "view trends".

**EPIC C — Per-metric browse**
- C1 (M): `goals/[id]/metric/[key]` detail route (mirror baselines/exercise/[name]) — summary header + HistoryChart + reverse-chron readings list (list_log_entries). `notFound()` guards.
- C2 (S, P3, explicit): inline-delete a reading on the detail page (server action + revalidatePath, uses delete_metric).

**EPIC D — Verify & polish**
- D1 (S): multi-vertical validation — rhino (followers/posts/engagement% multi-metric), Chewgether (mrr identical), ocarina (cumulative accumulation from 0); mobile 390px; USER_TZ axis.
- D2 (S, P3): coach parity — extend get_metric_history (body-only today) or add get_log_metric_series so the coach reads project trends too.

**Sprint 1:** A1 + B1 + B2 → "see every metric's trend on the goal page."
**Sprint 2:** C1 + D1 (+ optional C2, D2) → browse + verify + polish.
**Critical path:** A1 (the dense spine) unblocks B1 + C1.
