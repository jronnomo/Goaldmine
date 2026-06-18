# PRD: Recap Post-State Tracking — mark a week posted; clear the nudge

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-17
**Status**: Draft
**GitHub Issue**: [#95](https://github.com/jronnomo/workout-planner/issues/95) (Story 3.4-d · Epic #87 content flywheel)
**Branch**: main (direct-to-main, worktree dev)

UX-research: invoked — "Posted ✓" indicator + last-posted affordance (per user request in discovery).

---

## 1. Overview

### 1.1 Problem Statement
The `/recap` page lets the user share a weekly recap card to Instagram (Web Share or download fallback). But sharing is fire-and-forget: the app keeps no record that a week was posted. Two consequences:

1. **No "posted" feedback** — the user can't tell at a glance which weeks they've already shared. Re-opening `/recap` looks identical whether or not a week went out.
2. **The weekly nudge keeps nagging** — the proactive-coach Sunday routine writes a `[week:YYYY-Www]` `open_item` nudge ("post your recap") every week. Today the only way to silence it is to dismiss it manually on `/coach`. Posting the recap should itself satisfy and clear that nudge — otherwise the user gets nagged about a thing they already did.

### 1.2 Proposed Solution
When the user completes a share on `/recap` (native Web Share **or** the download/clipboard fallback fires — only a cancelled native share does not count), the client calls a new server action that:

1. **Marks the week posted** — creates a `Note` with `type: "shared_recap"`, keyed to the shared week's Monday (`targetDate`), idempotent (re-sharing reuses the existing marker, never duplicates).
2. **Clears the active nudge** — resolves the newest unresolved routine nudge (an `open_item` whose body starts with `[week:`) so `/coach` stops nagging.

On the read side, `/recap/page.tsx` queries `shared_recap` notes for the visible 13-week window and passes a `postedWeeks` array into `RecapClient`, which renders a **"Posted ✓"** state on the week being viewed.

`shared_recap` is also added to the MCP `NoteTypeShape` Zod enum (additive — `Note.type` is a free string column, no migration) so the coach/routine can read and (optionally) write the marker through MCP. It is naturally excluded from `recent_history` (which only surfaces `journal`/`audible`/`feedback`).

### 1.3 Success Criteria
- After a completed share of week W, a `shared_recap` Note exists for W's Monday, and re-sharing W creates no second note.
- After that share, the newest unresolved `[week:…]` `open_item` is resolved (`resolvedAt` set) → `/coach` no longer shows it.
- Re-opening `/recap` and navigating to W shows a "Posted ✓" indicator; un-posted weeks do not.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2. User Stories

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 | user on `/recap` (PWA) | the app to remember which weeks I've shared | I can see at a glance what's already posted and don't re-post by accident | Must Have |
| US-002 | user who just shared this week's recap | the weekly "post your recap" nudge on `/coach` to clear itself | I'm not nagged about a thing I already did | Must Have |
| US-003 | user re-opening `/recap` | a clear "Posted ✓" indicator on a week I've shared | I trust the post-state and feel the loop closed | Should Have |
| US-004 | coach in claude.ai (MCP) | `shared_recap` to be a recognized note type | I can read post-state without it polluting `recent_history` | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. A new server action `markRecapPosted(weekOffset: number)` in a `"use server"` module that, given a week offset (0…-12 relative to now):
   - Computes the week's Monday via `@/lib/calendar` (`startOfWeekMonday` + `addDays`, USER_TZ-correct).
   - **Idempotent create**: if no unresolved `shared_recap` Note already exists for that Monday, create one (`type: "shared_recap"`, `targetDate` = Monday, `date` = now, human-readable `body`). If one exists, no-op the create.
   - **Clear the nudge**: find the newest unresolved `open_item` Note whose `body` starts with `[week:`; if found, set `resolvedAt` + `resolvedReason` ("recap posted").
   - `revalidatePath("/recap")` and `revalidatePath("/coach")`.
   - Returns a small result (`{ posted: true }`) — never throws on the share path (best-effort; failures must not break the share UX).
2. `RecapClient.handleShare` calls `markRecapPosted(currentWeek.offset)` after a share **completes** — both the native `navigator.share` success branch and the download/clipboard fallback branch. It is NOT called on `AbortError` (user cancelled the native sheet).
3. `/recap/page.tsx` (server) queries `shared_recap` notes covering the 13-week window, maps each to a `weekOffset`, and passes `postedWeeks: number[]` (the offsets that are posted) into `RecapClient`.
4. `RecapClient` renders a **"Posted ✓"** state for the currently-viewed week when its offset is in `postedWeeks`, and optimistically marks the just-shared week posted in local state so the indicator appears immediately (before revalidation lands).
5. `NoteTypeShape` (`tools.ts:96`) gains `"shared_recap"`; the schema comment on `prisma/schema.prisma`'s `Note.type` is updated to list it.

### 3.2 Secondary Requirements
6. `recent_history` continues to exclude `shared_recap` (it already filters to `ACTIVITY_NOTE_TYPES = journal/audible/feedback` — verify no change needed).
7. The "Posted ✓" indicator degrades gracefully: if `postedWeeks` is empty, the Share button looks exactly as it does today.

### 3.3 Out of Scope
- **Un-posting / undo** — once a week is marked posted it stays posted (per discovery decision: idempotent, stays ✓).
- **A dedicated MCP write tool** for marking posted — the enum addition is enough; the web server action is the primary writer. No new `mark_recap_posted` MCP tool.
- **Auto-preparing the recap** (generate card + caption → "recap ready" nudge) — that is story 3.3-e / #94.
- **Per-platform posted tracking** (IG vs other) — a single "posted" boolean per week.
- **Clearing a nudge by exact ISO-week match** — discovery chose "clear the current active nudge"; we resolve the newest unresolved routine nudge regardless of which historical week was shared.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**No migration.** `Note.type` is already a free-form `String @default("journal")`. We introduce a new logical value `"shared_recap"` and store the week anchor in the existing `targetDate` column.

```prisma
// prisma/schema.prisma — Note.type comment update ONLY (no schema change):
type  String  @default("journal")
// audible | journal | feedback | standing_rule | review | open_item | shared_recap
```

- `shared_recap` note shape:
  - `type` = `"shared_recap"`
  - `targetDate` = the week's Monday (00:00 USER_TZ) — the absolute week key, queryable.
  - `date` = now (when the share happened).
  - `body` = human-readable, e.g. `"Shared recap for Jun 9 – Jun 15"` (use `weekRangeLabel`).
  - `resolvedAt` = null (these are records, not pending work; "unresolved" is the natural state and keeps the idempotency query simple).
- Migration plan: **none.** No `prisma migrate dev` needed. Run `npx prisma generate` only if any generated types are touched (they are not — `type` stays `String`).

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| (enum only) | Recognize `shared_recap` as a valid `log_note` type | — | Additive value in `NoteTypeShape`; no new tool, no description change required beyond the enum |

- **No new MCP tool.** The only MCP-surface change is adding `"shared_recap"` to `NoteTypeShape` at `src/lib/mcp/tools.ts:96`:
  ```ts
  const NoteTypeShape = z.enum(["journal", "audible", "feedback", "standing_rule", "review", "shared_recap"]);
  ```
- This makes `log_note({ type: "shared_recap", ... })` validate, should the coach ever want to mark a week posted from claude.ai. `recent_history`/`ACTIVITY_NOTE_TYPES` are unchanged, so the new type does not leak into activity history.
- MCP smoke: `tools/list` must still return `log_note`; `tools/call log_note` with `type:"shared_recap"` must validate (no Zod error).

### 4.3 Server Actions
New file `src/lib/recap-actions.ts` (`"use server"`), mirroring `src/lib/note-actions.ts`:

| Action | Args | Mutation | revalidatePath calls | Returns |
|--------|------|----------|----------------------|---------|
| `markRecapPosted` | `weekOffset: number` | upsert-by-Monday `shared_recap` Note (idempotent) + resolve newest unresolved `[week:` `open_item` | `/recap`, `/coach` | `{ posted: boolean }` |

Notes:
- Compute Monday: `const monday = addDays(startOfWeekMonday(new Date()), weekOffset * 7)`. Clamp `weekOffset` to `[-12, 0]` defensively.
- Idempotency: `findFirst({ where: { type: "shared_recap", targetDate: monday } })` before create. (No DB unique constraint added — the action guards it; concurrent double-fire is acceptable to leave as a rare duplicate, but the guard makes the common re-share path clean.)
- Nudge clear: `findFirst({ where: { type: "open_item", resolvedAt: null, body: { startsWith: "[week:" } }, orderBy: { createdAt: "desc" } })` → if found, `update` with `resolvedAt: new Date(), resolvedReason: "recap posted from /recap"`.
- Wrapped so it never throws to the client (try/catch; return `{ posted: false }` on failure). The share itself already succeeded; marking is best-effort.

### 4.4 Pages / Components
- **Modified `src/app/recap/page.tsx`** (server): after building `weeks`, query posted markers and compute `postedWeeks`:
  - Window: `monday(-12)` … `monday(0)`. Query `shared_recap` notes with `targetDate` in that range.
  - For each note's `targetDate`, derive its offset by matching against the 13 precomputed Mondays (compare via `dateKey` equality — never raw Date `===`). Build `postedWeeks: number[]`.
  - Pass `postedWeeks` to `<RecapClient weeks={weeks} postedWeeks={postedWeeks} />`. **CRIT-2: pass only plain numbers — no Date objects cross to the client.**
- **Modified `src/components/RecapClient.tsx`** (client):
  - New prop `postedWeeks?: number[]` (default `[]`).
  - Local state `locallyPosted: Set<number>` (or `number[]`) seeded from `postedWeeks`, so an optimistic ✓ shows instantly after share.
  - `const isPosted = postedWeeks.includes(currentWeek.offset) || locallyPosted.has(currentWeek.offset)`.
  - In `handleShare`, after a completed share (native success OR fallback download), call `markRecapPosted(currentWeek.offset)` and add the offset to `locallyPosted`. Skip on `AbortError`.
  - Render: when `isPosted`, show a "Posted ✓" affordance near the Share button (exact visual per UX research). The Share button remains tappable (re-share allowed; idempotent).
- **No new routes, no new components, no `BottomNav` change.**

### 4.5 Date / Time Semantics
- All week math via `@/lib/calendar`: `startOfWeekMonday`, `addDays`, `dateKey`. No raw `setHours`/`getDate`/`getMonth`/`getFullYear` in app code.
- `weekOffset → Monday` is the single source of truth shared by the server action (write) and the page (read) so the key is stable.
- Note matching done by `dateKey(monday)` string equality, not Date identity (Prisma returns Date instances; `===` would never match).
- No MCP `date: string` input added → `parseDateInput` not needed here.
- DST: `addDays`/`startOfWeekMonday` are USER_TZ-aware; a DST week boundary still resolves to the correct Monday.

### 4.6 Override-Awareness
- N/A — this feature does not read per-day plan state. No `resolveDay`/`PlanDayOverride` interaction. (Documented explicitly so QA doesn't flag the omission.)

### 4.7 Third-Party Dependencies
- None. No new packages, no external APIs, no `anthropic`/`openai` imports.

---

## 5. UI/UX Specifications

> Final visual is pending `/ux-research`. Baseline spec below; UX findings refine §5.1.

### 5.1 Screen Descriptions
`/recap` at 390 px. The change is a **"Posted ✓"** affordance tied to the currently-viewed week, near the primary Share CTA. Candidate (subject to UX research):

```
┌──────────────────────────────┐
│      [ recap card image ]     │
├──────────────────────────────┤
│  ◀     Jun 9 – Jun 15     ▶   │
│  [ Coal ]      [ Parchment ]  │
│  Featured Highlight  [ ▼ ]    │
│  ┌────────────────────────┐   │
│  │   ✓ Posted   ·  Share   │  │  ← Posted ✓ inline w/ Share CTA
│  └────────────────────────┘   │
│  [ Download Card ]            │
│  [ Story 1 ][ Story 2 ][ 3 ]  │
└──────────────────────────────┘
```

States:
- **Not posted** (default): Share button exactly as today (accent, full-width "Share").
- **Posting in flight**: existing "Preparing…" disabled state (unchanged).
- **Posted** (`isPosted`): a "Posted ✓" indicator appears (badge or label); Share remains tappable for re-share.
- **Share error**: existing `role="alert"` muted note (unchanged).

### 5.2 Navigation Flow
Unchanged. Entry via BottomNav → `/recap`. The posted indicator updates in place when the user navigates weeks (◀/▶) and immediately after a successful share (optimistic).

### 5.3 Responsive + Mobile-First Spec
- 390 px primary; the posted indicator must not push the Share button below 44 px tap height or cause horizontal overflow.
- Tokens only: `var(--accent)`, `var(--muted)`, `var(--border)`, `var(--card)` — no hardcoded colors.
- Card-based layout preserved.

### 5.4 Accessibility
- "Posted ✓" must be conveyed by text (not color/emoji alone) for screen readers — include the literal word "Posted".
- If implemented as a status, use an appropriate role (e.g. `aria-live="polite"` on optimistic update) so the change is announced without stealing focus.
- Maintain visible focus rings on the Share button.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| `markRecapPosted` DB write fails | Caught; returns `{ posted: false }`; share UX already succeeded → no error shown to user (optionally a console note). |
| User cancels native share (AbortError) | `markRecapPosted` NOT called; week stays un-posted; no nudge cleared. |
| Re-share an already-posted week | `markRecapPosted` finds existing marker → no duplicate note; nudge clear is a no-op if already resolved; ✓ stays. |
| No active routine nudge exists | Nudge-clear `findFirst` returns null → skip; marker still created. |
| Multiple unresolved `[week:` nudges | Resolve only the newest (orderBy createdAt desc) — matches "clear the current active nudge" decision. |
| Posted week scrolls out of 13-week window | Not shown (window is 13 weeks by design); acceptable — no historical posted-state beyond the recap window. |
| DST transition within the shared week | Monday computed via USER_TZ-aware `startOfWeekMonday`/`addDays` → correct key. |
| Two devices share the same week concurrently | Rare duplicate `shared_recap` note possible (no DB unique constraint); read path dedupes by offset so UI is unaffected. |
| Long "Posted" label on 390 px | Indicator wraps/truncates without overflow; Share stays ≥44 px. |

---

## 7. Security Considerations
- The server action runs server-side under the same trust boundary as existing actions in `note-actions.ts`; no new public route, no MCP auth bypass.
- Input is a single clamped integer (`weekOffset` ∈ [-12, 0]); no string/SQL injection surface. All DB access via Prisma.
- No `dangerouslySetInnerHTML`; the `body` string is app-generated (`weekRangeLabel`), not user-typed.
- No secrets touched; no `GITHUB_TOKEN`/`MCP_AUTH_TOKEN` in scope.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run build` succeeds (Turbopack).
4. [ ] `NoteTypeShape` in `src/lib/mcp/tools.ts` includes `"shared_recap"`; `prisma/schema.prisma` `Note.type` comment lists it.
5. [ ] MCP `tools/call log_note` with `{ type: "shared_recap", body: "test" }` validates (no Zod error) and writes a row.
6. [ ] `recent_history` does NOT return `shared_recap` notes (still filtered to `journal/audible/feedback`).
7. [ ] `src/lib/recap-actions.ts` exists, is `"use server"`, exports `markRecapPosted(weekOffset)`; it computes Monday via `@/lib/calendar`, creates a `shared_recap` note idempotently (no duplicate for the same Monday), resolves the newest unresolved `[week:` `open_item`, and calls `revalidatePath("/recap")` + `revalidatePath("/coach")`.
8. [ ] `markRecapPosted` is wrapped so it never throws to the caller (returns `{ posted: boolean }`).
9. [ ] `RecapClient.handleShare` calls `markRecapPosted(currentWeek.offset)` on the native-success AND fallback-download branches, and NOT on `AbortError`.
10. [ ] `src/app/recap/page.tsx` queries `shared_recap` notes and passes `postedWeeks: number[]` (offsets) to `RecapClient`; no `Date` object is passed to the client (CRIT-2).
11. [ ] `RecapClient` renders a text-inclusive "Posted ✓" indicator when the current week's offset is posted, including an optimistic update immediately after a successful share.
12. [ ] All week/date math goes through `@/lib/calendar`; `grep -n 'setHours\|setDate\|getHours\|getDate()\|getMonth()\|getFullYear' src/lib/recap-actions.ts src/app/recap/page.tsx` is empty.
13. [ ] Re-sharing the same week does not create a second `shared_recap` note. Idempotency uses a **calendar-day range** query (`targetDate: { gte: monday, lt: addDays(monday, 1) }`), NOT exact DateTime equality (CRIT-1). Verified by: share → DB count of `shared_recap` for that Monday == 1 → share again → count still == 1.
14. [ ] `markRecapPosted` is **awaited** in `handleShare` (not `void` fire-and-forget); the optimistic `setLocallyPosted` precedes the `await` (CRIT-2).
15. [ ] `weekRangeLabel` is moved to `src/lib/calendar-core.ts` and re-exported from `src/lib/recap.ts`; `src/lib/recap-actions.ts` imports it from `@/lib/calendar` (NOT `@/lib/recap`) so the server action does not pull the recap engine (DC-1).
16. [ ] `weekOffset` is `Math.trunc`'d before clamping to `[-12, 0]` (S-1).
17. [ ] Posted visual: a persistent reserved-height `aria-live="polite"` status line reading "✓ Posted to Instagram" (the `✓` is `aria-hidden`) renders above the Share button; the Share button demotes to secondary border style + label "Share again" when `isPosted` (not disabled, focus ring intact); the pre-existing `text-white` on the Share button is replaced with `text-[var(--accent-fg)]` (UXR-95-15). All tokens, no color literals.
18. [ ] Every `UXR-95-*` row in `docs/ux-research/recap-post-state-tracking-ledger.md` is ticked shipped/reworked/dropped with evidence.

---

## 9. Open Questions

_Resolved in discovery (2026-06-17):_
- **What counts as posted?** → Any completed share (native success OR download/clipboard fallback); cancel (AbortError) does not count.
- **Which nudge clears?** → The newest unresolved `[week:…]` routine `open_item` (the current active nudge), regardless of which historical week was shared.
- **Re-share / undo?** → Idempotent; stays ✓; no un-post.
- **UX research?** → Invoked + complete (`docs/ux-research/recap-post-state-tracking.md`). Chosen direction: inline `aria-live` status line "✓ Posted to Instagram" above Share + Share button demotes to secondary "Share again" once posted. User signed off on the demote 2026-06-17.
- **Devil's Advocate?** → Complete (`.feature-dev/2026-06-17-recap-post-state-tracking/agents/architecture-critique.md`, verdict NEEDS REVISION). Required fixes folded into `architecture-blueprint-v2.md` and ACs 13–17: calendar-day-range idempotency (CRIT-1), awaited action (CRIT-2), `weekRangeLabel` moved to calendar-core (DC-1), optimistic re-sync (DC-2), `Math.trunc` offset (S-1). All open items resolved — cleared for Phase 4.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
- `npx tsc --noEmit` — clean.
- `npm run lint` — no new errors.
- `npm run build` — Turbopack build succeeds (verifies `/recap` SSR + `/api/mcp`).

### 10.2 MCP curl smoke
- `tools/list` → confirm `log_note` present and unchanged in count.
- `tools/call log_note` with `{"type":"shared_recap","body":"smoke test"}` → expect success (no Zod validation error).
- `tools/call recent_history` → confirm the `shared_recap` row does NOT appear in activity notes.

### 10.3 Browser smoke
1. `npm run dev`; open http://localhost:3000/recap at 390 px.
2. Share the current week (use download fallback in desktop devtools — Web Share is mobile-only) → confirm "Posted ✓" appears optimistically.
3. Reload `/recap` → confirm "Posted ✓" persists for that week (server `postedWeeks`).
4. Navigate ◀ to an un-posted week → confirm no ✓; navigate back → ✓ returns.
5. Open `/coach` → confirm the active `[week:…]` nudge is gone (resolved by the share).
6. Re-share the same week → confirm no duplicate marker (check via repeated share, no error).

### 10.4 Migration verification
- N/A — no migration. Confirm `npx prisma generate` is NOT required (no `schema.prisma` field change; comment-only edit).

---

## 11. Appendix

### 11.1 Discovery Notes
- Share is currently 100% client-side (`RecapClient.handleShare`) with no server roundtrip — marking posted requires a new server action the client invokes.
- The weekly nudge is an `open_item` Note with body prefix `[week:YYYY-Www]`, written every Sunday by the proactive-coach routine (`docs/coaching/proactive-coach-routine.md`), surfaced on `/coach` via `CoachNudges`, already dismissable via `resolveOpenItem` (`src/lib/note-actions.ts`). The new work is the SHARE path also clearing it.
- `NoteTypeShape` lives at `src/lib/mcp/tools.ts:96`; `ACTIVITY_NOTE_TYPES` (journal/audible/feedback) already excludes new types from `recent_history`.
- CRIT-2 constraint (from prior recap work): `RecapClient` receives only plain serializable props — `{offset,label}[]` today, `+ postedWeeks: number[]`. No Date objects cross the server/client boundary.

### 11.2 References
- Issue #95 (Story 3.4-d), Epic #87, `docs/roadmap/content-flywheel-decomposition.md`.
- `docs/coaching/proactive-coach-routine.md` — `[week:YYYY-Www]` nudge contract.
- Prior recap commits: `e9645c5` (one-tap Web Share on /recap), `89bbfaf` (coach nudge surface).
