// WeekRail — presentational rail spine + confidence cap for one calendar week row.
//
// Pure component: no hooks, no IO. Receives the 7 cells of a week row, derives
// the rail state from their confidence + conflict fields, and renders:
//   - a vertical spine bar (solid gold / dashed muted / dashed warning / quiet past)
//   - a Bullseye cap at the top (filled / hollow / BullseyeWarning)
//
// The bullseye-pop flip is applied imperatively via a DOM querySelector in
// CalendarMonth.tsx's useEffect (which owns the localStorage gate). WeekRail
// marks each cap div with data-testid="week-cap-{weekIndex}" for this purpose.
//
// Track 2 (plan-confidence-calendar). Do NOT modify Bullseye.tsx.

import { Bullseye } from "@/components/Bullseye";
// Type-only import — does NOT pull in calendar.ts's prisma/db runtime code.
import type { CalendarDayCell } from "@/lib/calendar";

// ─── Warning cap ──────────────────────────────────────────────────────────────
// A hollow ring in var(--warning) — geometrically distinct by color; the
// corner wedge on DayCell provides the redundant non-color channel (D-2).
// Implemented as an inline SVG so Bullseye.tsx stays canonical and untouched.
function BullseyeWarning({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx={16} cy={16} r={14} fill="none" stroke="var(--warning)" strokeWidth={2} />
    </svg>
  );
}

// ─── Rail state derivation ────────────────────────────────────────────────────
// C-2: allPast check FIRST — past weeks must never show a conflict warning.
export type RailState = "confirmed" | "provisional" | "conflict" | "past" | null;

export function deriveRailState(
  cells: CalendarDayCell[],
  confirmedThroughDate: Date | null,
): RailState {
  const inPlan = cells.filter((c) => c.isInPlan);
  if (inPlan.length === 0) return null; // fully out-of-plan row (padding only)

  // C-2: Check allPast FIRST — bypass conflict for fully-past weeks.
  const allPast = inPlan.every((c) => c.confidence === "past");
  if (allPast) {
    // Was this past week confirmed? Use the last in-plan cell's date.
    // cell.date is already startOfDay (from buildCell's addDays walk).
    // confirmedThroughDate is endOfDay of the last confirmed week's last day.
    // Direct timestamp comparison is correct: if lastInPlanDate (midnight) is
    // the same day or earlier than confirmedThroughDate (23:59:59.999), it's
    // confirmed. This avoids importing startOfDay from @/lib/calendar (which
    // chains to db.ts/pg and breaks the client bundle).
    const lastInPlanDate = inPlan.at(-1)!.date;
    if (
      confirmedThroughDate != null &&
      lastInPlanDate.getTime() < confirmedThroughDate.getTime()
    ) {
      return "confirmed"; // past-confirmed: solid spine + filled cap
    }
    return "past"; // past-unconfirmed: quiet muted spine, no cap
  }

  // Conflict wins over confirmed/provisional for current/future weeks.
  if (inPlan.some((c) => c.conflict != null)) return "conflict";

  // All non-past in-plan cells confirmed?
  const nonPast = inPlan.filter((c) => c.confidence !== "past");
  if (nonPast.length > 0 && nonPast.every((c) => c.confidence === "confirmed")) return "confirmed";

  return "provisional";
}

// ─── Props ────────────────────────────────────────────────────────────────────
// D-1: startedOn dropped — we use the last in-plan cell's date directly (option b).
// capRef not in props — the pop animation is applied via DOM querySelector in
// CalendarMonth.tsx's useEffect using data-testid="week-cap-{weekIndex}".
export type WeekRailProps = {
  cells: CalendarDayCell[];          // 7 cells for this week row
  weekIndex: number | null;          // from first in-plan cell — used for data-testid
  confirmedThroughDate: Date | null; // for "past-confirmed" detection
};

export function WeekRail({ cells, weekIndex, confirmedThroughDate }: WeekRailProps) {
  const railState = deriveRailState(cells, confirmedThroughDate);

  if (railState === null) {
    // Fully out-of-plan row — render an empty spacer so grid alignment holds.
    return <div aria-hidden="true" />;
  }

  // Cap element — varies by rail state.
  let capElement: React.ReactNode = null;
  if (railState === "confirmed") {
    capElement = <Bullseye filled size={15} aria-hidden />;
  } else if (railState === "provisional") {
    capElement = <Bullseye size={15} aria-hidden />;
  } else if (railState === "conflict") {
    capElement = <BullseyeWarning size={15} />;
  }
  // "past" → no cap

  // Spine class — expressed via globals.css for dashed patterns.
  let spineClass = "";
  let spineStyle: React.CSSProperties = { width: 2, flex: 1 };

  if (railState === "confirmed") {
    spineStyle = { ...spineStyle, background: "var(--accent)" };
  } else if (railState === "provisional") {
    spineClass = "rail-spine-dashed-muted";
  } else if (railState === "conflict") {
    spineClass = "rail-spine-dashed-warning";
  } else if (railState === "past") {
    spineStyle = { ...spineStyle, background: "var(--muted)", opacity: 0.3 };
  }

  return (
    <div
      data-testid={weekIndex != null ? `week-rail-${weekIndex}` : undefined}
      aria-hidden="true"
      className="flex flex-col items-center h-full"
      style={{ gap: 2 }}
    >
      {/* Cap — non-interactive; pop animation applied via DOM querySelector in CalendarMonth */}
      <div
        data-testid={weekIndex != null ? `week-cap-${weekIndex}` : undefined}
        data-confidence={railState}
        style={{ display: "inline-block" }}
      >
        {capElement}
      </div>

      {/* Spine — the vertical bar */}
      <div
        className={spineClass}
        style={spineStyle}
      />
    </div>
  );
}
