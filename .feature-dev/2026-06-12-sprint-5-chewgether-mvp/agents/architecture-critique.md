# Architecture Critique — Sprint 5: Chewgether MVP
**Produced by**: Devil's Advocate Agent · **Date**: 2026-06-12
**Attack target**: `architecture-blueprint.md` + PRD + requirements

---

## VERDICT

**CONDITIONAL PASS — two doc-layer corrections are blocking; apply before handing to users.**

The blueprint is architecturally sound: the 13 fitness rules are retained verbatim, the dotenv/import order is safe, the seed targets satisfy GoalTargetSchema, and the readiness math produces score=18 as expected. Three specific errors in the prompts doc (REQ-003) will cause Zod validation failures or misleading validation checklists if uncorrected. One of them (wrong tool for readiness) will cause the coach to silently call the wrong MCP tool during E2E validation. Fix these before the ops runbook.

---

## CRITICAL (blocking — fix before agent hands off)

### CRIT-1 — Prompts doc uses `repo=` / `issue=` params that don't exist on three GitHub tools

**What**: `docs/coaching/project-goal-prompts.md` (blueprint §3) contains three tool invocations with parameter names that are not in the registered schema:

| Location in doc | As written | Actual schema param |
|-----------------|-----------|---------------------|
| Prompt 1 step 5 | `get_project_overview(repo='jronnomo/Chewgether')` | `goalId: z.string()` |
| Prompt 3 step 2 | `list_project_issues(repo='jronnomo/Chewgether', state='open')` | `goalId: z.string()` |
| Milestone-completion step 1 | `set_github_issue_status(repo='jronnomo/Chewgether', issue=<N>, state='closed')` | `goalId: z.string(), issueNumber: z.number().int()` |

Confirmed from `src/lib/mcp/tools/github-tools.ts` lines 444–449 (`get_project_overview`), 580–583 (`list_project_issues`), 839–856 (`set_github_issue_status`). All three tools resolve their repo via `resolveLinkedGoal(input.goalId)` — a `repo` param is not in any Zod schema.

**Why it matters**: (a) If a user pastes any of these invocations as coaching context, the tools throw Zod validation errors before hitting the handler. (b) The validation checklist compares "observed tool sequence" against the expected. When Claude (correctly) calls these with `goalId=`, the observed output will diverge from the doc's expected sequence, producing phantom FAIL marks and obscuring whether the coaching system is actually broken. This undermines REQ-005/006 entirely.

**Fix**: Replace all three with `goalId`-based invocations. Also update the milestone-completion rhythm `issue=<N>` → `issueNumber=<N>`.

---

### CRIT-2 — Prompts doc Prompt 2 step 4 uses wrong tool for readiness score

**What**: Prompt 2 expected tool sequence, step 4 reads: "`get_goal(id=<chewgether_id>)` — read readiness score (targets.log:mrr progress)."

The expected response shape then says: "Readiness contribution from MRR metric (weight 0.6 → X points toward total)."

**Why it matters**: `get_goal` returns raw `targets` JSON and a `feasibility` tier — it does NOT call `computeReadiness` and does NOT return a per-target score breakdown. The readiness breakdown (current value, progress ratio, weighted contribution) comes exclusively from `compute_readiness(goalId=...)` (confirmed at `src/lib/mcp/tools.ts` line 907). Claude will call `compute_readiness` (correct), but because the doc says `get_goal`, the user's validation checklist will show a tool-sequence mismatch on every run of Prompt 2. The user cannot distinguish "coaching broke" from "doc is wrong."

**Fix**: Replace step 4 with `compute_readiness(goalId=<chewgether_id>)`. Update the checklist row accordingly.

---

## HIGH (should fix before ops)

### HIGH-1 — Missing prerequisite: Chewgether must be in focus before project prompts work

**What**: The prompts doc prerequisites table (blueprint §3) does not mention that Chewgether must be the focus goal (`isFocus=true`) for goal-kind routing to activate project tools. Without `set_active_goal` being called first, `get_today_plan` returns `activeGoal.kind='fitness'` (Mt. Elbert is the seeded focus) and the routing block directs Claude to fitness tools.

**Why it matters**: The three canonical prompts — weekly launch review, MRR check-in, blocking-issue scan — are written as if project routing is active. If the user runs them with Mt. Elbert in focus, Claude will either (a) call fitness tools, silently ignoring the Chewgether intent, or (b) detect the intent mismatch and propose a focus switch (smart but undocumented). Neither produces the expected tool sequence. The REQ-006 E2E runbook includes a `set_active_goal` context-switch step, but REQ-003 (prompts doc) doesn't link to it.

**Fix**: Add a 4th prerequisite row: "Chewgether is the focus goal | `set_active_goal(goalId=<chewgether_id>)` called and approved | All 3 prompts." Also add a note that each prompt session ends with restoring Mt. Elbert to focus.

---

### HIGH-2 — Epic tools lose instructions-level discoverability on Bearer-token route

**What**: The current `src/app/api/mcp/route.ts` instructions (lines 31–32) explicitly reference six real registered tools: `get_rarity` (line 2012), `preview_goal_feasibility` (4648), `set_goal_feasibility` (4509), `set_goal_tracked` (4588), `set_plan_active` (4616), `promote_note_to_goal` (3322). All confirmed in `src/lib/mcp/tools.ts`. The new `COACH_INSTRUCTIONS` does not mention any of them. When the Bearer-token route replaces its inline string with `COACH_INSTRUCTIONS`, these six tools lose their primary instructions-level advertisement.

**Why it matters**: The live connector (`[token]/route.ts`) never mentioned these tools either, so they were already undiscovered via claude.ai. But the Bearer-token route (`route.ts`) did advertise them. After the sprint, both routes are byte-identical with no mention. The tools remain callable via `tools/list`, so functionality is preserved — but instructions-driven discoverability is permanently lost on both routes.

**Severity rationale**: Functional impact is low (tools still work). But these are legitimate goal-management tools (`set_goal_tracked`, `set_plan_active`) whose primary surfacing mechanism was the route.ts instructions string. Consider adding a brief mention of goal-management tools to `COACH_INSTRUCTIONS` rule 11 or a new rule 14.

---

### HIGH-3 — `get_session_brief` description contradicts new routing mandate

**What**: `get_session_brief` tool description (confirmed at `src/lib/mcp/tools.ts` line 1221): "Call this FIRST in a fresh chat instead of stitching together get_today_plan + recent_history + get_goal." The new `COACH_INSTRUCTIONS` routing block says: "Read get_today_plan first on every session start." For fitness sessions, the instructions then add: "follow get_today_plan with get_session_brief."

**Why it matters**: A well-aligned coach reading both the instructions string AND the `get_session_brief` tool description encounters contradictory session-start directives. The tool description says "call me INSTEAD of get_today_plan"; the instructions say "call get_today_plan BEFORE me." In practice the coach follows the instructions over the tool description, but this creates ambiguity that could cause some sessions to skip `get_today_plan` (losing standing-rule bodies and the full prescription) or occasionally call it redundantly.

**Fix**: Update `get_session_brief`'s tool description to read "Call after get_today_plan in a fresh fitness chat — delivers history, weight trend, standing-rule headers, latest review, open items, and week conflicts in a single call. See COACH_INSTRUCTIONS for the full session-start sequence." This requires an edit to `tools.ts`, not instructions.ts, but it eliminates the contradiction.

---

## CONCERNS (medium — note before shipping)

### CONCERN-1 — Dotenv/import order: confirmed safe, but singleton differs from seed.ts pattern

The blueprint claims `import "dotenv/config"` at line 1 of `seed-chewgether.ts` runs before `db.ts` evaluates — correct. tsx uses esbuild in non-bundling transpile mode; CJS require() order preserves source-text import order. However, `db.ts` evaluates at module load via `export const prisma = globalForPrisma.prisma ?? createClient()`, and `createClient()` reads `process.env.DATABASE_URL`. Since dotenv/config is imported first, DATABASE_URL is set before `db.ts` is required. `calendar.ts` is required third — its re-import of `db.ts` hits the module cache (already initialized).

The deviation from `seed.ts`'s standalone client is documented. The blueprint says "QA session confirmed" — trust, but flag: if tsx ever changes default output format from CJS to ESM, static import ordering changes and this guarantee breaks. Current risk: none. Future risk: low.

### CONCERN-2 — Burn-down never visible on /progress without explicit focus switch

`/progress` renders `MilestoneBurnDown` only when `focusProjectGoal` (isFocus=true AND kind='project') exists. Chewgether is seeded with `isFocus=false`. The milestone burn-down will never appear on the progress page unless the user manually switches focus. The readiness CARD for Chewgether DOES appear (page queries `active=true`). PRD §2.3 amendment explicitly keeps Mt. Elbert in focus, so this is by design — but the sprint success criteria ("7 milestones visible in items/burn-down/calendar/plan") implies burn-down visibility without noting the focus-switch prerequisite.

### CONCERN-3 — Milestone cumulative count covenant is human-enforced only

Instructions say `log_metric(metric='milestones_done', value=<new cumulative count>)`. The tool stores whatever number is passed (no validation against prior entries, no increment logic). If the coach accidentally logs 1 (delta) instead of the cumulative count, `progressFor` computes 1/7 regardless of actual milestones completed. The deviation from expected behavior is silent until someone manually audits LogEntry rows. Low probability but impossible to detect automatically.

### CONCERN-4 — Idempotency guard is case-sensitive at the brand name boundary

Guard: `objective: { contains: "Chewgether" }` — Postgres uses LIKE (case-sensitive, ILP collation). The seeded objective is "Ship Chewgether to the App Store + reach $1,000/mo MRR". Re-runs are safe. Edge case: if the objective is manually edited via DB to "chewgether" (lowercase), the guard fails and the seed creates a duplicate. Extremely low probability; the brand name is always capitalized. Document in the seed's header comment: "Do not lowercase the brand name in objective — idempotency guard is case-sensitive."

### CONCERN-5 — Readiness math verified: score = 18 confirmed

With test data mrr=200 (LogEntry), milestones_done=1 (LogEntry):
- `progressFor` for `log:mrr`: build-from-zero path → 200/1000 = 0.2
- `progressFor` for `log:milestones_done`: build-from-zero path → 1/7 ≈ 0.1428
- `computeReadiness`: both usable, totalWeight=1.0, weighted=0.6×0.2 + 0.4×0.1428 = 0.17714
- `Math.round(0.17714 × 100)` = **18** ✓

Confirms PRD §1 "≈18/100 with test data." Progress page renders the Chewgether readiness card because `active=true` is the page query predicate — no focus-switch needed for this card. Score rounds correctly.

---

## SUGGESTIONS (low)

### S-1 — Instructions weekly review shorthand omits `goalId`

"list_log_entries(metric='mrr', last 4 entries)" in the instructions' project review block omits the required `goalId`. Zod will return a clear error message if called without it, so a coaching session won't silently fail. However, consistent notation (include goalId in shorthand) makes the pattern easier for Claude to internalize. Low impact.

### S-2 — Two-call fitness session start is now explicit; `limit=4` implied but not stated

The instructions mandate `get_today_plan` → `get_session_brief` for fitness. Previously neither route mandated both. The instructions text says "last 4 entries" in the weekly project review shorthand — but `list_log_entries` defaults to `limit=50`. The coach needs to pass `limit=4` explicitly. Minor — the coach will include it when it matters.

### S-3 — Sep-30 milestone overlaps with goal `targetDate`

The 7th GitHub milestone ("growth to $1k") has due_on=Sep 30, same as `goal.targetDate`. When `sync_github_milestones` runs, this creates a ScheduledItem for Sep 30. The calendar will show both a milestone marker AND a goal-date pin on the same day. Not a bug (both are semantically correct), but may look duplicative in the UI. No action required unless the calendar legend gets noisy.

### S-4 — Prompt 1 makes two `list_scheduled_items` calls (planned + done)

Steps 3 and 4 call `list_scheduled_items` with different status filters. A single call without `status` filter returns all, allowing planned vs. done computation in one round trip. Minor efficiency gap.

---

## Dimension-by-dimension summary

| Dimension | Status | Key finding |
|-----------|--------|-------------|
| Instructions regression | PASS (with caveat) | 13 rules retained verbatim; goal-kind routing added correctly; set_active_goal covenant matches actual tool description; no token refs; length ~10.1k chars (within connector limits) |
| Seed correctness | PASS | Import order safe; dotenv first, singleton after, calendar cached; targets satisfy GoalTargetSchema; isFocus=false explicit; weights sum to 1.0; parseDateKey produces correct USER_TZ midnight |
| Ops sequence | PASS | GitHub due_on format `<date>T07:00:00Z` accepted by API; readiness math verified = 18; progress page renders Chewgether card for `active=true` goal without focus switch; burn-down gated (by design) |
| Docs | FAIL — CRIT-1, CRIT-2 | Three tools use wrong param names (repo= / issue=); readiness tool is wrong (`get_goal` vs `compute_readiness`); missing focus-switch prerequisite (HIGH-1) |
