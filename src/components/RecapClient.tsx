"use client";

// src/components/RecapClient.tsx
// Client component for the /recap page.
// Owns: week selector, template toggle, highlight picker, preview image, download links.
//
// CRIT-2 compliance: receives ONLY {offset, label}[] from the server.
// No Date objects, no WeeklyRecap, no client-side TZ math. Label always
// comes from weeks[weekIdx].label (pre-computed server-side by weekRangeLabel).

import { useState, useEffect } from "react";
import type { RecapTemplate, RecapHighlight } from "@/lib/recap";

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

  // ── Highlight state ──────────────────────────────────────────────────────
  // candidates: null = loading in progress, [] = loaded (no candidates found)
  const [candidates, setCandidates] = useState<RecapHighlight[] | null>(null);
  // highlightValue: "" = None, a candidate id, or "custom:<text>"
  const [highlightValue, setHighlightValue] = useState("");
  const [customText, setCustomText] = useState("");

  // ── Share state ──────────────────────────────────────────────────────────
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // ── Fetch candidates when weekIdx changes (purely async — no synchronous setState) ──
  useEffect(() => {
    const offset = weeks[weekIdx]?.offset ?? 0;
    let cancelled = false;

    fetch(`/recap/highlights?weekOffset=${offset}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ highlights: [] })))
      .then((data: { highlights?: RecapHighlight[] }) => {
        if (!cancelled) setCandidates(data.highlights ?? []);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });

    return () => {
      cancelled = true;
    };
  }, [weekIdx, weeks]);

  // ── Week navigation — also resets highlight + share state ───────────────
  function navigateToWeek(newIdx: number) {
    setWeekIdx(newIdx);
    // Reset highlight for the incoming week; null = loading
    setCandidates(null);
    setHighlightValue("");
    setCustomText("");
    setImageLoading(true);
    // Reset share state so the button is never locked on the new week
    setSharing(false);
    setShareError(null);
  }

  // ── Derived URLs ─────────────────────────────────────────────────────────
  const currentWeek = weeks[weekIdx];
  const highlightParam = highlightValue
    ? `&highlight=${encodeURIComponent(highlightValue)}`
    : "";
  const cardUrl = `/recap/card?weekOffset=${currentWeek.offset}&template=${template}${highlightParam}`;

  function storyUrl(slide: 1 | 2 | 3): string {
    // Story slides do NOT carry a highlight param — slides are unchanged.
    return `/recap/story/${slide}?weekOffset=${currentWeek.offset}&template=${template}`;
  }

  // ── Highlight select handler ──────────────────────────────────────────────
  function handleHighlightSelectChange(value: string) {
    if (value === "__custom__") {
      setHighlightValue("custom:");
    } else {
      setHighlightValue(value);
    }
    setImageLoading(true);
  }

  const selectValue = highlightValue.startsWith("custom:")
    ? "__custom__"
    : highlightValue;

  const highlightLoading = candidates === null;

  // ── Share handler ─────────────────────────────────────────────────────────
  async function handleShare() {
    setSharing(true);
    setShareError(null);
    try {
      const captionUrl = `/recap/caption?weekOffset=${currentWeek.offset}${highlightParam}`;
      const [capRes, imgRes] = await Promise.all([
        fetch(captionUrl),
        fetch(cardUrl),
      ]);

      // Caption is best-effort: if the fetch fails, share with empty caption
      const { caption } = capRes.ok
        ? ((await capRes.json()) as { caption: string })
        : { caption: "" };

      if (!imgRes.ok) {
        setShareError("Couldn't load the recap card. Try again.");
        return;
      }
      const blob = await imgRes.blob();
      const file = new File([blob], "recap-card.png", { type: "image/png" });

      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: caption });
      } else {
        // Fallback: copy caption to clipboard + trigger PNG download
        try {
          if (typeof navigator !== "undefined") {
            await navigator.clipboard?.writeText(caption);
          }
        } catch {
          // clipboard unavailable — swallow, best-effort copy
        }
        // Use the ShareWorkout blob-download pattern (append→click→remove for Safari)
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "recap-card.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShareError("Web Share unavailable — caption copied + card downloaded.");
      }
    } catch (e) {
      // AbortError = user dismissed the OS share sheet → NOT an error
      if ((e as Error)?.name !== "AbortError") {
        setShareError("Couldn't prepare the share. Try again.");
      }
    } finally {
      setSharing(false);
    }
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
          onClick={() => navigateToWeek(Math.min(weekIdx + 1, weeks.length - 1))}
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
          onClick={() => navigateToWeek(Math.max(weekIdx - 1, 0))}
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

      {/* Highlight picker */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--muted)]">Featured Highlight</span>
          {highlightLoading && (
            <span className="text-xs text-[var(--muted)]">Loading…</span>
          )}
        </div>

        <select
          value={selectValue}
          onChange={(e) => handleHighlightSelectChange(e.target.value)}
          aria-label="Select featured highlight"
          disabled={highlightLoading}
          className="w-full min-h-[44px] rounded-lg border border-[var(--border)] text-sm px-3 bg-[var(--card)] text-[var(--foreground)] disabled:opacity-50"
        >
          <option value="">None</option>
          {(candidates ?? []).map((h) => (
            <option key={h.id} value={h.id}>
              {h.icon} {h.label}
            </option>
          ))}
          <option value="__custom__">Custom…</option>
        </select>

        {highlightValue.startsWith("custom:") && (
          <input
            type="text"
            placeholder="Enter your highlight text"
            value={customText}
            onChange={(e) => {
              const text = e.target.value;
              setCustomText(text);
              setHighlightValue(`custom:${text}`);
              setImageLoading(true);
            }}
            aria-label="Custom highlight text"
            className="w-full min-h-[44px] rounded-lg border border-[var(--border)] text-sm px-3 bg-[var(--card)] text-[var(--foreground)]"
          />
        )}
      </div>

      {/* Share — primary CTA (accent, full-width) */}
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className="flex items-center justify-center min-h-[44px] w-full rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {sharing ? "Preparing…" : "Share"}
      </button>

      {/* Share error — muted note, hidden unless set (W-4: role=alert for screen readers) */}
      {shareError && (
        <p role="alert" className="text-xs text-[var(--muted)] text-center -mt-2">
          {shareError}
        </p>
      )}

      {/* Download card — secondary action (border style) */}
      <a
        href={cardUrl}
        download="recap-card.png"
        className="flex items-center justify-center min-h-[44px] w-full rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-foreground transition-colors"
      >
        Download Card
      </a>

      {/* Download stories (no highlight — slides are unchanged) */}
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
