# Devil's Advocate Critique — Spike #86: Proactive Coach Mechanism

**Reviewed:** `docs/roadmap/spike-proactive-coach.md`
**Reviewer role:** fact-checker / devil's advocate (read-only)
**Date:** 2026-06-17

---

## 1. Tool-Name Accuracy

### Verified as CORRECT

| Tool name (doc) | Exists in tools.ts? | Shape match? |
|---|---|---|
| `log_open_item` | YES (line 2400) | YES — `body` (required), `targetDate` (optional DateKey), `priority` (optional enum `high\|normal\|low`) |
| `list_open_items` | YES (line 1177) | YES — returns `{ id, body, targetDate, priority, overdue }[]`; `overdue` flag computed from `startOfDay(now)` |
| `resolve_open_item` | YES (line 2437) | YES — takes `id: string` and `reason: string`; enforces `type === "open_item"` guard |
| `get_session_brief` | YES (line 1224) | YES |
| `compute_readiness` | YES (line 915) | YES — optional `goalId`, optional `asOf` |
| `get_goal` | YES (line 817) | YES — returns `feasibility: { computed, coach }` |
| `generate_recap_card` | YES (line 4760) | YES — `weekOffset`, `goalId`, `template`, `highlight` |

### INACCURACY FOUND: `get_project_overview` does not exist

**Doc claim (Section 3 architecture diagram):**
> `reads get_session_brief + compute_readiness + get_goal.feasibility (+ get_project_overview for project goals)`

**Reality:** No tool named `get_project_overview` is registered anywhere — not in `src/lib/mcp/tools.ts`, not in `src/lib/mcp/tools/project-tools.ts`. The project-goal read surface consists of: `list_scheduled_items`, `log_metric`, `list_log_entries`, `set_active_goal`, plus `get_goal` and `get_session_brief`.

**Correction:** Remove `get_project_overview` from the architecture diagram and replace with the actual project-goal read tools (e.g., `list_scheduled_items`, `list_log_entries`). Alternatively, flag it as a tool that does not yet exist and add a follow-up story to create it if the routine genuinely needs a project-overview roll-up.

**Severity:** Medium. The thin slice (fitness, Sunday brief) is unaffected — this only matters for project-goal routines. But a reader implementing the routine from the doc would hit a "tool not found" error for the project path.

---

## 2. The "Reuse log_open_item for the Thin Slice" Claim

**Doc claim (Section 3):** `log_open_item` + `list_open_items` + `resolve_open_item` form a complete persist→display→dismiss loop with no schema change.

**Verdict: CORRECT.** All three tools exist with matching shapes. The persist side (`log_open_item`) hardcodes `type: "open_item"` in the Note row. The read side (`list_open_items`) queries `{ type: "open_item", resolvedAt: null }`. The dismiss side (`resolve_open_item`) enforces `type === "open_item"` and sets `resolvedAt`. The schema's `Note.type` is an unconstrained `String`, so the `open_item` value is already live. Zero schema migration needed for the thin slice.

One nuance: `NoteTypeShape` in tools.ts is `z.enum(["journal", "audible", "feedback", "standing_rule", "review"])` — it does NOT include `"open_item"`, which is intentional (open items have their own tool surface). This doesn't create a gap; it just means the `log_note` tool can't accidentally create an open item — the dedicated `log_open_item` tool does.

**No correction needed.**

---

## 3. No-LLM-in-App Integrity

**Doc claim (Section 1 / Section 6):** The routine reasons; the app only persists (`log_open_item`) + renders (deterministic). Zero `anthropic`/`openai` in app code stays true.

**Verdict: CORRECT.** Confirmed by grep-and-read of the app codebase. The app has no AI SDK imports. The routine is a Claude Code cloud agent — it runs in the Claude Code cloud, not inside the Next.js app. The "no LLM in the app" invariant is structurally preserved.

**No correction needed.**

---

## 4. Routine Capability Claims

The doc makes five "Verified" claims about Claude Code routines. All are consistent with the research in the CLAUDE.md project file and are defensible. However, one is an operational overclaim and one is understated as a risk:

### 4a. "Daily run cap" is understated

**Doc:** "Cost: $0 incremental — draws down the existing Claude Code Max subscription; a daily routine-run cap applies (a weekly Sunday brief is trivial within it)."

**Challenge:** The doc treats the daily run cap as clearly adequate without stating the cap number. If the daily cap is, say, 5 runs and the user wants a Sunday brief AND a mid-week check-in AND an ad-hoc run, the cap could constrain the design. The doc says "weekly" but the follow-ups (3.3-c) imply multiple signal types per run — a multi-signal run has a higher token cost than a single-nudge run. This is probably fine for the thin slice but warrants a note that multi-signal prompt libraries (3.3-c) could approach the cap faster than "one Sunday brief."

**Correction:** Add a parenthetical: "(exact daily cap not published; verify for multi-signal prompt library in 3.3-c before committing to daily runs)."

### 4b. "Bearer-token works headless" claim

**Doc:** "the 'interactive-auth MCP may be absent headless' caveat applies to OAuth connectors, NOT a static bearer token. ✓"

**Verdict: CORRECT** and well-reasoned. Static bearer tokens don't require an OAuth callback. No correction needed.

### 4c. Routine config not in repo

**Doc (Section 7):** Acknowledged honestly. ✓

---

## 5. Recommendation Soundness (A over B)

The core argument is: B's deterministic ceiling makes it the wrong tool for "coaching"; A gets the LLM reasoning while keeping the app LLM-free. This logic is sound.

### What the doc underweights for Mechanism B

The doc's comparison table lists B's reliability advantage as "cron misses nothing, but output quality is the ceiling" — but it doesn't say what "cron misses nothing" actually means in context: **B never silently fails.** Mechanism A has three recurring failure modes the doc treats as one-time setup problems when they are actually ongoing operational risks:

1. **Network allowlist decay:** if the Vercel deployment URL changes (e.g., a new preview URL, a domain change), the routine silently returns `403 host_not_allowed` on every Sunday run until manually reconfigured. The doc mentions this as a one-time setup step but does not acknowledge it as a recurring break risk if the deployment URL changes.

2. **Bearer-token rotation:** when the MCP auth token rotates (intentional security hygiene or forced rotation), the connector breaks silently. The routine calls the MCP server, gets a 401, and produces no nudge. The user has no notification that this happened. The doc mentions this in Section 7 but treats it as an edge case.

3. **Claude.ai account/routine state dependency:** if the routine is deleted, paused, or corrupted on the claude.ai account side (account migration, UI change, accidental deletion), the user gets no nudge and no error. The doc acknowledges the "routine config lives on the claude.ai account, not the repo" problem but frames it as a documentation concern, not a reliability concern.

**These three risks compound:** A routine can fail silently for weeks before the user notices ("coach hasn't said anything lately..."). Mechanism B would never do this. The doc should make this trade-off explicit in the comparison table.

**Recommended correction:** Add a row to the comparison table: "Silent failure mode | A: yes (network, token, account state) | B: no (Vercel cron is always-on)."

### Is the hybrid framing honest?

Yes. The doc correctly calls this a hybrid (LLM reasoning + deterministic display) and does not overclaim that the app itself gains any reasoning capability.

### Is "B is an alarm clock, not a coach" a fair dismissal?

Yes, for the stated goal of 3.3 ("a coach that *notices*"). B's deterministic rules could detect "altitude gate uncleared" but can't compose "the altitude gate is the only thing blocking 80 — let's plan the ≥12k hike" in coach voice. The dismissal is appropriate given the brief's scope.

---

## 6. Decomposition Quality

### Stories 3.3-a through 3.3-f

| Story | Buildable? | Right-sized? | Overlap? |
|---|---|---|---|
| 3.3-a (Today "Coach" nudge card) | YES | Medium = reasonable | None flagged |
| 3.3-b (Sunday brief routine + setup doc) | YES | Medium = reasonable | None flagged |
| 3.3-c (Nudge prompt library + dedup key) | YES | Medium = reasonable | Subsumes idempotency concern |
| 3.3-d (graduate to `coach_nudge` type) | YES | Small = reasonable | None |
| 3.3-e (Sunday recap card) | YES | Medium = reasonable | Overlap with #87 CORRECTLY FLAGGED |
| 3.3-f (push/email delivery) | YES | Large = reasonable | None |

### Missing story: verification/observability

The thin slice (Section 4) says "Verify with 'Run now' → a nudge appears on Today." But there is no follow-up story for **how the user knows a routine run succeeded or failed in production**. The only observability is manual transcript inspection at `claude.ai/code/routines`. If the Sunday routine silently fails for three weeks, the user has no automated signal. A story for "add a run-completed open item or log entry as a heartbeat" (or at minimum, documented manual verification steps in 3.3-b) would close this gap. This is missing.

**Recommended addition:** A sub-bullet in 3.3-b: "Document how to verify Sunday runs succeeded (link to transcript URL, what a failed run looks like, how often to audit)." Or a dedicated lightweight story between 3.3-b and 3.3-c.

### Idempotency coverage

The doc's concern about spam/dedup (Section 7) is baked into 3.3-c as "idempotency/dedup key per signal+week." This is technically sufficient (one story, one concern) but dedup is complex enough — what is the key? how is it stored? who enforces it on re-run? — that it could warrant its own story. This is a judgment call; including it in 3.3-c is defensible.

---

## 7. Scope / AC Completeness

The spike's AC: compare + recommend + decompose, NOT build.

| AC item | Met? |
|---|---|
| Compare both mechanisms | YES — Section 1 + 2 |
| Recommend one | YES — Section 3 |
| Decompose into stories | YES — Section 5 |
| No code written | YES — doc only |

All AC met. ✓

---

## 8. One Additional Concern: `get_goal.feasibility` notation

The doc's architecture diagram writes `get_goal.feasibility` as if it were a separate MCP call. It is not — `feasibility` is a field returned by the `get_goal` tool. The notation is slightly ambiguous (a reader might interpret it as a distinct `get_goal_feasibility` tool). The correct call is `get_goal(goalId)` and reading `result.feasibility.computed`. This is minor but could confuse an implementer.

---

## Summary of Inaccuracies

| # | Doc claim | Real fact | Severity | Correction |
|---|---|---|---|---|
| 1 | `get_project_overview` is a readable MCP tool for project goals | Tool does not exist | Medium | Remove reference; replace with `list_scheduled_items` + `list_log_entries`, or add a story to create it |
| 2 | Network allowlist + token rotation are one-time setup risks | Both are recurring silent-failure modes with no automatic recovery | Low–Medium | Add "Silent failure mode" row to comparison table; be explicit that A can break and self-heal only with manual intervention |
| 3 | Routine run cap is "trivially" satisfied by a weekly brief | Cap value unstated; multi-signal prompt library (3.3-c) may approach cap | Low | Add parenthetical noting cap should be verified for multi-signal runs |
| 4 | `get_goal.feasibility` notation (minor) | A field on `get_goal`'s result, not a separate tool call | Trivial | Rewrite as `get_goal(goalId) → read .feasibility.computed` |

---

## Verdict

**APPROVE-WITH-FIXES**

The recommendation (Mechanism A over B) is logically sound and well-argued. The decomposition covers the ground. The doc correctly acknowledges the key risks and flags 3.3-e overlap. The fundamental claim that the thin slice needs no schema change is correct.

**Single most important correction:** Remove `get_project_overview` from the architecture diagram (Section 3). It does not exist. A routine implementing the doc's project-goal read sequence would fail at the MCP call. Replace with `list_scheduled_items` + `list_log_entries`, or explicitly scope the thin slice to fitness goals only and defer the project-goal path to a future story.

**Strongest counter-argument to the recommendation:** The doc underweights Mechanism A's silent-failure reliability risk. A Sunday brief that silently fails (403 from a stale allowlist, 401 from a rotated token, account-state issue) leaves the user with no nudge and no error. This isn't a reason to choose B (B's deterministic ceiling is disqualifying for coaching), but it IS a reason to add observability to 3.3-b so failures are caught before the user wonders why "the coach has been quiet."
