# Architecture Critique — Auto-legend on goal creation

Date: 2026-05-05
Reviewer: Devil's Advocate
Sources: PRD, requirements.md, research-output.md, architecture-blueprint.md

Tags: 🚨 Blocker / ⚠️ Concern / 💡 Suggestion

---

## A. `createGoalCore` contract gaps

- ⚠️ **Validation asymmetry between callers.** Blueprint C.1's `createGoalCore` skeleton performs **zero** input validation. The form path (`goal-actions.ts:42-46`) throws `"Objective is required"` / `"Target date is required"` / `"Invalid target date"` BEFORE calling the core. The MCP path relies on Zod (`z.string().min(1).max(200)` + `DateKeyShape`). If a future caller (or a refactor) hits the core directly, `objective: ""` lands in DB unchallenged. Recommend: add cheap guards inside the core (`if (!objective.trim()) throw new Error("objective required")`, `if (Number.isNaN(targetDate.getTime())) throw new Error("invalid targetDate")`) so the contract is enforced at the boundary regardless of the caller. One source of truth.
- ⚠️ **Past-date silent acceptance.** Neither path rejects `targetDate < now`. `weeksBetween(now, past)` returns `Math.max(1, ...) = 1`, so the user gets a 1-week plan ending in the past. Existing form behavior, but worth documenting in `create_goal` description so Claude knows past dates are accepted (it might otherwise reject and confuse the user).
- ⚠️ **Return shape mismatch with form caller.** Blueprint returns `{ goal: { id }, planId }`. The form caller at C.2 destructures `const { goal } = await createGoalCore(...)` then `redirect(\`/goals/${goal.id}\`)`. Fine. But the `include: { plans: { select: { id: true } } }` change means the form path now does an extra column-fetch on every form submit it didn't need before. Tiny perf hit, but more importantly: the return type tightens — verify no one else imports `createGoal`'s prior implicit `goal` shape (research §5 says only `GoalCreateForm` calls it; safe).
- 💡 **Concurrency on `copyFromGoalId`.** Two simultaneous calls reading the same source goal would each copy the snapshot independently. No data race because both writes create distinct new Goal rows. Theoretical risk only; not worth gating.

## B. `create_goal` MCP tool input validation

- 💡 **`objective.max(200)`** matches the form's `maxLength={200}` — blueprint C.3 is correct. No issue.
- ⚠️ **`targetDate` natural-language input.** `DateKeyShape` is a strict yyyy-mm-dd regex (per research §6 / `parseDateInput`). If Claude passes "tomorrow" or "next Friday", Zod rejects with a regex error before `parseDateInput` runs. Acceptable, but the `create_goal` description does NOT tell Claude this — it should. Recommend adding to description: "targetDate must be `YYYY-MM-DD`; resolve relative dates yourself before calling."
- 🚨 **`legend: []` Zod-vs-runtime gap.** `LegendSchema = z.array(LegendEntrySchema)` accepts `[]` as valid input — Zod array schemas allow empty by default. Blueprint C.1 then maps `[]` → `Prisma.JsonNull` (DB null). PRD §6 says "empty array invalid for `LegendSchema`" — but that's **not actually true** at the schema level. The runtime path quietly converts `[]` to null. Two issues:
  1. PRD's claim is wrong; the docs and acceptance criteria implying schema-level rejection should be corrected.
  2. The convert-to-null behavior is fine but **must be mentioned in `create_goal`'s description**, otherwise Claude will be confused about why `legend: []` produces a goal with the default hike legend visible. Blueprint C.3 description does mention "empty array or omit to leave the goal on the default legend" — good. PRD should reflect.
- ⚠️ **`copyFromGoalId` pointing at inactive/abandoned goal.** Research §1 step 3 confirms: `findUnique` returns the goal regardless of `active` / `status`. So copying targets from an abandoned goal succeeds silently. Probably desired (user might be reviving a paused goal), but worth a one-line description note: "copies targets from any existing goal regardless of status."
- 💡 **`copyFromGoalId` pointing at the new goal.** Impossible (the goal doesn't exist yet at the time of copy). Non-issue.

## C. `update_goal_legend` description rewrite

- ⚠️ **Char budget reality check.** Blueprint C.4 estimates ~1730 chars and caps at 1800. I count the proposed string at roughly 1750-1800 chars including the embedded `\n` escapes (which count once each in the source literal). Within budget, but tight. The dev MUST `console.log(description.length)` and report. If it exceeds 1800, the `hybrid-endurance` preset is the longest and least-used — drop it first.
- ⚠️ **Emoji encoding consistency.** The blueprint uses Unicode literals (`🥾`, `🏋️`, `🏔️`) inside the JSON-string-inside-a-JS-string. The `\"` escapes are correct; the emoji travel as raw UTF-8 bytes in the source. Fine for compilation, but: `🏋️` is actually two codepoints (U+1F3CB + U+FE0F variation selector) and `🏔️` similarly. If the source file is somehow normalized, the variation selector could be stripped, rendering as a different glyph. Recommend: developer copy emoji from the requirements file directly (don't retype) and verify by rendering the description via `tools/list` curl during QA.
- ⚠️ **Closed-enum warning is implicit.** The proposed description states "Closed enum; new render conditions need a code change." Good, but it doesn't explicitly tell Claude what happens on bad kind. Suggest one extra clause: "Passing a `kind` outside this set fails Zod validation — the call returns an error envelope." Saves a confused retry.
- 💡 **No mention of icon palette.** Claude can pick any emoji for `icon` (only `kind` is enum-validated). The presets imply a vocabulary but don't constrain it. That's fine — flexibility is the point — but worth one sentence: "icon is a free-form string (any emoji or character); only `kind` is enumerated."

## D. Form-vs-MCP behavioral asymmetry (USER_TZ)

- 🚨 **This is a real, user-visible bug, not just a doc note.** The form uses `new Date("2026-09-15")` → 2026-09-15T00:00:00Z = 2026-09-14T18:00:00 MT. The MCP path uses `parseDateInput("2026-09-15")` → `parseDateKey` → 2026-09-15T00:00:00 MT = 2026-09-15T06:00:00Z. Same input string, different stored `targetDate`, **different calendar day** in `getCalendarMonth.goal.targetDate` rendering on a roughly 6-hour window. Concrete impact:
  - A goal created via the form for "2026-09-15" renders the goal-date pin on **September 14** in the calendar (TZ rolls back to MT-evening).
  - A goal created via MCP for "2026-09-15" renders correctly on September 15.
  - `goalProgress` percentage drifts by one day at the boundary.
  - Side-by-side comparison in `list_goals` will show identical `targetDate` strings rendering on different calendar cells.
- ⚠️ **CLAUDE.md gotcha #5 is explicit**: "Every date/time helper goes through `@/lib/calendar`." The blueprint accepts the bug as "out of scope" (D.2). That's a valid scoping call for THIS PR, **but the PR description should call it out as a known issue with a follow-up issue/commit**, not bury it. Otherwise the next agent debugging "why does my goal-date appear on the wrong day" wastes hours.
- 💡 Recommend: add a 2-line fix to REQ-A1 — change `const targetDate = new Date(targetDateStr)` to `const targetDate = parseDateKey(targetDateStr)` (with the same regex guard) in the form-side `createGoal`. Cost: 1 import, 2 lines. Risk: low. Aligns both paths permanently. If declined, document loudly.

## E. Idempotency / double-submit

- ⚠️ **Confirmed risk, no safeguard.** Research §3 + risk #3: no unique constraint on `Goal`; both surfaces allow duplicates. PRD/blueprint accept this as out of scope. Documented; acceptable for a single-user app. But:
- ⚠️ **MCP retry amplification.** Claude.ai's reasoning engine may retry on perceived failure (e.g., it didn't read the response, or got an HTTP 5xx mid-flight even though the write succeeded). This produces **two complete Goal+Plan+Revision triplets** with all the cascading "active: true" plan rows. Cleanup is manual + nontrivial (delete goal cascades plans, but the user must use the UI delete button or DB).
- 💡 Recommend: add a paragraph to `create_goal`'s description warning Claude: "If you receive an unclear response from this tool, call `list_goals` BEFORE retrying — duplicates are not auto-prevented." Cheap, prevents the most common amplification.
- 💡 Future work: optional `idempotencyKey: string` parameter that the tool stores on Goal (new column) or in a side table; reject if seen within 60s. Out of scope for this PR.

## F. Operating-rules doc (REQ-D1)

- 🚨 **Numbering conflict is real.** Research §9 verified: `COACH_INSTRUCTIONS` at `src/app/api/mcp/[token]/route.ts:67-89` already contains a rule 10 (Nutrition logs are food groups/items, not macros). Requirements.md REQ-D1 numbers the new auto-legend rule **also as 10**. Blueprint A.4 catches this and locks "auto-legend = 11; nutrition stays 10". Good. But:
- ⚠️ **The blueprint's doc body in C.5 includes both rules 10 (nutrition) and 11 (auto-legend) — verify the dev pulls rule 10 verbatim from `[token]/route.ts:67-89`, not from memory.** The current draft in C.5 looks right, but it's *paraphrased*: cross-check against the actual constant before committing. Drift on day 1 = the doc is worthless.
- ⚠️ **Connector-text-vs-constant drift risk.** Research §9 raises the right alarm: the user's actual claude.ai connector instructions text was pasted manually at some point. If it has drifted from `COACH_INSTRUCTIONS`, the new doc and the deployed connector won't match. The PR final report needs to **(a) instruct the user to paste the new auto-legend paragraph into the connector AND (b) remind them to paste the entire doc once if they want full alignment**. Otherwise rule 11 lives only in repo + claude.ai, not in `[token]/route.ts`'s constant — which means the deployed `instructions` field still says rules 1-10 only. **The blueprint does NOT instruct the dev to update `COACH_INSTRUCTIONS` in `[token]/route.ts`.** That should also be updated to keep doc / constant / claude.ai connector all in sync.
- 💡 Append rule 11 to the END of `COACH_INSTRUCTIONS` constant; do not interleave/renumber. Preserves history. Make this explicit in REQ-D1's acceptance.

## G. Acceptance criteria gaps

- 💡 **PRD #19 (no `text-emerald-500` regressions) is boilerplate.** This feature touches zero UI. The chance of introducing emerald/amber/red regressions is near-zero unless the dev whimsically adds a preview component. Flag as carry-over noise; consider dropping for clarity in the next PRD revision. Not a blocker.
- ⚠️ **PRD #12 / Cross-cutting REQ-X "GoalCreateForm web flow unchanged" verification is vague.** "Manual smoke" is mentioned but unspecified. Recommend: spell out the exact verification as part of the test plan:
  1. `npm run dev`
  2. Visit `/goals`, fill objective + targetDate (yyyy-mm-dd) + optional notes, submit.
  3. Confirm redirect to `/goals/<new-id>`.
  4. Confirm new Goal in DB has `legend === null`, `targets` matches form, `plans` count = 1, `revisions` count = 1.
  5. Visit `/calendar`, confirm default-legend renders.
  Without the explicit checklist, "unchanged" is unprovable.
- ⚠️ **Tool count acceptance was wrong in PRD (38→39); blueprint corrects to 33→34.** Make sure the PRD is updated, otherwise QA might flag a false negative. Blueprint already calls this out.

## H. Plan-bundle prerequisites

- ⚠️ **`weeksBetween(now, past) === 1` edge case.** Research §2 confirms `weeksBetween` clamps to `Math.max(1, ...)`. So a past `targetDate` produces `weeks = 1`, which `scaffoldPlanFromTemplate(1)` must handle. No one has audited what `scaffoldPlanFromTemplate(1)` does — does it fit all 3 phases into 1 week? Returns the template unchanged with a single-week phase? Throws? Recommend: dev reads `src/lib/plan.ts` to confirm `scaffoldPlanFromTemplate(1)` doesn't throw, OR add a guard: `if (weeks < 2) throw new Error("targetDate too soon — plan needs at least 2 weeks")`.
- 💡 **No Program row touched.** Research §1 shows the nested write creates Goal + Plan + PlanRevision. There is no Program row creation in the existing flow. Confirm `scaffoldPlanFromTemplate` doesn't reference an active Program; if it does, `createGoalCore` must either fetch one or accept a `programId`. Cheap to verify; blueprint should make this explicit.

## I. MCP tool ordering

- 💡 Blueprint slots `create_goal` AFTER `update_goal_legend`, keeping the "goal cluster" together. Alphabetical/thematic ordering would put `create_goal` BEFORE `update_*`. Doesn't matter for Claude's tool selection (it reads the full list), but `tools/list` output ordering is exposed in protocol. **Stability matters more than order**: pick a position and stick to it. Blueprint's choice is fine; just document so a future agent doesn't "alphabetize" the registration order and break diff stability.
- ⚠️ Naming: thematic neighbors are `update_goal_targets`, `update_goal_legend`, `add_goal_reference`. The verb `create_goal` is consistent (creates a new entity), `add_*` is for items added to an existing entity, `update_*` is mutate. Naming is fine. (See section K for verb consistency check.)

## J. Description-text token budget

- ⚠️ **Aggregate description size.** Rewritten `update_goal_legend` (~1750 chars) + new `create_goal` description (~600 chars from blueprint C.3) = ~2350 new chars. Existing `tools/list` payload was ~3-4 KB; will become ~5-6 KB. Within reasonable connector-config token budget for current claude.ai. No single description > 2000 chars (the rewritten `update_goal_legend` is the largest at ~1750). OK for now.
- 💡 As a soft cap rule: any single tool description > 2000 chars should justify itself in the PR description. Future feature additions to tool descriptions will compound; total should stay < 8 KB.

## K. Anything else

- ⚠️ **Test pollution / no `delete_goal` MCP tool.** Confirmed: research §3 + tool list shows no `delete_goal`. Cleanup is via UI's delete button or direct DB. Blueprint E recommends `prisma.goal.deleteMany({ where: { objective: { startsWith: "Test:" } } })` plus a `Test:` prefix convention. Acceptable, but:
  - The blueprint doesn't say WHO runs that cleanup. The QA agent? The orchestrator? After every smoke run, or once at the end?
  - Recommend: orchestrator runs it once after final acceptance, before merging. Document in QA-agent prompt.
- 💡 **Verb consistency.** The MCP tool family verbs: `log_*`, `apply_*`, `update_*`, `add_*`, `delete_*`, `clear_*`, `get_*`, `recent_*`, `weekly_*`, `export_*`. There's no existing `create_*` verb — `create_goal` introduces a new verb pattern. Alternatives: `add_goal` (matches `add_goal_reference`) or `start_goal` (matches the lifecycle "start a new training cycle"). However: `add_goal_reference` adds a reference TO an existing goal, not a new goal. `add_goal` would be ambiguous. `create_goal` is the clearest. **Decision**: stick with `create_goal`; it's the one true creation verb in the surface. Document in the description.
- ⚠️ **`goal-core.ts` import cycle risk.** Blueprint C.1 imports `GoalTarget` type from `@/lib/goal-actions`, while `goal-actions.ts` imports `createGoalCore` from `@/lib/goal-core`. This is `import type` only on the core side, so TS handles it (type-only imports are erased). Should compile fine, but **lint/tsc with `verbatimModuleSyntax: true` would flag it**. Verify `tsconfig.json` doesn't enable that flag (research didn't capture it; quick check needed).
- 💡 **`Legend` type not yet exported from `src/lib/legend.ts`.** Blueprint C.1 + risk register both call it out: dev must add `export type Legend = z.infer<typeof LegendSchema>` if missing. Confirm during agent run; trivial.
- ⚠️ **Blueprint C.1 stores `notes: notes ?? null`** but the existing form action passes `notes: notes` (truthy-ored to null up-front; same effect). Fine. Just verify: if MCP caller passes `notes: ""` (empty string), is that stored as empty string or null? Blueprint says `notes ?? null` — empty string is truthy-falsy here, `??` only catches null/undefined, so `""` stores as `""`. Form path uses `(form.get("notes") as string | null)?.trim() || null` — empty string becomes null. **Asymmetry**: MCP would store `""`, form would store `null`. Likely benign (UI probably treats both the same), but worth normalizing: `notes: notes?.trim() || null` in core.

---

## Summary verdict

**APPROVED with 4 concerns documented and 2 blockers requiring resolution before code.**

Blockers (must address):
1. **Section B**: PRD §6's claim that `LegendSchema` rejects `[]` is false; the runtime maps `[]` → null. Update PRD acceptance text and ensure `create_goal` description tells Claude this.
2. **Section F**: Decide and document — does `COACH_INSTRUCTIONS` constant in `[token]/route.ts:67-89` get rule 11 appended in this PR, or only the doc + claude.ai connector? Triple-source drift is the silent killer here.

Top concerns (recommend addressing in this PR):
- **D**: USER_TZ form/MCP asymmetry is a real cross-surface user-visible bug; either fix in REQ-A1 (cheap, 2 lines) or document loudly in PR description as known follow-up.
- **A**: Move objective/targetDate guards INTO `createGoalCore` so the contract is enforced at one boundary, not duplicated in callers.
- **H**: Confirm `scaffoldPlanFromTemplate(1)` doesn't blow up on past dates.
- **K**: Normalize `notes: ""` → null in the core for parity with form path.

Everything else is documentation polish or future work. The architecture's bones are sound: extracting `createGoalCore` is correct (research §5 + §8 prove the `"use server"` constraint); slotting `create_goal` after `update_goal_legend` is fine; the `Prisma.JsonNull` vs `undefined` decision matrix is correct (research §4); the parallel-edit plan for `tools.ts` is workable. Ship after addressing the two blockers.

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-auto-legend-on-goal-creation/agents/architecture-critique.md
