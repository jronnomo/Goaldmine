# Devil's Advocate — #234 override-write-hardening (PRD §3.1/§6)

Verified against HEAD on `feature/phase1-auth`. All line numbers below quoted from live source, not the PRD's paraphrase.

---

## Critical

### C1. The parseDateKey swap is not cosmetic — on the prod (UTC) runtime it is a deterministic, unconditional one-calendar-day corruption of every dashboard-written override, and it has been live since 2026-05-03.

Evidence chain:

- `src/lib/day-actions.ts:87-90` defines a **local, shadowing** `parseDateKey`:
  ```
  function parseDateKey(k: string): Date {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  ```
  This is JS-runtime-local-timezone midnight — **not** `USER_TZ` midnight. It's used at `:19` (`upsertDayOverrideFromForm`), `:61` (`clearDayOverride`), and `:73` (`logNoteForDate`). Note `day-actions.ts:7` imports the *real* `startOfDay` from `@/lib/calendar` but never imports the real `parseDateKey` — so the file mixes one correct (TZ-aware) primitive with one incorrect (naive) one on the same line (`:19`).

- `src/lib/calendar-core.ts:88-91` (the correct implementation, used by MCP):
  ```
  export function parseDateKey(k: string): Date {
    const [y, m, d] = k.split("-").map(Number);
    return userTzWallClockToUTC(y!, m!, d!);
  }
  ```

- Repo-wide grep confirms exactly these two definitions exist — no third variant, no ambiguity about which callers are affected. Every other read/write site against `PlanDayOverride.date` (`calendar.ts:863-865` `resolveDay`, `tools.ts:240-246` `applyDayOverrideCore`, `override-integrity.ts:82`, `plan-lint.ts:296`) goes through `calendar-core.ts`'s pair or a pre-parsed `Date`. `day-actions.ts` is the **sole outlier**.

**Worked example**, dateKey `"2026-07-10"`, on a UTC-runtime server (Vercel default — confirmed no `TZ` env override anywhere in the repo: `vercel.json` doesn't exist, no `TZ=` in any config), `USER_TZ = America/Denver` (MDT, UTC-6 in July):

| Path | Computation | Result (UTC instant) |
|---|---|---|
| day-actions (buggy) | `new Date(2026,6,10)` under runtime-local=UTC → `2026-07-10T00:00:00Z`, then `startOfDay` reformats that instant into Denver wall-clock (`2026-07-10T00:00Z` = `2026-07-09 18:00` Denver) → re-derives **July 9** midnight Denver → UTC | `2026-07-09T06:00:00.000Z` |
| MCP/core (correct) | `userTzWallClockToUTC(2026,7,10,...)` = Denver midnight July 10 | `2026-07-10T06:00:00.000Z` |

**This is not an edge case — it fires on every single dateKey**, unconditionally, whenever the server's runtime TZ is UTC (or anything not equal to Denver's offset) and `USER_TZ` sits behind UTC (true for any Western-hemisphere `USER_TZ`, always true here). The naive `new Date(y,m-1,d)` interpreted at UTC midnight, then re-bucketed through Denver's negative offset, *always* rolls back exactly one calendar day. It is deterministic, not probabilistic — every dashboard-form write/clear on prod since commit `67612c9` (2026-05-03, `git blame -L85,91` confirms this code has never been touched since introduction) stores under `dateKey - 1 day` while `resolveDay` (the read path everyone else uses, including the day-detail page itself) looks it up under the correct `dateKey`.

**Consequences, concretely:**
1. A dashboard-written override for `2026-07-10` is invisible when you view `/days/2026-07-10` (read path computes the correct instant, finds nothing) — it silently resurfaces one day early, in `/days/2026-07-09`'s override slot, colliding with (and silently overwriting, via the `@@unique([planId,date])` upsert target — schema.prisma:413, full-`DateTime` uniqueness, **no `@db.Date` truncation** to save you) whatever the *previous* day's override state was.
2. This means the dashboard form has been effectively unusable for its stated purpose on prod for ~2 months, in a way that fails silently (no error — you just edit the wrong day and never notice unless you go looking).
3. The PRD's own edge-case table (§6, "Existing rows written under the old naive date parse") correctly flags this as a risk but defers the ruling to "DA" without doing the arithmetic — the arithmetic shows this isn't a maybe, it's a certainty given the deployment topology.

**What the PRD does NOT resolve and must, before shipping the swap:**
- **Blast radius is unknown, not zero.** Per project memory ("Local .env is now the DEV branch," inverted 2026-07-01), local dev now points at an isolated Neon *dev* branch — so recent local testing wouldn't touch prod data. But this bug predates that inversion by two months (May 3 → July 1), and the founder's local dev TZ (if it's Denver, matching `USER_TZ`) would have made the bug **invisible in local dev all along** — naive parse in Denver-local-runtime already lands on Denver midnight, no divergence. That means: (a) the bug could ONLY ever have manifested against the **prod** DB, on the **Vercel/UTC** runtime, (b) it would have been silent, and (c) whether it *actually* fired depends entirely on whether the dashboard form (not the MCP path — the coach's calls are unaffected) was ever used against prod between 2026-05-03 and now. This is a factual question about production usage history that this critique cannot answer from source alone.
- **A row-shape repair script is not straightforwardly possible.** The buggy output (`2026-07-09T06:00:00Z`) is not distinguishable in *shape* from a legitimately-correct row for `2026-07-09` — both are "some day's Denver-midnight-in-UTC." There's no `@db.Date`-truncation artifact, no sentinel hour, nothing to `WHERE` on. Detecting a mis-dated row requires either (a) app-level audit logs / Prisma query logs from that window, or (b) manual cross-reference against the founder's memory of when they used the dashboard override form vs. the MCP tool, or (c) accepting the residual risk (single-user app, small dataset — a manual spot-check of all `PlanDayOverride` rows on prod, cross-referenced by eye against known workout history, is tractable at this scale).

**Verdict on this axis: ship the swap — the divergence is actively harmful today and doing nothing is strictly worse — but this cannot go out as a silent code change.** Required before merge:
1. A **prod-only, read-only** query (`db:which` pointed at prod, `SELECT id, planId, date, "updatedAt" FROM "PlanDayOverride" ORDER BY date`) to eyeball whether any rows look plausibly dashboard-written (small `id` count, `updatedAt` in the May–July window) and manually sanity-check them against the calendar. This is cheap and directly answers "does bad data exist" instead of guessing.
2. A one-line gotcha entry (`docs/project-gotchas.md`) documenting the historical divergence window (2026-05-03 → date of fix) so a future "why does this one day's override look wrong" investigation doesn't start from zero.
3. AC #6 ("parseDateKey fix shipped per DA ruling, or filed separately with rationale") should be satisfied by *shipping the fix*, not filing separately — deferring it perpetuates active data corruption on every dashboard form use.

---

## Concerns

### G1. Guard trigger parity — confirmed correct, but the "clearing workout" case deserves an explicit test, not just an edge-case table row.
`settingWorkout = workoutValue !== undefined && workoutValue !== null` (`tools.ts:308`). Blank-textarea-but-notes-filled in the form produces `workoutJson === null` (day-actions.ts:11-28: `workoutRaw` is `null` when blank, and the `if (workoutRaw)` guard at `:22` never assigns anything else), so `settingWorkout` is `false` for both (a) a genuinely notes-only patch and (b) an **explicit clear of an existing override's workout** (user blanks a previously-populated textarea). Both silently skip the guard. This matches core's `workoutJson: null` semantics (`tools.ts:330-331`: `touchedWorkout` fires but `settingWorkout` doesn't) — correct and intentional (nothing to guard when you're *removing* a workout). But the form conflates "field was never populated" with "field was intentionally cleared" into the identical `null`, so this is one behavior serving two different user intents. Not a bug given the guard's purpose, but the PRD's test matrix (§FR-4) should explicitly name this case (`clearing an existing baseline-day override's workout, notes-only edit unrelated` ) rather than rely on the edge-case table row alone — it's exactly the kind of case that regresses silently if someone "cleans up" the `workoutJson ?? null` initialization later.

### G2. Message-string plumbing: confirm `dateKey` passed to the shared helper is the raw caller string, not a recomputed one.
Core's message uses `input.date` verbatim (`tools.ts:315`: `` `Audible on ${input.date} touches the workout...` `` — the raw string the caller passed, not `toDateKey(date)`). For byte-identical output (AC #2), `day-actions.ts` must pass through the original `dateKey` argument to `upsertDayOverrideFromForm(dateKey, form)` unchanged — not `dateKey(date)` recomputed from the (now-fixed) parsed `Date`. Post-fix these should be equal in practice, but the implementation should thread the original string explicitly rather than "helpfully" recomputing it, both for message-format guarantee and to avoid reintroducing a subtle asymmetry if the two `dateKey()`/`parseDateKey()` implementations ever drift again.

### G3. `assertBaselineDecisionMade` doesn't need a leaky-reads mock entry — confirmed, but flag for the new test file instead.
`leaky-reads.test.ts:122-126` mocks `day-template-validation.ts`'s existing two asserts as no-ops; it does **not** need to add the new guard helper, because leaky-reads.test.ts only exercises **read** tool handlers (private-note-leak checks) — the guard is only reachable from `applyDayOverrideCore`, a write path invoked by `apply_day_override`/`batch_apply_day_overrides`, neither of which leaky-reads.test.ts calls. Importing `tools.ts` wholesale (which it must, to get at the read-tool handlers) only *defines* `applyDayOverrideCore`'s function body — it doesn't execute it, so a missing mock entry for `assertBaselineDecisionMade` won't throw. No action needed there. The real risk is in the **new** `day-actions.test.ts`/`day-template-validation.test.ts`: per research item 5, the house convention mocks `@/lib/db` and `getActiveProgram` fully — make sure `@/lib/calendar`'s `parseDateKey`/`startOfDay`/`rotationBaselineNamesForDate` are either mocked consistently with the leaky-reads style (`startOfDay: (d) => d`, etc. — cheap but doesn't exercise real TZ math) or, better, left **un-mocked** so the new tests actually exercise the real `calendar-core.ts` conversion and would have caught C1 in the first place. Given C1, I'd treat "the new test suite runs the real date functions, not stubs" as close to a requirement, not a nice-to-have — a mocked `parseDateKey: (s) => new Date(s)` (leaky-reads.test.ts:75's pattern) would have made this exact regression invisible.

### G4. "Don't punt this to the UI — own the call" appearing verbatim inside the UI banner.
AC-mandated (PRD FR-1: "throwing the tools.ts:314-318 message VERBATIM") and explicitly deferred to #235 for a dashboard-native affordance. Confirmed acceptable as a stopgap — the alternative (diverging the message) breaks AC #2's before/after parity requirement and the PRD is explicit this is a known, deliberate rough edge. No action needed now; if it's not already written down, worth a one-line note in #235's scope so it doesn't get silently forgotten as "already fine."

---

## Suggestions

- **S1.** Pre-read + upsert on day-actions has a benign TOCTOU window (read `existing`, then upsert) identical in shape to core's own (`tools.ts:244` → `:380`). Single-user app, no concurrent writers in practice — not worth a transaction. Explicitly stated so it doesn't get flagged again in review.
- **S2.** A single core-level test of `applyDayOverrideCore`'s guard call (or the extracted helper's own unit tests) is sufficient; the batch path (`tools.ts:4646`, in a `db.$transaction`) is just another caller of the same function — no batch-specific guard behavior exists to test separately. Don't let the test matrix balloon into a duplicate batch-txn guard suite.
- **S3.** Scope check passed: day-actions never touches `nutritionPlan`/`baselineTestNames` (confirmed — only `workoutJson`, `nutritionText`, `mobilityText`, `notes` at `day-actions.ts:36-49`), and the guard/validators don't touch lint (`lintTemplate`/`lintActivePlan` gate plan-template writes only, per `docs/project-gotchas.md` cross-check in research). While in this file, resist the temptation to "also" validate `nutritionPlan` shape on the dashboard path — genuinely out of scope, not touched by either write path today.

---

## Verdict: **APPROVE-WITH-FIXES**

Top 3:
1. **C1 is real and worse than the PRD frames it** — on prod (UTC runtime, confirmed no TZ override anywhere in repo), the naive parse in `day-actions.ts:87-90` unconditionally shifts every dashboard-written override back one calendar day, silently, since 2026-05-03. Ship the swap, but first run a **read-only prod query** to check for mis-dated rows (can't be schema-detected — shape is indistinguishable from a legitimately-correct row) and add a gotchas-doc note; don't defer this to "separately filed."
2. Guard-trigger parity (G1) is correct as designed, but the "explicit clear vs. never-touched" conflation in the form's blank-textarea handling needs its own named test case, not just an edge-case table row — it's the kind of thing that regresses silently.
3. The new test suite should exercise the **real** `calendar-core.ts` date functions rather than the leaky-reads-style stubs (G3) — a mocked `parseDateKey` would have hidden the exact bug this story is fixing.
