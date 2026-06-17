# Proactive Coach — the "Sunday Brief" Routine (#99, story 3.3-b)

**Mechanism:** a Claude Code **scheduled cloud routine** (per spike `docs/roadmap/spike-proactive-coach.md`, Mechanism A). The routine reads the goaldmine MCP read tools, **reasons in the cloud** (the app stays LLM-free), and writes **one** coach nudge per week via `log_open_item` — which the in-app **/coach "Coach nudges"** surface (#98) then displays + lets you dismiss.

**Cost:** $0 — runs on the Claude Code Max subscription (counts against the daily routine-run cap; one weekly run is trivial). **No app code runs this** — it's claude.ai account config + the prompt below.

---

## One-time setup (do these once, in order)

### 1. Confirm the goaldmine MCP connector
The bearer-token connector you already use as the coach (`https://workout-planner-gold-three.vercel.app/api/mcp`, `Authorization: Bearer $MCP_AUTH_TOKEN`) is what the routine will use. Bearer-token HTTP MCP works headless (the "interactive-auth may be absent headless" caveat applies only to OAuth connectors, not a static token).

### 2. ⚠ Allow the Vercel domain in the routine's network environment (the easy-to-miss step)
By default a routine runs in a "Trusted" network env with an allowlist — a **custom domain returns `403 host_not_allowed`**. When creating the routine, open its **Environment → Network access → Custom**, add `workout-planner-gold-three.vercel.app`, and keep **"Also include default list"** checked. **Skip this and the routine silently fails every run.**

### 3. Create the routine
`/schedule` it for **weekly, Sunday ~8am America/Denver** (the schedule is entered in your local zone and converted automatically). Paste the **Routine Prompt** below. (The routine config lives on your claude.ai account, not this repo — this doc is the version-controlled source of truth for the prompt + setup.)

### 4. Verify
Use **"Run now"** on the routine (claude.ai/code/routines). Within a minute, open the app's **/coach** page — a "Coach nudge" should appear. Dismiss it to confirm the loop.

---

## The Routine Prompt (paste into `/schedule`)

```
You are my proactive fitness/goals coach for goaldmine. Run my weekly Sunday brief.

1. Read state via the goaldmine MCP tools:
   - get_session_brief  (focus goal, days-to-goal, open items, latest review)
   - compute_readiness  (score, ceiling, coverage, openGateCount, per-target breakdown)
   - get_goal on the focus goal (feasibility.computed: tier, weeksRemaining, per-target requiredRate vs observedRate, unratedReason)
   - For a project focus goal also: list_log_entries(metric='mrr') + list_scheduled_items(status='planned') (+ get_project_overview if a GitHub repo is linked)
   - list_open_items  (to dedup — see idempotency below)

2. Decide the SINGLE most important thing for me to focus on this week. Prefer, in order:
   - an open hard GATE that's the only thing capping the score at 80 ("your altitude gate is the only thing blocking 80 — let's plan the ≥12k-ft hike")
   - a metric going stale (no log in N days) that the feasibility/readiness needs
   - an overdue milestone / open item
   - a feasibility verdict worth surfacing ("at your current pace you reach ~62% by Sep 30 — this is a stretch")
   - if nothing is wrong: an honest "all clear" affirmation

3. IDEMPOTENCY — write at most ONE nudge per week:
   First call list_open_items and check for an existing unresolved item whose body starts with "[week:YYYY-Www]" for the CURRENT ISO week. If one exists, STOP (do not write a duplicate). Otherwise:

4. ALWAYS write exactly one nudge via log_open_item, even when all-clear:
   log_open_item({
     body: "[week:YYYY-Www] <one or two sentences, coach voice — the single focus, or 'All clear — you're on track for <goal>. Keep the streak going.'>",
     priority: "high"  // only when it's a real blocker; otherwise omit (normal)
     targetDate: <optional yyyy-mm-dd if there's a deadline, e.g. the gate hike>
   })
   Do NOT call any other write tool, do NOT switch the focus goal, do NOT change the plan. One read-only briefing + one nudge.

5. End by stating, in your run transcript, the nudge you wrote (so the routine log is auditable).
```

**Why "always write" matters (observability):** because the routine writes every week, **the absence of a recent nudge means the loop is broken** (a stale allowlist 403, a rotated token 401, or the routine being paused). The app's /coach surface shows a staleness warning when the newest nudge is >8 days old (#99 app-side), and the routine's full transcript at `claude.ai/code/routines` is the first place to check.

---

## Idempotency / dedup
The `[week:YYYY-Www]` body prefix is the dedup key. The routine checks `list_open_items` for an existing current-week item before writing, so re-runs (or a manual "Run now" plus the scheduled run) never double-post. Dismissing a nudge on /coach resolves it; the next week's nudge is a fresh `[week:...]`.

## What this routine does NOT do (separate stories)
- **Auto-prepare the recap post** (generate_recap_card + caption → "recap ready" nudge) — that's story 3.3-e / flywheel #94 (the SAME routine gains a step; build once).
- **Push/email delivery** (off-app reach) — deferred (3.3-f).
- **Richer per-signal prompt recipes** (gate/staleness/overdue/feasibility templates) — 3.3-c.

## Failure modes & fixes
| Symptom | Cause | Fix |
|---|---|---|
| No nudge appears after "Run now" | `403 host_not_allowed` | Add the Vercel domain to the routine env Allowed domains (setup step 2) |
| Tools fail / 401 | bearer token rotated | Update the connector token at claude.ai/customize/connectors |
| Duplicate nudges | dedup skipped | Ensure the prompt's `[week:YYYY-Www]` check + list_open_items runs first |
| /coach shows ">8 days, no coach nudge" | routine paused / broken | Check the transcript at claude.ai/code/routines; re-enable / fix network |
