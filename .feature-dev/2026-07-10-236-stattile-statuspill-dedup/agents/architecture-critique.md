# Architecture critique — issue #236 StatTile/StatusPill dedup

**Verdict: APPROVE-WITH-CONDITIONS**

The consolidation is sound and the design's own line-number citations all check out
against the actual repo. Two concrete, must-fix conditions found (both mechanical,
both would surface as build/lint failures if missed — not silent runtime bugs, but
still worth handing to the developer explicitly so they don't burn a review cycle).
No blocking risks.

---

## Attack results

### 1. ul→div swap (calendar/page.tsx:141)
**Ruling: no risk.** `node_modules/tailwindcss/preflight.css` (lines ~194-200) already
resets `ol, ul, menu { list-style: none; }` and the base reset zeroes margin/padding/border
on all elements. `src/app/globals.css` has zero custom `ul`/`li`/`::marker`/`[&>li]`
selectors (`grep -n -iE "\bul\b|\bli\b|list-style|marker"` over globals.css returns
nothing but an unrelated comment at line 314). Repo-wide `[&>li]`/`[&_li]`/`[&>ul]`
arbitrary-variant grep is empty. So the ul→div swap is visually inert.

**a11y note (non-blocking):** current markup is `<ul><li>...</li>×4</ul>` (calendar/page.tsx:141,164-171,
`Stat` returns `<li className="... list-none">`). Post-migration it's `<div><StatTile/>×4</div>`
(StatTile is a plain `<div>`). This drops list semantics (AT previously announced
"list, 4 items"; now an anonymous group of 4 divs). Low-value list (4 number/label pairs)
so not blocking, but flag it — don't let the developer claim "zero a11y impact."

### 2. tabular-nums on migrated tiles
**Ruling: no risk.** `StatTile.tsx:27` already hardcodes `tabular-nums` unconditionally
and is already live on `/progress` (Totals row, progress/page.tsx:262-264) and `/compare`
(8 call sites, compare/page.tsx:381-398, including non-numeric-looking values like
`"3 → 4"` for Level). This is proven-safe in production today. The three newly-migrated
tiles (calendar Stat, progress WeightStat, burndown BurndownStat) currently lack
tabular-nums (confirmed by reading each), so the design's "gains tabular-nums" framing
is accurate, not a change to already-styled-with-tabular-nums content.
Width check: all migrated grids already carry `text-center` and are 3–4 col at max-w-md;
values are short integers or "159.2 lb"-shaped strings — tabular-nums affects digit
glyph width only, not a wrap risk at these lengths.

### 3. Tone-flip completeness
**Ruling: verified complete, and the type system is a real safety net.**
- `StatusPill` in baselines/page.tsx:166-189 has `tone: "emerald" | "amber" | "red" | "muted"` —
  a string-literal union, not `string`. Its only 4 call sites are baselines/page.tsx:34-37,
  all static literals (no ternaries/template-literal tone construction found repo-wide).
- `StatusPill` in RecordsSummary.tsx:188-211 already has `tone: "success" | "warning" | "danger" | "muted"` —
  i.e. RecordsSummary is *already* on the target vocabulary; its 4 call sites
  (RecordsSummary.tsx:49-52) need zero changes, confirming the design's "call sites unchanged" claim.
- Because both are literal unions, forgetting to re-tone a baselines call site would be a
  **compile-time TS error**, not a silent color bug — attack premise (TS should catch this) confirmed correct.

### 4. formatBest identity (baselines:216-223 vs RecordsSummary:213-224)
**Ruling: byte-identical bodies** (only whitespace/line-wrap differs):
```
if (e.primary === "rm") return `~${Math.round(e.bestValue)} lb 1RM (${e.bestRaw.weightLb} × ${e.bestRaw.reps})`;
if (e.primary === "reps") return `${e.bestValue} reps`;
if (e.primary === "duration") return formatDuration(e.bestValue);
if (e.primary === "distance") return `${e.bestValue.toFixed(2)} mi`;
if (e.primary === "time") return formatDuration(e.bestValue);
return String(e.bestValue);
```
Same parameter shape in both (`{ primary, bestValue, bestRaw: { weightLb, reps, durationSec } }`).
Safe to hoist verbatim.

### 5. countByStatus identity (baselines:204-210 vs RecordsSummary:167-173)
**Ruling: byte-identical.**
```
function countByStatus(list: ScheduledBaseline[]): Record<CheckpointStatus, number> {
  const out: Record<CheckpointStatus, number> = { done: 0, due: 0, overdue: 0, upcoming: 0 };
  for (const s of list) { for (const c of s.checkpoints) out[c.status]++; }
  return out;
}
```
Safe to hoist verbatim. `formatDuration` (baselines:225-229 vs RecordsSummary:226-230) is also byte-identical.

### 6. statusClass/statusTextClass identity + call sites
**Ruling: identical switch logic, different names only** — baselines' `statusClass`
(baselines:191-202) and RecordsSummary's `statusTextClass` (RecordsSummary:175-186) both map
done→success, due→warning, overdue→danger, default→muted, to the same `text-[var(--x)]` classes.
**Additional call sites found (beyond the pills, as the attack predicted):**
- baselines/page.tsx:148 — `<span className={statusClass(next.status)}>` inside `ScheduledRow`
  (per-row next-checkpoint label color, unrelated to the StatusPill component).
- RecordsSummary.tsx:77 — `<span className={statusTextClass(next.status)}>` inside the
  testsDue list, same purpose.

**Gap in the design's migration list:** the design says "delete `statusClass` (:191) ... import shared"
but the shared function is named `statusTextClass` (RecordsSummary's name, per design item 3). It does
not explicitly say to rename the call site at baselines/page.tsx:148 from `statusClass(...)` to
`statusTextClass(...)`. If the developer deletes the local function and imports the shared one but
forgets this call site, it's a `ReferenceError`-shaped TS "cannot find name 'statusClass'" build failure —
caught by `tsc`, not silent, but worth stating explicitly to avoid a wasted round trip. **Added to
instructions below.**

### 7. Import cycles / server purity
**Ruling: no risk.** `src/lib/records.ts:1-9` imports only `@/lib/calendar`, `@/lib/db`,
`@/lib/program-template` — nothing from `src/components/`. A new `src/lib/baseline-format.ts`
importing types from `@/lib/records` cannot cycle back into components. Both source files
(baselines/page.tsx, RecordsSummary.tsx) are server components (no `"use client"` directive,
`async function` components) — the functions being extracted are already plain, pure,
non-hook functions, so `baseline-format.ts` is trivially server-safe/client-safe either way.

### 8. StatTile testId prop / burndown-stat-* query sites
**Ruling: no risk, but the current data-testid has zero live consumers.**
Repo-wide grep for `burndown-stat` and `data-testid` in any `*.test.ts(x)` file: only hits
are the definition sites in MilestoneBurnDown.tsx:65-67 and two *documentation* mentions
(docs/prds/PRD-236-...md, docs/ux-research/sprint-4-project-ui.md — descriptive, not
executable). No Vitest test, no Maestro/e2e yaml (`find . -iname "*.yaml" -o -iname "*.yml" | xargs grep -l "burndown\|StatTile"` → empty) references these hooks today.
Moving `data-testid` from `BurndownStat`'s own div to `StatTile`'s wrapper div preserves the
exact same DOM position (StatTile's wrapper is a `<div>`, same as BurndownStat's), so even if
a future test targets these ids, the migration doesn't change their DOM location — just their
implementation source. Safe.

### 9. Component-merge question (should StatTile and StatusPill be one component?)
**Ruling: NO, confirmed correct — the markup is genuinely different, not superficially so.**
StatTile (StatTile.tsx:25-30):
```
<div className="rounded-lg border border-[var(--border)] py-2 text-center">
  <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
  <p className="text-xs text-[var(--muted)]">{label}</p>
</div>
```
StatusPill (RecordsSummary.tsx:205-210, baselines equivalent identical):
```
<div className={`rounded-lg border ${cls} py-2`}>
  <p className="text-lg font-semibold tabular-nums">{count}</p>
  <p className="text-xs">{label}</p>
</div>
```
Real differences: (a) StatTile tints only the value text; the border and label always stay
neutral (`border-[var(--border)]`, `text-[var(--muted)]`). StatusPill tints the *whole pill* —
border opacity-40 AND both text rows inherit the tone color via CSS `color` inheritance from
the wrapper div (neither inner `<p>` sets its own color). (b) StatTile bakes in `text-center`;
StatusPill relies on the parent grid's `text-center` (present at both call sites, so currently
masked, but it's a real prop/behavior difference, not just naming). These are different visual
components with different tone-application semantics — merging them would require either
losing StatusPill's full-pill tint or adding a second tone axis to StatTile. Keep separate.

### 10. Render routes for RecordsSummary / MilestoneBurnDown
**Both render only on `/progress`** (src/app/progress/page.tsx):
- `<MilestoneBurnDown goalId={focusProjectGoal.id} />` — progress/page.tsx:208, gated on
  `focusProjectGoal` (a focus goal with `kind === "project"`) — will only be visible in the
  browser if the seeded/logged-in test account's focus goal is a project-kind goal.
- `<RecordsSummary />` — progress/page.tsx:258, ungated, always renders on `/progress`.

So the full browser verification list for this ticket is: `/calendar`, `/progress` (covers
both StatTile Totals/Weight tiles AND RecordsSummary's StatusPill), and `/baselines`. MilestoneBurnDown
needs a project-kind focus goal active to be visible on `/progress` — confirm the dev/test
account's active focus goal before relying on visual verification there, or temporarily
swap focus goal if it's currently the fitness goal (per this repo's MEMORY, the founder's
current focus is the fitness goal "Mt. Elbert", not the project goal "Chewgether" — so
MilestoneBurnDown will NOT render by default against the founder's real data; needs the
project goal to be `isFocus=true`, or a second Goal fixture, to visually verify).

### 11. Additional risks found
- **Unused import — confirmed, asymmetric between the two files.** `CheckpointStatus` is imported
  in baselines/page.tsx:3 and, after deleting `statusClass` (:191) and `countByStatus` (:204), has
  **zero remaining uses** in that file (`grep -n "CheckpointStatus" src/app/baselines/page.tsx` shows
  only the import and the two doomed functions) — `type CheckpointStatus` must be dropped from that
  import line or ESLint's unused-vars rule fails. By contrast, in RecordsSummary.tsx, `CheckpointStatus`
  is **still needed** after the same deletions — it's used at RecordsSummary.tsx:36 inside the
  `testsDue` sort (`const order: Record<CheckpointStatus, number> = ...`), a function (`nextCheckpoint`
  logic) that is NOT part of this dedup and stays local. Do not blanket-strip the import from both files
  the same way.
- **`ScheduledBaseline` import stays needed in both files** — baselines/page.tsx:130 (`ScheduledRow`)
  and RecordsSummary.tsx `nextCheckpoint`/testsDue logic both still reference it after the dedup deletions.
  No action needed, just confirming it's not also orphaned.
- **`Stat` name in calendar/page.tsx** does not collide with anything else in that file (only its own
  4 call sites at :142-145 and its own definition at :164); safe to delete outright.
- **progress/page.tsx already imports StatTile** (`import { StatTile } from "@/components/StatTile"` at
  line 10) and already uses it 3x for the Totals row (:262-264) — confirmed no duplicate-import risk;
  the WeightStat migration is additive to an existing import, not a new one.
- **StatTile's `tone` union is narrower than StatusPill's** — `StatTile.tsx:15` is
  `tone?: "success" | "danger" | "muted"` (no `"warning"`). Not a blocker for this design (none
  of the 3 newly-migrated StatTile call sites pass a `tone` at all), but flag it so nobody
  later reaches for StatTile expecting a `"warning"` tone and gets a silent TS union error.
- **compare/page.tsx does not need any changes** for this ticket — it already consumes StatTile
  fully; the design correctly excludes it from the migration list.

---

## Instructions for the developer agent (deltas vs. the design doc)

1. **baselines/page.tsx call-site rename (attack 6):** after deleting the local `statusClass`
   function (:191-202) and importing the shared status-color function from `@/lib/baseline-format`
   (named `statusTextClass`, per design item 3), update the call site at **baselines/page.tsx:148**
   from `className={statusClass(next.status)}` to `className={statusTextClass(next.status)}`. This
   is the only call site of the deleted function outside the StatusPill markup itself.
2. **baselines/page.tsx unused import (attack 11):** after removing the local `statusClass` and
   `countByStatus` functions, drop `type CheckpointStatus` from the `@/lib/records` import at
   baselines/page.tsx:3 — it has no remaining use in that file. Do NOT make the same change in
   RecordsSummary.tsx — `CheckpointStatus` stays needed there (RecordsSummary.tsx:36, inside the
   `testsDue` sort's `order` map, which is not part of this dedup).
3. **Browser verification list (attack 10):** verify `/calendar`, `/progress`, `/baselines` at minimum.
   For MilestoneBurnDown specifically, the founder's current focus goal is fitness-kind (Mt. Elbert),
   so the burndown card will not render by default — either temporarily flip focus to the project
   goal (Chewgether) or verify against a project-goal fixture before signing off on the
   `testId="burndown-stat-*"` StatTile migration visually.
4. Optional (non-blocking, call it out but don't block merge on it): consider whether the ul→div
   swap on calendar/page.tsx:141 should keep `role="list"` on the wrapper div for a11y parity, since
   Preflight already made the visual change a no-op but the semantic list-of-4 role is lost.
