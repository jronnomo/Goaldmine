# Fitness Coaching Prompts

Canonical prompt set for **fitness-goal** sessions in claude.ai (the Mt. Elbert hero goal
and any `kind='fitness'` goal). Counterpart to `project-goal-prompts.md` — same structure,
fitness framing. Each prompt assumes a fitness goal with an active plan is in focus.

---

## Prerequisites

| Condition | How to verify | Required for |
|-----------|--------------|-------------|
| A fitness goal is in focus | `get_today_plan` → `activeGoal.kind='fitness'` (or `list_goals`) | All prompts |
| An active plan exists | `get_today_plan` returns today's prescription / rotation | Prompt 1, 2 |
| Targets are set | `compute_readiness(goalId=<id>)` returns a scored breakdown (not no-targets) | Prompt 1, 3 |
| Baselines logged | `get_baseline_history` returns rows | Prompt 3 |

### Focus state note

Fitness is the default routing. When `activeGoal.kind='fitness'`, `get_today_plan` directs the
coach to the fitness tool pack (`log_workout`, `log_hike`, `log_baseline`, `log_measurement`,
`compute_readiness`, `get_records_summary`, etc.). If a project goal is in focus, switch back
with `set_active_goal(goalId=<fitness_id>)` for a clean fitness session (and warn the user that
flipping focus to a project goal suspends the daily fitness prescription).

---

## Surfaces the coach can rely on (fitness-shaped)

A fitness goal renders fitness-shaped on every surface — driven by the goal-presentation registry
(`presentationForGoal(goal)` → `FITNESS_PRESENTATION`). When you reference what the user sees,
describe the **fitness** versions:

| Surface | What a fitness goal shows | Notes for the coach |
|---------|---------------------------|---------------------|
| **Recap card** (`generate_recap_card`, `/recap/card`) | Ring labelled **READINESS**; header **"WEEK n · DAY m OF d"** (program-week); a **2×2** stat grid: **WORKOUTS / VOLUME / NEW PRs / ELEVATION** | Volume shows `—` on cardio-only weeks; elevation `—` when no completed hikes (muted, honest — not `0`). |
| **Today** (`/`) | The day's workout / rest / baseline / hike prescription. On a **rest day**, a **recovery tip** ("a short walk or light stretch builds the aerobic base and joint resilience your goal needs"). | The rest-day tip is fitness-only and goal-generic (it no longer names a specific peak). It does not render for project goals. |
| **Progress** (`/progress`) | A **Weight** card (current / start / Δ + WeightChart) when the goal has a `weightLb` target; per-target **readiness** charts + breakdown. | The weight chart gates on the goal actually tracking weight — a fitness goal with no `weightLb` target shows no weight card. |

### Feasibility (forthcoming — Sprint 8)

The feasibility data already exists in the engine: `get_goal(goalId=<id>).feasibility.computed`
(and `preview_goal_feasibility`) returns per-target `requiredRate` / `observedRate` /
`plausibleRate` / `ratio` / `verdict` + `weeksRemaining`. The **FeasibilityReadout** UI surface
on **Today** and the **goal page** ships in the Sprint 8 feasibility work; until then, surface
feasibility conversationally from `get_goal`.

### Fitness is the `__default__` clone (not the universal "correct" default)

In the registry, `DEFAULT_PRESENTATION` spreads `FITNESS_PRESENTATION` with two overrides:
`kind:"__default__"` **and** `restCopy: null`. So a goal with a **null or unknown kind** renders
fitness-shaped for the ring/header/stats (a safe fallback matching the existing system's
`kind ?? "fitness"` behavior) but, unlike an explicit fitness goal, shows **no rest-day recovery
tip** (the recovery copy is fitness-domain-specific and is not leaked to unspecified kinds). This
is an explicit safety net, **not** a claim that fitness is the universal correct framing: an explicit
`kind:"project"` goal renders project-shaped (see `project-goal-prompts.md`), and future kinds
get their own registry entry. Treat `__default__` as "kind unspecified → show the fitness view,"
not "fitness is the right default for everything."

---

## Prompt 1 — Weekly Training Review

**Use**: Sunday or Monday; the fitness weekly review cadence.

**Prompt text**:
```
Run my weekly training review:
1. How did this week's sessions go — volume, PRs, any hikes?
2. Where am I on readiness toward the goal, and which gates are still open?
3. What should I focus on next week?
```

**Expected tool sequence**:
1. `get_today_plan` — confirm `activeGoal.kind='fitness'` + this week's context
2. `weekly_summary_data` — the week's workouts / volume / PRs / hikes
3. `compute_readiness(goalId=<id>)` — overall score, coverage, open gates, per-target breakdown
4. `get_records_summary` — recent PRs / bests
5. Natural-language synthesis → no write tools unless the user approves

**Expected response shape**:
- Week recap: workouts, volume, new PRs, elevation
- Readiness: score 0–100 + coverage (tested/total) + open gate count, with the gating cap noted
- One-paragraph "next week's focus" recommendation

---

## Prompt 2 — Log a Workout

**Use**: After the user pastes a Strong-app export or describes a session.

**Prompt text**:
```
Here's today's workout: [paste Strong txt export]. Log it and tell me if I set any records.
```

**Expected tool sequence**:
1. Parse the Strong export (in-conversation) into the structured shape
2. `log_workout(...)` — returns `recordsSet[]`
3. Summarize: sets logged, any PRs from `recordsSet[]`, how it moves readiness
4. No further writes unless the user approves a plan change

**Expected response shape**:
- Confirmation: "Logged [title] — N exercises, M sets."
- PRs: any new records from `recordsSet[]` (or "no new records this session")
- Optional: a note on how it advances an open gate / target

---

## Prompt 3 — Baseline / Readiness Check

**Use**: On a baseline-test day, or any time the user wants to see where they stand.

**Prompt text**:
```
Where do I stand toward the goal? Walk me through readiness, what's tested vs untested,
and what's gating my score.
```

**Expected tool sequence**:
1. `get_today_plan` — confirm focus + any baselines due today
2. `compute_readiness(goalId=<id>)` — score, coverage, gates, per-target breakdown
3. `get_baseline_history` / `get_baseline_schedule` — recent baseline results + what's due
4. Natural-language synthesis — honest framing: untested targets count as 0; gates cap at 80

**Expected response shape**:
- Readiness score + the ceiling (80 if any gate open, else 100) and why
- Coverage: tested / total targets; which are still untested
- Open gates: which hard requirements (e.g. an altitude prep hike) are not yet cleared
- Recommended next baseline / action to move the score

---

## Manual Validation Checklist

After running each prompt in claude.ai, fill in Pass/Fail and note the actual tool sequence.

### Prompt 1 — Weekly Training Review

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach calls get_today_plan first | Yes | | |
| Coach reads the week's data | `weekly_summary_data` | | |
| Coach reads readiness | `compute_readiness(goalId=...)` | | |
| Response includes week recap + readiness + focus | Yes | | |
| No write calls without approval | Yes | | |

### Prompt 2 — Log a Workout

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach parses the export then logs | `log_workout(...)` | | |
| Coach reports records from recordsSet[] | Yes | | |
| No unapproved plan changes | Yes | | |

### Prompt 3 — Baseline / Readiness Check

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach calls compute_readiness | `compute_readiness(goalId=...)` | | |
| Coach reads baselines | `get_baseline_history` / `get_baseline_schedule` | | |
| Coach explains untested=0 + gate cap honestly | Yes | | |
| No write calls without approval | Yes | | |
