// src/components/progress/MilestoneCard.tsx
//
// Manifest key 16 — the video-verified milestone (UXR-PROG-39/41). Reads a
// FootageMarker with highlight:true; NEVER a notes regex, no new column —
// the card self-nulls when no row exists, so it cannot ship broken (R27:
// making the 2026-08-09 hold visible is a log_footage launch-checklist item,
// not code).
//
// Rarity = AREA + TYPE, not ornament: its own card is the signal; the numeral
// is the matched Baseline row's VALUE (never the frame-estimate — that would
// be inventing data) in --font-display at 30px ⚠[28–32] — the sanctioned
// display-serif use (R20: numerals ≥20px that mark a moment). Cap: ONE per
// page. A serif among sans survives grayscale.
//
// Server component.

import { Card } from "@/components/Card";
import { USER_TZ } from "@/lib/calendar-core";

export type MilestoneModel = {
  label: string;
  date: Date;
  kind: string;
  /** The Baseline row's value ±1d of the marker, when one matches. */
  numeral: string | null;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: USER_TZ,
});

export function MilestoneCard({ milestone }: { milestone: MilestoneModel | null }) {
  if (milestone === null) return null;
  return (
    <Card data-testid="milestone-card" className="scroll-mt-16">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {milestone.kind === "video" ? "Video-verified" : "Verified"} milestone
      </p>
      {milestone.numeral && (
        <p
          className="mt-1 text-[30px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
          data-testid="milestone-numeral"
        >
          {milestone.numeral}
        </p>
      )}
      <p className="mt-1 text-sm">{milestone.label}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{dateFmt.format(milestone.date)}</p>
    </Card>
  );
}
