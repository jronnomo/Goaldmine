# Architecture Critique — Recap Post-State Tracking (#95)

**Feature**: Mark a week posted; clear the nudge
**Agent**: Devil's Advocate
**Date**: 2026-06-17
**Documents reviewed**: PRD, requirements.md, research-output.md, architecture-blueprint.md
**Code reviewed**: RecapClient.tsx, recap/page.tsx, recap.ts, note-actions.ts, calendar-core.ts, calendar.ts, mcp/tools.ts, coach/page.tsx, prisma/schema.prisma

---

## Critical Issues

### CRIT-1: Idempotency guard uses exact Prisma DateTime equality — the linchpin that must hold without a safety net

**What**: The blueprint's idempotency check is:
```ts
const existing = await prisma.note.findFirst({
  where: { type: "shared_recap", targetDate: monday },
  select: { id: true },
});
```
This is an exact millisecond equality match in Postgres.

**Why it matters**: The PRD locked out a DB unique constraint. That means `findFirst` + `create` is the ONLY guard against duplicate notes. If `findFirst` returns null for any reason, a new note is created unconditionally. Every re-share creates a new row. Over 13 weeks of use, the "rare duplicate" scenario becomes routine rather than rare.

**The specific miss path that IS reachable**: Once `"shared_recap"` is added to `NoteTypeShape`, the coach can call `log_note({ type: "shared_recap", body: "Jun 9..." })` — with no `targetDate` (the field is optional in `LogNoteShape`). That note is stored with `targetDate: null`. Later, the user shares the same week via the web UI: `findFirst({ where: { targetDate: monday } })` sees `monday != null`, never matches the null-targetDate row, and creates a second note. The MCP note and the web note both exist for the same logical week.

**The precision risk (lower, but real)**: The server action writes `monday = addDays(startOfWeekMonday(new Date()), offset * 7)`. `addDays` calls `userTzWallClockToUTC(year, month, day)` which internally does `Date.UTC(year, month-1, day, 0, 0, 0, 0)` — always exactly `00:00:00.000`. This is deterministic, so two separate server-action invocations for the same calendar week produce identical UTC millisecond values. The equality works for action-written notes. But the moment any other code path (present or future) writes a `shared_recap` note with a sub-second offset, the guard silently fails.

**How to fix**: Use a calendar-day range, consistent with the established `dateKey` matching pattern:
```ts
const existing = await prisma.note.findFirst({
  where: {
    type: "shared_recap",
    targetDate: { gte: monday, lt: addDays(monday, 1) },
  },
  select: { id: true },
});
```
This tolerates any `targetDate` on that calendar day in USER_TZ, regardless of millisecond. Add a convention note to the team: `log_note` with `type: "shared_recap"` MUST include `targetDate` = the week's Monday.

**Severity: HIGH** — the design's "no unique constraint; application-level guard" stance is only safe when the guard is bulletproof. This one has a real miss path (optional targetDate via MCP) and a fragile precision assumption.

---

### CRIT-2: Fire-and-forget `void markRecapPosted(...)` may not complete `revalidatePath` before navigation

**What**: The blueprint explicitly marks the call as fire-and-forget:
```ts
void markRecapPosted(currentWeek.offset);
setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));
```
The browser starts an HTTP request for the server action but the client does not await it. On a PWA, the user may tap the home tab or back button immediately after the share sheet closes. The in-flight request may be aborted.

**Why it matters**: If the request is aborted before `revalidatePath("/coach")` runs server-side, the client-side router cache for `/coach` is not invalidated. The user navigates to `/coach` and sees the `[week:` nudge still active — the very thing this feature promises to clear. The DB write (the `prisma.note.update` resolving the nudge) may or may not have completed depending on where in the request the abort landed. At minimum, the cache state is undefined.

**The `force-dynamic` nuance**: Both `/recap` and `/coach` use `export const dynamic = "force-dynamic"`, meaning the server never writes to the full-route cache. `revalidatePath` on `force-dynamic` routes affects only the **client-side router cache** (the RSC payload cache Next.js maintains for soft navigations). This is the exact cache that matters here: the user soft-navigates from `/recap` to `/coach` and sees stale data.

**Why the fix is free**: The optimistic update is already done synchronously with `setLocallyPosted`. Awaiting the server action after that adds no UX delay — the ✓ is already on screen. The share sheet is already dismissed. Awaiting only ensures the HTTP round-trip completes and `revalidatePath` runs.

**How to fix**:
```ts
// In handleShare, after the completed share (native or fallback):
setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));
await markRecapPosted(currentWeek.offset);  // await; never throws; optimistic already done
```
The `markRecapPosted` action is wrapped in try/catch and never throws, so awaiting it inside the existing `handleShare` try block is safe.

**Severity: HIGH** — the feature's primary UX promise ("posting the recap clears the nudge") can silently fail on the most common mobile usage pattern (tap share, immediately tab away).

---

## Design Concerns

### DC-1: `weekRangeLabel` import drags the entire `@/lib/recap` module into the server action bundle

**What**: `recap-actions.ts` imports `{ weekRangeLabel }` from `@/lib/recap`. `recap.ts` transitively imports: `@/lib/db` (Prisma client), `@/lib/goal-presentation`, `@/lib/program`, `@/lib/readiness`, `@/lib/records`, `@/lib/game/engine`, `computeWeeklyRecap`, `getExerciseSummaries`, `computeGameState`, etc.

**Why it matters**: The server action module loads the entire recap computation engine — `computeWeeklyRecap`, `getExerciseSummaries` (all-time PRs), `computeGameState` (badge engine) — to format a single label string like `"Jun 9 – Jun 15"`. This inflates the server action's module graph, increases cold-start latency on Vercel (the action initializes more module-level code), and is fragile against future changes to `recap.ts` (e.g., adding a top-level import that has side effects).

**How to fix**: `weekRangeLabel` (from `recap.ts` lines 237–249) is a pure, 12-line function that only needs `startOfWeekMonday`, `addDays`, `endOfWeekSunday`, and `Intl.DateTimeFormat`. Two options:
1. Move `weekRangeLabel` to `@/lib/calendar-core` (already the right home for USER_TZ label helpers).
2. Implement it inline in `recap-actions.ts`:
```ts
const monday = addDays(thisMonday, clampedOffset * 7);
const sunday = addDays(monday, 6);   // or endOfWeekSunday — same result for midnight-anchored Monday
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: USER_TZ });
const body = `Shared recap for ${fmt.format(monday)} – ${fmt.format(sunday)}`;
```

**Severity: MEDIUM** — not a correctness bug, but violates minimal-dependency principle and creates a maintenance coupling between the server action and the recap computation engine.

---

### DC-2: `locallyPosted` lazy initializer does not re-sync when `postedWeeks` prop updates

**What**: `useState(() => new Set(postedWeeks))` runs only at mount. If the RSC layer re-renders the page (e.g., after the awaited/non-awaited `revalidatePath` lands, or on a soft navigation back to `/recap`), the `RecapClient` may receive a new `postedWeeks` prop but `locallyPosted` stays frozen at the mount-time value.

**Why it matters**: Two concrete failure modes:
1. **False positive ✓** — Server action returns `{ posted: false }` (DB write failed). `locallyPosted` has the offset. `isPosted` is true. User sees ✓ on the current session but it disappears on hard reload. This is accepted as best-effort per PRD, but the false positive is indefinite within the session.
2. **Stale optimistic for a different device** — A second device marks week W posted. The current device does a soft navigation and RSC re-renders with `postedWeeks = [..., W]`. `locallyPosted` was seeded without W at mount, but `postedWeeks.includes(W)` is now true, so `isPosted` IS correct via the prop path. This path works. The concern is only the reverse direction (optimistic > DB truth), which is acceptable.

**How to fix**: The OR logic (`postedWeeks.includes(offset) || locallyPosted.has(offset)`) already prevents the false-negative case (server truth is always visible). The false-positive case can be suppressed by re-syncing on prop change:
```ts
useEffect(() => {
  setLocallyPosted((prev) => {
    const merged = new Set(postedWeeks);
    prev.forEach((o) => merged.add(o));  // keep optimistic additions
    return merged;
  });
}, [postedWeeks]);
```
This merges server truth into `locallyPosted` without losing optimistic additions. Matches the "never un-post" invariant.

**Severity: MEDIUM** — the false-positive ✓ lasts only until hard reload. Acceptable for best-effort, but a simple fix eliminates a surprising user-visible discrepancy.

---

### DC-3: `revalidatePath` on `force-dynamic` pages — misunderstood semantics in documentation

**What**: Both `/recap` and `/coach` have `export const dynamic = "force-dynamic"`. Calling `revalidatePath("/recap")` and `revalidatePath("/coach")` from the server action does NOT invalidate the server-side full-route cache (there isn't one). It ONLY affects the **client-side router cache** (the Next.js RSC payload cache for soft navigations).

**Why it matters**: The comments in the architecture blueprint describe `revalidatePath` as if it invalidates the server rendering cache. Developers may assume that after a `revalidatePath`, the NEXT request to `/coach` from ANY client will re-render. In fact, only the SAME client (the one that called the action) has its cache cleared. This is a subtle but important distinction for a multi-tab or multi-device scenario (even single-user). Combined with the fire-and-forget issue (CRIT-2), the client-side cache may not even be cleared for the current client.

**How to fix**: Document explicitly in `recap-actions.ts`:
```ts
// revalidatePath clears the client-side router cache for these paths.
// Both pages are force-dynamic so there is no server-side full-route cache.
// The client that invoked this action will re-fetch fresh RSC payloads
// on next soft navigation to /recap or /coach.
revalidatePath("/recap");
revalidatePath("/coach");
```

**Severity: MEDIUM** — not a functional bug, but misleading semantics will cause future developers to misdiagnose caching issues.

---

### DC-4: Historical recap share clears the CURRENT week's nudge — logical mismatch in the spec

**What**: If the user navigates to week -3 (three weeks ago) and shares it, `markRecapPosted(-3)` creates a `shared_recap` note anchored to that week's Monday — correct. But the nudge-clear path resolves `findFirst({ body: { startsWith: "[week:" }, resolvedAt: null, orderBy: { createdAt: "desc" } })`, which is the NEWEST unresolved nudge (almost certainly this week's `[week:2026-W25]` routine nudge), not the nudge for week -3.

**Why it matters**: The user posted an old recap. The current week's "post your recap" nudge gets cleared even though the user hasn't posted this week's recap. On the next Sunday, the routine writes a new `[week:2026-W26]` nudge — but for the intervening week (W25), the user never sees the nudge they should have seen. Conversely, the user might share W25 intending to clear the W25 nudge that was dismissed accidentally; the action silently clears W26's nudge instead.

**Note**: This is a locked design decision (PRD §3.3: "Clearing a nudge by exact ISO-week match — discovery chose 'clear the current active nudge'"). The critique does not challenge the decision. But the implementation correctly exposes the spec's logical gap. If the team revisits this, the fix is:
```ts
// Match nudge by ISO week of the shared offset
const weekLabel = `[week:${isoWeekString(monday)}]`; // e.g. "[week:2026-W23]"
where: { type: "open_item", resolvedAt: null, body: { startsWith: weekLabel } }
```

**Severity: LOW** — locked decision; noting for future revisit. Implementation is faithful to spec.

---

## Suggestions

### S-1: Validate `weekOffset` as an integer before clamping

The server action receives `weekOffset: number` from the client. The client sends `currentWeek.offset`, which is always an integer (the `weeks` array uses `-i` for `i` in 0..12). However, the action has no runtime guarantee. If a fractional value like `-0.5` arrives (malformed client or future code change):

```ts
addDays(thisMonday, -0.5 * 7)  // = addDays(thisMonday, -3.5)
```

`addDays` does `new Date(Date.UTC(year, month-1, day + (-3.5)))`. JavaScript's `Date.UTC` coerces the day to an integer via truncation, giving `day - 4` (truncation toward zero loses 0.5 days). The result is a wrong Monday (3 days before Thursday, not 3 weeks before). Add:
```ts
const clampedOffset = Math.max(-12, Math.min(0, Math.trunc(weekOffset)));
```

**Priority: LOW** — client-only inputs today, but worth hardening.

---

### S-2: Add `targetDate` guidance to MCP `log_note` description for `shared_recap` type

Once `"shared_recap"` is in `NoteTypeShape`, `log_note({ type: "shared_recap" })` is valid MCP. The `targetDate` param is optional. Coach could easily omit it. Add a note to the tool description (or a `shared_recap`-specific comment in the enum registration):

```
// shared_recap: week-share marker. Always supply targetDate = the week's Monday
// (yyyy-mm-dd). Without targetDate, the web UI's idempotency guard cannot match
// this note and will create duplicates on next share.
```

---

### S-3: Confirm `handleShare`'s catch block does not accidentally reach the fallback post path

In the current `RecapClient`, the fallback download block and the catch block are siblings at the same nesting level. After blueprint changes, the fallback's `void markRecapPosted(...)` (or `await`) must be placed BEFORE `setShareError("Web Share unavailable...")` — within the fallback's else branch, not after the catch. The blueprint shows this correctly. The QA checklist should explicitly verify this call order to prevent the case where a `catch` from the fallback path (e.g., clipboard API rejection) skips the `markRecapPosted` call.

---

### S-4: Document `"use server"` export-shape constraint in the new file header

The `recap-actions.ts` file uses the file-level `"use server"` directive. All exports must be async functions. Add a lint-visible comment at the top:
```ts
// "use server" — ALL exports must be async functions (Next.js 16 constraint).
// Do NOT export sync helpers, constants, or types from this file — use @/lib/recap
// or @/lib/calendar for those. Consumers that need markRecapPosted's return type
// should import from there directly.
```

This prevents a future developer from accidentally adding a `export const X = ...` to this file and being puzzled by the resulting build error.

---

## Missing Requirements

| # | Gap | Risk | Recommendation |
|---|-----|------|----------------|
| MR-1 | No requirement that `weekOffset` is validated as an integer | LOW | Add `Math.trunc` before clamping in REQ-002 acceptance criteria |
| MR-2 | No MCP coaching convention that `log_note type:"shared_recap"` requires `targetDate` | MEDIUM | Add to MCP docs / tool description comment |
| MR-3 | Acceptance criterion #13 ("no duplicate via repeated share") relies on browser smoke only — no DB-level assertion | MEDIUM | Add a curl sequence to smoke plan: share → DB count query → share again → DB count query; assert count stays 1 |
| MR-4 | No acceptance criterion for the fire-and-forget vs. await behavior | HIGH | AC should specify: "markRecapPosted is awaited in handleShare; the optimistic update precedes the await" |
| MR-5 | No test for the historical-offset share scenario (offset -3 clears newest nudge, not offset-3 nudge) | LOW | Add to test plan: share offset -3 with an active [week: nudge for current week; verify current-week nudge is cleared and the shared week's ✓ appears |

---

## Risk Assessment Table

| Risk | Likelihood | Impact | Severity | Mitigated by |
|------|-----------|--------|---------|--------------|
| Idempotency findFirst misses MCP-written note (no targetDate) → duplicate per re-share | Medium | High | **HIGH** | Use date-range query; document targetDate requirement |
| Fire-and-forget aborted on navigation → /coach shows stale nudge | Medium | Medium | **HIGH** | Await the action after optimistic update |
| Exact DateTime equality breaks on any future non-midnight targetDate write | Low | High | **HIGH** | Use date-range query (same fix as above) |
| Heavy recap.ts import in server action → cold-start overhead | Low | Low | MEDIUM | Move weekRangeLabel to calendar-core |
| locallyPosted stale → false ✓ persists after posted:false | Low | Low | MEDIUM | useEffect re-sync; acceptable for best-effort |
| Historical share clears wrong week nudge | Certain | Low | MEDIUM | Locked decision; document expected behavior |
| MCP log_note creates null-targetDate shared_recap → idempotency gap | Medium | Medium | **HIGH** | Range query fix + doc |
| Float weekOffset → wrong Monday | Very Low | Medium | LOW | Math.trunc guard |
| revalidatePath misunderstood as full-route cache invalidation | Certain | Low | LOW | Documentation |

---

## Verdict

**NEEDS REVISION**

The feature design is well-structured and the locked decisions are sound. The core data model, prop-shape, and component architecture are correct. However, two HIGH issues must be addressed before development starts, and one has a simple fix available:

**Required before Phase 4 (implementation):**

1. **CRIT-1 (HIGH): Replace the exact DateTime idempotency guard with a calendar-day range query.** The current `findFirst({ where: { targetDate: monday } })` has a known miss path (MCP-created notes without `targetDate`) and is fragile against any future change in write provenance. The fix is a single change: `targetDate: { gte: monday, lt: addDays(monday, 1) }`. This does not require a migration or schema change.

2. **CRIT-2 (HIGH): Await `markRecapPosted` in `handleShare`.** The `void` fire-and-forget drops the `revalidatePath("/coach")` call on navigation. Since the optimistic update is already applied, `await` costs zero UX overhead and guarantees cache invalidation.

**Recommended before Phase 4:**

3. **DC-1 (MEDIUM): Move `weekRangeLabel` out of `@/lib/recap`.** Either to `calendar-core.ts` (preferred) or inline in the action. Prevents the action bundle from loading the full recap computation engine.

**Acceptable as-is (document in code):**

4. DC-2 — false-positive ✓ lasts only until reload; acceptable for best-effort.
5. DC-3 — `revalidatePath` semantics are correct but mislead; add comments.
6. DC-4 — locked design decision; expected behavior, needs no code change.
