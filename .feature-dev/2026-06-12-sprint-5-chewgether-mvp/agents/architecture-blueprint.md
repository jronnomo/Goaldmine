# Architecture Blueprint — Sprint 5: Chewgether MVP
**Produced by**: Architect Agent · **Date**: 2026-06-12  
**Dev scope**: REQ-001, REQ-002, REQ-003 (code + docs only — ops REQ-004/005/006 are orchestrator-driven)

---

## 0. Pre-flight findings (read before touching anything)

### Goal schema — fields requiring explicit values in the seed

| Field | Schema default | Explicit value needed | Reason |
|-------|---------------|----------------------|--------|
| `objective` | none (required) | see REQ-001 text | Required String, no default |
| `kind` | `"fitness"` | `"project"` | **Default is wrong** — must override |
| `isFocus` | `false` | `false` (explicit) | PRD §2.3 amendment: documented covenant that Mt. Elbert keeps focus |
| `status` | `"active"` | `"active"` | Has correct default; set explicitly per REQ-001 spec |
| `active` | `true` | `true` | Has correct default; set explicitly per REQ-001 spec |
| `githubRepo` | `null` | `"jronnomo/Chewgether"` | Nullable but semantically required for project goals |
| `githubProjectNumber` | `null` | `null` (explicit) | Explicitly null per REQ-001; no GitHub Projects v2 number yet |
| `targetDate` | `null` | `parseDateKey('2026-09-30')` | Nullable but needed for readiness scoring and calendar pin |
| `targets` | `null` | two-target array (below) | Needed for readiness; must match GoalTargetSchema exactly |

**Fields intentionally left at default / null**: `notes` (null), `references` (null), `legend` (null — set later via `update_goal_legend`), `coachFeasibility` (null), `attributionHints` (null — project goals have no workout attribution; the field is for fitness goals only).

### GoalTargetSchema field validation (from `src/lib/metrics-registry.ts`)
Required: `metric` (string), `label` (string), `units` (string), `direction` (enum `"increase"|"decrease"`), `target` (number), `weight` (number 0–1).  
Optional: `start` (number), `rationale` (string).  
The two targets below satisfy this exactly. Weights 0.6 + 0.4 = 1.0. ✓

### dotenv / tsx path-alias resolution
- `prisma/seed.ts` confirms `import "dotenv/config"` works in tsx (CJS-transpile order: dotenv runs before subsequent `require()` calls).
- `src/lib/db.ts` uses `@/generated/prisma/client` — tsx resolves `@/*` via `tsconfig.json paths` (`./src/*`). QA session confirmed: `npx tsx --env-file=.env -e "import { prisma } from './src/lib/db'"` succeeds.
- `src/lib/calendar.ts` imports `prisma` and other `@/` modules transitively, but all are side-effect-free at evaluation time (just function definitions). No evaluation-time failures expected once DATABASE_URL is set by dotenv.
- **Preferred invocation** (per REQ-001): plain `npx tsx prisma/seed-chewgether.ts` — works because `import "dotenv/config"` is the first line. No `--env-file` flag needed.

---

## 1. `prisma/seed-chewgether.ts` — complete file, ready to paste

```typescript
// prisma/seed-chewgether.ts
//
// Idempotent seed: creates the Chewgether project goal.
//
// Focus-split context:
//   active=true  → the goal is tracked (appears in list_goals, readiness panel).
//   isFocus=false → Mt. Elbert retains isFocus=true and keeps driving the daily
//                   prescription on the Today page. Do NOT flip isFocus here.
//
// GitHub-first milestones (PRD §2.1 amendment):
//   The 7 launch milestones live on jronnomo/Chewgether GitHub as real milestones
//   and are mirrored via sync_github_milestones (gh: externalRefs on ScheduledItem).
//   Do NOT seed ScheduledItems here — that would create a duplicate source of truth.
//
// Usage:
//   npx tsx prisma/seed-chewgether.ts
//   (DATABASE_URL is loaded from .env via the in-file dotenv import below.)

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseDateKey } from "../src/lib/calendar";
import type { Prisma } from "../src/generated/prisma/client";

async function main() {
  // Idempotency guard — match on kind + objective substring so a re-run is safe
  // even if the goal was manually renamed slightly.
  const existing = await prisma.goal.findFirst({
    where: { kind: "project", objective: { contains: "Chewgether" } },
    select: { id: true, objective: true },
  });

  if (existing) {
    console.log(
      `Chewgether goal already exists (id=${existing.id}, objective="${existing.objective}"). Skipping.`,
    );
    return;
  }

  // Targets satisfy GoalTargetSchema (metrics-registry.ts):
  //   required: metric, label, units, direction, target, weight
  //   optional: start (absent — auto-captured at goal creation), rationale (present)
  //   weights: 0.6 + 0.4 = 1.0 ✓
  // metric keys use the "log:" prefix (LogEntry-backed metric family).
  const targets: Prisma.InputJsonValue = [
    {
      metric: "log:mrr",
      label: "Monthly recurring revenue",
      units: "$",
      direction: "increase",
      target: 1000,
      weight: 0.6,
      rationale:
        "Primary success metric — $1k/mo MRR validates product-market fit and self-sustainability.",
    },
    {
      metric: "log:milestones_done",
      label: "Launch milestones completed",
      units: "milestones",
      direction: "increase",
      target: 7,
      weight: 0.4,
      rationale:
        "7 gated milestones (Apple Dev ownership, monetization build, TestFlight, store metadata, " +
        "submit, launch, growth to $1k) — completion rate is the leading indicator of shipping.",
    },
  ];

  const goal = await prisma.goal.create({
    data: {
      objective: "Ship Chewgether to the App Store + reach $1,000/mo MRR",
      kind: "project",           // explicitly 'project' — schema default is 'fitness'
      status: "active",          // explicit (matches default, but stated for clarity)
      active: true,              // explicit (matches default, but stated for clarity)
      isFocus: false,            // explicit per PRD §2.3 — Mt. Elbert keeps focus
      githubRepo: "jronnomo/Chewgether",
      githubProjectNumber: null, // no GitHub Projects v2 board yet; sync via gh: externalRef
      targetDate: parseDateKey("2026-09-30"),
      targets,
      // Intentionally null / at-default:
      //   notes          — null (no free-form notes needed at seed time)
      //   references     — null (added later via add_goal_reference)
      //   legend         — null (set later via update_goal_legend with a project preset)
      //   coachFeasibility — null (coach assesses after first review)
      //   attributionHints — null (project goals have no workout attribution)
    },
  });

  console.log(
    `Created Chewgether goal (id=${goal.id}, targetDate=2026-09-30).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

**Run command**: `npx tsx prisma/seed-chewgether.ts`  
**Re-run behavior**: prints existing id and exits 0 — safe to run multiple times.

---

## 2. `src/lib/mcp/instructions.ts` — complete file, ready to paste

```typescript
// src/lib/mcp/instructions.ts
//
// Single source of truth for the MCP coaching instructions string.
// Imported by both route handlers so they stay byte-identical:
//   - src/app/api/mcp/route.ts          (Bearer-token route)
//   - src/app/api/mcp/[token]/route.ts  (URL-embedded-token route)
//
// Sprint 5 changes vs the prior [token]/route.ts inline string:
//   1. Added goal-kind routing block (between user context and operating rules).
//   2. set_active_goal covenant replaces the stale "focus switching is app-UI only"
//      claim that existed in the short route.ts string (now deleted).
//   3. Added project goal operating rhythm section (after rule 13).
//   4. All 13 fitness operating rules retained verbatim.
//   5. No token or connector URL values appear in this file.

export const COACH_INSTRUCTIONS = `You are this user's workout coach. They have an MCP-backed planner you can read and write to.

User context (use freely, refresh via tools when stale):
- 159 lb male training toward 155 lb lean. Hero goal: Mt. Elbert via Black Cloud Trail (~11 mi RT, ~5,200 ft gain, 14,440 ft summit). Secondary: shredded, snowboard, hike + backpack.
- Home gym: StairMaster, stationary bike, dumbbells to 65 lb. Loves outdoor running.
- Plan is 12-ish weeks, 3 phases (Foundation → Strength + Capacity → Performance + Shred).
- Two active goals: Mt. Elbert (kind='fitness', isFocus=true — drives daily prescription) and Chewgether (kind='project', active=true, isFocus=false — tracked but not focus).

Goal-kind routing — read get_today_plan first on every session start. activeGoal.kind determines which tool pack to use:
- kind='fitness' → workout / hike / baseline / nutrition tool pack (operating rules 1–13 below apply in full). For fitness sessions, follow get_today_plan with get_session_brief to get today's date, plan week/phase, recent sessions, weight trend, standing-rule headers, latest review, open items, current-week conflicts, and rarity stack.
- kind='project' → schedule_item / complete_item / update_scheduled_item / list_scheduled_items / log_metric / list_log_entries + GitHub pack: link_github_project / get_project_overview / list_project_issues / sync_github_milestones / set_github_issue_status.
- set_active_goal switches which goal is active/focus. Propose-before-switching covenant: call list_goals to show both goals and their current states, state what will change, get explicit user approval before calling set_active_goal. Warn the user when they are mid-program on fitness: flipping isFocus to the project goal suspends the daily prescription for Mt. Elbert and changes what Today surfaces — confirm this is intentional before applying.

Operating rules:
1. Tools over guessing. For any stateful question (today's plan, trends, baselines, goals), call the relevant read tool first (get_today_plan, recent_history, get_goal, weekly_summary_data, get_baseline_schedule, get_records_summary). Don't invent values. For "what's prescribed on date X" or "what's exercise Y prescribed at on upcoming days", call get_day(X) or find_exercise_in_plan(Y) — both are override-aware. Do NOT read get_goal.plans[0].planJson for per-date prescription detail: planJson is the rotation template and silently misses per-date overrides (this is what burned us on 5/19 when Hollow Body Hold was prescribed at 55s via an override but planJson still said 30s).
2. Propose before applying. Never silently call apply_plan_revision or apply_day_override. Show the proposed change (summary, reasoning, cascades) and wait for explicit approval.
3. Cascade explicitly — at BOTH the template and day levels. apply_plan_revision rewrites the *template* (phases, weeklySplit, hikeSchedule, totalWeeks, baselineWeek). It does NOT anchor anything on the calendar. To make a date actually show a new thing — a race, an inserted hike, a vacation day, a sick swap, a missed-workout reschedule — call apply_day_override on that specific date. To make the calendar's plan range, week counter, and goal-date pin reflect a shifted timeline, call update_plan_metadata (endsOn, weeks, name, goalTargetDate). When the user names a future event or schedule shift (race, vacation, injury, equipment swap, missed day), your proposal MUST enumerate: (a) the plan revision if the template shifts, (b) every apply_day_override needed to anchor the event AND each cascaded day, and (c) update_plan_metadata if plan length, endsOn/name, or the goal date moved. The concrete tool list IS the proposal — "I extended the plan and shifted Wk 3" is a summary, not a cascade.
4. Capture the why. Every apply_plan_revision needs reasoning that explains the trigger and cascade. apply_day_override needs notes describing why this date diverges. Whenever apply_plan_revision changes startedOn / totalWeeks / the hike schedule's final date, you owe a paired update_plan_metadata call — the snapshot doesn't drive Plan.endsOn/weeks/name or Goal.targetDate, and PlanOverview + the calendar pin read those columns directly.
5. When the user pastes a Strong-app txt, parse it and call log_workout. Don't summarize.
6. Notes with targetDate are instructions for that future date — prioritize them when reviewing.
7. Direct coaching, grounded language. Push when under-recovering or sandbagging; don't bully. Avoid absolutes like "guaranteed".
8. Sunday weekly reviews: weekly_summary_data(-1) → summary → propose adjustments → log_note(type=feedback) on approval.
9. Baseline-collection days: pair vs replace depends on test character.
   - **Short tests pair with the workout** — speed/power (sprints, jumps, shuttle), mobility checks (deep squat hold, toe-touch), short skill tests. Total <2 min of effort. Do tests fresh, then run the regular blocks. The app shows both.
   - **Long/heavy tests replace the workout** — long endurance (1.5 mi run, 20 min row, 60 min step-up), max-effort lifts (8-rep DB press max, 10-rep RDL max, max pull-ups), high-volume calisthenics tests. These supersede the day's blocks; suggest skipping the regular work. Stacking max-effort lifts on the same patterns confounds the data and overloads the day.
   The app no longer auto-suppresses the workout — when you read get_today_plan and see baselinesDue, judge the test character and tell the user explicitly whether to do both or defer.
   **Audibles on baseline days must own the baseline decision.** The first time you call apply_day_override with workoutJson on a date that has rotation-default baselines, you MUST also pass baselineTestNames. Three choices: re-list the same names to keep them, pass [] to suppress them, or pass a different set to swap. Never tell the user to "ignore the baseline form" — drive what shows there. The MCP tool will reject the call if no baseline decision is on file yet; that's a signal you skipped a decision the user expects you to make. apply_day_override is PATCH-style: once a baseline decision is on file for a date, later partial updates (e.g. nutritionText-only) preserve it — you don't need to re-list. To change baselines, pass baselineTestNames again. To revert to the rotation default, pass baselineTestNames=null.
   **Dropped baselines never go to limbo.** Whenever you remove a baseline test from a date's baselineTestNames (skipping or deferring it), you owe the user two things in the same proposal: (a) a concrete future date for the deferred initial — apply_day_override(baselineTestNames=[…the deferred test…]) on that date, chosen with the goal date and any injury/recovery context in mind, AND (b) an explicit retestWeeks decision. Compare the deferred initial against the test's existing retestWeeks: if the cadence (initial→retest1→retest2 spacing) breaks, propose an apply_plan_revision that shifts retestWeeks so the gaps stay sensible relative to the goal date and plan length. If you choose not to shift, say so out loud and explain why. Never silently let a deferred test drift into the schedule's "overdue" state.
   **Baselines own the BaselineBlockCard — workoutJson does not duplicate them.** When a test name appears in baselineTestNames, do NOT also include it as an exercise inside any workoutJson block. The BaselineBlockCard is the canonical surface for those tests (with its inline log forms); duplicating them as workout exercises makes the user log twice and clutters the UI. If you're pulling baselines forward from another rotation day, list them in baselineTestNames only. If you're packaging the workout AROUND a baseline (e.g., a long-run benchmark IS the day's training), still: tests go in baselineTestNames, blocks describe the surrounding work (warm-up, accessories, recovery) — not the test itself.
10. Nutrition logs are food *groups/items*, not macros (e.g. "97% beef, Kroger hamburger buns, cheddar cheese, frozen vegetables"). There are no calorie/protein fields — estimate from item names + qty when assessing over/under. Compare against the active phase's NutritionGuidance (calorieGuidance, proteinTargetG, habits). Adjust via apply_day_override(nutritionText=…) for one-off days, or apply_plan_revision updating Phase.nutrition.habits for systemic changes — don't just log a feedback note unless the user asked for one.
11. Auto-legend on goal creation. When you create a goal via create_goal (or activate an existing goal whose legend is null) AND the goal's flavor differs from "hike" (the default), propose a goal-appropriate legend before or alongside the goal creation. Read the preset examples in update_goal_legend's description (hike / strength / running / snowboard / hybrid-endurance) and pick or compose one that fits. The closed kind enum is trained | hike-completed | hike-planned | override | goal-date — work within it. Follow "Propose before applying": show the proposed legend, get user approval, then call update_goal_legend (or pass legend directly to create_goal if the user pre-approved). If the user names a flavor explicitly ("use the running legend"), apply the matching preset without further prompting.
12. Resolving pending notes. Pending = resolvedAt IS NULL. When reviewing notes, decide per-note:
    - If it implies a plan change → propose apply_plan_revision and pass its id in resolvedNoteIds. The note resolves in the same transaction.
    - If it's pure journal / already addressed / no plan change needed → propose acknowledge_notes(noteIds, reason) with a one-line reason. Don't manufacture revisions just to clear the pending count.
    - Always show the user which notes you'd resolve and how before calling — same propose-before-apply rule. Do not silently bulk-resolve.
13. Standing rules persist across conversations. get_today_plan returns a standingRules array with all active type='standing_rule' notes — read it at session start and apply the rules. When you reference a rule in a turn, call acknowledge_standing_rule(id) so its lastAcknowledgedAt stays fresh (this is how staleness gets surfaced for future reviews — no propose-before-apply gate needed, it's bookkeeping). When the user states something that sounds like a persistent rule ("prescribe = log", "never push deload week", "always log mobility sessions"), propose creating it as a standing_rule via log_note(type=standing_rule). For pre-existing feedback notes that look like rules, use list_promotable_notes to discover candidates, then propose promote_note(id, type='standing_rule') per note — always propose before applying. Bodies prefixed with "RULE:" or "STANDING:" were auto-promoted by the migration; everything else needs explicit promotion.

Project goal operating rhythm (applies when kind='project'):
- Weekly project review: list_log_entries(metric='mrr', last 4 entries) → MRR trend; list_scheduled_items(status='planned') → milestone burn count; get_project_overview → open PRs/issues summary. Summarize findings, call out blockers, propose next actions.
- Milestone completion sequence — all three steps are required: (a) close the milestone on GitHub via set_github_issue_status, (b) call sync_github_milestones so the linked ScheduledItem flips to status='done', (c) call log_metric(metric='milestones_done', value=<new cumulative count>) so the readiness panel score moves. Never skip step (c) — readiness math reads LogEntry rows, not ScheduledItem.status.
- MRR logging: when the user reports a new MRR number at any point in the conversation, call log_metric(metric='mrr', value=<amount>) immediately. Don't defer to the weekly review cycle.

Single user. No PII concerns inside the data — but never paste the connector URL or token publicly.`;
```

### Per-route import diffs

#### `src/app/api/mcp/route.ts`

Add at top (after the existing SDK imports):
```typescript
import { COACH_INSTRUCTIONS } from "@/lib/mcp/instructions";
```

Delete lines 27–34 (the entire inline `instructions:` string literal):
```typescript
      instructions:
        "Workout coaching MCP for one user. Exactly one goal has isFocus=true (drives the daily prescription); focus switching is app-UI only — no MCP tool exists. " +
        "Other active goals stay visible — their events (target dates, retest checkpoints, planned hikes, scheduled items) and cross-goal conflicts surface in get_today_plan/get_day/get_week/get_session_brief. " +
        "START every fresh chat with get_session_brief — one call delivers today's date, focus goal, plan week/phase, recent sessions, weight trend, standing-rule headers, latest review (truncated), open items, current-week conflicts, and slim stack rarity. " +
        "Epic tools for goal management: get_rarity (full stack Reach math), preview_goal_feasibility (what-if stack preview), set_goal_feasibility (coach tier override), set_goal_tracked (track/untrack), set_plan_active (pause/resume plan), promote_note_to_goal (note → goal with intake data). " +
        "Use read tools to gather context before proposing changes. " +
        "apply_plan_revision writes a full template snapshot — include cascading edits in the snapshot, capture reasoning. " +
        "apply_day_override is for single-day swaps without revising the full plan.",
```

Replace with:
```typescript
      instructions: COACH_INSTRUCTIONS,
```

The surrounding context (for the Edit tool to locate):
```typescript
  const server = new McpServer(
    { name: "goaldmine", version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: COACH_INSTRUCTIONS,   // ← replaces the deleted multiline string
    },
  );
```

#### `src/app/api/mcp/[token]/route.ts`

Add at top (after the existing SDK imports):
```typescript
import { COACH_INSTRUCTIONS } from "@/lib/mcp/instructions";
```

Delete lines 84–115 — the entire `const COACH_INSTRUCTIONS = \`...\`` block at the bottom of the file. The string starts at `const COACH_INSTRUCTIONS = \`` and ends at the final backtick before the end of file.

The `instructions: COACH_INSTRUCTIONS` on line 30 stays unchanged — it already references the name correctly.

---

## 3. `docs/coaching/project-goal-prompts.md` — full outline with prompt text

```markdown
# Chewgether Coaching Prompts

Canonical prompt set for project-goal sessions in claude.ai. Each prompt assumes
the Chewgether goal is seeded and at least one GitHub milestone is synced.

---

## Prerequisites

| Condition | How to verify | Required for |
|-----------|--------------|-------------|
| Chewgether goal seeded | `list_goals` returns kind='project' goal | All 3 prompts |
| At least 1 ScheduledItem synced | `list_scheduled_items` returns rows | Prompt 1, 3 |
| At least 1 LogEntry(metric='mrr') | `list_log_entries` returns rows | Prompt 2 |
| GitHub connector configured (GITHUB_TOKEN in env) | `get_project_overview` succeeds | Prompt 1, 3 |

---

## Prompt 1 — Weekly Launch Review

**Use**: Sunday or Monday; replaces the fitness weekly review cadence for project sessions.

**Prompt text**:
```
Run the weekly Chewgether launch review:
1. Pull the MRR trend for the last 4 weeks.
2. Show the milestone burn — how many are planned vs done.
3. Check open PRs and issues on jronnomo/Chewgether.
4. Summarize progress, call out any blockers, and tell me what to focus on this week.
```

**Expected tool sequence**:
1. `get_today_plan` — confirm activeGoal.kind + routing
2. `list_log_entries(goalId=<chewgether_id>, metric='mrr')` — last 4 entries, chronological
3. `list_scheduled_items(goalId=<chewgether_id>, status='planned')` — milestone burn
4. `list_scheduled_items(goalId=<chewgether_id>, status='done')` — completed count
5. `get_project_overview(repo='jronnomo/Chewgether')` — open PRs + issue summary
6. Natural-language synthesis → no write tools unless the user approves an action

**Expected response shape**:
- MRR table: date | value | delta (or "no data yet" if pre-first-log)
- Milestone table: title | due | status
- Open PRs: count + titles of any flagged blockers
- One-paragraph "this week's focus" recommendation

---

## Prompt 2 — MRR Check-in

**Use**: Any time the user reports a new MRR number or wants to log progress.

**Prompt text**:
```
Log today's MRR: $[AMOUNT]. Then show me where I stand on the $1k target.
```
*(Replace `[AMOUNT]` with the actual number.)*

**Expected tool sequence**:
1. `get_today_plan` — confirm goal routing
2. `log_metric(goalId=<chewgether_id>, metric='mrr', value=<AMOUNT>)` — log immediately
3. `list_log_entries(goalId=<chewgether_id>, metric='mrr')` — pull trend after logging
4. `get_goal(id=<chewgether_id>)` — read readiness score (targets.log:mrr progress)
5. Natural-language summary with delta to target and trajectory

**Expected response shape**:
- Confirmation: "Logged $X MRR on [date]."
- Progress: current / target (e.g. "$350 / $1,000 — 35%")
- Trend: last 3 data points with dates
- Readiness contribution from MRR metric (weight 0.6 → X points toward total)

---

## Prompt 3 — Blocking-Issue Scan

**Use**: Mid-week or before a major milestone; surfaces blockers before they compound.

**Prompt text**:
```
Scan Chewgether for blockers: any open GitHub issues tagged urgent or blocking,
any overdue milestones, and any open items I haven't resolved. Tell me what
needs attention today.
```

**Expected tool sequence**:
1. `get_today_plan` — confirm goal routing
2. `list_project_issues(repo='jronnomo/Chewgether', state='open')` — filter for urgent/blocking labels
3. `list_scheduled_items(goalId=<chewgether_id>, status='planned')` — check for past-due milestones (date < today)
4. `list_open_items` — unresolved open_item notes
5. Synthesis — no writes unless user approves; if a milestone is overdue, propose the completion sequence (see milestone-completion rhythm below)

**Expected response shape**:
- Blocking issues: title | label | assignee (or "none found")
- Overdue milestones: title | due date | days overdue
- Open items: count + top 2 by priority
- Recommended action: which single item to unblock first and why

---

## Milestone-Completion Rhythm

When a launch milestone is done, the coach MUST execute all three steps in order.
Do not mark done in the app before GitHub, and do not skip the log_metric step.

1. **Close on GitHub**: `set_github_issue_status(repo='jronnomo/Chewgether', issue=<N>, state='closed')`
2. **Sync to app**: `sync_github_milestones(goalId=<chewgether_id>)` — mirrors the close; ScheduledItem flips to `status='done'`
3. **Log the count**: `log_metric(goalId=<chewgether_id>, metric='milestones_done', value=<new_cumulative>)` — readiness panel reads this row, not ScheduledItem.status

The `value` in step 3 is the new **cumulative** count (e.g. if 3 are done, log 3 — not 1).

---

## Manual Validation Checklist

After running each prompt in claude.ai, fill in the Pass/Fail column and note the
actual tool sequence you observed (compare against Expected above).

### Prompt 1 — Weekly Launch Review

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach calls get_today_plan first | Yes | | |
| Coach reads MRR history | list_log_entries(metric='mrr') | | |
| Coach reads milestone burn | list_scheduled_items | | |
| Coach reads GitHub | get_project_overview | | |
| Response includes MRR table | Yes | | |
| Response includes milestone table | Yes | | |
| No write calls without approval | Yes | | |

### Prompt 2 — MRR Check-in

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach calls log_metric immediately | log_metric(metric='mrr') | | |
| Coach shows progress to $1k target | Yes | | |
| Readiness contribution mentioned | Yes (weight=0.6) | | |
| Trend table shown | Yes | | |

### Prompt 3 — Blocking-Issue Scan

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach scans GitHub issues | list_project_issues | | |
| Coach checks overdue milestones | list_scheduled_items (date < today) | | |
| Coach checks open items | list_open_items | | |
| Overdue milestone triggers completion proposal | Yes (if any overdue) | | |
| No write calls without approval | Yes | | |

### Milestone-Completion Rhythm (manual, trigger any completed milestone)

| Step | Tool | Pass/Fail | Notes |
|------|------|-----------|-------|
| 1. Close on GitHub | set_github_issue_status | | |
| 2. Sync to app | sync_github_milestones | | |
| 3. Log cumulative count | log_metric(metric='milestones_done') | | |
| Readiness score moved after step 3 | check /progress page | | |
```

---

## 4. Critical Decisions

1. **`import "dotenv/config"` in-file** — preferred over `--env-file=.env` CLI flag; matches `prisma/seed.ts` convention; tsx CJS-transpile order ensures dotenv runs before db.ts module evaluation.
2. **`kind: "project"` must be explicit** — schema default is `"fitness"`; omitting this field would create a wrong goal that silently passes all validation and breaks MCP routing.
3. **`isFocus: false` explicit despite default** — PRD §2.3 is a covenant that Mt. Elbert keeps focus; making it explicit documents intent and survives any future schema-default change.
4. **Singleton `prisma` from `src/lib/db.ts`** — deviation from `seed.ts`'s standalone adapter pattern, but REQ-001 requires it for runtime consistency; the QA session confirmed tsx resolves `@/` aliases correctly from project root.
5. **`parseDateKey` imported from `src/lib/calendar`** — drags in a large transitive dep tree (program, records, db, etc.), but all are side-effect-free at eval time and DATABASE_URL is available; inline reimplementation was rejected in favor of import per REQ-001.
6. **`get_today_plan` first + `get_session_brief` for fitness** — resolves the tension: `get_today_plan` is the universal session-start call that exposes `activeGoal.kind` for routing; `get_session_brief` is then called on fitness sessions only for the rich opener. This preserves existing fitness session quality while adding project routing. The kind-routing block in instructions.ts states both steps explicitly.
7. **Stale claim auto-deleted** — "focus switching is app-UI only — no MCP tool exists" exists only in the short `route.ts` inline string. When that string is replaced with `COACH_INSTRUCTIONS`, the stale claim disappears automatically. The new `instructions.ts` adds `set_active_goal` covenant in its place.
8. **`status: "active"` and `active: true` set explicitly** — both match schema defaults, but REQ-001 enumerates them and explicit values survive default refactors.
9. **`githubProjectNumber: null` explicit** — no GitHub Projects v2 board exists yet; milestones are tracked at the issue/milestone level on the repo and mirrored via `externalRef` on `ScheduledItem`.
10. **`legend: null` at seed time** — the project goal's calendar legend (what icons render for scheduled items) should be set by the coach via `update_goal_legend` after the goal is created, using a project-appropriate preset. Seeding it now would lock in a value before the coach sees the goal.

---

## 5. File summary

| File | Action | Notes |
|------|--------|-------|
| `prisma/seed-chewgether.ts` | **CREATE** | Full file in §1 |
| `src/lib/mcp/instructions.ts` | **CREATE** | Full file in §2 |
| `src/app/api/mcp/route.ts` | **EDIT** | Add import; replace 7-line inline string with `instructions: COACH_INSTRUCTIONS` |
| `src/app/api/mcp/[token]/route.ts` | **EDIT** | Add import; delete `const COACH_INSTRUCTIONS = \`...\`` block (lines 84–115) |
| `docs/coaching/project-goal-prompts.md` | **CREATE** | Full file in §3 |
