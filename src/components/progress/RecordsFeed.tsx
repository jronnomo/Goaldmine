// src/components/progress/RecordsFeed.tsx
//
// Manifest key 8 — the MIXED-KIND records feed (UXR-PROG-33): PRs + baseline
// results + hikes over the trailing 21 days. Always renders — the zero-state
// is honest, and its 0 is a TRUE count (the R11 carve-out's ✓ case, not an
// invented numeral).
//
// UXR-PROG-34 (R26): the glyph column renders ONLY when distinctKinds > 1 —
// a trophy on every row of a single-kind list is clip-art. Glyphs are
// <RecapGlyph> at the 24px hard floor (⚑ UXR-PROG-35 resolved), tinted by
// currentColor so grayscale loses nothing.
//
// UXR-PROG-36: content celebratory, presentation calm — `24 → 26 reps`
// deltas; a NEW chip + --accent value ONLY when ≤7 days old; no motion.
//
// R19/UXR-PROG-100: the register link reads "All records →" (the target
// page's h1 is Records).
//
// Server component.

import Link from "next/link";
import { OverflowList } from "@/components/OverflowList";
import { RecapGlyph } from "@/components/RecapGlyph";
import { feedValueText, RECORDS_WINDOW_DAYS, type RecordFeedItem } from "@/lib/progress-records";
import type { RecapHighlightIconId } from "@/lib/recap-icons";
import { USER_TZ } from "@/lib/calendar-core";

const GLYPH_FOR: Record<RecordFeedItem["kind"], RecapHighlightIconId> = {
  pr: "trophy",
  baseline: "ruler",
  hike: "mountain",
};

const NEW_CHIP_DAYS = 7;

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

export function RecordsFeed({
  items,
  now,
  headline = 3, // ⚠[3–5] UXR-PROG-68
  windowDays = RECORDS_WINDOW_DAYS,
  countKnown = true,
}: {
  items: RecordFeedItem[];
  now: Date;
  headline?: number;
  windowDays?: number;
  /** R11 carve-out: the zero-row shape computes NO feed, so it may not claim
   *  a 0 — the numeral renders only when the count was actually computed. */
  countKnown?: boolean;
}) {
  const distinctKinds = new Set(items.map((i) => i.kind)).size;
  const showGlyphs = distinctKinds > 1;
  const newCutoff = now.getTime() - NEW_CHIP_DAYS * 24 * 3600 * 1000;

  return (
    <section
      id="records"
      data-testid="records-feed"
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm scroll-mt-16"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Recent records · {windowDays} days
        </span>
        {countKnown && (
          <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">
          None in the last {windowDays} days.
        </p>
      ) : (
        <div className="mt-1">
          <OverflowList
            items={items}
            headline={headline}
            keyOf={(i) => i.id}
            noun="records"
            data-testid="overflow-list-records"
            renderItem={(i) => {
              const isNew = i.date.getTime() >= newCutoff;
              return (
                <div
                  className="flex items-center gap-2.5 py-2 border-b border-[var(--border)] last:border-b-0"
                  data-testid={`record-row-${i.kind}-${i.id}`}
                >
                  {showGlyphs && (
                    <span className="text-[var(--muted)]">
                      <RecapGlyph icon={GLYPH_FOR[i.kind]} data-testid={`record-glyph-${i.kind}`} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
                  {isNew && i.kind === "pr" && (
                    <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      new
                    </span>
                  )}
                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      isNew && i.kind === "pr" ? "text-[var(--accent)] font-medium" : ""
                    }`}
                  >
                    {feedValueText(i)}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">
                    {dateFmt.format(i.date)}
                  </span>
                </div>
              );
            }}
          />
        </div>
      )}

      <Link
        href="/baselines"
        className="mt-2 inline-flex min-h-11 items-center text-xs text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
      >
        All records →
      </Link>
    </section>
  );
}
