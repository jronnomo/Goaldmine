# PRD — Recap Caption Composer (#92, story 3.4-a)

**Slug:** recap-caption · **Issue:** #92 (board #8, Backlog, Medium, P2) · **Date:** 2026-06-17
**Epic:** #87 content flywheel. Decomposition: `docs/roadmap/content-flywheel-decomposition.md`.
**UX-research:** skipped — pure lib module (a deterministic string composer); no UI is rendered in this story (the caption is consumed by #93's Share UI later).

## 1. Goal
A deterministic, goal-generic function that drafts a build-in-public Instagram caption from the `WeeklyRecap` bundle — **no LLM** (the app holds no LLM; this is a template). Used by #93's Share UI (via a `/recap/caption` route) and conceptually mirrored by the #94 routine (which composes its own coach-voiced version).

## 2. Confirmed types (research)
- `WeeklyRecap` (recap.ts:103): `dateRangeLabel: string`, `streakDays: number`, `instagramHandle: string|null`, `emptyWeek: boolean`, `highlights: RecapHighlight[]`, `statSlots: ResolvedStatSlot[]`, `goal: RecapGoalBlock|null` (has `objective`, `kind`, `progressPct`), `header` (programWeek / weeksToTarget / targetDateLabel).
- `ResolvedStatSlot` (recap.ts:88): `{ key, label, value, isNull }` (already-formatted strings — e.g. `"5,370 lb"`, `"0/7"`, `"—"`).
- `RecapHighlight` (recap.ts:49): `{ id, kind, icon, label, sub }` (icon is an emoji; `label` e.g. "Goblet Squat — 65 lb"; `sub` e.g. "new PR").
- `.env.example` does NOT currently document `INSTAGRAM_HANDLE` → add it.

## 3. Design
New `src/lib/recap-caption.ts` (pure, no Prisma/Date/Node — `WeeklyRecap` is already serialized):
```ts
export function composeCaption(recap: WeeklyRecap, highlight: RecapHighlight | null): string
```
**Caption structure (deterministic template, goal-generic):**
1. **Opener** — the goal + week frame, from the goal's own data:
   - fitness (`header.programWeek != null`): e.g. `"Week 7 · Day 46 — Summit Mt. Elbert via Black Cloud Trail"` (objective from `recap.goal.objective`).
   - project (`header.weeksToTarget != null`): e.g. `"15 weeks to Sep 30 — Ship Chewgether to the App Store"`.
   - no goal / someday: just the date range.
2. **Featured highlight** (if `highlight`): `"${highlight.icon} ${highlight.label}${highlight.sub ? ` — ${highlight.sub}` : ""}"` (e.g. `"🏆 Goblet Squat — 65 lb — new PR"`).
3. **Stats line** — from `statSlots`, skipping `isNull` slots: `"${label} ${value}"` joined by `" · "` (e.g. `"WORKOUTS 4 · VOLUME 5,370 lb · NEW PRs 7"` for fitness; `"MILESTONES 0/7"` for project — MRR `—` is null → skipped). **Goal-generic — labels/values come from statSlots, never hardcoded.**
4. **Streak** (if `streakDays > 0`): `"🔥 ${streakDays}-day streak"`.
5. **Empty week** (`emptyWeek === true`): a gentle "quiet week" line instead of stats — e.g. `"A quiet week — back at it."` (honest, no fake stats).
6. **Hashtags** — `#buildinpublic` + a goal-kind tag (`#fitness`/`#projectgoal`/generic) + `#goaldmine`. The `instagramHandle` is NOT in the caption body (it's on the card image already; including it would self-@-mention) — instead the caption ends with the hashtags. (If a future need wants the handle in text, add then.)
- **Length:** assemble sections with `\n\n` separators; **truncate to ≤2200 chars** (IG caption limit) — drop the stats line first if over (highlight + opener + hashtags are the priority).
- **Goal-generic guardrail:** zero hardcoded "Elbert"/"Chewgether"/"MRR"/"$" — all content derives from `recap` fields. (The objective string may literally contain "Mt. Elbert" because it's the user's own goal text — that's data, allowed.)

## 4. Edge cases
- `recap.goal === null` → opener is just the date range; no readiness/objective.
- `emptyWeek` → quiet-week line, no stats, but still highlight (none) + hashtags.
- All `statSlots` null (e.g. project with no data) → skip the stats line entirely (don't emit an empty "·" line).
- `highlight === null` → omit section 2.
- `streakDays === 0` → omit section 4.

## 5. Acceptance criteria
1. `src/lib/recap-caption.ts` exports `composeCaption(recap, highlight): string` — pure, no Prisma/Date/Node imports.
2. Goal-generic: content derived from `statSlots`/`highlights`/`goal`/`header`; grep-clean of hardcoded `Elbert`/`Chewgether`/`MRR`/`$` (the objective passthrough is data, not a literal).
3. Skips `isNull` stat slots; handles `emptyWeek` with a quiet-week line (no fake stats); omits highlight/streak sections when absent.
4. Caption ≤2200 chars (truncates stats first if over).
5. Vitest (`src/lib/recap-caption.test.ts`) covers: a fitness fixture (4 stats + a PR highlight + streak), a project fixture (MILESTONES 0/7, MRR null→skipped, no highlight), and an empty-week fixture — asserting the expected lines + the goal-generic/length invariants.
6. `.env.example` documents `INSTAGRAM_HANDLE` (with a placeholder + a comment that it surfaces on the recap card + caption).
7. `npx tsc --noEmit`, lint, `npm run build`, `npx vitest run` pass.

## 6. Verification
tsc · eslint · build · `npx vitest run` (existing 39 + new caption cases green). `grep -nE "Elbert|Chewgether|\bMRR\b|\\$" src/lib/recap-caption.ts` → clean (only structural template, no hardcoded verticals). Confirm `.env.example` has `INSTAGRAM_HANDLE`.
