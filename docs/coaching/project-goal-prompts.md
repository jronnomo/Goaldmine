# Chewgether Coaching Prompts

Canonical prompt set for project-goal sessions in claude.ai. Each prompt assumes
the Chewgether goal is seeded and at least one GitHub milestone is synced.

---

## Prerequisites

| Condition | How to verify | Required for |
|-----------|--------------|-------------|
| Chewgether goal seeded | `list_goals` returns kind='project' goal with `githubRepo='jronnomo/Chewgether'` | All 3 prompts |
| At least 1 ScheduledItem synced | `list_scheduled_items(goalId=<chewgether_id>)` returns rows | Prompt 1, 3 |
| At least 1 LogEntry(metric='mrr') | `list_log_entries(goalId=<chewgether_id>, metric='mrr')` returns rows | Prompt 2 |
| GitHub connector configured (GITHUB_TOKEN in env) | `get_project_overview(goalId=<chewgether_id>)` succeeds | Prompt 1, 3 |
| [v2] Chewgether is the focus goal (for routing) | `set_active_goal(goalId=<chewgether_id>)` called and approved, or confirmed via `get_today_plan` → `activeGoal.kind='project'` | All 3 prompts (see focus note below) |

### [v2] Focus state note — two operating modes

All project tools (`get_project_overview`, `list_project_issues`, `set_github_issue_status`,
`sync_github_milestones`, `log_metric`, `list_log_entries`, `list_scheduled_items`) take
`goalId` as their first parameter and work correctly regardless of which goal is in focus.
Claude can discover the Chewgether `goalId` via `list_goals` at any time.

The focus state only affects `get_today_plan`'s routing signal (`activeGoal.kind`):
- If Mt. Elbert is focus (`kind='fitness'`), the routing block directs Claude to fitness tools.
  Claude will still execute project prompts correctly if the user's intent is clear, but may
  not auto-sequence project tools from session start. For clean project sessions, switch focus.
- If Chewgether is focus (`kind='project'`), the routing block activates the project tool pack
  immediately and project prompts run without ambiguity.

**Recommended**: when a session is clearly project-centric (running all 3 prompts, doing a
weekly review, or tracking a milestone), propose `set_active_goal(goalId=<chewgether_id>)`
at session start. End the session by restoring Mt. Elbert to focus:
`set_active_goal(goalId=<mt_elbert_id>)`.

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
1. `get_today_plan` — confirm `activeGoal.kind` + routing (or `list_goals` to discover `chewgether_id` if kind='fitness')
2. `list_log_entries(goalId=<chewgether_id>, metric='mrr', limit=4)` — MRR trend, last 4 entries, chronological [v2]
3. `list_scheduled_items(goalId=<chewgether_id>, status='planned')` — milestone burn (planned count)
4. `list_scheduled_items(goalId=<chewgether_id>, status='done')` — completed milestone count
5. `get_project_overview(goalId=<chewgether_id>)` — open PRs + issue summary [v2: was `repo='jronnomo/Chewgether'`, no such param]
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
1. `get_today_plan` — confirm goal routing (or `list_goals` to discover `chewgether_id`)
2. `log_metric(goalId=<chewgether_id>, metric='mrr', value=<AMOUNT>)` — log immediately
3. `list_log_entries(goalId=<chewgether_id>, metric='mrr')` — pull trend after logging
4. `compute_readiness(goalId=<chewgether_id>)` — live per-target breakdown including MRR weight contribution [v2: was `get_goal` which returns raw targets, not the scored breakdown]
5. Natural-language summary with delta to target and trajectory

**Expected response shape**:
- Confirmation: "Logged $X MRR on [date]."
- Progress: current / target (e.g. "$350 / $1,000 — 35%")
- Trend: last 3 data points with dates
- Readiness score: overall 0-100 + MRR contribution (progress × weight 0.6 → X points)

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
1. `get_today_plan` — confirm goal routing (or `list_goals` to discover `chewgether_id`)
2. `list_project_issues(goalId=<chewgether_id>, state='open')` — filter for urgent/blocking labels [v2: was `repo='jronnomo/Chewgether'`, no such param]
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

1. **Close on GitHub**: `set_github_issue_status(goalId=<chewgether_id>, issueNumber=<N>, state='closed')` [v2: was `repo=` / `issue=` — no such params; verified against github-tools.ts inputSchema]
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
| Coach reads MRR history | `list_log_entries(goalId=..., metric='mrr', limit=4)` | | |
| Coach reads milestone burn | `list_scheduled_items(goalId=...)` | | |
| Coach reads GitHub | `get_project_overview(goalId=...)` | | |
| Response includes MRR table | Yes | | |
| Response includes milestone table | Yes | | |
| No write calls without approval | Yes | | |

### Prompt 2 — MRR Check-in

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach calls log_metric immediately | `log_metric(goalId=..., metric='mrr')` | | |
| Coach calls compute_readiness (not get_goal) | `compute_readiness(goalId=...)` | | |
| Coach shows progress to $1k target | Yes | | |
| Readiness score + MRR contribution mentioned | Yes (weight=0.6) | | |
| Trend table shown | Yes | | |

### Prompt 3 — Blocking-Issue Scan

| Check | Expected | Pass/Fail | Observed tool sequence |
|-------|----------|-----------|----------------------|
| Coach scans GitHub issues | `list_project_issues(goalId=...)` | | |
| Coach checks overdue milestones | `list_scheduled_items(goalId=..., status='planned')` | | |
| Coach checks open items | `list_open_items` | | |
| Overdue milestone triggers completion proposal | Yes (if any overdue) | | |
| No write calls without approval | Yes | | |

### Milestone-Completion Rhythm (manual, trigger any completed milestone)

| Step | Tool | Pass/Fail | Notes |
|------|------|-----------|-------|
| 1. Close on GitHub | `set_github_issue_status(goalId=..., issueNumber=N, state='closed')` | | |
| 2. Sync to app | `sync_github_milestones(goalId=...)` | | |
| 3. Log cumulative count | `log_metric(goalId=..., metric='milestones_done')` | | |
| Readiness score moved after step 3 | check /progress page | | |
