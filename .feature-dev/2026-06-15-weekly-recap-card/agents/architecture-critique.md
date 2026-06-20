# Architecture Critique — Weekly Recap Card

**Author**: Devil's Advocate Agent
**Date**: 2026-06-15
**Subject**: `architecture-blueprint.md` (2026-06-15)
**Cross-refs**: `PRD-weekly-recap-card.md` · `requirements.md` (5 REQs) · `research-output.md` · `docs/ux-research/weekly-recap-card.md` · `CLAUDE.md` · `.claude/quality-tools.md`
**Verdict**: **NEEDS REVISION** — 4 critical bugs must be fixed before any code is written. Blueprint is otherwise structurally sound.

---

## Critical Issues

### CRIT-1 — `dayOfProgram` for `weekOffset=0` will show a FUTURE day number

**What**: Blueprint §3.1 note 6 says:

```typescript
const refDay = startOfDay(sunday);  // clamp to today for weekOffset=0
```

The comment claims a clamp, but no clamp is implemented. For `weekOffset = 0`, `sunday = endOfWeekSunday(monday)` is always next Sunday — up to 6 days in the future. If today is Wednesday of Week 3 (Day 17), `startOfDay(sunday)` is Day 21, so the card header reads "Week 3 · Day **21** of 84" instead of "Day **17** of 84".

**Why it matters**: This is what the card's header will show on every current-week render — always wrong by 0–6 days. The PRD AC 10 is "Header string equals Week N · Day M... from plan startedOn" — this fails.

**How to fix**: Mirror `getTodayContext` exactly — that function uses `startOfDay(now)` (the actual current date), not the end of the week. The correct pattern:

```typescript
const refDay = weekOffset === 0
  ? startOfDay(asOf)    // current week: show today's actual program day
  : startOfDay(sunday); // past week: show the week's last day (correct — that's the final state)
```

**Severity**: CRITICAL

---

### CRIT-2 — `Date` objects in `WeeklyRecap` cannot cross the server→client boundary; dateRangeLabel update for non-initial `weekOffset` forces a forbidden convention violation

**What**: `WeeklyRecap` has `weekStart: Date` and `weekEnd: Date`. In Next.js App Router, passing a `Date` object as a prop to a `"use client"` component is problematic — Next.js's RSC serialization converts `Date` to an ISO string, so at runtime in `RecapClient.tsx`, `initialRecap.weekStart` is a string, not a `Date`. Calling `.getTime()` on it throws `TypeError: initialRecap.weekStart.getTime is not a function`.

The blueprint's §8 "SIMPLE OPTION" for updating the date label when `weekOffset` changes says:

> derive client-side from `new Date(initialRecap.weekStart.getTime() + weekOffset * 7 * 86400000)`

This code:
1. Calls `.getTime()` on what will be a string at runtime → throws.
2. Uses raw ms arithmetic on a Date boundary — explicitly forbidden by conventions ("no raw `setHours`/`getDate`") and by the codebase's own gotcha note (quality-tools.md §Stack gotchas #5): "Raw `setHours(0,0,0,0)` / `getDate()` against `process.env.TZ=UTC`... silently rolls 'today' at the wrong moment." The underlying concern is DST; `.getTime()` arithmetic shares the same hazard.
3. `@/lib/calendar` is a server-only module (imports Prisma transitively) — it can't be used client-side.

**Why it matters**: Stream B's `RecapClient.tsx` needs to display an updated date range when the user clicks ◀/▶. The blueprint leaves this unresolved, then recommends an approach that will throw at runtime AND violates conventions. Both streams will silently diverge on what the label shows.

**How to fix** (choose one, architect decides before coding):

Option A (recommended): Add `weekLabels: string[]` to `WeeklyRecap` that pre-computes labels for a rolling 26-week window, OR expose a lightweight `GET /recap/label?weekOffset=N` endpoint that returns just the label string. Stream B fetches it on demand.

Option B: Remove `weekStart: Date` and `weekEnd: Date` from the serialized props entirely. Pass only `dateRangeLabel: string` (for the initial render) and `weekOffset: number`. The client shows the current label until the new preview image loads; the label can be displayed once the image route responds (images already carry the correct label encoded in the card itself). This is the simplest safe option — the label on the page lags one server round-trip but the user sees the correct card immediately.

Option C: Keep `weekStart` but serialize it as a string (`weekStartISO: string`) in the props type, and derive the label with a pure US date formatter on the client (`new Intl.DateTimeFormat(...)`). No calendar module needed, no `.getTime()` arithmetic — pure wall-clock formatting from an ISO string that Next.js can safely serialize.

Regardless of option chosen: **freeze the decision in the blueprint before Stream B writes a single line of `RecapClient.tsx`**.

**Severity**: CRITICAL

---

### CRIT-3 — `RecapPR.units` maps to a field that does not exist on `ExerciseSummary`

**What**: The `RecapPR` type (blueprint §2) declares:

```typescript
/** Human-readable unit string from ExerciseSummary (e.g. "lb", "reps", "sec"). */
units: string;
```

The actual `ExerciseSummary` type (`src/lib/records.ts:55-65`) is:

```typescript
{
  name: string;
  equipment: string | null;
  sessionCount: number;
  totalSets: number;
  primary: "rm" | "reps" | "duration";  // NOT "lb"/"reps"/"sec"
  bestValue: number;
  bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null };
  bestDate: Date;
}
```

There is no `units` field. `primary` is an enum (`"rm" | "reps" | "duration"`) — not a human-readable unit string. Stream A will produce a TypeScript error (`Property 'units' does not exist on type 'ExerciseSummary'`) or silently assign `undefined` if they use `s.units` directly.

**Why it matters**: `prCount` / `prs[]` is a card stat that will render broken units (either an undefined/empty string or a type error that kills the build).

**How to fix**: Derive the unit string from `primary` in `computeWeeklyRecap`:

```typescript
const UNIT_FROM_PRIMARY: Record<ExerciseSummary["primary"], string> = {
  rm:       "lb",    // estimated 1RM
  reps:     "reps",
  duration: "sec",
};

prs = weekPRs.map(s => ({
  name:      s.name,
  bestValue: s.bestValue,
  units:     UNIT_FROM_PRIMARY[s.primary],
}));
```

Document this mapping in the blueprint so Stream A doesn't guess.

**Severity**: CRITICAL

---

### CRIT-4 — Baseline PRs omitted despite REQ-001 explicitly requiring `getBaselineSummaries`

**What**: REQ-001 states:

> "Reuses: `getExerciseSummaries`/`getBaselineSummaries` (`@/lib/records`) for PRs-this-week (bestDate ∈ week)"

Blueprint §3.1 note 8 only calls `getExerciseSummaries()`. `getBaselineSummaries()` is never mentioned anywhere in the blueprint. This is a silent drop of half the PR source.

**Why it matters beyond completeness**: `getBaselineSummaries()` doesn't have a `bestDate` field — it has `latest.date` (most recent test) and `earliest.date`. "Baseline PR this week" is not the same as "latest baseline happened this week"; it requires knowing whether the ALL-TIME BEST value for a test occurred in this week. `getBaselineSummaries()` as currently written cannot answer this without additional logic (it doesn't expose a `bestDate` analogous to `ExerciseSummary.bestDate`).

This means either:
(a) The architect decided baseline PRs are out of scope (and REQ-001 should be updated to remove the reference), OR
(b) A new query/helper is needed to find baseline PRs by date range (not a trivial addition).

**How to fix**: Make the decision explicit in the blueprint. If baseline PRs are in scope, add a `prBaselines: BaselinePR[]` field to `WeeklyRecap` (or extend `RecapPR` with a `source` discriminator) and document the query needed. If baseline PRs are out of scope, remove the `getBaselineSummaries` reference from REQ-001 and note why. Do not leave it ambiguous — Stream A will guess wrong.

**Severity**: CRITICAL — scope decision that affects REQ-001 acceptance criteria and the `WeeklyRecap` type

---

## Design Concerns

### DC-1 — `fs.readFileSync(path).buffer` is unsafe for Buffer pool slices (HIGH)

**Blueprint §5.2 / §7 pattern:**
```typescript
const fontGeistRegular: ArrayBuffer = fs.readFileSync(
  path.join(FONTS_DIR, "Geist-Regular.ttf")
).buffer as ArrayBuffer;
```

`Buffer.buffer` returns the ENTIRE underlying `ArrayBuffer`, which may be larger than the actual content if the Node.js buffer pool shared a backing store. For files above ~8KB (all subset TTFs will be 20-40KB), Node allocates a dedicated `ArrayBuffer`, so this is likely safe in practice. However, the safe, correct pattern is:

```typescript
const raw = fs.readFileSync(path.join(FONTS_DIR, "Geist-Regular.ttf"));
const fontGeistRegular: ArrayBuffer = raw.buffer.slice(
  raw.byteOffset,
  raw.byteOffset + raw.byteLength,
) as ArrayBuffer;
```

The research output (`Q1`) and blueprint both note "TypeScript may require `as ArrayBuffer` cast" but neither mentions the slice. Add the slice pattern to the blueprint to prevent a subtle satori font-loading failure if Node.js ever changes its buffer allocation strategy or if a very small subset font hits the pool.

**Severity**: HIGH

---

### DC-2 — `@gabe` footer handle is hardcoded with no field in the contract (HIGH)

**UXR-recap-15** specifies: `GOALDMINE + @gabe` in the footer. Neither `WeeklyRecap` nor `TemplateTokens` carries an Instagram handle field. Stream A will hardcode `"@gabe"` in `recap-card.tsx`.

This is user-specific copy in a feature designed to be "goal-generic." It creates:
- A `grep -ri "gabe" src/lib/recap-card.tsx` hit (analogous to the Elbert grep test)
- A code change required to update the handle

Add `instagramHandle: string | null` to `WeeklyRecap` (aggregated from an env var or config, null = omit from footer). Stream A reads it from `process.env.INSTAGRAM_HANDLE ?? null` and places it in the type. The card renders it only when non-null. This is a 2-line fix that keeps the card truly generic.

**Severity**: HIGH — hardcoded user-specific copy in a goal-generic contract

---

### DC-3 — `IMAGE_OPTIONS` and font loading forced to be duplicated with vague justification (MEDIUM)

Blueprint §7 states:

> "Do NOT share it from a common module to avoid any import-side-effect issues in the route build graph. Define it independently in both locations with identical values."

This forces two independent copies of `IMAGE_OPTIONS` (with font `data` `ArrayBuffer` references) in `tools.ts` AND in the route handlers. The stated reason — "import-side-effect issues in the route build graph" — is not explained. `src/lib/og-config.ts` with module-scope `fs.readFileSync` calls is plain Node.js — no edge-runtime concern, no React context, no side effects that Next.js would object to. Both consumers (`tools.ts` and `card/route.tsx`) are in the same Node.js runtime.

If a font file is renamed or a third template font is added, both copies must be updated. This is a real maintenance hazard, not a theoretical one.

**How to fix**: Either (a) create `src/lib/og-config.ts` exporting `IMAGE_OPTIONS` and the font buffers, imported from both locations, or (b) document precisely which build-time error was observed that motivated the duplication (so Stream A can verify whether the concern is real in this version of Next/Turbopack). If the concern is real, it belongs in `docs/project-gotchas.md`.

**Severity**: MEDIUM — maintenance hazard and undocumented constraint

---

### DC-4 — `noGoalTargets` conflates three distinct states the card needs to distinguish (MEDIUM)

**Blueprint §2 definition:**
> "True when goal is null OR goal.progressPct is null (no focus goal, or focus goal has no/all-missing targets)."

There are actually three states with different PRD-specified rendering:

| State | `goal` | `targets` | `progressPct` | PRD §6 says |
|-------|--------|-----------|---------------|-------------|
| No focus goal | null | — | — | "Progress bar hidden or shows 'Set goal targets'" |
| Goal exists, no targets | not null | [] | null | "Progress bar hidden or shows 'Set goal targets'" |
| Goal exists, all targets missing | not null | [T1, T2] | null | "'—' not 0%" |

`noGoalTargets = true` conflates all three into the same flag, but "Set goal targets" is a very different card message from "—". The flag is insufficient for Stream A to render the card correctly — they need to know whether to show the CTA text or the muted dash.

**How to fix**: Either split into `noFocusGoal: boolean` + `noTargetsDefined: boolean` + keep `noGoalTargets` for all-missing-targets, OR add a `goalState: "no-goal" | "no-targets" | "all-missing" | "has-data"` discriminant to `WeeklyRecap`. The latter is cleaner for Stream B as well (they could filter the card preview label).

**Severity**: MEDIUM — rendering ambiguity visible on every card without a focus goal

---

### DC-5 — Number formatting responsibility not assigned; format not specified (MEDIUM)

`WeeklyRecap.volumeLb: number | null` carries the raw number (e.g., 48300). The UX spec shows "48,300 lb" with comma-thousands formatting. The template token constants (`TemplateTokens`) carry no formatting hints.

The blueprint never specifies:
- Which component formats numbers (RecapCard? directly in the JSX?)
- The format spec (Intl.NumberFormat with "en-US"? always whole numbers? thousands separator?)
- Whether `prCount` shows as "4" or "04" (zero-pad?)

Since `RecapCard` is owned by Stream A and is the only render site, A will guess. If UX feedback at QA requests "18,240" with a comma and A shipped "18240", that's a rework of Stream A code with Stream B already merged. Document the format in the blueprint: "All numeric card values formatted via `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)` for volume/elevation (comma-grouped integers); `prCount`, `workoutsCompleted`, `streakDays` rendered as plain decimal string."

**Severity**: MEDIUM — guaranteed visual divergence from UX spec without explicit format

---

### DC-6 — WASM cold-start risk in MCP tool is undersold (MEDIUM)

Blueprint §14 S3 spike notes "first call ~100-200ms extra; acceptable." The research output Risk 1 is more honest: "`@vercel/og/index.node.js` dynamically imports WASM... may not deduplicate across requests."

On Vercel's serverless, the stateless MCP endpoint creates a fresh Node.js invocation on cold start. `ImageResponse` relies on `resvg.wasm` and `yoga.wasm` via dynamic `import()` inside `@vercel/og`. In testing by the `@vercel/og` maintainers, cold-start WASM initialization can take 500-800ms (not 100-200ms) on the first invocation per cold container. For a tool called once per week ("make my recap card" on Sunday), the cold-start rate could be near 100%.

The acceptance criterion for S3 ("verify it resolves; WASM loads") is underspecified. Add a timing assertion: "S3 passes only if `tools/call` returns within 5 seconds even after a fresh cold start (restart dev server, call immediately)." If it exceeds that, revisit module-level WASM pre-warming or accept the latency in the tool description.

**Severity**: MEDIUM — could produce a timeout failure in claude.ai if the claude.ai MCP connector has a short timeout

---

### DC-7 — Phase 1 stub content is underspecified — Stream B may build against wrong nullability (MEDIUM)

Blueprint §12 Phase 1 says:

> "Create `src/lib/recap.ts` [export WeeklyRecap type + all sub-types; stub computeWeeklyRecap returning hardcoded fixture]"

The fixture content is not specified. Stream B will be coding their route handlers and client component against whatever stub A ships. Risks:
- Stub returns `prs: []` but the type says `RecapPR[]` with unresolved `units` field (CRIT-3)
- Stub misses `noGoalTargets` or `noProgram` flags → Stream B's TypeScript passes but their empty-state JSX is untested
- Stub hardcodes `weekStart: new Date("2026-06-09")` as a Date → the server-client boundary issue (CRIT-2) will not surface until Stream B integrates

**How to fix**: Specify the exact stub fixture in the blueprint. Include at least one non-null value for every field and explicitly type the stub return as `WeeklyRecap`. This makes CRIT-2 and CRIT-3 surface during Phase 1 compilation — exactly the right time.

**Severity**: MEDIUM — type issues will surface late (integration) not early (Phase 1)

---

## Suggestions

### S-1 — Slide 3 `header.programWeek === null` rendering not specified (LOW)

UXR §4.6 says slide 3 ("Closing") shows "On to Week N." where N is `header.programWeek + 1`. When `header.programWeek === null` (no active plan), the blueprint is silent. Specify: either omit the "On to Week N." line entirely (show only the streak and footer), or show "On to Week —." in `mutedText`. Add this to the empty/zero state table in §10.

---

### S-2 — `topMetricLabel: null` case missing from empty state table (LOW)

The §10 empty/zero state rules table covers all `WeeklyRecap` fields except `topMetricLabel`. When null (no usable targets), the progress bar sub-label should be omitted entirely — but this isn't documented. Add a row: `topMetricLabel | null (no usable targets) | Omit sub-label; bar still renders`.

---

### S-3 — QA AC 8 only smoke-tests slide 1; PRD requires all 3 (LOW)

Blueprint §15 AC 8: "curl /recap/story/1 → 1080×1920 PNG"

PRD AC 8: "GET /recap/story/1|2|3 each return a 1080×1920 PNG"

The QA gate should be three separate curls: slides 1, 2, and 3. Slide 2 ("The Numbers" with the 2×2 grid) and slide 3 ("Closing" with the large Bullseye) exercise different JSX paths that could fail independently.

---

### S-4 — `RecapPR` has no `source` discriminator; future baseline PR addition breaks the frozen contract (LOW)

`RecapPR` has `name, bestValue, units`. If baseline PRs are added later (per CRIT-4's resolution), you'll need `source: "exercise" | "baseline"` to let the card render them differently (baseline PRs typically show test name + value, not exercise name + weight). Add `source` now at zero cost; its presence won't affect exercise PR rendering.

---

### S-5 — Cardio-only week renders `volumeLb: 0` (not null), reads as "0 lb" in primaryText — probably wrong (LOW)

A week with completed workouts that are all cardio (no `weightLb`/`reps` sets) would produce `workoutsCompleted: 1, volumeLb: 0`. The null rule says `volumeLb = null when workoutsCompleted === 0`. Cardio-only week: `workoutsCompleted > 0` so `volumeLb: 0` — this renders "0 lb" in `primaryText` (normal color), not the muted "—". The `emptyWeek` flag is false. This could be argued either way, but the spec should explicitly address it. Consider `volumeLb = (rawVol > 0 ? rawVol : workoutsCompleted === 0 ? null : null)` — i.e., null whenever no volume was lifted regardless of whether workouts occurred.

---

### S-6 — `@gabe` BottomNav line reference will drift (LOW)

Blueprint §11 says "At line 57–60, the Progress tab's match predicate." The actual predicate currently starts at a different offset (it's inside an array literal). Dev agents should verify by content-matching, not line number. The blueprint should say "find the `match: (p) => p.startsWith('/progress')` predicate in `src/components/BottomNav.tsx`" rather than citing a line number.

---

## Missing Requirements

### MR-1 — PRD AC 6 ("grep elbert") passes but `@gabe` is an equivalent hardcoded-person issue

The blueprint tests for Elbert via grep but introduces a hardcoded `@gabe` Instagram handle in `recap-card.tsx` with no corresponding grep test. If the codebase principle is "no user-specific hardcodes in goal-generic modules," the grep should extend to handles. With the fix in DC-2 (`instagramHandle` from env), this concern evaporates.

### MR-2 — No acceptance criterion for the date range label updating correctly after weekOffset change

The 12 ACs in both the PRD and the blueprint §15 don't include: "after clicking ◀ twice, the date range label on `/recap` reflects 2 weeks ago." This is a visible user-facing behavior that could regress silently. The label update mechanism (CRIT-2) should be proven correct in AC 9 or a new AC 13.

### MR-3 — No acceptance criterion for `streakDays` live-clock caveat being visible in the card copy

PRD §6 documents the accepted limitation: "streakDays reflects the game-engine current streak (documented caveat for historical weeks)." Blueprint §2 says "document in card footer copy for past weeks." But no acceptance criterion verifies this copy exists on the card when `weekOffset < 0`. Add it or drop the requirement from the blueprint to avoid a QA ambiguity.

---

## Risk Assessment Table

| # | Dimension | Risk | Severity | Probability | Impact if unaddressed |
|---|-----------|------|----------|-------------|----------------------|
| CRIT-1 | USER_TZ / dayOfProgram | `weekOffset=0` shows future program day | Critical | Certain | Wrong header every current-week render |
| CRIT-2 | Interface contract / Date objects | `weekStart: Date` breaks RSC→client; label update uses forbidden arithmetic | Critical | Certain | Runtime throw in RecapClient; convention violation |
| CRIT-3 | Type safety / RecapPR.units | No `units` field on ExerciseSummary | Critical | Certain | Build error or runtime `undefined` units on PRs card |
| CRIT-4 | Completeness / baseline PRs | REQ-001 mentions `getBaselineSummaries`; blueprint silently omits it | Critical | Certain | REQ-001 AC fails; scope ambiguity persists into dev |
| DC-1 | next/og correctness | `Buffer.buffer` unsafe slice | High | Low–Medium | Silent satori font failure on some Node versions |
| DC-2 | Goal-generic correctness | `@gabe` hardcoded in card JSX | High | Certain | User-specific hardcode in goal-generic module |
| DC-3 | Parallel-dev hazard | IMAGE_OPTIONS duplicated | Medium | Low | Font list drift between MCP and route images |
| DC-4 | Interface contract | `noGoalTargets` conflates 3 states | Medium | High | Wrong rendering: "—" vs "Set goal targets" vs hidden bar |
| DC-5 | Interface contract | Number format unspecified | Medium | Certain | Visual divergence from UX spec at QA |
| DC-6 | next/og correctness | WASM cold-start time underestimated | Medium | Medium | MCP timeout on first call to claude.ai |
| DC-7 | Parallel-dev hazard | Phase 1 stub underspecified | Medium | Medium | Type errors surface at integration, not Phase 1 |
| S-1 | Completeness | Slide 3 null header unspecified | Low | Low | Crash or ugly "Week —" in slide 3 |
| S-2 | Completeness | `topMetricLabel: null` unspecified | Low | Medium | Undefined rendering of bar sub-label |
| S-3 | QA / completeness | AC 8 only checks slide 1 | Low | High | Slide 2/3 regressions invisible |
| S-4 | Interface contract | `RecapPR` no source discriminator | Low | Low | Type change required when baseline PRs added |
| S-5 | Edge state | Cardio-only week volume display | Low | Low | "0 lb" instead of "—" for no-iron weeks |

---

## Verdict

**NEEDS REVISION.** The blueprint is architecturally sound — file plan, ownership, import direction, Satori constraints, token constants, and MCP content-block shape are all correct. The contract-freeze mechanism (§2–§3) is the right pattern for parallel dev.

However, four bugs would survive the Phase 1 TypeScript check and produce wrong output or runtime failures in production:

1. **dayOfProgram** will be wrong on every current-week card without the `weekOffset=0` clamp.
2. **`WeeklyRecap` with `Date` fields** will throw in `RecapClient.tsx` and the date label update mechanism is an unresolved convention violation.
3. **`RecapPR.units`** has no source field — TypeScript will error or the value will be `undefined`.
4. **Baseline PRs** — REQ-001 explicitly requires them; the blueprint silently drops them without a documented decision.

---

## Must-Fix Before Coding (10-line summary)

1. **CRIT-1**: Add `weekOffset === 0 ? startOfDay(asOf) : startOfDay(sunday)` to the `refDay` line in §3.1 note 6.
2. **CRIT-2**: Remove `weekStart: Date` and `weekEnd: Date` from the props passed to `RecapClient`; pick one of the three resolution options and freeze it in the contract before Stream B writes a line.
3. **CRIT-3**: Add the `UNIT_FROM_PRIMARY` mapping to §3.1 note 8 and correct the `RecapPR.units` comment to remove the false claim it comes directly from `ExerciseSummary`.
4. **CRIT-4**: Architect decides whether baseline PRs are in scope. If yes, add `getBaselineSummaries()` query logic, a `source` discriminator on `RecapPR`, and the date-range filter. If no, update REQ-001 to remove the reference.
5. **DC-2**: Add `instagramHandle: string | null` to `WeeklyRecap`; populate from env; remove the hardcoded `@gabe` from the card template spec.
6. **DC-4**: Replace `noGoalTargets: boolean` with a tri-state discriminant (`"no-goal" | "no-targets" | "all-missing" | "has-data"`) or split into two flags; update §10 empty state table accordingly.
7. **DC-5**: Add a "number formatting" row to §13 Critical Decisions specifying the exact format function.
8. **DC-7**: Specify the exact hardcoded fixture that the Phase 1 stub must return, typed as `WeeklyRecap`, so CRIT-2 and CRIT-3 surface at compile time in Phase 1.
9. **S-3**: Update QA AC 8 to require `curl /recap/story/{1,2,3}` for all three slides.
10. **S-2 + S-1**: Add `topMetricLabel: null` and `header.programWeek: null` on slide 3 to the §10 empty state table.
