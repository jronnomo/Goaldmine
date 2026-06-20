# Coaching Docs Fact-Check Critique
Docs reviewed: `docs/coaching/fitness-goal-prompts.md` (#75) and `docs/coaching/project-goal-prompts.md` (#89)
Reviewed against: shipped code as of 2026-06-17, branch `fix/nutrition-macro-residual`

---

## Verification Results by Claim

### 1. Recap card — FITNESS_PRESENTATION shape

**Doc claim (fitness doc, line 36):**
> Ring labelled **READINESS**; header **"WEEK n · DAY m OF d"** (program-week); a **2×2** stat grid: **WORKOUTS / VOLUME / NEW PRs / ELEVATION**

**Reality:**
`src/lib/goal-presentation.ts:57-90` — `FITNESS_PRESENTATION` has `ringLabel: "READINESS"`, `headerStyle: "program-week"`, and exactly 4 `statSlots` in order: WORKOUTS, VOLUME, NEW PRs, ELEVATION.
`src/lib/recap-card.tsx:702` — `StatGrid` renders slots in rows of 2 (`for (let i = 0; i < statSlots.length; i += 2)`), so 4 slots → 2 rows × 2 cells = a genuine 2×2 grid.
`src/lib/recap-card.tsx:295-303` — `program-week` headerStyle produces `WEEK ${programWeek} · DAY ${dayOfProgram} OF ${totalProgramDays}`.

**Verdict: ACCURATE.**

---

### 2. Recap card — PROJECT_PRESENTATION shape

**Doc claim (project doc, line 47):**
> Ring labelled **PROGRESS** (not READINESS); header **"N WEEKS TO `<target>`"** (weeks-to-target, not "Day M of 90"); a **2-cell** stat row: **MRR** + **MILESTONES** (e.g. `$1,200` / `3/7`)

**Reality:**
`src/lib/goal-presentation.ts:92-112` — `PROJECT_PRESENTATION` has `ringLabel: "PROGRESS"`, `headerStyle: "weeks-to-target"`, and exactly 2 `statSlots`: MRR (from `logLatest.mrr`) and MILESTONES (from `scheduledItem.milestone` aggregated as `doneOverTotal`).
`src/lib/recap-card.tsx:299-302` — `weeks-to-target` produces `${weeksToTarget} WEEKS TO ${(targetDateLabel ?? "").toUpperCase()}` — the `<target>` placeholder in the doc is the goal's `targetDate` label (e.g. "OCT 5"), not the MRR target value.
2-cell claim: 2 slots → 1 row of 2 cells via StatGrid. Correct.

**Verdict: ACCURATE.**

---

### 3. Two-truths invariant for MILESTONES

**Doc claim (project doc, lines 52-66):**
> The recap card's MILESTONES stat sources the live ScheduledItem aggregate (e.g. `0/7` — counts `status='done'` over total milestone items). The readiness score does NOT read that aggregate — it reads the `log:milestones_done` LogEntry metric.

**Reality:**
`src/lib/goal-presentation.ts:102-108` — MILESTONES slot source is `{ from: "scheduledItem", itemType: "milestone", agg: "doneOverTotal" }`.
`src/lib/recap.ts:336-351` — `resolveStatSlot` for `scheduledItem` calls `prisma.scheduledItem.groupBy(...)` counting actual `status='done'` rows.
`src/lib/recap.ts:405` — Readiness is computed via `computeReadiness(targets, sunday, goal.id)`. The milestones target metric is `log:milestones_done` which reads from `LogEntry`, not `ScheduledItem.status`.
The claim that `sync_github_milestones` moves the recap card count but NOT the readiness score (until `log_metric` is called) is structurally correct per these two separate code paths.

**Verdict: ACCURATE.**

---

### 4. Today page routing

**Doc claim (fitness doc, line 37; project doc, line 48):**
> Fitness: On a rest day, a recovery tip (`presentation.restCopy`). Project: routed to `ProjectTodayView`; no rest-day recovery tip.

**Reality:**
`src/app/page.tsx:46-48` — `if (focusGoal?.kind === "project") { return <ProjectTodayView goal={focusGoal} />; }` — project goals short-circuit to `ProjectTodayView` before any rest-day logic.
`src/app/page.tsx:249-254` — `{isRestDay && presentation.restCopy && (<p>...{presentation.restCopy}</p>)}` — tip gated on `presentation.restCopy`, which is `null` for `PROJECT_PRESENTATION` (goal-presentation.ts:111) and non-null for `FITNESS_PRESENTATION` (goal-presentation.ts:87-89).
The fitness restCopy text in the code (`"A short walk or light stretch today builds the aerobic base and joint resilience your goal needs — treat recovery as training, not a day off."`) matches the paraphrase in the doc.

**Verdict: ACCURATE.**

---

### 5. DEFAULT_PRESENTATION claim — INACCURACY FOUND

**Doc claim (fitness doc, lines 50-56):**
> In the registry, `DEFAULT_PRESENTATION` is a clone of `FITNESS_PRESENTATION` labelled `kind:"__default__"`.

**Reality (src/lib/goal-presentation.ts:114-118):**
```ts
export const DEFAULT_PRESENTATION: GoalPresentation = {
  ...FITNESS_PRESENTATION,
  kind: "__default__",
  restCopy: null, // recovery tip is fitness-specific; unknown kinds get no tip
};
```

`DEFAULT_PRESENTATION` is a spread of `FITNESS_PRESENTATION` with **two** overrides: `kind: "__default__"` AND `restCopy: null`. It is NOT a pure clone — it also strips the recovery tip. This means a goal with an unknown/null kind that renders via `DEFAULT_PRESENTATION` will show the fitness stat grid and READINESS ring, but will **not** show a rest-day recovery tip (unlike a genuine `FITNESS_PRESENTATION` goal). The code comment explains the rationale.

The doc's framing as "a clone" implies only the kind label changes, which is not quite right.

**Severity:** Low. The doc's next sentence ("renders fitness-shaped") is broadly correct (same ring, same stat grid), but a coach reading this might assume unknown-kind goals also get the recovery tip, which they don't.

**Correction:** "In the registry, `DEFAULT_PRESENTATION` spreads `FITNESS_PRESENTATION` with `kind:'__default__'` and `restCopy: null` (the recovery tip is fitness-specific and is not shown for unknown kinds). An unrecognized `kind` renders the fitness stat grid and READINESS ring, but no rest-day tip."

---

### 6. Progress page — weight card, MilestoneBurnDown, MRR trend

**Doc claim (fitness doc, line 38):**
> A Weight card when the goal has a `weightLb` target.

**Reality (src/app/progress/page.tsx:56-57, 220):**
`const hasWeightTarget = focusTargets.some((t) => t.metric === "weightLb");`
`{hasWeightTarget && (<Card title="Weight">...)}` — gates exactly on `weightLb` target. ✓

**Doc claim (project doc, line 49):**
> No weight chart. Instead: MilestoneBurnDown (planned vs done) + an MRR-over-time trend chart.

**Reality:**
`src/app/progress/page.tsx:52, 200-217` — `focusProjectGoal` activates `<MilestoneBurnDown>` and the MRR trend. The weight card at line 220 is NOT gated on `kind !== 'project'` — it gates on `hasWeightTarget` from the focus goal's targets. If a project goal hypothetically carried a `weightLb` target, a weight card would render alongside the burn-down. For Chewgether this won't occur, but "No weight chart" is only conditionally true, not structurally enforced.

Additionally, the MRR trend (project doc) is dual-gated: it requires BOTH `focusProjectGoal` AND `hasMrrTarget` (line 61: `focusTargets.some((t) => t.metric === "log:mrr")`). A project goal without a `log:mrr` target renders no MRR card. The doc doesn't mention this second gate.

**Severity:** Very low. For Chewgether the `log:mrr` target will be present. The "No weight chart" claim is accurate in practice but not architecturally enforced by goal kind.

---

### 7. Feasibility — get_goal returns computed data

**Doc claim (fitness doc, lines 42-45):**
> `get_goal(goalId=<id>).feasibility.computed` (and `preview_goal_feasibility`) returns per-target `requiredRate` / `observedRate` / `plausibleRate` / `ratio` / `verdict` + `weeksRemaining`.

**Reality:**
`src/lib/mcp/tools.ts:896-910` — `get_goal` calls `computeGoalFeasibility(...)` and returns `{ ...goal, feasibility: { computed, coach }, ... }`. ✓
`src/lib/rarity.ts:283-292` — `computeGoalFeasibility` returns `{ goalId, tier, unratedReason, ratio, perTarget, basis, weeksRemaining, computedAt }`.
`src/lib/rarity-core.ts:195-200` — each `perTarget[]` element (`TargetFeasibility`) has `requiredRate`, `observedRate`, `plausibleRate`, `ratio`, `verdict`. ✓
`weeksRemaining` is at the **top level** of `computed` (not per-target), but the doc's phrasing "per-target ... + `weeksRemaining`" reads as "those per-target fields, plus `weeksRemaining` at the goal level," which is accurate.
`preview_goal_feasibility` (tools.ts:4700) returns `{ stackRarity, hypotheticalGoalFeasibility }` where `hypotheticalGoalFeasibility` carries the same `GoalFeasibility` shape including `perTarget`. The parenthetical mention is accurate.

**Verdict: ACCURATE.**

---

### 8. FeasibilityReadout not shipped

**Doc claim (fitness doc, lines 45-46; project doc, lines 63-67):**
> The FeasibilityReadout UI surface … ships in the Sprint 8 feasibility work; until then, surface feasibility conversationally from `get_goal`. / feasibility ("is this date a fantasy?") … is the FeasibilityReadout surface shipped in the Sprint 8 feasibility work, not the recap/Today/progress framing covered here.

**Reality:**
```
grep -rn "FeasibilityReadout" src/ → (no output)
```
`FeasibilityReadout` does not exist anywhere in `src/`. Correctly described as forthcoming. ✓

**Verdict: ACCURATE.**

---

### 9. MCP tools — all named tools verified

Every tool named in either doc was checked against `src/lib/mcp/tools.ts` and `src/lib/mcp/tools/*.ts`:

| Tool name | Exists? | Source file |
|-----------|---------|-------------|
| `weekly_summary_data` | ✓ | tools.ts:1073 |
| `compute_readiness` | ✓ | tools.ts:915 |
| `log_workout` | ✓ | tools.ts:2168 |
| `get_records_summary` | ✓ | tools.ts:1158 |
| `get_baseline_history` | ✓ | tools.ts:1145 |
| `get_baseline_schedule` | ✓ | tools.ts:1132 |
| `get_today_plan` | ✓ | tools.ts:533 |
| `generate_recap_card` | ✓ | tools.ts:4757 |
| `sync_github_milestones` | ✓ | tools/github-tools.ts:662 |
| `log_metric` | ✓ | tools/project-tools.ts:440 |
| `list_log_entries` | ✓ | tools/project-tools.ts:543 |
| `list_scheduled_items` | ✓ | tools/project-tools.ts:336 |
| `get_project_overview` | ✓ | tools/github-tools.ts:425 |
| `list_project_issues` | ✓ | tools/github-tools.ts:566 |
| `list_open_items` | ✓ | tools.ts:1177 |
| `set_active_goal` | ✓ | tools/project-tools.ts:633 |
| `get_goal` | ✓ | tools.ts:818 |
| `preview_goal_feasibility` | ✓ | tools.ts:4700 |
| `set_github_issue_status` | ✓ | tools/github-tools.ts:828 |

**No phantom tools. All names are correct. Verdict: ACCURATE.**

---

### 10. log_workout returns recordsSet[]

**Doc claim (fitness doc, line 98):**
> `log_workout(...)` — returns `recordsSet[]`

**Reality (tools.ts:2186-2195):**
```ts
const { id, recordsSet } = await createWorkoutCore({ ... });
return { id, message: "Workout logged", recordsSet };
```
**Verdict: ACCURATE.**

---

### 11. Sprint 8 scope guard (#89 concern)

**Doc claim (project doc, lines 63-67):**
> Feasibility ("is this date a fantasy?") on Today and the goal page is documented separately — it is the FeasibilityReadout surface shipped in the Sprint 8 feasibility work, not the recap/Today/progress framing covered here.

The new section limits itself to a single-sentence pointer-to-Sprint-8 callout. It does NOT document FeasibilityReadout internals, fields, or behavior. The fitness doc separately describes the `get_goal.feasibility.computed` data (which exists today) while correctly marking the UI surface as forthcoming. No duplication or scope bleed.

**Verdict: ACCURATE.**

---

## Summary of Inaccuracies

| # | Severity | Doc | Line | Inaccuracy | Correction |
|---|----------|-----|------|-----------|-----------|
| 1 | LOW | fitness | 50 | "clone of FITNESS_PRESENTATION" — actually a spread with two overrides (kind + restCopy: null); unknown-kind goals do NOT get the recovery tip | Change "clone … labelled `kind:'__default__'`" to "spread of FITNESS_PRESENTATION with `kind:'__default__'` and `restCopy: null`" |
| 2 | VERY LOW | project | 49 | "No weight chart" — code gates on `hasWeightTarget`, not `kind !== 'project'`; would render for a project goal with a `weightLb` target | Clarify: "No weight chart (project goals typically have no `weightLb` target, so the card is absent in practice)" |
| 3 | VERY LOW | project | 49 | MRR trend described as always-present for project focus; code requires both `focusProjectGoal` AND `hasMrrTarget` (`log:mrr` in the goal's targets) | Add "and has a `log:mrr` target" qualifier |
| 4 | VERY LOW | project | 48 | ProjectTodayView "MRR" render described unconditionally; it's gated on `mrrTarget != null` (goal must have a `log:mrr` target) | Minor qualifier: "MRR progress (when `log:mrr` target is set)" |

Total inaccuracies: **4**, all LOW or VERY LOW severity. No phantom tool names. No structural errors.

---

## Verdict

**APPROVE-WITH-FIXES**

The docs are substantively accurate. Every MCP tool named exists with the correct name. The recap card layout, Today routing, Progress page gating, two-truths invariant, feasibility data path, and `FeasibilityReadout` forthcoming status are all correct. Four minor inaccuracies were found; none would cause a coach to make a wrong tool call or misread a UI surface in a meaningful way.

**Most important correction:** Finding #1 — `DEFAULT_PRESENTATION` is not a pure clone of `FITNESS_PRESENTATION`; it also sets `restCopy: null`. The doc's use of "clone" could mislead a reader into thinking unknown-kind goals behave identically to `FITNESS_PRESENTATION` goals (including rest-day tips), when they don't. This is a one-sentence fix in the fitness doc.

The other three findings (MRR card conditionality, weight chart architectural gate, ProjectTodayView MRR gate) are all "true in practice for Chewgether but technically imprecise in general" — worth a qualifier each, not a rewrite.
