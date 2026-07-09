# Research / premise-check — #228 (Explore agent, 2026-07-09)

## P1 dead counters — TRUE
- Computed: `compare.ts:391` baselineTestsLogged (db.baseline.count :358), `:392` notesLogged (db.note.count :363). Typed: compare-core.ts:273-274.
- Rendered set ("The work between", page.tsx:283-303, grid grid-cols-3 gap-2): workouts :288, hikes :289, ft climbed :290, mi hiked :291, XP :292, Level :293-295 (conditional), cumulative[] DeltaRows :297-301. notesLogged/baselineTestsLogged ABSENT. aria-label :285 stale (omits mi hiked + Level too).
- notesLogged counts only journal|audible|feedback (comment :359-362 matches recent_history ACTIVITY_NOTE_TYPES) — private types excluded; safe to render.

## P2 date inputs — TRUE (client gap only)
- Form page.tsx:220-245; type="date" name=a :223-228, name=b :232-237; NO max attr. todayKey available :145 (`dateKey(new Date())`). Server clamp exists: compare-core.ts:211-236 (clamp :215-222); HeroSpan renders clamp note :70-72.

## P3 sameDay — TRUE (soft zero-state)
- HeroSpan.tsx :66 microcopy line, :67 `{spanDays} days of showing up.` (0 for sameDay), :69 `{sameDay && "Same day selected."}`. Page has no sameDay branch — sections render with zero deltas; nothing hidden.

## P4 unhandled throw — WEAKENED
- computeComparison inside Promise.all page.tsx:158-167, no local try/catch, no Suspense. BUT root `src/app/error.tsx` exists (friendly client boundary, covers /compare; no compare/error.tsx, no global-error.tsx).
- URL params regex-gated: DATE_KEY_RE ^\d{4}-\d{2}-\d{2}$ :150-153, fallback last30Key/todayKey :154-155 → garbage never reaches computeComparison. parseDateKey itself unguarded (calendar-core.ts:88-91, NaN on garbage — moot behind the gate). Remaining throw paths: infra (DB down).

## P5 StatTile API
- src/components/StatTile.tsx:8-31: { label: string; value: string|number; tone?: "success"|"danger"|"muted" }. Count tiles use `formatValue(x, "")`.

## P6 other gaps in the card
- aria-label staleness (fold into AC1). Level tile raw string (out of scope). cumulative rows lack sub-heading (out of scope).
