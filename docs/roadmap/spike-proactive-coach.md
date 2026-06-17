# Spike — Proactive Coach Mechanism (#86, thread 3.3)

**Stamped:** 2026-06-17 · Spike (decision doc — NO code built here) · Board #8, Backlog
**Question:** how should the coach *initiate* (gate nudges, staleness alerts, an auto Sunday recap) instead of only reacting — at **$0**, with **no LLM in the app**, and USER_TZ-correct?

---

## 0. The core constraint that shapes everything
The app holds **no LLM** (verified: zero `anthropic`/`openai` imports; all reasoning is in claude.ai via MCP). So a proactive nudge needs two things the app cannot both provide:
1. **A reasoner** that decides a nudge is warranted (and writes it in coach voice).
2. **A surface** where the nudge lands so the user sees it without opening claude.ai.

The mechanism choice is really: *where does the reasoning happen, and how does its output reach the user.*

---

## 1. The two mechanisms

### Mechanism A — Claude Code scheduled cloud **routine** (`/schedule`)
A cloud agent runs on a cron, connects to the goaldmine MCP server (bearer-token HTTP), reads signal tools, **reasons** (it *is* an LLM agent — but it runs in the Claude Code cloud, NOT in the app, so "no LLM in the app" holds), and **writes a nudge back via an MCP write tool** that the app then displays.

Verified (Claude Code routines docs):
- **Cloud + cron + timezone:** runs without the laptop; schedule entered in local zone (set to `America/Denver`), wall-clock-correct. Min interval **1 hour** (fine for daily/weekly).
- **Bearer-token MCP works headless** — the "interactive-auth MCP may be absent headless" caveat applies to OAuth connectors, NOT a static bearer token. ✓
- **Network gotcha (one-time):** a custom domain (`workout-planner-gold-three.vercel.app`) returns `403 host_not_allowed` unless the routine's environment Network access = Custom + the domain added (keep "include default list"). Must be set before the first run.
- **Output surface:** call an MCP **write** tool to persist a nudge (cleanest) — or a Slack/email connector. No push API. Every run leaves a transcript at `claude.ai/code/routines`.
- **Cost: $0 incremental** — draws down the existing Claude Code Max subscription; a daily routine-run cap applies (a weekly/daily nudge is well within it).

### Mechanism B — In-app **cron** (Vercel) → MCP read tools → deterministic nudge
A Vercel cron route computes **rule-based** nudges from the data (no LLM — the app can't reason) and renders a digest.

- **Deterministic only:** the app can detect "altitude gate uncleared", "no MRR logged in 14d", "milestone overdue", "feasibility tier dropped" — but it **cannot phrase them as coaching** or synthesize ("your altitude gate is the only thing blocking 80 — let's plan the ≥12k hike"). They are alerts, not a coach noticing.
- **All net-new infra:** no `vercel.json`, no cron route, no rules engine exists today. USER_TZ math is available via `@/lib/calendar`.
- **Cost:** ~$0 (Vercel cron, hobby limits), but at the price of a worse, mechanical result.

---

## 2. Comparison

| Axis | A — Claude Code routine | B — in-app Vercel cron |
|---|---|---|
| **Reasoning** | ✅ full LLM coaching (synthesis, voice, the auto Sunday recap narrative) | ❌ deterministic rules only — alerts, not coaching |
| **"No LLM in the app"** | ✅ reasoning is in the cloud routine | ✅ (because it literally can't reason) |
| **Cost** | ✅ $0 (Max subscription; daily run cap) | ✅ ~$0 (Vercel cron) |
| **USER_TZ** | ✅ schedule in `America/Denver`; reasoning reads MCP (already TZ-correct) | ⚠️ cron fires UTC; rules must use `@/lib/calendar` |
| **New infra needed** | a nudge **write+display** path + one-time routine setup (network allowlist, connector) | cron route + rules engine + nudge display — all net-new |
| **Reliability gotchas** | network allowlist; bearer-token rotation; 1h min interval; daily run cap | cron misses nothing, but output quality is the ceiling |
| **Delivers the brief's vision** ("a coach that *notices*") | ✅ yes | ❌ no — it's an alarm clock, not a coach |

---

## 3. Recommendation — **Mechanism A (routine reasons → MCP write → app displays)**

The whole point of 3.3 is *a coach that notices* — that requires reasoning, which only A provides. A is **$0**, reuses the existing rich MCP read surface, and keeps the app LLM-free (the routine is the reasoner; the app only persists + renders the nudge it's handed). B's deterministic ceiling makes it the wrong tool for "coaching"; its only edge (always-on, no claude.ai dependency) is not worth building a second, inferior nudge system.

**The architecture:**
```
cron (Sun 8am MT)
  → routine connects to goaldmine MCP (bearer token)
  → reads get_session_brief + compute_readiness + get_goal.feasibility
      (project goals with a linked GitHub repo: + get_project_overview [GitHub pack, needs GITHUB_TOKEN]; else list_scheduled_items / list_log_entries)
  → REASONS → composes ONE coach nudge
  → writes it via an MCP write tool (a nudge the app stores)
  → app surfaces pending nudges on a dashboard card; user dismisses when handled
```
This is a **hybrid**: LLM reasoning (cloud routine) + deterministic display (app). It also subsumes 3.4's auto Sunday recap (the same routine can call `generate_recap_card`).

### The missing piece A needs: a nudge **persist + display** path
Today there is **no dashboard surface for coach-authored notes/open-items** and **no nudge type**. Two options for persistence:
- **Reuse `log_open_item`** — it already has `body`, `targetDate`, `priority`, an `overdue` flag, and a read tool (`list_open_items`). Lowest-effort; "open items" already mean "things to resolve." Risk: conflates coach nudges with user open items.
- **Add a `coach_nudge` Note type** (+ a `list_pending_nudges` read tool) — cleaner separation, works for any goal, has `resolvedAt` for dismiss. Slightly more work.
Recommendation: **start by reusing `log_open_item`** for the thin slice (zero schema change), and only graduate to a dedicated `coach_nudge` type if the surfaces need to diverge.

---

## 4. The thin slice to build first (prove the loop end-to-end, one nudge)
1. **Display:** a "Coach" card on Today (or flesh out the currently-static `/coach` page) that renders pending `open_item`s (overdue/priority first) with a dismiss action (`resolve_open_item`). *(net-new UI; reuses `list_open_items`/`resolve_open_item`.)*
2. **The routine:** ONE weekly routine — "Sunday brief": cron Sun 8am MT → `get_session_brief` + `compute_readiness` + `get_goal.feasibility` → reason → write **one** nudge via `log_open_item` (e.g. *"Altitude gate is the only thing blocking 80 — let's plan the ≥12k-ft hike."*). *(config + a prompt; no app code.)*
3. **One-time setup (documented in `docs/coaching/`):** add the Vercel domain to the routine env Allowed domains; confirm the bearer-token connector; `/schedule` the routine. Verify with "Run now" → a nudge appears on Today.
**Done when:** a real Sunday run writes a nudge that shows on Today and the user can dismiss it. One nudge type, end-to-end, before expanding.

---

## 5. Follow-up stories (decomposition — to materialize after this spike; NOT built here)
| # | Story | Effort | Notes |
|---|---|---|---|
| 3.3-a | Today "Coach" nudge card: render pending open-items (overdue/priority) + dismiss via `resolve_open_item` | Medium | net-new UI; reuses existing tools; mobile-first 390px |
| 3.3-b | "Sunday brief" routine + one-time setup doc (network allowlist, connector, `/schedule`) + **observability** | Medium | config + prompt in `docs/coaching/`; no app code. Mechanism A fails *silently* (a stale allowlist 403, a rotated token 401, or cloud account state produce no user-visible error). Mitigate: (1) make the routine ALWAYS write a nudge — even an "all clear" — so *absence of a recent nudge = the loop is broken*; (2) the app's Coach card shows the last-nudge timestamp and warns if it's >8 days stale; (3) the routine transcript at `claude.ai/code/routines` is the audit trail to check first. |
| 3.3-c | Nudge prompt library: gate-blocking-80, stale-metric (N days no log), overdue-milestone, feasibility-tier-drop — each a reasoning recipe the routine uses | Medium | grounds the coach voice; idempotency/dedup key per signal+week so it doesn't spam |
| 3.3-d | (graduation) dedicated `coach_nudge` Note type + `list_pending_nudges` read tool — only if open-item reuse proves too conflated | Small | additive schema + Zod enum |
| 3.3-e | Auto Sunday recap card from the same routine (`generate_recap_card`) — overlaps **#87** (content flywheel) | Medium | merge with 3.4 rather than duplicate |
| 3.3-f | (deferred) push/email delivery (PWA push or email connector) — out of the $0-simple core; only if "must reach user off-app" becomes a requirement | Large | net-new service-worker/push infra |

---

## 6. Constraints honored
- **$0:** routine runs on the Max subscription (daily run cap; a weekly Sunday brief is trivial within it). No new paid infra.
- **No LLM in the app:** the routine reasons; the app only persists (`log_open_item`) + renders (deterministic). Zero `anthropic`/`openai` in app code stays true.
- **USER_TZ:** routine cron in `America/Denver`; any in-app "days since / weeks left" math uses `@/lib/calendar`.
- **MCP is the surface:** the loop is entirely MCP read+write — no new app↔cloud channel.

## 7. Risks / open questions
- **Network allowlist** is a one-time manual step — easy to forget; document it as step 1 of 3.3-b (else silent `403 host_not_allowed`).
- **Idempotency/spam:** the routine must dedup (one nudge per signal per week) — bake into 3.3-c.
- **Bearer-token rotation** breaks the connector → update at `claude.ai/customize/connectors`.
- **Discoverability of nudges:** if the only surface is a Today card, a nudge is missed until the user opens the app — acceptable for v1 (the user opens the app daily); push delivery (3.3-f) is the escalation if not.
- **Routine config lives on the claude.ai account, not the repo** — document the routine prompt + schedule in `docs/coaching/` so it's recoverable/version-tracked even though the schedule itself isn't in git.
