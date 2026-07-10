# Devil's Advocate critique — PRD-241 (chart/emoji/alert a11y)

**Verdict: APPROVE-WITH-CONDITIONS**

The emoji and role="alert" work (items 2 and 3) is correct as designed and needs no changes. The chart work (item 1) has one **load-bearing technical error** (aria-hidden cannot go on `<ResponsiveContainer>`) and one **real design gap** the premise check missed (progress/page.tsx already ships hand-rolled, richer aria-labels for WeightChart/ReadinessChart that the PRD's plan would orphan or duplicate). Both are fixable in the same diff; neither requires new scope. Conditions are below, with exact code.

---

## Attack 1 — Tooltip interactivity + aria-hidden placement

**Do these charts use Tooltip?** Yes, all three — confirmed by reading each component:
- `WeightChart.tsx:44-52` — `<Tooltip formatter={...} />`
- `ReadinessChart.tsx:51-59` — `<Tooltip formatter={...} />`
- `HistoryChart.tsx:52-63` — `<Tooltip formatter={...} />`

**Does aria-hidden break tooltips?** No — confirmed. `aria-hidden` only removes an element from the accessibility tree; it does not set `pointer-events: none` and is not `inert`. Grepped the codebase for any global CSS keyed on `[aria-hidden]` (`grep -rn "aria-hidden" src/**/*.css` and `globals.css`) — no rules exist. Tooltips (mouse/touch-driven, attached to the SVG surface layer) are unaffected.

**Where does aria-hidden go — is this actually safe on `<ResponsiveContainer>`?** **No — this is a real bug in the PRD's premise.** Checked `node_modules/recharts/types/component/ResponsiveContainer.d.ts`: the `Props` interface is a closed list — `aspect, width, height, minWidth, minHeight, initialDimension, children, debounce, id, className, style, onResize`. No index signature, no `[key: string]: unknown`. TypeScript will reject `aria-hidden` as an unknown prop. Confirmed further in `node_modules/recharts/lib/component/ResponsiveContainer.js:145-156`: the render function explicitly forwards only `id`, `className`, and `style` onto the rendered `<div>` — arbitrary props (including `aria-hidden`) are **not** spread onto the DOM. Even if the type check were bypassed, the attribute would never reach the DOM.

**Prescribed structure** (per component, e.g. `WeightChart.tsx:24-63`):

```tsx
<div className="h-48" role="img" aria-label={ariaLabel}>
  <div aria-hidden="true" className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        {/* ...unchanged... */}
      </LineChart>
    </ResponsiveContainer>
  </div>
</div>
```

The **existing** `h-48` div becomes the `role="img"` + `aria-label` carrier (matches the ReachMeter idiom — outer element owns the a11y identity). A **new** inner div is required to carry `aria-hidden` — it must be `className="w-full h-full"` (or equivalent explicit sizing), not a bare `<div aria-hidden>`. Reason: `ResponsiveContainer` sizes itself via `ResizeObserver` against its immediate DOM parent. Inserting an unsized block div between the `h-48` box and `ResponsiveContainer` risks a 0-height measurement on first paint (classic Recharts collapse bug) unless the wrapper explicitly inherits 100%/100%. This is a one-line detail but will silently break every chart's height if omitted — call it out explicitly to the implementer.

Apply the same two-div structure to `ReadinessChart.tsx:25-79` and `HistoryChart.tsx:32-73`.

---

## Attack 2 — Label strings, and a design gap the premise check missed

**Empty-data early returns**: none of the three components early-return on empty data — verified by reading all three files in full (`WeightChart.tsx`, `ReadinessChart.tsx`, `HistoryChart.tsx`); the `h-48` div renders unconditionally. **But** every current call site already guards before rendering the chart, so in practice empty data never reaches these components today:
- `progress/page.tsx:180` (`series.length > 1 ? <ReadinessChart .../> : <p>...`), `:228` (`weights.length === 0 ? <p>... : <WeightChart/>`)
- `history/page.tsx:36` (`measurements.length === 0 ? <p>... : <WeightChart/>`) — **this WeightChart caller isn't in the PRD's scope list at all; it needs no label-prop change (label is internally computed) but confirm it still renders correctly after the wrapper-div restructure.**
- `progress/page.tsx:210` (`mrrPoints.length > 0 ? <HistoryChart/> : <p>...`)
- `goals/[id]/metric/[key]/page.tsx:76`, `baselines/test/[testName]/page.tsx:39-45` (also special-cases length===1), `baselines/exercise/[name]/page.tsx:48-54` (also special-cases length===1)
- `BodyMetricsSection.tsx:16` (`rows.length === 0` returns `null` for the whole component before any chart renders; per-key `keyRows` is always ≥1)
- `ProjectTrendsView.tsx:74` (`s.points.length === 0 ? <p>... : <HistoryChart/>`)

So the "labels never say 0 entries" acceptance criterion holds **in practice**, but the components themselves don't guarantee it — write the fallback label expressions defensively anyway (see below), since these are exported, reusable components and a future caller may not guard.

**The real gap — read progress/page.tsx before designing WeightChart/ReadinessChart's label logic.** The PRD's premise check says "zero a11y today" for the chart components — true for the component files, **false in effect** for two of the three real usages. `progress/page.tsx` already computes hand-rolled, materially richer labels and wraps the charts in an `aria-label` div:

```tsx
// progress/page.tsx:86-91
const weightAriaLabel =
  latest !== undefined && start !== undefined && delta !== null
    ? `Weight trend, latest ${latest} lb, ${delta < 0 ? "down" : delta > 0 ? "up" : "unchanged"} ${Math.abs(delta).toFixed(1)} from start`
    : ...

// progress/page.tsx:133-138
const readinessAriaLabel =
  latestScore !== null && firstScore !== null && series.length > 1
    ? `Readiness trend for ${goal.objective}, latest score ${latestScore}/100, ${latestScore > firstScore ? "up" : ...} from ${firstScore}`
    : ...

// usage:
<div aria-label={readinessAriaLabel}><ReadinessChart .../></div>   // :181
<div aria-label={weightAriaLabel}><WeightChart .../></div>          // :246
```

Two problems if the PRD is implemented literally (WeightChart/ReadinessChart compute their own generic "N entries from X to Y" label internally, no prop):
1. **These existing wrapper divs become dead weight or, worse, a duplicate/conflicting announcement.** A bare `<div aria-label="...">` (no role) is frequently *not* exposed as an accessible name by real screen readers (VoiceOver/NVDA generally skip non-interactive, non-landmark generic elements in the browse-mode buffer) — so this existing code is likely non-functional today, which is presumably *why* issue #241 exists. But once the inner `WeightChart` gets its own `role="img"` + a **different**, blander, auto-generated label, you get an outer div whose (possibly-inert) label disagrees with an inner, definitely-announced `role="img"` label. That's a regression in information quality even if it "works."
2. **The richer, already-authored label is thrown away for a generic one.** "Weight trend, latest 165 lb, down 2.3 from start" is strictly more useful to a screen-reader user than "Weight trend chart, 45 entries from Jan 3 to Jun 28." Replacing it with the PRD's generic string is a content downgrade at the one call site that already did this right.

**Ruling**: give `WeightChart` and `ReadinessChart` the **same optional-prop pattern the PRD already specifies for `HistoryChart`** (it's more consistent, not more scope — same shape, same day's work):

```tsx
// WeightChart.tsx
export function WeightChart({ data, ariaLabel }: { data: Point[]; ariaLabel?: string }) {
  const formatted = data.map(...);
  const computedLabel =
    ariaLabel ??
    (formatted.length > 0
      ? `Weight trend chart, ${formatted.length} ${formatted.length === 1 ? "entry" : "entries"} from ${formatted[0]!.label} to ${formatted.at(-1)!.label}`
      : "Weight trend chart, no data");
  return (
    <div className="h-48" role="img" aria-label={computedLabel}>
      <div aria-hidden="true" className="w-full h-full">
        <ResponsiveContainer width="100%" height="100%">…</ResponsiveContainer>
      </div>
    </div>
  );
}
```

Same for `ReadinessChart` (`ariaLabel?: string`, fallback `` `Readiness trend chart, ${formatted.length} points${targetDate ? `, target ${new Date(targetDate).toLocaleDateString(undefined,{month:"short",day:"numeric"})}` : ""}` ``, guard `formatted.length === 0` → `"Readiness trend chart, no data"`).

Then at the call sites, **thread the existing richer labels in and delete the now-redundant wrapper divs**:

```tsx
// progress/page.tsx:181 — replace
<div aria-label={readinessAriaLabel}><ReadinessChart data={series} targetDate={goal.targetDate?.toISOString()} /></div>
// with
<ReadinessChart data={series} targetDate={goal.targetDate?.toISOString()} ariaLabel={readinessAriaLabel} />

// progress/page.tsx:246 — replace
<div aria-label={weightAriaLabel}><WeightChart data={weights} /></div>
// with
<WeightChart data={weights} ariaLabel={weightAriaLabel} />
```

`history/page.tsx:39` (`<WeightChart data={...} />`) passes no `ariaLabel` — falls back to the generic computed string, which is correct there (no richer context computed at that call site, and it's out of the PRD's stated scope, but confirm it isn't broken by the prop rename). Checked: no existing tests reference `weightAriaLabel`, `readinessAriaLabel`, `WeightChart`, or `ReadinessChart` (`grep` across `*.test.ts(x)` returned nothing), so this restructure is safe — no test breakage.

**Naming note (minor, non-blocking):** don't call the new prop `label`. `HistoryChart.tsx:13` already defines `HistoryPoint.label?: string` — a *per-point* x-axis tick override — and multiple callers (`BodyMetricsSection.tsx:75`, `ProjectTrendsView.tsx:64`, ExerciseRow's `chartTitleFor`) use a local variable literally named `label` for the `<Card title={label}>` prop. Adding a third, differently-scoped meaning of "label" (chart-level accessible name) into the same file/call sites is a foot-gun for future readers even though TS won't flag it (different scopes). Use `ariaLabel` for the new prop on all three components — consistent with the DOM attribute it sets, and avoids the collision.

---

## Attack 3 — The 6 HistoryChart call sites

All six have a natural label in scope; confirmed by reading each file. Exact prescribed values:

| Call site | Line | In-scope variable | Prescribed `ariaLabel` value |
|---|---|---|---|
| `progress/page.tsx` | 212 | (no variable; Card title is a literal `"MRR Trend"`) | `"MRR trend chart"` |
| `goals/[id]/metric/[key]/page.tsx` | 79 | `series.label` (already used as `<h1>` and Card title, :67/:75) | `` `${series.label} trend chart` `` |
| `baselines/test/[testName]/page.tsx` | 46 | `testName` (route param, already the `<h1>`, :24) | `` `${testName} trend chart` `` |
| `baselines/exercise/[name]/page.tsx` | 55 | `chartTitleFor(summary?.primary)` — already used as Card title, :47 | `chartTitleFor(summary?.primary)` (reuse verbatim, zero new string) |
| `BodyMetricsSection.tsx` | 76 | `label` (from `resolveBodyMetric`, :44; already Card title, :75) | `` `${label} trend chart` `` |
| `ProjectTrendsView.tsx` | 79 | `s.label` (already Card title, :64) | `` `${s.label} trend chart` `` |

No call site needs the generic units-based fallback in practice — but implement it anyway since `HistoryChart` is exported and reusable: `` `History chart, ${formatted.length} ${formatted.length === 1 ? "point" : "points"}${units ? ` (${units})` : ""}` ``, guarded the same way as above for `formatted.length === 0`.

---

## Attack 4 — sr-only spacing at calendar:152

Read the exact current line:
```tsx
// calendar/page.tsx:150-154
{goal && (
  <p className="text-xs text-[var(--muted)] text-center">
    🏔️ {goal.objective}
    {goal.targetDate ? ` — ${new Date(goal.targetDate).toLocaleDateString()}` : ""}
  </p>
)}
```
The JSX text node is `"🏔️ "` (emoji + one trailing space) immediately followed by the `{goal.objective}` expression — i.e. today's rendered output is `"🏔️ " + objective`.

Prescribed replacement, preserving exactly one visible space:
```tsx
<span aria-hidden>🏔️</span><span className="sr-only">Goal target: </span> {goal.objective}
```
Verified this preserves visual spacing: the `aria-hidden` span and the `sr-only` span are adjacent with **no whitespace/newline between their tags** (matters — a newline between JSX elements becomes a collapsed-but-real space text node in some cases; write them on one line, adjacent, as above, to guarantee zero extra visual gap). The `sr-only` span is visually zero-width (standard `position:absolute; width:1px; ...` clip pattern — check `globals.css`/Tailwind's `sr-only` utility, standard, confirmed present via `sr-only` used elsewhere e.g. `ConfirmButton.tsx:100`), so it contributes no visible space. The literal space + `{goal.objective}` that follows renders exactly as before. Net visible output: `"🏔️ " + objective` — unchanged. Screen-reader output: "Goal target: " immediately followed by the objective text node (a leading space in the text node collapses in speech synthesis) — reads sensibly as "Goal target: Mt. Elbert...". No bug.

---

## Attack 5 — days:207 / :248 icon wraps

`days/[dateKey]/page.tsx:205-209` (target-date banner):
```tsx
{targetDateEvents.map((e) => (
  <p key={...} className="font-medium text-[var(--foreground)]">
    {e.icon} {e.label} — {e.goalObjective}
  </p>
))}
```
`:246-250` (secondary events, inline within a `<p>`):
```tsx
{secondaryEvents.map((e) => (
  <span key={...} className="text-[var(--muted)]">
    {e.icon} {e.label} — {e.goalObjective} ·{" "}
  </span>
))}
```
Both are plain inline text inside block-level `<p>`/`<span>` — not flex containers, no layout dependent on `{e.icon}` being a bare text expression. Wrapping it as `<span aria-hidden>{e.icon}</span>` is an inline, non-breaking, non-styled element; it changes nothing about text flow, alignment, or wrapping — confirmed no `display:flex`/`inline-flex`/`gap` classes on either container. Also confirmed `e.icon` is always a genuine, non-empty emoji string (`src/lib/goal-flavors.ts`, e.g. `{ icon: "🏔️", label: "Goal date", kind: "goal-date" }` — 20+ entries, `icon` always populated), and `e.label` (adjacent, visible, not hidden) always carries equivalent semantic meaning ("Goal date", "Meet day", "Race day", etc.), so hiding the icon loses no information. Safe as designed.

---

## Attack 6 — role="alert" specifics

Confirmed 8 in-repo precedents all follow the identical shape — a `role="alert"` `<p>` with `border`/`bg` danger styling, no `aria-live` needed (role="alert" implies `aria-live="assertive"` + `aria-atomic="true"`): `signin/page.tsx:69`, `ScanFoodSheet.tsx:482`, `RecapClient.tsx:463`, `days/FootageForm.tsx:186`, `days/RenderJobPanel.tsx:172,250`, `day-editor/ExerciseRow.tsx:207,212`. `OnboardingGoalForm.tsx:133-137` and `GoalCreateForm.tsx:153-157` are structurally identical blocks (`border-[var(--danger)]/30 bg-[var(--danger)]/10` styling, conditional render on `error`). `role="alert"` over `aria-live="polite"` is correct per the repo's own consistency rule — this is a validation *failure*, not a background status update; the other `aria-live="polite"` usages in the repo (`LogNoteForm.tsx:83`, `InviteCodeField.tsx:67`, etc.) are all non-error status strips. No issue; implement as designed on both files, no other changes needed.

Re-submit-with-same-text edge case: since the block is conditionally rendered (`{error && (...)}`), a transition from `null` → message is a genuine DOM insertion (correctly triggers the assertive announcement). If a second failed submit produces the *identical* error string, React does not remount/change the node, so no new announcement fires — this is expected, matches the 8 existing precedents, and is a non-issue (the user already heard the unchanged message).

---

## Attack 7 — anything else

**Server/client boundaries**: `calendar/page.tsx` and `days/[dateKey]/page.tsx` are server components — the `sr-only`/`aria-hidden` spans are static markup, no boundary issue. `BodyMetricsSection.tsx` and `ProjectTrendsView.tsx` are server components (confirmed via file-header comments: "Async server component — do NOT add 'use client'" and "Server component — no 'use client'") passing a plain `string` `ariaLabel` prop into `HistoryChart.tsx` (`"use client"`, confirmed line 1) — strings serialize across the RSC boundary with no issue, same as the existing `units`/`domain` props already threaded the same way.

**Other raw emoji in the two target pages**: ran a Unicode emoji-range scan over both files. Only hits: `calendar/page.tsx:152` and `days/[dateKey]/page.tsx:243` (both in scope) — no other emoji missed. Both files do contain `←`/`→` glyphs in link/nav text (`calendar/page.tsx:62,69,83`; `days/[dateKey]/page.tsx:230,239`) — these are not emoji, are outside the PRD's stated scope, and are pre-existing/unrelated to #241 (note only for completeness — not a blocking finding; `progress/page.tsx:114` already sets a precedent of `aria-hidden` on a similar `→` glyph, so if a future issue wants to sweep these, that's the template, but it's out of scope here).

---

## Summary of required changes beyond the PRD's literal text

1. `aria-hidden` cannot go on `<ResponsiveContainer>` (not in its prop type, not forwarded to the DOM) — use a `className="w-full h-full"` wrapper `<div aria-hidden="true">` around it, inside the existing `role="img"` div, in all three chart components.
2. Give `WeightChart` and `ReadinessChart` an optional `ariaLabel?: string` prop (same shape already planned for `HistoryChart`) instead of purely-internal label computation, so `progress/page.tsx` can thread its existing richer `weightAriaLabel`/`readinessAriaLabel` strings in — and delete the now-redundant `<div aria-label={...}>` wrappers at `progress/page.tsx:181` and `:246`.
3. Name the new prop `ariaLabel`, not `label`, on all three chart components — `HistoryChart.tsx:13`'s `HistoryPoint.label` and several callers' local `label` variables already overload that name for a different purpose.
4. Guard the generic fallback label expressions against `data.length === 0` explicitly (produce `"...no data"` rather than `"...undefined to undefined"`), since the components don't early-return themselves — even though every current caller happens to guard first.

Everything else in the PRD — the emoji sr-only treatment, the icon-wrap sites, and both role="alert" additions — is correct as designed and needs no changes.
