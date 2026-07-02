"use client";

// Month calendar — a glanceable icon grid plus a detail panel.
//
// The grid stays compact (square cells, day number + a row of the goal's
// legend icons). It is NOT where you read workout detail — tapping a day
// SELECTS it and the panel below shows the full, readable detail (workout
// name, marker labels, link to the day page). Today is selected by default.
// This split keeps the grid uncluttered on narrow phones (~48px cells) while
// the cells still carry the goal's own custom legend icons, not generic dots.
//
// Track 2 additions:
//   - 6-week rows with WeekRail (spine + confidence cap) in a 16px left gutter
//   - DayCell provisional opacity + dashed top hairline (REQ-006)
//   - DayCell conflict corner wedge (REQ-006, D-2 colorblind-safe redundancy)
//   - bullseye-pop flip on newly-confirmed weeks via localStorage gate (REQ-007)
//   - Compare mode: two-tap date-pair picker -> /compare?a=&b= (REQ-006, glance-back-forge-ahead)

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MarkerIcon, ForeignGoalMarker } from "@/components/MarkerIcon";
import { WeekRail } from "@/components/WeekRail";
import type { CalendarDayCell } from "@/lib/calendar";
import { parseDateKey } from "@/lib/calendar-core";
import { findLegendEntry, type LegendEntry, type LegendKind } from "@/lib/legend";

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Compare mode (REQ-006) ─────────────────────────────────────────────────
// Two-tap date-pair picker: "normal" (default calendar browsing) -> "selectA"
// (pill tapped, waiting for the first day) -> "selectB" (first day picked,
// waiting for the second) -> navigate to /compare and reset to "normal".
type CompareMode = "normal" | "selectA" | "selectB";

const COMPARE_STORAGE_KEY = "goaldmine.compareMode";

// UXR-62-03: focus-first ordering, cap 2–3 total markers before +N chip.
// 3 chosen: worst-case race-week cell has 1 focus + 2 foreign glyphs before chip.
const MARKER_CAP = 3;

type Marker = { entry: LegendEntry; count: number };

// Cross-goal conflict kinds — these carry a human-readable .label for display.
const CROSS_GOAL_KINDS = new Set([
  "event-on-hard-day",
  "key-events-same-week",
  "event-near-long-effort",
]);

// Resolve which markers a day shows. A kind absent from the goal's legend is
// suppressed — a cell only ever shows what the legend can explain.
function markersFor(
  cell: CalendarDayCell,
  legend: readonly LegendEntry[],
): Marker[] {
  const out: Marker[] = [];
  const isOutdoor = cell.hikeCount > 0;
  const isPlannedOutdoor =
    !isOutdoor && cell.plannedHikeCount > 0 && !cell.isPast;
  // A logged hike counts as a completed training day too.
  const isCompleted = cell.workoutCount > 0 || cell.hikeCount > 0;

  const push = (kind: LegendKind, count: number) => {
    const entry = findLegendEntry(legend, kind);
    if (entry) out.push({ entry, count });
  };

  if (isCompleted) push("trained", 1);
  if (isOutdoor) push("hike-completed", cell.hikeCount);
  if (isPlannedOutdoor) push("hike-planned", cell.plannedHikeCount);
  if (cell.hasOverride) push("override", 1);
  if (cell.baselinesDue > 0) push("baseline", cell.baselinesDue);
  // REQ-003: push scheduled-item AFTER baseline, BEFORE goal-date. Safe for fitness
  // goals: DEFAULT_LEGEND has no scheduled-item entry, so push() finds nothing and
  // returns without adding a marker.
  //
  // [v2] DC-1: Focus marker priority order within MARKER_CAP=3:
  //   trained > hike-completed > hike-planned > override > baseline > scheduled-item > goal-date
  // goal-date has LOWEST priority and may be truncated by MARKER_CAP when 3 higher-priority
  // markers are present (e.g., trained + scheduled-item + baseline on a busy project day that
  // also happens to be the goal date). This is intentional per UXR-s4-07 ordering — goal-date
  // is a one-off landmark; daily activity markers take precedence in the compact grid.
  if (cell.scheduledItemCount > 0) push("scheduled-item", cell.scheduledItemCount);
  if (cell.isGoalDate) push("goal-date", 1);
  return out;
}

export function CalendarMonth({
  cells,
  monthKey,
  legend,
  confirmedThroughDate,
}: {
  cells: CalendarDayCell[];
  monthKey: string; // "yyyy-mm" of the displayed month
  legend: readonly LegendEntry[];
  confirmedThroughDate?: Date | null; // Track 2: from calendar/page.tsx via program
}) {
  // Compare via the tz-stable dateKey string, not Date.getMonth() — the latter
  // is shifted by the client's timezone and can misclassify boundary days
  // (which made the default selection fall through to the first grid cell).
  const inMonth = (c: CalendarDayCell) => c.dateKey.startsWith(monthKey);

  // Default selection: today if it's in this month, else the first day of it.
  const defaultCell =
    cells.find((c) => c.isToday && inMonth(c)) ?? cells.find(inMonth) ?? cells[0];
  const [selectedKey, setSelectedKey] = useState(defaultCell?.dateKey ?? "");

  const selected = cells.find((c) => c.dateKey === selectedKey) ?? null;

  // ── REQ-006: compare mode ───────────────────────────────────────────────────
  const [mode, setMode] = useState<CompareMode>("normal");
  const [compareA, setCompareA] = useState<string | null>(null);
  const router = useRouter();

  // Hydrate once on mount. CalendarMonth remounts fully on month navigation
  // (key={year-month} + plain <Link> in calendar/page.tsx — no client-side
  // transition preserves React state), so sessionStorage — not just state —
  // is what survives a month-nav mid-comparison. Reading external storage
  // into state on mount is the intentional exception the project's
  // react-hooks/set-state-in-effect rule allows (see RecapClient.tsx).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(COMPARE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { mode: CompareMode; compareA: string | null };
        if (parsed.mode === "selectA" || parsed.mode === "selectB") {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setMode(parsed.mode);
          setCompareA(parsed.compareA);
        }
      }
    } catch {
      // private browsing / storage disabled — degrade to normal mode silently,
      // mirroring the existing localStorage try/catch guard in this same file
      // (REQ-007 bullseye-pop gate, below).
    }
  }, []);

  // Persist on every mode/compareA change; clear when back to normal.
  useEffect(() => {
    try {
      if (mode === "normal") sessionStorage.removeItem(COMPARE_STORAGE_KEY);
      else sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify({ mode, compareA }));
    } catch {
      // ignore — same defensive posture as above
    }
  }, [mode, compareA]);

  function handleCompareToggle() {
    if (mode === "normal") {
      setMode("selectA");
      setCompareA(null);
    } else {
      setMode("normal");
      setCompareA(null);
    }
  }

  // Cross-month recall row's "change" tap — re-pick day 1 without leaving
  // compare mode entirely.
  function handleRecallChange() {
    setMode("selectA");
    setCompareA(null);
  }

  function handleDayTap(cell: CalendarDayCell) {
    if (mode === "normal") {
      setSelectedKey(cell.dateKey); // existing behavior, unchanged
      return;
    }
    if (mode === "selectA") {
      setCompareA(cell.dateKey);
      setMode("selectB");
      return;
    }
    // mode === "selectB"
    if (cell.dateKey === compareA) {
      setCompareA(null);
      setMode("selectA"); // tap-A-again -> undo (presence/absence only, no red/shake)
      return;
    }
    const [minKey, maxKey] = [compareA!, cell.dateKey].sort();
    setMode("normal");
    setCompareA(null);
    try {
      sessionStorage.removeItem(COMPARE_STORAGE_KEY);
    } catch {
      // ignore — same defensive posture as above
    }
    router.push(`/compare?a=${minKey}&b=${maxKey}`);
  }

  // Fix 5: cross-month recall row condition is checked against the FULL
  // 42-cell padded grid (`cells`), NOT the inMonth subset — a compareA that
  // sits in an adjacent month but is visible as an overflow cell (ringed +
  // chipped) needs no recall row.
  const compareAOffScreen =
    mode === "selectB" && compareA !== null && !cells.some((c) => c.dateKey === compareA);

  // ── REQ-007: bullseye-pop flip ──────────────────────────────────────────────
  // The pop is applied imperatively via a DOM query in useEffect so we avoid:
  //   1. Accessing refs during render (ESLint react-hooks/refs)
  //   2. setState/re-render/SSR hydration mismatch (mirrors TodayCelebration.tsx)
  // WeekRail marks each cap wrapper with data-testid="week-cap-{weekIndex}",
  // so we can querySelector without any ref plumbing through JSX.
  useEffect(() => {
    // Scan all cells for confirmed weekIndices on this render.
    const confirmedWeekIndices = new Set(
      cells
        .filter((c) => c.isInPlan && c.confidence === "confirmed" && c.weekIndex != null)
        .map((c) => c.weekIndex as number),
    );

    // C-3: sort descending — fire the pop for the HIGHEST (most-recently confirmed)
    // week first. A confirm_week(5) call covers weeks 1-5; the "completion moment"
    // should be associated with week 5, not week 1.
    const sorted = [...confirmedWeekIndices].sort((a, b) => b - a);

    for (const wi of sorted) {
      const key = `goaldmine.weekConfirmed.${wi}`;
      try {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, "1");
          // Query the cap wrapper by its data-testid and imperatively add the
          // pop class — no ref needed; no setState; no re-render; no mismatch.
          const capEl = document.querySelector(`[data-testid="week-cap-${wi}"]`);
          capEl?.classList.add("week-confirm-pop");
          break; // Only one pop per render cycle.
        }
      } catch {
        // localStorage blocked (private browsing, storage quota) — degrade silently.
      }
    }
  }, [cells]);

  // ── Week-row grid ────────────────────────────────────────────────────────────
  // The 42 padded cells already arrive Mon–Sun aligned from getCalendarMonth
  // (via startOfWeekMonday/endOfWeekSunday), so chunking by 7 gives correct rows.
  const weeks = Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <div className="space-y-3">
      {/* REQ-006: compare-mode pill row — right-aligned, above the whole grid. */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="compare-pill"
          aria-pressed={mode !== "normal"}
          onClick={handleCompareToggle}
          className={`compare-pill min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium ${
            mode === "normal"
              ? "border-[var(--border)] bg-[var(--card)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]"
          }`}
        >
          {mode === "normal" ? "⇄ Compare" : "⇄ Comparing · Cancel"}
        </button>
      </div>
      {mode !== "normal" && (
        <p
          aria-live="polite"
          role="status"
          data-testid="compare-hint"
          className="text-xs text-[var(--muted)] px-1"
        >
          {mode === "selectA"
            ? "Pick the first day"
            : `Pick the second day — ${formatCompareDate(compareA)} selected`}
        </p>
      )}
      {/* UXR-18 / Fix 5: cross-month recall row — compareA lives outside the
          rendered month's 42-cell grid, so its ring + "A" chip are off-screen. */}
      {compareAOffScreen && (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)] px-1">
          <span>A: {formatCompareDate(compareA)}</span>
          <button
            type="button"
            onClick={handleRecallChange}
            className="min-h-11 font-medium text-[var(--accent)]"
          >
            ⇄ change
          </button>
        </div>
      )}
      <div>
        {/* Header: 16px rail gutter spacer + 7 day-name columns (same grid as rows).
            The spacer keeps columns perfectly aligned with the week data rows. */}
        <div className="grid grid-cols-[16px_repeat(7,1fr)] mb-1">
          {/* Header gets the 16px rail spacer but no spine/cap component */}
          <div aria-hidden="true" />
          {DAY_HEADERS.map((d) => (
            <div
              key={d}
              className="text-xs text-[var(--muted)] text-center font-medium"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Week rows: col 1 = WeekRail (16px), cols 2-8 = DayCell */}
        <div className="space-y-1">
          {weeks.map((weekCells, rowIdx) => {
            const weekIndex = weekCells.find((c) => c.isInPlan)?.weekIndex ?? null;
            return (
              <div
                key={rowIdx}
                data-testid={weekIndex != null ? `week-row-${weekIndex}` : undefined}
                className="grid grid-cols-[16px_repeat(7,1fr)] gap-1"
              >
                <WeekRail
                  cells={weekCells}
                  weekIndex={weekIndex}
                  confirmedThroughDate={confirmedThroughDate ?? null}
                />
                {weekCells.map((c) => {
                  // "selected" is repurposed in compare mode: it drives the
                  // same ring-2 styling for whichever day is currently
                  // picked as A, rather than adding a parallel prop set.
                  const isSelectedForDisplay =
                    mode === "normal" ? c.dateKey === selectedKey : c.dateKey === compareA;
                  return (
                    <DayCell
                      key={c.dateKey}
                      cell={c}
                      inMonth={inMonth(c)}
                      legend={legend}
                      selected={isSelectedForDisplay}
                      compareBadge={mode === "selectB" && c.dateKey === compareA ? "A" : undefined}
                      onSelect={() => handleDayTap(c)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {/* REQ-006: DayDetail is hidden (unmounted) while a compare-mode pick is
          in progress — Fix 6 accepts the resulting one-frame flash on
          month-nav rehydrate rather than a sessionStorage lazy-initializer
          (which would cause a hydration mismatch). */}
      {mode === "normal" && selected && <DayDetail cell={selected} legend={legend} />}
    </div>
  );
}

// Small display-only formatter for the compare-mode hint/recall row — NOT
// date math, just rendering an already-normalized dateKey. Uses the same
// `undefined` (browser-locale) toLocaleDateString convention as DayDetail's
// dateLabel below, scoped to a short month/day form for the compact rows.
function formatCompareDate(key: string | null): string {
  if (!key) return "";
  return parseDateKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── DayCell ──────────────────────────────────────────────────────────────────
// REQ-006: provisional opacity + dashed top hairline; conflict corner wedge.
// D-3: isPopping prop does not exist — the pop lives on the WeekRail cap ref.

function DayCell({
  cell,
  inMonth,
  legend,
  selected,
  compareBadge,
  onSelect,
}: {
  cell: CalendarDayCell;
  inMonth: boolean;
  legend: readonly LegendEntry[];
  selected: boolean;
  compareBadge?: "A"; // REQ-006: corner chip for the picked A day in compare mode
  onSelect: () => void;
}) {
  const focusMarkers = markersFor(cell, legend);
  const foreignEvents = cell.otherGoalEvents;

  // UXR-62-03: focus-first, cap at MARKER_CAP total, remainder → +N chip
  const shownFocus = focusMarkers.slice(0, MARKER_CAP);
  const foreignSlots = Math.max(0, MARKER_CAP - shownFocus.length);
  const shownForeign = foreignEvents.slice(0, foreignSlots);
  const overflow = (focusMarkers.length - shownFocus.length) + (foreignEvents.length - shownForeign.length);

  const isCompleted = cell.workoutCount > 0 || cell.hikeCount > 0;
  const isQuietPast = cell.isPast && cell.isInPlan && focusMarkers.length === 0 && foreignEvents.length === 0;

  // Every day carries a slim border for separation; out-of-month days get a
  // fainter one so the current month still reads as the focus.
  let toneClass = "border-[var(--border)] bg-[var(--card)]";
  if (!inMonth) toneClass = "border-[var(--border)]/50 bg-transparent";
  else if (isQuietPast) toneClass = "border-[var(--border)] bg-[var(--background)]";

  // Completed in-month days get a soft gold halo — a blurred box-shadow, not
  // a crisp ring, so it reads as a glow distinct from the today/selected ring.
  const glowClass =
    inMonth && isCompleted ? "shadow-[0_0_11px_-3px_var(--accent)]" : "";

  // Selection wins the ring; today gets a subtler ring when not selected.
  // REQ-006: `compare-ring` carries the box-shadow fade transition whenever
  // this ring is toggled on/off by a compare-mode pick (UXR-16).
  const ringClass = selected
    ? "ring-2 ring-[var(--accent)] compare-ring"
    : cell.isToday
      ? "ring-1 ring-[var(--accent)]"
      : "compare-ring";

  const numClass = !inMonth
    ? "text-[var(--muted)]/40"
    : cell.isToday
      ? "font-semibold"
      : isQuietPast
        ? "text-[var(--muted)]"
        : "";

  // REQ-006: provisional cue — reduced opacity + dashed top hairline.
  // Only applied to in-month, in-plan provisional cells (not to out-of-month padding).
  // ⚠ opacity 0.62 starting point — verify date number stays ≥ WCAG AA on cream;
  //   raise to 0.68 if too faint (the range is 0.55–0.70 per UX §9).
  const confidenceClass =
    inMonth && cell.isInPlan && cell.confidence === "provisional"
      ? "opacity-[0.62] border-t border-dashed border-t-[var(--muted)]"
      : "";

  // REQ-65-4: skipped-day cue — muted ✕ when the day has an acknowledged-skipped
  // workout but no completed training. Placed in the marker row so it occupies the
  // same visual band as legend icons without disturbing the glow/quiet/provisional logic
  // (those depend on isCompleted/isQuietPast which are already correct post workoutCount fix).
  const showSkippedMark = inMonth && cell.skippedCount > 0 && !isCompleted;

  // REQ-006 / a11y: extend aria-label with confidence, other-goal events, + conflict.
  const ariaLabel = [
    cell.dateKey,
    cell.dayTitle ? `— ${cell.dayTitle}` : "",
    cell.confidence && cell.confidence !== "past" ? `· ${cell.confidence}` : "",
    showSkippedMark ? ", skipped (acknowledged)" : "",
    // REQ-106: append foreign goal event labels for screen readers
    ...cell.otherGoalEvents.map((e) => `· ${e.label} — ${e.goalObjective}`),
    // REQ-106: use human label for cross-goal conflicts, kind for same-goal conflicts
    cell.conflict
      ? `· conflict: ${cell.conflict.label ?? cell.conflict.kind}`
      : "",
    // REQ-006: announce the compare-mode A pick for screen readers.
    compareBadge ? "· A selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={ariaLabel}
      data-testid={`day-cell-${cell.dateKey}`}
      data-confidence={cell.confidence ?? "out-of-plan"}
      data-conflict={cell.conflict?.kind ?? undefined}
      className={`relative min-h-[3.75rem] rounded-lg border flex flex-col items-center justify-start gap-0.5 p-1 text-xs transition-colors hover:border-[var(--accent)] ${toneClass} ${ringClass} ${glowClass} ${confidenceClass}`}
    >
      <span className={numClass}>{cell.date.getDate()}</span>
      {/* Focus markers first, then foreign goal markers, capped at MARKER_CAP total.
          UXR-62-01/02: foreign markers get claim-ring via ForeignGoalMarker.
          UXR-62-03: overflow collapsed to +N chip. */}
      <span className="flex flex-wrap items-center justify-center gap-0.5">
        {shownFocus.map((m) => (
          <MarkerIcon key={m.entry.kind} entry={m.entry} size={13} />
        ))}
        {shownForeign.map((e, idx) => (
          <ForeignGoalMarker
            key={`${e.goalId}-${e.type}-${idx}`}
            icon={e.icon}
            label={`${e.label} — ${e.goalObjective}`}
            size={13}
          />
        ))}
        {/* REQ-65-4: muted ✕ for acknowledged-skipped days (no completed training). */}
        {showSkippedMark && (
          <span
            aria-hidden="true"
            style={{ fontSize: "11px" }}
            className="text-[var(--muted)]"
          >
            ✕
          </span>
        )}
        {/* UXR-62-04: +N chip — 9px muted text on accent-soft */}
        {overflow > 0 && (
          <span
            data-testid="cal-marker-overflow"
            className="rounded-full bg-[var(--accent-soft)] px-1 leading-[1.6] text-[9px] text-[var(--muted)]"
          >
            +{overflow}
          </span>
        )}
      </span>

      {/* REQ-006: compare-mode "A" chip — same chip vocabulary as the +N
          overflow chip above, placed in the opposite corner from the
          conflict wedge so the two never collide. Entrance animated via
          @starting-style (compare-a-chip, globals.css). */}
      {compareBadge && (
        <span
          data-testid={`day-compare-badge-${cell.dateKey}`}
          aria-hidden="true"
          className="compare-a-chip absolute bottom-0.5 right-0.5 rounded-full bg-[var(--accent-soft)] px-1 leading-[1.6] text-[9px] font-medium text-[var(--accent)]"
        >
          A
        </span>
      )}

      {/* REQ-006 / D-2: conflict corner wedge.
          Geometric non-color redundant channel — required for colorblind-safety
          alongside the warning-color BullseyeWarning cap (UX §8). Without the wedge
          the conflict state would be color-only.
          ⚠ 11px wedge: verify it doesn't fight the today/selected ring at 390px. */}
      {cell.conflict != null && (
        <span
          data-testid={`day-conflict-${cell.dateKey}`}
          aria-hidden="true"
          className="absolute top-0 right-0 w-0 h-0 border-t-[11px] border-t-[var(--warning)] border-l-[11px] border-l-transparent rounded-tr-lg"
        />
      )}
    </button>
  );
}

// ─── DayDetail ────────────────────────────────────────────────────────────────

function DayDetail({
  cell,
  legend,
}: {
  cell: CalendarDayCell;
  legend: readonly LegendEntry[];
}) {
  const markers = markersFor(cell, legend);
  const dateLabel = cell.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // REQ-106: is this a cross-goal conflict (carries a human label)?
  const isCrossGoalConflict = cell.conflict != null && CROSS_GOAL_KINDS.has(cell.conflict.kind);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {dateLabel}
          {cell.isToday && (
            <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              Today
            </span>
          )}
        </p>
        {cell.weekIndex != null && (
          <span className="shrink-0 text-xs text-[var(--muted)]">
            Week {cell.weekIndex}
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--muted)]">
        {cell.dayTitle
          ? `${cell.rotationDay ? `D${cell.rotationDay} · ` : ""}${cell.dayTitle}`
          : cell.isInPlan
            ? "Rest / unscheduled day."
            : "Outside the current plan."}
      </p>
      {cell.plannedWorkoutTitle && (
        <p className="text-xs text-[var(--muted)]">planned: {cell.plannedWorkoutTitle}</p>
      )}

      {/* REQ-65-4: acknowledged-skipped indicator in DayDetail. */}
      {cell.skippedCount > 0 && (
        <p className="text-xs text-[var(--muted)]">Skipped — acknowledged</p>
      )}

      {markers.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {markers.map((m) => (
            <li
              key={m.entry.kind}
              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
            >
              <MarkerIcon entry={m.entry} size={14} />
              <span>
                {m.count > 1 ? `${m.count} ` : ""}
                {m.entry.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* REQ-106: other-goal events — full uncapped list in DayDetail (progressive disclosure).
          UXR-62-01/02: claim-ring on foreign icons; {icon} {label} — {objective} format. */}
      {cell.otherGoalEvents.length > 0 && (
        <ul className="space-y-1">
          {cell.otherGoalEvents.map((e, idx) => (
            <li
              key={`${e.goalId}-${e.type}-${idx}`}
              className="flex items-center gap-1.5 text-xs text-[var(--muted)]"
            >
              <ForeignGoalMarker icon={e.icon} label={e.label} size={13} />
              <span>
                <span className="text-[var(--foreground)]">{e.label}</span>
                {" — "}
                {e.goalObjective}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* REQ-106: cross-goal conflict label in var(--warning); same-goal conflicts show kind only.
          UXR-62-09 principle: label surfaced verbatim, copy in foreground, --warning for glyph. */}
      {isCrossGoalConflict && cell.conflict?.label && (
        <p className="text-xs flex items-baseline gap-1">
          <span className="text-[var(--warning)]" aria-hidden>◣</span>
          <span className="text-[var(--foreground)]">{cell.conflict.label}</span>
        </p>
      )}

      <Link
        href={`/days/${cell.dateKey}`}
        className="inline-block text-xs font-medium text-[var(--accent)]"
      >
        Open day →
      </Link>
    </div>
  );
}
