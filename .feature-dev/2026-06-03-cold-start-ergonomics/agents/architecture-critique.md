# Architecture Critique — Cold-Start Ergonomics

**Date:** 2026-06-03
**Reviewer:** Devil's Advocate Agent
**Blueprint:** `.feature-dev/2026-06-03-cold-start-ergonomics/agents/architecture-blueprint.md`
**Verdict:** NEEDS REVISION (3 medium issues; 0 critical blockers; safe to build after fixes)

---

## Phase-Shape Verification (Highest Priority Check)

**VERIFIED CORRECT.** The `Phase` type in `src/lib/program-template.ts` (lines 53–61) is:

```ts
export type Phase = {
  index: 1 | 2 | 3;
  name: string;
  weeks: number[];
  goal: string;
  emphasis: string;
  nutrition: NutritionGuidance;
  mobility: MobilityFocus;
};
```

- `Phase.index` — **exists**. Blueprint's `matchedPhase.index` is valid.
- `Phase.name` — **exists**. Blueprint's `matchedPhase.name` is valid.
- `Phase.weeks` — **exists as `number[]`**. Blueprint's `p.weeks.includes(weekIndex)` is valid.
- `program.name` — **exists** on `ActiveProgramSnapshot` (confirmed in `src/lib/program.ts` research; used in blueprint as `program.name`).
- `program.template.totalWeeks` — **exists** on `ProgramTemplate` (line 89 of program-template.ts). Valid.
- `resolveDay` return has `isInPlan: boolean` and `weekIndex: number | null` — **confirmed** from calendar.ts lines 310–323 and `ResolvedDay` type (Appendix B of research).
- `calendar.ts` helper signatures (`startOfDay`, `addDays`, `toDateKey`/`dateKey`, `parseDateKey`) — **all confirmed** (lines 615–670 of calendar.ts).

Phase shape: **clean pass**. This is not a bug.

---

## Critical Issues

None identified. All Phase field accesses are correct, all calendar helpers are present and correctly
aliased (`dateKey` imported as `toDateKey`), and the `workout` relation name on `WorkoutExercise`
(Prisma schema line 34) exactly matches the blueprint's `workout: { id: { not: workoutId } }` filter.

---

## Design Concerns (Medium)

### DC-1: `standingRules orderBy: "asc"` vs `get_today_plan`'s `desc nulls last` — intentional but undocumented [MEDIUM]

**What:** `get_session_brief` queries standing rules with `orderBy: { lastAcknowledgedAt: "asc" }`. In Postgres, `ASC` on a nullable column places `NULL` first (nulls-first is the Postgres default for ascending). `get_today_plan` uses `orderBy: [{ lastAcknowledgedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }]` — which surfaces the most recently acknowledged rule first.

**Result in `get_session_brief`:** Never-acknowledged rules (null) sort to the **top**. Recently-acknowledged rules sort to the **bottom**. This is the opposite of `get_today_plan`.

**Is it intentional?** The blueprint says standing-rule headers exist in `get_session_brief` to give the coach a one-line reminder of what each rule says — not to prioritize freshly-used rules. From a cold-start ergonomics perspective, surfacing *stale* (never-acknowledged) rules first is arguably better — those are the rules most at risk of being forgotten. However, the blueprint never documents this ordering choice. The discrepancy will confuse whoever maintains this code.

**Why it matters:** If the ordering is intentional (stalest first for cold-start), it is semantically correct but needs a code comment explaining the divergence from `get_today_plan`. If it was a copy-paste from an older pattern without thought, it should match `get_today_plan`.

**Recommendation:** Keep `asc` (stale-first is correct for a cold-start orientation) but add a code comment in `get_session_brief`'s query block:
```ts
// ASC puts NULL first (Postgres default) → never-acknowledged rules
// surface first in the brief. Intentional: stale rules are the ones
// the coach is most at risk of forgetting. get_today_plan uses
// desc/nulls-last (freshest first) because it's a per-turn surface.
```

**Severity: Medium** — wrong ordering for the stated purpose is defensible; missing documentation is a maintenance hazard.

---

### DC-2: `nearestMeasurement` unsafe `as` cast + `weightLb: number | null` typing in `weightTrend` [MEDIUM]

**What:** The `nearestMeasurement` helper returns `best as { date: Date; weightLb: number } | null`. `best` is typed as `(typeof mList)[number] | null`, where `mList` is `{ date: Date; weightLb: number | null }[]`. The `null` guard (`if (m.weightLb === null) continue`) ensures `best` will only be set when `weightLb !== null`, but TypeScript does not narrow `best`'s static type through that flow — so `best` remains typed as `{ date: Date; weightLb: number | null } | null`. The `as` cast bypasses this correctly at runtime, but `npx tsc --noEmit` in strict mode will allow the cast only if the cast target is a supertype or subtype. Since `{ weightLb: number }` is a subtype of `{ weightLb: number | null }`, the cast is technically a "downcast" and TypeScript **does** allow it without error (it's not a completely unrelated type), but it suppresses the narrowing guarantee.

The downstream consequence is in `weightTrend`:
```ts
delta7d: m7d && latest && latest.weightLb !== null
  ? Math.round((latest.weightLb - m7d.weightLb) * 10) / 10
  : null,
```
`latest` is `measurements.at(-1) ?? null` typed as `{ date: Date; weightLb: number | null } | null`. The `latest.weightLb !== null` guard narrows correctly within the ternary, but without the cast on `nearestMeasurement`, TypeScript would require `m7d.weightLb` to also be checked (since it is typed `number | null` on the list element). The cast papers over this.

**Will `tsc --noEmit` pass?** Yes — the cast from `{ date: Date; weightLb: number | null }` to `{ date: Date; weightLb: number }` is a valid downcast in TS strict mode and will compile. However it is still a code smell.

**Cast-free fix (recommended):**
```ts
function nearestMeasurement(
  mList: { date: Date; weightLb: number | null }[],
  target: Date,
): { date: Date; weightLb: number } | null {
  let best: { date: Date; weightLb: number } | null = null;
  let bestDist = Infinity;
  for (const m of mList) {
    if (m.weightLb === null) continue;
    const weightLb = m.weightLb; // narrows to number here
    const dist = Math.abs(m.date.getTime() - target.getTime());
    if (dist < bestDist) {
      best = { date: m.date, weightLb };
      bestDist = dist;
    }
  }
  return best;
}
```
Assigns into a correctly-typed `best` variable. No cast, no suppression, tsc happy.

**Severity: Medium** — compiles today; the cast is logically sound; but it is a maintenance debt and will confuse the next developer who reads it.

---

### DC-3: `note.date` ordering for `fetchOpenItems` is wrong; PRD says sort by `targetDate` nulls-last then `createdAt` [MEDIUM]

**What:** `fetchOpenItems` issues a DB query `orderBy: { date: "asc" }` and then sorts in JavaScript. The JavaScript sort uses `a.date.getTime() - b.date.getTime()` as the tie-breaker when both items lack a `targetDate`. PRD §3.1 req 6 says: "sorted by `targetDate` (nulls last), each with an `overdue` boolean". PRD §4.2 says `list_open_items` returns them "sorted by targetDate (soonest first, nulls last) then date." The "then date" tie-breaker is the `Note.date` (write date), not `createdAt`.

In the schema, `Note` has `date DateTime @default(now())` and `createdAt DateTime @default(now())` — both default to now and are effectively the same for newly created open items (both get the same write timestamp). There is no semantic difference between `date` and `createdAt` for `open_item` notes since `log_open_item` sets no explicit `date` (it will take the `@default(now())`).

**Actual bug:** The DB `orderBy: { date: "asc" }` pre-sorts before JavaScript sorting overrides it — but the JS sort already covers all cases, so the DB orderBy is effectively a no-op (overridden by JS). This is harmless but wasteful and slightly confusing.

**Bigger concern:** In `list_open_items`, the `select` clause fetches `{ id, body, targetDate, priority, date }` — `date` is fetched, not `createdAt`. Since they are both `@default(now())` and populated simultaneously, this is fine in practice. However if a developer later allows a backdated `open_item` (explicit `date:` field), the tie-breaking would use the user-visible "about" date, not the creation timestamp, which could reorder items unexpectedly.

**Recommendation:** Change the DB `orderBy` to match the actual sort intent, or drop the DB `orderBy` entirely (JS sort handles it). Also rename the tie-breaker comment to clarify:
```ts
// sort: targetDate asc (nulls last), tie-break by date asc
const items = await prisma.note.findMany({ where: ..., select: ..., orderBy: { date: "asc" } });
// JS re-sort is needed for nulls-last behavior (Prisma requires explicit nulls: "last" syntax)
items.sort((a, b) => { ... });
```
The real fix is using Prisma's native `orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }]` and removing the JS sort entirely, which is cleaner and pushes sorting to the DB.

**Severity: Medium** — functionally correct (JS sort wins), but the DB `orderBy` is misleading and the pattern should be clean.

---

## Suggestions (Low / Non-blocking)

### S-1: `weekIndex` past `totalWeeks` — behavior is well-defined but worth documenting [LOW]

If `daysDelta >= totalWeeks * 7`, `resolveDay` sets `isInPlan = false` and `weekIndex = null` (the condition at calendar.ts line 320 is `daysDelta < program.template.totalWeeks * 7`). The blueprint's guard `if (resolved.isInPlan && program && resolved.weekIndex !== null)` correctly returns `plan = null` after the program ends. This is PRD §6's "No active goal/plan → plan = null" case and is handled correctly. No code fix needed; a one-line comment in the blueprint's plan block would be helpful.

---

### S-2: DST in `daysToGo` — `Math.round` is sufficient [LOW]

`daysToGo` divides two `startOfDay(...)` values by `86400000`. Both are USER_TZ midnight instants produced by `userTzWallClockToUTC` (calendar.ts lines 595–603), which does not use `getTime()` delta arithmetic — it re-derives the UTC offset explicitly. Across a DST boundary the two midnight instants will differ by 23h or 25h of UTC milliseconds, not exactly 24h. `Math.round` covers ±1h of DST slop and returns the correct calendar-day count. Acceptable. No fix needed.

---

### S-3: `recordsSetInWorkout` N+1 queries — acceptable for log_workout's exercise count [LOW]

The function issues one `findMany` query per unique `name+equipment` group. For a typical workout of 5–8 exercise groups that is 5–8 sequential queries after the initial exercises load. Given that `log_workout` is a write path (not a hot read path) and already performs a large `create` with nested `sets`, 5–8 extra reads are fine. No performance risk worth addressing.

If this ever needs to scale, a single `prisma.workoutExercise.findMany({ where: { name: { in: names }, workout: { id: { not: workoutId } } }, include: { sets: true } })` could batch-load all prior sets in one query, then group in memory. That is an optimization for a later sprint if needed.

---

### S-4: Metric-type-change branch in `recordsSetInWorkout` — valid but nearly dead code [LOW]

The "prior primary !== this primary" branch (`priorSummary.primary !== thisSummary.primary`) is logically correct. In practice it will never fire: `bestSetSummary` determines primary by data shape (does the exercise have weight+reps? → "rm"), and for any named exercise the data shape is stable across sessions unless the user fundamentally changes how they log it (e.g. switching from weighted to bodyweight-only). The branch is harmless dead code that protects against an unlikely edge case without adding complexity. Acceptable.

---

### S-5: `promote_note` now accepts `type:"review"` via updated `NoteTypeShape` — intentional but worth auditing [LOW]

Adding `"review"` to `NoteTypeShape` means `promote_note(id, type:"review")` becomes valid. This is correct per PRD §3.2 req 14. However `promote_note`'s description says "The intended use is promoting a feedback-type note into standing_rule." After the enum change, `promote_note` will also allow promoting any note to `"review"`. Since `lastAcknowledgedAt` stamping only triggers on `type === "standing_rule"`, promoting to `"review"` stamps nothing and returns the old type + new type. This is fine; the description should be updated to reflect the broader use (or at least not exclude `review` as a target).

---

### S-6: `batch_log_note` gains `"review"` type silently — acceptable, worth confirming intent [LOW]

`batch_log_note` uses `LogNoteSchema` which uses `NoteTypeShape`. After the change, `batch_log_note` accepts `type:"review"` in bulk operations. `logNoteCore` does not treat `"review"` specially (no `lastAcknowledgedAt` stamp for reviews). This is correct and intentional. No code change needed; the `batch_log_note` description should be updated to mention `"review"` alongside the existing type list.

---

### S-7: `resolve_open_item` on an already-resolved item — behavior is "updates again", not idempotent [LOW]

The blueprint does not guard against calling `resolve_open_item` on a note where `resolvedAt` is already set. The PRD says "idempotent-ish: updates resolvedAt/reason again or no-ops; report count." The blueprint's implementation re-updates `resolvedAt = new Date()` and `resolvedReason = reason`. This is fine (the PRD explicitly accepts it), but the QA checklist item for this case should be verified: the resolved item should still stay out of `list_open_items` (which filters `resolvedAt: null`), so re-resolving an already-resolved item is invisible to the read surface. Correct.

---

## Missing Requirements

### MR-1: `update_note` description not updated for `"review"` [LOW]

The blueprint's D-8 describes updating `log_note`'s description for `"review"`, but does not call out updating `update_note` or `delete_note` descriptions. Both `update_note` (line 2009) and `delete_note` (research §6, line 2078) enumerate note types in their descriptions as `"journal, audible, feedback, standing_rule"`. After the enum change, those descriptions are out of date. This is docs-only (no behavior change), but should be in REQ-007 scope.

---

### MR-2: `log_note` description update only mentioned in D-8, not in the file-plan or REQ-007 spec [LOW]

Section 10 (CLAUDE.md Update Spec / REQ-007) updates the tool inventory but does not mention updating `log_note`'s inline description (from "Audible / journal / feedback / standing_rule" to include "review"). This is mentioned in D-8 but absent from the implementation checklist (§11 QA Checklist). The developer is unlikely to forget it if they read D-8, but it should be added as a checklist item.

---

### MR-3: `open_item` not added to `NoteTypeShape` — correct per PRD, but `update_note` cannot retype a note to `open_item` [LOW]

The blueprint explicitly excludes `"open_item"` from `NoteTypeShape` (correctly). The consequence is that `update_note` cannot change a note's type to `"open_item"` and `promote_note` cannot target `"open_item"`. This means if the user writes a `journal` note that should have been an `open_item`, the only fix is: `delete_note` + `log_open_item`. This is a user workflow gap but matches PRD §3.3 out-of-scope ("No backfilling via update_note/promote_note for open_item"). Document in the tool description for `update_note`/`promote_note` that `"open_item"` is not targetable this way — use `log_open_item` instead.

---

## Risk Assessment

| # | Risk | Severity | Probability | Blueprint Correct? | Recommendation |
|---|------|----------|-------------|-------------------|----------------|
| 1 | Phase field names (`index`/`name`/`weeks`) wrong | Critical | — | **YES — VERIFIED CORRECT** | No fix needed |
| 2 | `program.name` / `template.totalWeeks` missing | Critical | — | **YES — VERIFIED CORRECT** | No fix needed |
| 3 | `standingRules orderBy: "asc"` vs `desc nulls last` inconsistency | Medium | Certain | Intentional but undocumented | Add comment explaining divergence |
| 4 | `nearestMeasurement` unsafe `as` cast | Medium | Will compile; logic correct | Logically correct | Replace with cast-free typed variable |
| 5 | `fetchOpenItems` DB `orderBy` vs JS sort mismatch | Medium | Certain (harmless) | Functionally correct | Push sort to DB with `nulls: "last"` or remove DB orderBy |
| 6 | `weekIndex` past `totalWeeks` → `plan = null` | Low | Handled | Correct | Add comment |
| 7 | DST in `daysToGo` | Low | Math.round covers it | Correct | No fix needed |
| 8 | N+1 in `recordsSetInWorkout` | Low | Acceptable for write path | Correct | No fix needed |
| 9 | Metric-type-change branch dead code | Low | Correct | Correct | No fix needed |
| 10 | `promote_note` / `batch_log_note` description drift after enum change | Low | Certain | Missing from docs spec | Add to REQ-007 checklist |
| 11 | `resolve_open_item` on already-resolved item | Low | Acceptable per PRD | Correct per PRD | No fix needed |
| 12 | `update_note` / `delete_note` description drift | Low | Certain | Missing from docs spec | Add to REQ-007 |
| 13 | `tsc --noEmit` on `as` cast | Low | Will pass (valid downcast) | Passes | Cast-free fix is cleaner |

---

## Verdict: NEEDS REVISION

**No blocking correctness bugs.** The Phase shape, `program.name`, `program.template.totalWeeks`, `resolveDay` return fields, and all Prisma relation names (`workout`, `sets`) are verified correct against the real code. The blueprint will compile and run correctly as written.

Three medium issues should be fixed before handing to the developer:

1. **DC-1 (standing-rule ordering):** Add a code comment explaining `asc` (stale-first) in `get_session_brief` diverges from `get_today_plan`'s `desc nulls last`. Zero code change; one-line comment.

2. **DC-2 (unsafe `as` cast):** Replace `best as { ... }` with a correctly-typed local variable in `nearestMeasurement`. Prevents future type-narrowing confusion; no behavior change.

3. **DC-3 (`fetchOpenItems` sort):** Replace JS sort + misleading DB `orderBy: { date: "asc" }` with Prisma's native `orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }]` and remove the JS sort. Cleaner, pushes sort to the DB, matches PRD intent.

Low-severity items (MR-1, MR-2, MR-3) should be folded into the REQ-007 docs pass by the developer — they are description-only changes with no behavioral impact.
