# Verification report — #244 — 2026-07-11 · CalendarMonth 390px wedge layout + provisional contrast

## Method
Orchestrator-executed live browser verification (Chrome extension, dev server, dev DB). The two checks execute the code's own ⚠ comments (CalendarMonth.tsx:420-421 and :517).

**390px emulation note**: Chrome enforced a ~620px minimum window width on this machine, and a same-origin iframe hit a Next.js streaming quirk (content arrives but the loading boundary never reveals inside an iframe). Since the app has no width-based media queries in this range, 390px geometry was reproduced exactly by constraining the page container to 390px — cell math identical to a real 390px phone. Measured: **42×60px day cells, grid 340px, zero horizontal clipping**.

**Conflict-cell note**: no natural conflict data exists in the dev DB (July and August 2026 both render zero `data-conflict` cells). The wedge test injected the EXACT production markup (CalendarMonth.tsx:519-523, byte-identical className) into (a) a ring-1 cell and (b) the worst case: a SELECTED provisional cell carrying ring-2 + dashed hairline + wedge simultaneously. Simulated state, real CSS.

## VERDICT: CONFIRMED PASS (AC outcome a) — both checks, both themes

### 1. Provisional-cell contrast at opacity 0.62 (measured, WCAG relative-luminance math on composited colors)
| Theme | Text (raw) | Cell bg | Page bg | Effective contrast |
|---|---|---|---|---|
| Dark | rgb(244,233,212) | rgb(26,19,12) | rgb(15,11,7) | **6.34 : 1** |
| Light (cream) | rgb(31,20,8) | rgb(255,251,240) | rgb(250,243,227) | **5.10 : 1** |

Both exceed the 4.5:1 AA text threshold. Method: the cell's group opacity (0.62) composites both text and cell background over the page background; ratio computed on the composited pair. The code comment's "raise to 0.68 if too faint" contingency is NOT needed — **no CSS change made** (per the no-speculative-fix AC).

### 2. Wedge-vs-ring at 390px (42px cells)
- Wedge alone (ring-1 today cell): sits cleanly inside the top-right rounded corner — `rounded-tr-lg` matches the cell radius; no overflow, no clipping.
- **Worst case** (selected cell: ring-2 + provisional dashed hairline + wedge): all three cues coexist without collision — ring renders outside the border, wedge inside the corner, hairline along the top edge. Verified via zoomed captures in dark AND light themes. The warning-orange wedge stays distinguishable from the amber selection ring (and the wedge is the geometric colorblind-safe channel by design, so hue adjacency is not load-bearing).

## Notes
- The dev DB's lack of conflict data means the wedge has never rendered organically — worth remembering that the first real cross-goal conflict will be its true first paint (markup verified identical here).
- No code changed; verification-only story (same pattern as #243 — no dev agent/DA needed).
