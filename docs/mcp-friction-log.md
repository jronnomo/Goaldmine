# MCP Tool Friction Log

Coaching-surface frustrations that turn into MCP tool changes. Each entry preserves the original report (the evidence) and notes what happened next.

Entries live in one of four sections:

- **Resolved** — shipped a fix; PR + merge SHA captured.
- **Out of scope** — real friction we can't fix in this codebase (e.g. claude.ai client behavior).
- **Deferred decisions** — scope deliberately not shipped during a fix, with the reasoning preserved so the next reporter knows what evidence would warrant revisiting.
- **Open** — reported but not yet addressed.

A separate **Production verification** section logs dated end-to-end checks against the deployed MCP endpoint to confirm the documented behaviors still work in the surface claude.ai actually sees.

When new friction shows up, append a new entry in **Open** with the reporter's exact words — that's the most useful artifact when designing the fix.

---

## Resolved

### #1 — `apply_day_override` was destructive
**Reported:** 2026-05-22. Severity: High (silent data loss).

> Calling `apply_day_override` with only one field (e.g., `nutritionText`) wipes out all other fields on that day (`workoutJson`, `mobilityText`, `notes`). On 5/22, I logged today's dinner plan as a `nutritionText` override after earlier applying a `workoutJson` override with the full 32-min mobility flow. The second call silently deleted the mobility flow. User had to ask "where are my stretches?" to surface the bug.

**Shipped:** PR #5 (`b092c4e`). `apply_day_override` is now PATCH-style: `undefined` = leave alone, `null` = clear, value = set. Response reports `updatedFields` and `preservedFields` explicitly. The audible-with-baselines guard was also relaxed so partial follow-up calls don't re-prompt for a baseline decision once one is on file.

---

### #3 — `apply_day_override` required full `workoutJson` snapshot, not diffs
**Reported:** 2026-05-22. Severity: Medium.

> To make a small change to a workout (e.g., add one exercise, change one duration), I must rewrite the entire `workoutJson` blob. On 5/22 when adding calf/dorsiflexion back to the mobility flow, I had to re-emit the full mobility flow with all 20+ exercises. Risk of typo or omission each time.

**Shipped:** PR #12 (`ca09a4e`). `apply_day_override` accepts a `workoutJsonOps` array — `addExercise` / `updateExercise` / `removeExercise`. Mutually exclusive with `workoutJson`. Ops apply against the existing override (if any) or the rotation-day template, run sequentially against a deep clone, and the result is validated like a full `workoutJson` replace. Ambiguous matches throw with every candidate listed and a hint to pass `block` to disambiguate.

---

### #4 — Progression / per-date prescription drift in `planJson`
**Reported:** 2026-05-22 (about a 5/19 incident). Severity: Medium.

> The plan snapshot doesn't reflect progressions made by the engine. On 5/19, I claimed Hollow Body Hold was prescribed at 30s based on the snapshot, but the app actually showed 55s after progression. Workaround: I now call `get_day` before stating any per-day prescription details. This is now a standing rule I have to remember.

**Investigation finding:** There is no automatic progression engine in the code. The "progression" is the coach manually bumping prescriptions via `apply_plan_revision` (template-wide) or `apply_day_override` (per-date). The real architectural ambiguity is that `planJson` is the rotation template and per-date overrides layer on top — reading `planJson` alone never tells you what's actually scheduled on a given date.

**Shipped:** PR #10 (`3648bd6`). Three changes:
1. `get_goal` description explicitly states `planJson` is the rotation template and points at `get_day` / `find_exercise_in_plan` for per-date detail.
2. `get_goal` response gains `upcomingOverrides` — every `PlanDayOverride` in the next 60 days with which fields are driving and the workout title.
3. New `find_exercise_in_plan(name, windowDays, fromDate?)` walks N days via `resolveDay` (override-aware) and returns every occurrence with `source: "template" | "override"` plus the resolved prescription. Coach instructions rule 1 was amended to route prescription questions to these tools, citing the 5/19 incident.

---

### #5 — Plan-metadata tool description didn't match search intent
**Reported:** 2026-05-22. Severity: Low (search issue, not a true gap).

> When I extended the plan from 13 → 14 weeks on 5/18, the snapshot updated cleanly but the surrounding metadata fields lived elsewhere and weren't writable. I flagged it as a tool gap. Created a stale-data window — UI was showing "13-week plan" with old target date for a few hours until I located `update_plan_metadata` (which did exist, I just hadn't found it via tool_search keywords).

**Shipped:** PR #9 (`360b4db`). Tool description pass — rewrote 21 of 39 tool descriptions to lead with verbs callers think in ("Extend / shorten / rename plan; shift goal date" vs the old "Update plan dates / name"), weave search synonyms into the prose, and cross-link related tools by name. Verified the original failing search keyword now hits.

---

### #6 — No way to log a workout AND apply an override in one atomic operation
**Reported:** 2026-05-22 (about a 5/21 hike incident). Severity: Low-Medium.

> When completing a session that diverges from the plan, I have to call multiple tools: `log_workout` for what they did, then `apply_day_override` to update the displayed plan. These can desync. On 5/21, when user clarified the actual Flatirons route, I had to update `workoutJson` to reflect actual route, plus the user's completed workout was logged elsewhere. Two sources of truth.

**Shipped:** PR #13 (`949d57d`) — narrow, hike-only. `log_hike` gains optional `replacesPlannedHikeId`. When set, finalizes a planned row in place instead of creating a duplicate; id preserved, status flips `planned → completed` (or `skipped`); date updates too if the actual day differed from the planned day, with `dateMoved.{from, to}` surfaced in the response. The workout-side combo was deliberately **left out** — the Workout → DayTemplate mapping is lossy and the workout-side friction wasn't well-evidenced beyond the single Flatirons report. Revisit if a future report establishes the need.

---

### #7 — `get_day` returned override fields as `null` rather than absent
**Reported:** 2026-05-22. Severity: Low.

> When a day has no override, `get_day` still shows an `override` key with all-null fields. When a day HAS an override but only one field was set, the unset fields also show as `null`. Distinguishing "intentionally cleared" from "never set" is impossible.

**Shipped:** PR #5 (`b092c4e`, paired with #1). The `override` sub-object in `get_day`'s response now omits null fields. Key presence means "this override is driving that field"; absence means "rotation default applies." Top-level resolved fields (`workoutTemplate`, `nutritionText`, etc.) still carry the final rendered values and are unchanged for UI compatibility. `baselineTestNames` was also added to the sub-object (previously omitted entirely).

---

### #8 — No batch / transaction support for multi-day operations
**Reported:** 2026-05-22. Severity: Low.

> When planning meals across 12 days, I had to make 12 separate `apply_day_override` calls. If any failed mid-sequence, I'd have partial state. The HelloFresh meal-planning session today required 12 sequential calls. One failed, forcing a retry.

**Shipped:** PR #11 (`2c5a831`). Three new batch tools wrapping single Prisma transactions:
- `batch_apply_day_overrides`
- `batch_log_nutrition`
- `batch_log_note`

Max 50 ops per call. Operations run sequentially within the transaction (an earlier op's `baselineTestNames` decision is visible to a later op, so the audible-with-baselines guard doesn't re-fire mid-batch). On any failure: full rollback, error names the failing index and the underlying message. Verified end-to-end with a planted failure at index `[1]` of a 3-op batch — ops `[0]` and `[2]` left no rows behind.

---

### #9 — `apply_day_override` failed with opaque errors on large JSON payloads
**Reported:** 2026-05-22 (about a 5/21 incident). Severity: Low-Medium.

> On 5/21 my first attempt to write the Flatirons hike workout JSON failed with `"Error occurred during tool execution"` and a request ID. Retrying with the JSON compressed succeeded. Required guessing at the cause. Lost time, lost user trust.

**Shipped:** PR #8 (`a53ee36`). Three layers:
1. New `src/lib/day-template-validation.ts` validates `workoutJson` field-by-field (title, blocks, exercises, dayOfWeek/category enums). Reports the specific field that failed instead of a generic Prisma error.
2. Size guard at 64KB after `JSON.stringify` (real DayTemplates are 2–8KB; oversized usually means a full plan snapshot was pasted by mistake). Message names actual byte count, limit, KB calc, and likely causes. Catches `JSON.stringify` throws too (circular references).
3. Route-level error envelope in both `/api/mcp` and `/api/mcp/[token]`: any uncaught throw above the tool's `safe()` wrapper now returns a JSON-RPC `-32603` with the message instead of a generic 500. The original "Error occurred during tool execution" string was claude.ai's fallback when our 500 had no body — this fixes it.

---

### #10 — Standing rules / persistent guidance didn't auto-surface
**Reported:** 2026-05-22. Severity: Medium.

> Standing rules logged as `feedback` notes (like "prescribe = log") don't automatically appear in my context on new conversations. I have to either remember them or search for them. The "prescribe = log" rule was established on 5/22 — if I start a new conversation tomorrow and the user asks for a mobility flow, I won't see that rule unless I think to search for it.

**Shipped:** PR #7 (`29e7494`). PR #6 was the original open PR but was auto-closed by GitHub when its base branch (`fix/mcp-override-patch-semantics`, which #5 was on) was deleted on #5's merge; the same commits were rebased onto `main` and re-opened as PR #7. So in the GitHub PR list, #6 shows "closed, not merged" alongside #7 "merged" with effectively the same content — that's the rebase, not lost work.

New `standing_rule` Note type with `lastAcknowledgedAt` freshness signal:
- Schema migration adds `Note.lastAcknowledgedAt` and high-confidence backfills feedback notes whose body starts with `RULE:` / `STANDING:` (case-insensitive POSIX) to `standing_rule` with the timestamp stamped.
- `get_today_plan` returns active standing rules under `standingRules`, ordered freshest-acknowledged-first (nulls last).
- Three new tools: `list_promotable_notes` (find candidates), `promote_note` (flip type, stamps timestamp), `acknowledge_standing_rule` (bump timestamp when referencing a rule in a turn).
- UI dropdowns in `LogNoteForm` and `DayNoteForm` got the new type.
- Coach instructions rule 13 added: read `standingRules` at session start; acknowledge when referencing; propose `standing_rule` when the user states a persistent rule.

Verification afterward surfaced two follow-up nits (ordering put nulls first, `log_note(type=standing_rule)` didn't stamp) — both fixed in `4079693` on the same branch.

---

## Out of scope

Friction that's real but can't be fixed inside this codebase. Recorded so the next reporter doesn't repeat the investigation and so the closest available mitigation is documented.

### #2 — Deferred tools not discoverable without `tool_search`
**Reported:** 2026-05-22. Severity: Medium.

> Many tools (`log_note`, `get_day`, `apply_day_override`, `log_nutrition`, etc.) aren't loaded by default. Each must be discovered via `tool_search` before first use. Tool descriptions also aren't visible until searched. Repeated `tool_search` calls throughout every session. Wasted turns. Even tools I just used 5 minutes ago in the same conversation sometimes drop out.

**Status:** Out of scope at the server. This is claude.ai's harness behavior — the MCP server exposes everything via `tools/list`; the client decides what to load eagerly and what to defer behind `tool_search`. Server-side mitigation: PR #9 (`360b4db`) rewrote 21 tool descriptions with better keyword coverage so `tool_search` is more likely to hit first try, but the round-trip itself can't be removed from this side. If the harness behavior changes upstream (claude.ai eagerly loads more tools, or surfaces descriptions without a search), this entry can be retired.

---

## Deferred decisions

Choices made during a friction fix to *not* ship a piece of scope, with the reasoning preserved so the next reporter can either provide the missing evidence or read why it wasn't worth the cost.

### Workout-side `log_workout + apply_day_override` combo (deferred from #6)
**Context:** Friction #6 originally proposed an atomic `log_workout + apply_day_override` combo so the displayed plan would auto-update to match what was actually done. The shipped fix (PR #13) handled only the hike side via `log_hike.replacesPlannedHikeId`.

**Why deferred:**
1. **Lossy mapping.** `Workout` (actual sets with weights/reps/duration values) → `DayTemplate` (prescriptions with ranges like "8-12") isn't 1:1. Auto-deriving one from the other loses prescription intent vs. captured execution.
2. **Thin evidence.** Only the Flatirons case (a hike, not a workout) was on the table. One report isn't enough signal to commit to a fixed mapping.
3. **The "two sources of truth" framing might be a feature.** The override is the plan; the workout log is the execution. Their divergence is information — the user did X when X was planned.

**Revisit if:** Multiple reports establish a recurring pattern where the coach has to manually re-emit a `workoutJson` to match a logged workout, the lossy mapping is acceptable, or the user explicitly says they want post-hoc display to track actual performance.

---

## Open

*(none currently)*

---

## Production verification

Periodic end-to-end checks against the deployed MCP endpoint (the one claude.ai actually hits) to confirm the documented behaviors still work. New entry appended each time someone re-verifies after a noteworthy batch of changes.

### 2026-05-23 — initial post-shipping verification
**Endpoint:** `https://workout-planner-gold-three.vercel.app/api/mcp/<token>` (commit `c480000`, Vercel deployment success at 03:43 UTC).
**Method:** curl against the prod MCP route with the user's bearer token, mirroring claude.ai's transport.

| Item | Probe | Result |
| --- | --- | --- |
| Tool surface | `tools/list` count + all 7 new tools present | 43 tools; `batch_apply_day_overrides`, `batch_log_nutrition`, `batch_log_note`, `find_exercise_in_plan`, `promote_note`, `acknowledge_standing_rule`, `list_promotable_notes` all returned |
| #1 PATCH semantics | partial nutrition-only update on an existing override | `updatedFields: [nutritionText]`, `preservedFields: [workoutJson, baselineTestNames, mobilityText, notes]` |
| #3 workoutJsonOps | `addExercise` op against the override just set | "Override updated (changed: workoutJson). Other fields preserved. workoutJson edited via 1 op." |
| #4 upcomingOverrides | `get_goal` on the active Mt. Elbert goal | 14 upcoming override entries surfaced |
| #4 find_exercise_in_plan | `exerciseName: "hollow"`, `windowDays: 21` | 3 occurrences, all `durationSec: 55` (the synced progressed value) |
| #6 replacesPlannedHikeId | plan a hike on 2026-09-01, finalize-in-place on 2026-09-02 | `finalized: true`, `previousStatus: "planned"`, id preserved, `dateMoved: 2026-09-01 → 2026-09-02` |
| #7 override null-omission | covered by the PATCH probe response (preservedFields list is the structural signal) | ✓ |
| #8 batch atomic rollback | 3-op batch with op `[1]` containing a malformed `workoutJson` | error names index + failing field; all 3 dates show `isOverride: false` afterward — full rollback confirmed |
| #9 validation envelope | `workoutJson` without `title` | "Invalid workoutJson (DayTemplate). Fix these fields, then retry: workoutJson.title must be a non-empty string" with reference shape |
| #10 standingRules surface | `get_today_plan` top-level keys | `standingRules` field present (count 0; no rules populated yet) |

All test rows cleaned up post-verification (`clear_day_override`, `delete_hike`).

**Gotcha to remember for next verification run:** picking a future date outside the plan's calendar window (e.g. 2026-08-15 when the plan ends in summer 2026) means `get_day.workoutTemplate` comes back `null` even after an override is set — `resolveDay` only returns a workoutTemplate when `isInPlan: true`. The override row exists and is queryable, but if the verification script reads `workoutTemplate.title` directly it'll trip. For probes that need to read the resolved workout, pick a date inside the plan window.

---

## How to add a new entry

1. Copy the user's exact words into a `> blockquote` under "Reported." Don't paraphrase — the literal language is the design signal.
2. Note severity from the reporter's perspective:
   - **High** — data loss, wrong values shown to the user, or anything silently corrupting state.
   - **Medium** — slow workflow, accuracy that relies on coach discipline, or a workaround that's easy to forget.
   - **Low** — ergonomic friction; works correctly but takes too many steps.
3. If the fix needs design discussion before code, capture the alternatives considered and which one shipped + why. Loss of options is information.
4. After landing the fix, fill in **Shipped:** with the PR number, the merge SHA, and a short paragraph naming the concrete tool / column / behavior changes. Cross-link other PRs that relate (e.g. paired changes, design references).
5. Move the entry to the right destination:
   - Shipped a fix → **Resolved**.
   - Can't fix in this codebase → **Out of scope** with the reasoning + any partial mitigation.
   - Shipped a fix but skipped a piece of scope → keep the main entry in **Resolved**, add a corresponding entry in **Deferred decisions** describing what was skipped and what evidence would warrant revisiting.
   Keep the original Reported blockquote intact in all cases.
6. After a noteworthy batch of fixes, drive the prod MCP endpoint with curl (mirroring claude.ai's transport) and append a dated entry to **Production verification** — a table of probes + results, plus any "gotcha to remember" notes from the verification run. The point is to confirm the deployed surface matches the documented behavior, not to re-run unit tests.
