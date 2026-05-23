# MCP Overhaul — 2026-05-22 session

A single session that resolved every item on the 10-point friction log the workout-coach Claude had been accumulating. 11 merged PRs, ~1,500 lines of code/docs added, the MCP server's behavior reshaped in ways the coach will notice immediately.

Open this when you forget what changed.

---

## TL;DR

- **`apply_day_override` no longer wipes sibling fields.** PATCH semantics: pass only what you want to change.
- **Surgical workout edits.** Add/update/remove single exercises without re-emitting the full DayTemplate.
- **Batch tools.** Multi-day plans (HelloFresh weeks, vacation cascades) commit atomically.
- **Standing rules persist across conversations.** New `standing_rule` note type auto-surfaces in `get_today_plan`.
- **Per-date prescription queries get the right answer.** `find_exercise_in_plan` walks the calendar override-aware so the coach can't accidentally read stale rotation-template values.
- **Hike duplication gone.** Planned hikes finalize in place via `replacesPlannedHikeId`.
- **Errors are useful again.** The opaque "Error occurred during tool execution" is replaced by field-level validation messages.
- **Tool descriptions hit `tool_search` better.** 21 rewritten with synonyms and use-case language.

---

## What you should see in the next session

Once you refresh the MCP connector in claude.ai (which re-fetches `tools/list` + the updated `COACH_INSTRUCTIONS`):

### Tool surface

- **43 tools** registered (was 36).
- **New tools (7):** `batch_apply_day_overrides`, `batch_log_nutrition`, `batch_log_note`, `find_exercise_in_plan`, `promote_note`, `acknowledge_standing_rule`, `list_promotable_notes`.
- **Existing tools with new fields or response shapes:**
  - `apply_day_override` — PATCH semantics, `workoutJsonOps` array, size guard, structural validation
  - `log_hike` — `replacesPlannedHikeId`
  - `log_note` — stamps `lastAcknowledgedAt` when type is `standing_rule`
  - `get_today_plan` — returns `standingRules` array
  - `get_goal` — returns `upcomingOverrides` array
  - `get_day` — override sub-object omits null fields (presence of a key = override is driving it)

### Updated coach instructions

`COACH_INSTRUCTIONS` (the server-side prompt the coach reads on connection) gained:

- **Rule 1 amended:** routes per-date prescription questions to `get_day` / `find_exercise_in_plan`, citing the 5/19 Hollow Body Hold incident as a concrete reminder.
- **Rule 9 relaxed:** the audible-with-baselines guard no longer re-fires on every partial follow-up call once a baseline decision is on file.
- **Rule 13 added:** standing rules persist; read them at session start; acknowledge when referencing; propose `standing_rule` type when you state persistent guidance.

### Concrete behavior changes the coach should exhibit

- **Multi-step override sessions don't lose data.** Setting a workoutJson, then a nutritionText, then a notes field — each only touches its named field. The response now lists `updatedFields` and `preservedFields` explicitly.
- **"Add calf stretch to today's mobility" → one small call.** The coach should use `workoutJsonOps: [{op: "addExercise", block: "Mobility", exercise: {name: "Calf Stretch", durationSec: 30}}]` rather than re-emitting the whole 20-exercise mobility block.
- **HelloFresh weeks atomic.** A 12-day meal layout is one `batch_apply_day_overrides` call. If any day fails validation, none commit and the error names the failing index + reason.
- **Finished hikes don't duplicate.** When you finish a planned hike, the coach should call `log_hike(replacesPlannedHikeId: <id>)` so the planned row updates in place with the actual values. Status flips `planned → completed`; if the date moved, `dateMoved.{from, to}` surfaces in the response.
- **Standing rules show up automatically.** Anything logged as `standing_rule` (or promoted via `promote_note`) appears in `get_today_plan.standingRules` every session, sorted by freshness (most-recently-acknowledged first).
- **Per-date prescription questions resolve correctly.** "What's Hollow Body Hold prescribed at over the next two weeks" should produce a `find_exercise_in_plan` call, not a `get_goal` read.
- **Validation errors name the field.** "workoutJson.blocks[0].exercises must be an array" instead of "Error occurred during tool execution."

---

## One-time housekeeping in your next session

The migration's strict backfill (`^[[:space:]]*(RULE|STANDING)[[:space:]]*[:.-]`) auto-promoted zero feedback notes — the existing 22 don't have the prefix. They're still type=`feedback` and won't surface in `standingRules`.

**Ask the coach in your first refreshed session:**

> Call `list_promotable_notes()`, review the existing feedback notes, and propose which ones should become `standing_rule` so they auto-surface in future sessions.

The coach should walk the list, propose promotions one by one, and call `promote_note(id, type: "standing_rule")` after each "yes." That's how your accumulated coaching wisdom moves to the persistent surface.

---

## What's still annoying — and won't change from this side

**Friction #2** (logged in `docs/mcp-friction-log.md` under "Out of scope"): the coach still has to call `tool_search` to load some tools before first use. That's claude.ai's harness behavior — our MCP server already exposes everything via `tools/list`; the client decides what to eagerly load and what to defer.

The closest mitigation: PR #9 rewrote 21 tool descriptions with better keyword coverage (synonyms like "extend plan duration", "personal records", "fitness test", "training hike", "rubric" baked into the descriptions). Searches should hit on the first keyword try more often, so the round-trip cost is lower even when it still happens.

---

## 30-second sanity check

When you refresh and open a new chat:

> "What's Hollow Body Hold prescribed at over the next two weeks?"

What you should see: the coach calls `find_exercise_in_plan({exerciseName: "hollow", windowDays: 14})` and tells you 55s. That's the synced progressed value, override-aware. If you instead see it pull `get_goal.plans[0].planJson` and walk the blocks manually, the new tool didn't surface in `tool_search` — flag it as friction for the next session.

---

## PRs landed this session

In merge order:

| # | SHA | Title |
| --- | --- | --- |
| #5 | `b092c4e` | fix(mcp): apply_day_override is PATCH-style; resolveDay omits null override fields |
| #7 | `29e7494` | feat(notes): standing_rule note type with auto-surfacing in get_today_plan (originally opened as #6; rebased after #5's base branch was deleted) |
| #8 | `a53ee36` | fix(mcp): field-level validation + size guard + route-level error envelope for apply_day_override |
| #9 | `360b4db` | feat(mcp): rewrite tool descriptions for better keyword-search discoverability |
| #10 | `3648bd6` | feat(mcp): get_goal surfaces upcoming overrides; new find_exercise_in_plan tool |
| #11 | `2c5a831` | feat(mcp): batch_apply_day_overrides, batch_log_nutrition, batch_log_note (atomic batches) |
| #12 | `ca09a4e` | feat(mcp): apply_day_override.workoutJsonOps — surgical exercise edits |
| #13 | `949d57d` | feat(mcp): log_hike.replacesPlannedHikeId — finalize a planned hike in place |
| #14 | `d7117f2` | docs: add MCP tool friction log |
| #15 | `c480000` | docs(friction-log): restructure — Out of scope + Deferred decisions sections; PR #6→#7 rebase context |
| #16 | `8dd7476` | docs(friction-log): add Production verification section with 2026-05-23 prod probe results |

---

## Files you might want to revisit

- **`docs/mcp-friction-log.md`** — the structured archive: original report blockquotes preserved, what shipped per item, deferred decisions, production verification log. Authoritative reference for "what changed and why."
- **`src/lib/mcp/tools.ts`** — the tool registrations. Look here when you want to read a tool's exact description (those are what the coach sees) or input shape.
- **`src/app/api/mcp/[token]/route.ts`** — `COACH_INSTRUCTIONS` is at the bottom of this file. That's the server-side prompt the coach reads on connection. Edit here to change coaching rules.
- **`src/lib/day-template-ops.ts`** — pure transforms for `workoutJsonOps` (addExercise / updateExercise / removeExercise). New file.
- **`src/lib/day-template-validation.ts`** — `assertValidDayTemplate` + size guard. New file.
- **`prisma/migrations/20260522120000_add_standing_rule_notes/migration.sql`** — the ALTER TABLE + backfill SQL. Already applied to Neon prod during verification.

---

## Architecture notes worth remembering

- **`Plan.planJson` is the rotation template.** It tells you what Mondays do. It does NOT include per-date overrides. To answer "what's on date X," call `get_day(X)` or `find_exercise_in_plan` — never read `planJson` directly for per-date questions.
- **There is no automatic progression engine.** "Progression" in this codebase is the coach manually syncing prescriptions via `apply_plan_revision` (template-wide) or `apply_day_override` (per-date). The 5/19 Hollow Body Hold 30s-vs-55s confusion came from reading a stale view, not from a hidden engine.
- **The override row is layered, not merged.** `PlanDayOverride.workoutJson` (set) overrides the template entirely for that date. There's no field-level merge between the template and an override — the override either drives a field or it doesn't, signalled by the field being null vs. set in the DB.
- **The MCP server has zero LLM calls.** The coach reasons in claude.ai; this server is pure read/write tools. The MCP transport is stateless HTTP per request.

---

## Production endpoint

`https://workout-planner-gold-three.vercel.app/api/mcp/<token>` (token from `MCP_AUTH_TOKEN` in `.env`).

To verify behaviors against prod from a shell:

```bash
# tools/list
curl -sS -X POST "https://workout-planner-gold-three.vercel.app/api/mcp/$MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# → 43
```

Last full prod verification: 2026-05-23, captured in `docs/mcp-friction-log.md` under "Production verification."
