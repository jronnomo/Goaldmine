# Requirements — Recap Post-State Tracking (#95)

Atomic requirements decomposed from `docs/prds/PRD-recap-post-state-tracking.md`.

---

## REQ-001 — `shared_recap` note type (MCP enum + schema comment)
**Description**: Add `"shared_recap"` to the `NoteTypeShape` Zod enum so `log_note` validates it. Update the `Note.type` comment in the schema to list the new value. No migration — `type` is a free `String`.
**Files**:
- `src/lib/mcp/tools.ts` (line ~96: `NoteTypeShape = z.enum([...])`)
- `prisma/schema.prisma` (Note.type comment, line ~89)
**Acceptance**:
- `NoteTypeShape` includes `"shared_recap"`.
- Schema comment reads `audible | journal | feedback | standing_rule | review | open_item | shared_recap`.
- `recent_history` / `ACTIVITY_NOTE_TYPES` UNCHANGED (still journal/audible/feedback) — verify `shared_recap` is not surfaced.
- MCP `tools/call log_note` with `{type:"shared_recap"}` validates (no Zod error).
**Dependencies**: none.
**Complexity**: S

---

## REQ-002 — `markRecapPosted` server action
**Description**: New `"use server"` module `src/lib/recap-actions.ts` exporting `markRecapPosted(weekOffset: number): Promise<{ posted: boolean }>`. Steps:
1. Clamp `weekOffset` to `[-12, 0]`.
2. Compute Monday: `addDays(startOfWeekMonday(new Date()), weekOffset * 7)` (USER_TZ via `@/lib/calendar`).
3. Idempotent create: if no `shared_recap` note with `targetDate === monday` exists, create one (`type:"shared_recap"`, `targetDate: monday`, `date: now`, `body` via `weekRangeLabel`). Else no-op.
4. Resolve nudge: `findFirst` newest unresolved `open_item` with `body startsWith "[week:"` → set `resolvedAt` + `resolvedReason:"recap posted from /recap"`.
5. `revalidatePath("/recap")` + `revalidatePath("/coach")`.
6. Wrap in try/catch — never throw; return `{posted:false}` on failure, `{posted:true}` on success.
**Files**: `src/lib/recap-actions.ts` (new)
**Acceptance**:
- Module is `"use server"`; export signature matches.
- Monday math via `@/lib/calendar` only (no raw Date primitives — grep clean).
- Note matching by `dateKey` string equality, not Date identity.
- Idempotent: second call for same offset creates no duplicate.
- Nudge resolved when present; no-op when absent; never throws.
**Dependencies**: REQ-001 (type value should exist conceptually; action can be written in parallel but reviewed together).
**Complexity**: M

---

## REQ-003 — Read path: `postedWeeks` in `/recap/page.tsx`
**Description**: Server page queries `shared_recap` notes for the 13-week window and passes `postedWeeks: number[]` (offsets) to `RecapClient`.
1. Precompute the 13 Mondays (offset 0…-12) via `@/lib/calendar`.
2. Query `prisma.note.findMany({ where: { type:"shared_recap", targetDate: { gte: monday(-12), lte: monday(0) } } })`.
3. Map each note's `targetDate` → offset by `dateKey` match against the precomputed Mondays.
4. Pass `postedWeeks` to `<RecapClient weeks={weeks} postedWeeks={postedWeeks} />`.
**Files**: `src/app/recap/page.tsx`
**Acceptance**:
- Only plain `number[]` passed to client — NO Date object crosses boundary (CRIT-2).
- Offsets derived via `dateKey` equality.
- Empty when no posted notes → `postedWeeks = []`.
**Dependencies**: REQ-004 (prop shape must agree).
**Complexity**: S

---

## REQ-004 — `RecapClient` "Posted ✓" state + share-path wiring
**Description**:
1. New prop `postedWeeks?: number[]` (default `[]`).
2. Local optimistic state `locallyPosted` (Set/array of offsets) seeded from `postedWeeks`.
3. `isPosted = postedWeeks.includes(offset) || locallyPosted.has(offset)` for the current week.
4. In `handleShare`: after a COMPLETED share — native `navigator.share` success branch AND the download/clipboard fallback branch — call `markRecapPosted(currentWeek.offset)` and add the offset to `locallyPosted`. Do NOT call on `AbortError`.
5. Render a text-inclusive "Posted ✓" indicator near the Share CTA when `isPosted` (exact visual per UX research). Share button stays tappable (re-share allowed).
6. `navigateToWeek` must not wipe `locallyPosted` (it persists across week nav).
**Files**: `src/components/RecapClient.tsx`
**Acceptance**:
- Prop added; default `[]`; backwards compatible.
- `markRecapPosted` imported from `@/lib/recap-actions`.
- Called on both completion branches, never on AbortError.
- "Posted ✓" contains the literal word "Posted" (a11y); uses theme tokens only.
- Optimistic ✓ appears immediately post-share.
**Dependencies**: REQ-002 (action), REQ-003 (prop). UX research gates the visual.
**Complexity**: M

---

## Streams
- **Backend stream (1 dev)**: REQ-001 + REQ-002 (tools.ts, schema comment, recap-actions.ts).
- **Frontend stream (1 dev)**: REQ-003 + REQ-004 (page.tsx, RecapClient.tsx) — depends on REQ-002 export signature (provide via blueprint).

Both streams touch disjoint files → parallelizable once the action signature is fixed in the architecture blueprint.
