"use client";

// src/components/RecapClient.tsx
// Client component for the /recap page.
// Owns: week selector, template toggle, preview image, download links.
//
// CRIT-2 compliance: receives ONLY {offset, label}[] from the server.
// No Date objects, no WeeklyRecap, no client-side TZ math. Label always
// comes from weeks[weekIdx].label (pre-computed server-side by weekRangeLabel).

import { useState } from "react";
import type { RecapTemplate } from "@/lib/recap";

type WeekItem = { offset: number; label: string };

export function RecapClient({
  weeks,
  defaultTemplate = "coal",
}: {
  weeks: WeekItem[];
  defaultTemplate?: RecapTemplate;
}) {
  // weekIdx: 0 = current week, 1 = one week ago, etc.
  const [weekIdx, setWeekIdx] = useState(0);
  const [template, setTemplate] = useState<RecapTemplate>(defaultTemplate);
  const [imageLoading, setImageLoading] = useState(true);

  const currentWeek = weeks[weekIdx];
  const cardUrl = `/recap/card?weekOffset=${currentWeek.offset}&template=${template}`;

  function storyUrl(slide: 1 | 2 | 3): string {
    return `/recap/story/${slide}?weekOffset=${currentWeek.offset}&template=${template}`;
  }

  return (
    <div className="space-y-4">
      {/* Preview image zone */}
      <div className="relative flex justify-center overflow-hidden rounded-lg bg-[var(--card)]">
        {imageLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-[var(--muted)]">Loading…</span>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardUrl}
          width={540}
          height={960}
          alt="Weekly recap card preview"
          className="w-full h-auto rounded-lg"
          onLoadStart={() => setImageLoading(true)}
          onLoad={() => setImageLoading(false)}
        />
      </div>

      {/* Week selector */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setWeekIdx((i) => Math.min(i + 1, weeks.length - 1));
            setImageLoading(true);
          }}
          disabled={weekIdx >= weeks.length - 1}
          aria-label="Previous week"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] disabled:opacity-30 hover:text-foreground transition-colors"
        >
          ◀
        </button>
        <span className="flex-1 text-sm font-medium text-center">
          {currentWeek.label}
        </span>
        <button
          type="button"
          onClick={() => {
            setWeekIdx((i) => Math.max(i - 1, 0));
            setImageLoading(true);
          }}
          disabled={weekIdx <= 0}
          aria-label="Next week"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] disabled:opacity-30 hover:text-foreground transition-colors"
        >
          ▶
        </button>
      </div>

      {/* Template toggle */}
      <div className="flex gap-2">
        {(["coal", "parchment"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={template === t}
            onClick={() => {
              setTemplate(t);
              setImageLoading(true);
            }}
            className={`flex-1 min-h-[44px] rounded-lg border text-sm font-medium capitalize transition-colors ${
              template === t
                ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] text-[var(--muted)] hover:text-foreground"
            }`}
          >
            {t === "coal" ? "Coal" : "Parchment"}
          </button>
        ))}
      </div>

      {/* Download card */}
      <a
        href={cardUrl}
        download="recap-card.png"
        className="flex items-center justify-center min-h-[44px] w-full rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Download Card
      </a>

      {/* Download stories */}
      <div className="flex gap-2">
        {([1, 2, 3] as const).map((slide) => (
          <a
            key={slide}
            href={storyUrl(slide)}
            download={`recap-story-${slide}.png`}
            className="flex-1 flex items-center justify-center min-h-[44px] rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-foreground transition-colors"
          >
            Story {slide}
          </a>
        ))}
      </div>
    </div>
  );
}
