# Architecture Critique — Story #99 Stale Coach Nudge Guard (app-code piece)

**Reviewer:** Devil's Advocate (read-only)
**Files read:** `src/app/coach/page.tsx`, `src/components/CoachNudges.tsx`, `prisma/schema.prisma`, `src/lib/mcp/tools.ts` (log_open_item handler), `src/lib/calendar-core.ts`, `src/lib/calendar.ts`, `docs/coaching/proactive-coach-routine.md`

---

## CRITICAL

### C-1 — Signal contamination: the query picks up ALL open_items, not just routine-written ones

**The proposed query:**
```ts
prisma.note.findFirst({ where: { type: "open_item" }, orderBy: { createdAt: "desc" } })
```
returns ANY open_item — a user-manually-logged action thread ("Pick the Longs Peak date") lands in the same bucket as a routine-written weekly brief. This breaks the guard in two directions:

**False ALARM (before routine is set up):** If the user has any pre-existing hand-logged open_items (highly likely — the app supports manual logging and the user has been using it), `lastNudgeDaysAgo` is non-null immediately, potentially showing the "may not be running" warning before the routine has ever been configured. The `null` guard correctly handles "zero open_items ever" but the real "routine not yet set up" state maps to "open_items exist from manual use" — a scenario the null-guard does NOT protect.

**False NEGATIVE (broken routine masked):** A user-logged open_item created today makes `lastNudgeDaysAgo = 0`, silencing the guard entirely — even if the routine has been broken for three weeks.

**The routine already has a machine-readable prefix:** `docs/coaching/proactive-coach-routine.md` line 49 specifies all routine-written nudges start with `[week:YYYY-Www]`. This prefix was introduced specifically for dedup, but it also functions as a corpus discriminator.

**Fix:** Narrow the query to routine-written nudges only:
```ts
prisma.note.findFirst({
  where: { type: "open_item", body: { startsWith: "[week:" } },
  orderBy: { createdAt: "desc" },
  select: { createdAt: true },
})
```
Prisma `startsWith` maps to a Postgres `LIKE '[week:%'` prefix scan. Combined with `@@index([type])` (`schema.prisma` line 110), this is efficient on a single-user DB. No migration needed.

With this fix:
- Before the routine is ever set up → zero rows match → `null` → no warning. Correct.
- After setup → routine-written rows are the only signal. Correct.
- A user-logged action thread never contaminates the freshness calculation.

---

## CONCERNS

### P-1 — `createdAt` vs `date`: both work here, but understand why

**Verified in `tools.ts` lines 2425–2432:** `log_open_item` calls `prisma.note.create` with only `body`, `type`, `targetDate`, and `priority`. Neither `date` nor `createdAt` is passed explicitly — both default to `now()` via their Postgres `@default(now())` (`schema.prisma` lines 87, 105). They are identical at insert time.

`update_note` (`tools.ts` line 3239–3276) mutates `body`, `type`, and `targetDate` — but never `date` and never `createdAt`. So both fields are effectively immutable after insert via any MCP tool.

**Conclusion:** `createdAt` is the correct choice for two reasons: (1) it's the conventional Prisma immutable-insert timestamp by naming convention; (2) `date` is semantically "what date is this note about" — on other note types it CAN be set to an arbitrary value by future tools. Using `createdAt` is more defensible. The proposal is correct.

**One nuance:** `targetDate` is the optional "due/decide-by" future date (the routine uses it for gate deadlines). `targetDate` for a routine nudge might be a future date (e.g., the gate hike). The proposal ignores `targetDate` for freshness — correct. `targetDate`-based staleness would be nonsensical.

### P-2 — The `> 8` boundary and exactly-8-days edge case

`> 8` means `lastNudgeDaysAgo === 8` does NOT warn — the warning fires on day 9+. For a weekly routine, a missed run lands the nudge at 7+ days old; day 8 gives one full grace day, day 9 triggers. The doc text at `proactive-coach-routine.md` line 58 says "when the newest nudge is >8 days old" — the code and the doc agree. Acceptable.

Edge case: exactly 8 days. The `Math.floor` in the diff makes this `8`, `> 8` is false, no warning. Correct per the doc's spec.

Recommendation: if the routine ever slips to e.g. Monday due to account-rate-limiting, a 9-day gap (Sunday → Tuesday) triggers correctly. The 8-day threshold is sound for a weekly cadence.

### P-3 — `startOfDay` on both sides of the diff

The proposal says "startOfDay epoch (USER_TZ-safe)" but the implementation detail matters. The correct form is:
```ts
const todayStart = startOfDay(new Date());       // from @/lib/calendar
const nudgeStart = startOfDay(lastNudge.createdAt);
const days = Math.floor((todayStart.getTime() - nudgeStart.getTime()) / 86_400_000);
```
Using raw `getTime()` diff without `startOfDay` on both sides would be off by a partial day at any time other than midnight. Existing patterns in `page.tsx` (`const now = startOfDay(new Date())`, line 94) confirm `startOfDay` is already imported and used for this pattern. This should be followed exactly.

### P-4 — No compound index on `(type, createdAt)`

The proposed query filters on `type` and sorts by `createdAt`. `schema.prisma` has `@@index([type])` (line 110) but no `(type, createdAt)` compound index. For a single-user app with hundreds of notes (not millions), the query will use the `type` index to filter then sort the result set in memory — negligible cost. Not a bug, just worth acknowledging if the table ever grows substantially. No action needed for this story.

---

## SUGGESTIONS

### S-1 — Empty-state text in CoachNudges vs the staleness footer

The current empty-state copy (`CoachNudges.tsx` line 23–25) says "your coach will surface gate alerts, staleness, and the weekly brief here." After this feature lands, "staleness" is surfaced in the footer — not as a nudge in the list. The empty state implicitly promises something that will appear below it (not in it) when the routine is broken. Consider whether the empty-state copy should be tightened ("your coach will surface gate alerts and the weekly brief here") to avoid confusion with the footer guard. Low priority.

### S-2 — `"today"` / `"1 day ago"` prose vs raw number

The proposal handles `lastNudgeDaysAgo === 0` → "today" and `=== 1` → "1 day ago". Both are correct UX. Verify the implementation doesn't accidentally render "0 days ago" for same-day nudges — a quick `if (days === 0) return "today"` guard before the pluralization branch is all that's needed.

### S-3 — Consider surfacing the [week:YYYY-Www] routine prefix to the user

The footer message links to `claude.ai/code/routines` for diagnosis. A small enhancement: if `lastNudge.body?.startsWith("[week:")`, extract the week tag and show it ("Last routine brief: Week 24 · 3 days ago"). This is polish, not scope for #99.

---

## VERDICT

**Approve with required fix on C-1.** The overall design is sound: correct field (`createdAt`), correct serialization (number|null, no Date crossing the boundary), correct null guard for the never-run case, correct threshold for the weekly cadence, and minimal footprint on CoachNudges. The `> 8` threshold matches the doc. Serialization is clean.

**The single required change:** narrow the Prisma query to `body: { startsWith: "[week:" }`. Without this, the guard conflates routine-written nudges with user-logged action threads, producing both false alarms (pre-existing items trigger the ">8 days" warning before the routine is configured) and false negatives (a manual item today masks a broken routine). The routine's `[week:YYYY-Www]` prefix is already the canonical discriminator; the query must honor it.

**Most important finding:** `createdAt` is correct (C-1 answer) — but the field selection is moot if the query doesn't also filter `body: { startsWith: "[week:" }`. That filter is the load-bearing fix.
