// src/lib/calendar-windows.ts
//
// Deload / observance windows for the cross-goal calendar (#291,
// docs/ux-research/program-views.md §7.3).
//
// ── THE DETECTION CONTRACT (writer: the Phase 2A import, src/lib/phase2a-spec.ts) ──
// The research's `windows[]` discriminator does not exist as a column; v1
// derives windows from the ACTIVE plan's day-swap overrides by TITLE PREFIX:
//
//   • workoutJson.title starting with "Deload"       → kind "deload"
//     (buildPhase2aOverrides writes "Deload #1 — Virginia",
//      "Deload #2 — Thanksgiving" as zone2-mobility day swaps)
//   • workoutJson.title starting with "Mirror Lake"  → kind "observance"
//     (the import writes "Mirror Lake — Matt" rest-day swaps for Aug 14–15;
//      SACRED TIME, deliberately never labelled a deload)
//
// The import spec is the writer side of this contract — if its titles change,
// this classifier and phase2a-spec.ts must move together (documented in
// docs/program-redesign/TOOL-DIFFS.md). Note-only overrides (e.g. the
// Virginia "soft break", which carries no workoutJson) are NOT windows — no
// day swap, nothing to band.
//
// Rendering semantics (UXR-PV-88 ledger, approved):
//   • deload      → the second-grid-row span bar (WindowSpanBar), splitting at
//                   week boundaries via splitWindowIntoSegments below.
//   • observance  → NO band, NO wash, NO marker, zero motion — the covered
//                   cell renders ONE EM DASH (see CalendarMonth's DayCell).
//
// Pure + client-safe: no Prisma imports, no IO. dateKey strings only
// ("yyyy-mm-dd" — lexicographic compare IS chronological compare).

export type CalendarWindowKind = "deload" | "observance";

export type CalendarWindow = {
  /** Stable per-month id: `${kind}:${startKey}` — used in testids. */
  id: string;
  kind: CalendarWindowKind;
  /** The user's own words — the override's workoutJson.title. */
  label: string;
  /** First covered dateKey (inclusive). */
  startKey: string;
  /** Last covered dateKey (inclusive). */
  endKey: string;
};

/** One rendered piece of a window inside a single week row. A window crossing
 *  a week boundary becomes ≥2 segments; the flat (un-rounded) edge reads as
 *  "continues" (research §7.3). */
export type WindowSegment = {
  windowId: string;
  kind: CalendarWindowKind;
  label: string;
  /** 0-based row index into the week grid the caller supplied. */
  weekRow: number;
  /** 0-based day column within the week (0 = Monday). */
  colStart: number;
  /** Number of covered columns (≥1). */
  span: number;
  /** True when this segment contains the window's true start (round the left edge). */
  isStart: boolean;
  /** True when this segment contains the window's true end (round the right edge). */
  isEnd: boolean;
};

/** Title-prefix classifier — the contract documented in the file header. */
export function classifyOverrideWindowKind(title: unknown): CalendarWindowKind | null {
  if (typeof title !== "string") return null;
  if (title.startsWith("Deload")) return "deload";
  if (title.startsWith("Mirror Lake")) return "observance";
  return null;
}

/**
 * Group day-swap overrides into contiguous windows. Input rows need only
 * `dateKey` + the override's workoutJson `title`; rows whose title matches no
 * window kind are ignored. Adjacent days (dateKey difference of exactly one
 * calendar day) of the SAME kind merge into one window; the label is the
 * first day's title.
 */
export function deriveCalendarWindows(
  rows: { dateKey: string; title: unknown }[],
): CalendarWindow[] {
  const classified = rows
    .map((r) => ({ dateKey: r.dateKey, kind: classifyOverrideWindowKind(r.title), title: r.title }))
    .filter((r): r is { dateKey: string; kind: CalendarWindowKind; title: string } => r.kind !== null)
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  const windows: CalendarWindow[] = [];
  for (const row of classified) {
    const last = windows[windows.length - 1];
    if (last && last.kind === row.kind && isNextDay(last.endKey, row.dateKey)) {
      last.endKey = row.dateKey;
      continue;
    }
    windows.push({
      id: `${row.kind}:${row.dateKey}`,
      kind: row.kind,
      label: row.title,
      startKey: row.dateKey,
      endKey: row.dateKey,
    });
  }
  return windows;
}

/** Pure yyyy-mm-dd successor check via Date.UTC arithmetic on the date PARTS —
 *  no timezone involvement (both endpoints are UTC midnights), mirroring the
 *  phase2a-spec.ts idiom. */
function isNextDay(a: string, b: string): boolean {
  return utcMs(b) - utcMs(a) === 86400000;
}

function utcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/**
 * Split a window into per-week-row segments against the calendar's padded
 * grid (weekRows: 6 rows × 7 dateKeys, Monday-first — exactly the rows
 * CalendarMonth chunks out of getCalendarMonth's cells).
 *
 * The caller positions each segment with an INLINE style
 * `gridColumn: \`${2 + colStart} / span ${span}\`` — Tailwind's JIT cannot
 * see runtime class strings, and grid column 1 is the WeekRail, hence `2 +`
 * (research §7.3).
 */
export function splitWindowIntoSegments(
  win: CalendarWindow,
  weekRows: string[][],
): WindowSegment[] {
  const segments: WindowSegment[] = [];
  for (let row = 0; row < weekRows.length; row++) {
    const keys = weekRows[row]!;
    if (keys.length === 0) continue;
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    if (win.endKey < first || win.startKey > last) continue; // no overlap
    const startIdx = keys.findIndex((k) => k >= win.startKey);
    let endIdx = -1;
    for (let i = keys.length - 1; i >= 0; i--) {
      if (keys[i]! <= win.endKey) {
        endIdx = i;
        break;
      }
    }
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) continue;
    segments.push({
      windowId: win.id,
      kind: win.kind,
      label: win.label,
      weekRow: row,
      colStart: startIdx,
      span: endIdx - startIdx + 1,
      isStart: keys[startIdx]! === win.startKey,
      isEnd: keys[endIdx]! === win.endKey,
    });
  }
  return segments;
}
