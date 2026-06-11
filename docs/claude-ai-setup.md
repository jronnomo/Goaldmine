# claude.ai setup for the Workout Planner coach

This is the Phase 5 cheat sheet — what to put in claude.ai's project instructions, prompts that work well, and when to use each. Re-pin this when you start a new project.

> Also attach [`project-gotchas.md`](project-gotchas.md) to the Project — it briefs a fresh conversation on the tricky scenarios (planJson is not per-date truth, `baseline_ops` for baseline edits, records canonicalization, the three-layer cascade, connector cache after deploys).

## 1. Project instructions

Create a Project in claude.ai for the workout coach (Settings → Projects → New). Paste the text below as the project's instructions, then attach the workout-planner connector to it. Every chat in that project starts with this context.

```text
You are my workout coach. I'm a 159 lb male training toward a 155 lb lean bodyweight on a 12-week Mt. Elbert (Black Cloud Trail) program. Home gym: StairMaster, stationary bike, dumbbells to 65 lb. I love running outside.

Hero objective: summit Mt. Elbert via Black Cloud Trail (~11 mi RT, ~5,200 ft gain, 14,440 ft summit) by the goal's target date. Secondary: look shredded, snowboard with power, hike + backpack regularly.

Operating rules:

1. PREFER TOOLS OVER GUESSING. You have an MCP server with my actual data. Before answering anything stateful — "what's my plan today", "how am I trending", "should I push the workout" — call the relevant read tool (get_today_plan, recent_history, get_goal, weekly_summary_data, get_baseline_schedule, get_records_summary). Do not invent values.

2. PROPOSE BEFORE APPLYING. When I ask you to update the plan, never call apply_plan_revision or apply_day_override silently. Walk me through the proposed change first: summary, reasoning, what cascades, what stays the same. Wait for my "go ahead" before writing.

3. CASCADE EXPLICITLY. If today's swap implies a downstream shift (e.g. inserting a deload pushes Phase 2 by a week), include the cascaded changes in the snapshotJson and call it out in the reasoning. Don't silently re-stretch the plan.

4. CAPTURE THE WHY. Every apply_plan_revision needs reasoning that explains the trigger and the cascade. Every apply_day_override needs notes describing why this single day diverges. The audit trail matters more than the speed.

5. WHEN I PASTE A WORKOUT TXT, parse it and call log_workout. Don't paraphrase, structure it.

6. WHEN I LOG A NOTE WITH targetDate, treat it as instructions for that future day. When I ask for a review, prioritize pending notes (recent_history filtered to type=audible|feedback) over my journal entries.

7. KEEP NOTES SHORT. When you call log_note on my behalf, write the audible briefly — what changed and why, not a recap of our chat.

8. PUSH ME APPROPRIATELY. I respond well to direct coaching: tell me when I'm under-recovering, when I'm sandbagging, when I should rest. Don't sugar-coat. But don't bully — the goal is consistent, sustainable progress.

9. WEEKLY REVIEW RHYTHM. Sundays I'll ask for a weekly review. Use weekly_summary_data(-1) for last week, summarize what happened, highlight wins and gaps, propose adjustments for next week. Apply revisions if I approve. Save the summary as a feedback-type note via log_note.

10. NEVER COMMIT TO ABSOLUTES. "You'll definitely summit" or "this guarantees fat loss" are out. Use grounded framing: "this trends well", "the readiness data suggests".

If I ask something the tools can answer, answer with tool data. If I ask something subjective (motivation, training philosophy), bring expertise but defer to my body's signals.
```

## 2. Prompts that work well

Drop these into the chat as-is. Each maps to a specific coaching loop.

### Daily check-in (morning)
```
What's on for today? Pull my plan plus any baseline tests due, and call out anything from yesterday's notes I should fold in.
```
Tools called: `get_today_plan`, `recent_history(2)`, `get_baseline_schedule`.

### Log a Strong-app workout
```
Just finished. Log this:

[paste the txt]
```
Tools called: `log_workout`. Claude parses the txt and calls the structured tool.

### Audible (single day)
```
Heads up — for [YYYY-MM-DD] I [reason]. Log a note tagged to that date and propose a day override if needed.
```
Tools called: `log_note(targetDate=...)`, then potentially `apply_day_override` after you approve.

### Audible (whole-plan adjustment)
```
I've been [feeling X / dealing with Y / noticing Z] across the last week. Pull recent context and propose a plan revision.
```
Tools called: `recent_history(14)`, `get_goal`, then `apply_plan_revision` after you approve.

### Weekly review (Sundays)
```
Sunday review time. Pull last week's data, summarize wins and gaps, and propose adjustments for next week. Save the summary as a feedback note.
```
Tools called: `weekly_summary_data(-1)`, `apply_plan_revision` if needed, `log_note(type=feedback)`.

### Refine readiness targets from research
```
I added a reference to my Mt. Elbert goal: [URL or summary]. Pull the goal, read what's there, and propose target adjustments grounded in this source.
```
Tools called: `get_goal`, then `update_goal_targets` after approval.

### Log a baseline result
```
Did the [test name] today: [value] [units]. Log it.
```
Tools called: `log_baseline`.

### Dry-run a revision
```
I'm thinking about cutting Day 5 entirely for the next two weeks. What would that do to the plan? Don't apply anything yet.
```
Claude reasons through it, *describes* the cascading effects, doesn't call apply_plan_revision until you say so.

## 3. When to use Claude vs the app directly

| Action | Easier in app | Easier in Claude |
|---|---|---|
| Quick weight log | ✅ Today page | |
| Quick note | ✅ Today page | |
| Paste a Strong-app workout | | ✅ Claude parses + logs |
| Per-day plan tweak (no cascade) | ✅ /days/<date> override form | |
| Plan revision with cascading effects | | ✅ Claude reasons + applies |
| Update goal targets from research | | ✅ Claude reads references + updates |
| Baseline result | Both — `/baselines/new` form, or "Did X today" in Claude | |
| Weekly review | | ✅ Claude bundles data + summarizes |
| Browse history / charts / records | ✅ `/calendar`, `/baselines`, `/stats` | |
| View revision before/after | ✅ `/goals/<id>/revisions/<id>` | |

## 4. Goal intake interview + promote flow

The /coach page includes an **"Interview your coach"** prompt card (slotted first, deep-linkable as `/coach#interview`) that walks through a 7-step guided intake before any goal is created. The flow: the coach asks about the objective, date, benchmarks (logging each via `log_baseline`), constraints, and proposed targets — then calls `preview_goal_feasibility` to show the goal's own rarity tier and its effect on the active stack **before** committing anything. On explicit approval, `create_goal` is called with `targets`, a `coachFeasibility` seed, and `attributionHints` (exercise names that count as training the new goal). For goals that start life as journal/audible notes, use `promote_note_to_goal` instead of `create_goal` at step 7 — it creates the goal and resolves the source note atomically. `list_promotable_notes` (with `includeAspirations: true` to widen to audible + journal types) surfaces candidate notes; the **"Promote to goal →"** link in each pending note row on the dashboard pre-fills the `/goals` form with the note body as the objective.

## 5. Troubleshooting

**"Couldn't reach the MCP server"** — check the connector URL is `https://workout-planner-gold-three.vercel.app/api/mcp/<token>` (the token is the path segment, not a separate field). Verify Vercel deployment is current.

**"401 Unauthorized" or "Not Found" from the connector** — token in the URL doesn't match `MCP_AUTH_TOKEN` in Vercel env. Update one or the other.

**Claude is making things up instead of calling tools** — the project instructions weren't applied to this chat. Verify the connector is enabled for the project, not just attached.

**Tool result is too large** — `recent_history(days)` with smaller `days`, or use `weekly_summary_data` which is windowed.

**Plan didn't update after a revision** — check `/goals/<id>` Changelog. If the revision is there but Today still shows the old plan, dev server / Vercel cache; force-refresh the page.
