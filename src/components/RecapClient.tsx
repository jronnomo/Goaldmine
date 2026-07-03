"use client";

// src/components/RecapClient.tsx
// Client component for the /recap page.
// Owns: week selector, template toggle, highlight picker, preview image, download links.
//
// CRIT-2 compliance: receives ONLY {offset, label}[] + postedWeeks: number[] from the server.
// No Date objects, no WeeklyRecap, no client-side TZ math. Label always
// comes from weeks[weekIdx].label (pre-computed server-side by weekRangeLabel).

import { useState, useEffect } from "react";
import type { RecapTemplate, RecapCardFormat, RecapHighlight } from "@/lib/recap";
import { markRecapPosted } from "@/lib/recap-actions";

type WeekItem = { offset: number; label: string };

export function RecapClient({
  weeks,
  defaultTemplate = "coal",
  postedWeeks = [],
}: {
  weeks: WeekItem[];
  defaultTemplate?: RecapTemplate;
  postedWeeks?: number[]; // plain offsets — no Date objects (CRIT-2)
}) {
  // weekIdx: 0 = current week, 1 = one week ago, etc.
  const [weekIdx, setWeekIdx] = useState(0);
  const [template, setTemplate] = useState<RecapTemplate>(defaultTemplate);
  const [format, setFormat] = useState<RecapCardFormat>("story");
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

  // ── Posted state ─────────────────────────────────────────────────────────
  // Seeded from server-derived postedWeeks; persists across week navigation.
  // Never reset in navigateToWeek — posted state is sticky within the session.
  const [locallyPosted, setLocallyPosted] = useState<Set<number>>(
    () => new Set(postedWeeks),
  );

  // REV-4 (DC-2): re-sync when the prop changes (e.g. after revalidatePath lands).
  // Keeps optimistic additions; never un-posts.
  // This controlled state-merge is intentional; suppress the cascading-render rule.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocallyPosted((prev) => {
      const merged = new Set(postedWeeks);
      prev.forEach((o) => merged.add(o));
      return merged;
    });
  }, [postedWeeks]);

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
  // locallyPosted is intentionally NOT reset here; posted state persists across week nav.
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

  // ── Derived values ────────────────────────────────────────────────────────
  const currentWeek = weeks[weekIdx];
  // isPosted: true when this week's offset is in the server list OR locally optimistic
  const isPosted =
    postedWeeks.includes(currentWeek.offset) ||
    locallyPosted.has(currentWeek.offset);

  const highlightParam = highlightValue
    ? `&highlight=${encodeURIComponent(highlightValue)}`
    : "";
  const cardUrl = `/recap/card?weekOffset=${currentWeek.offset}&template=${template}&format=${format}${highlightParam}`;
  const cardFileName = `recap-card-${format}.png`;
  // Preview intrinsic dimensions per format (display is responsive via CSS).
  const previewSize: Record<RecapCardFormat, { w: number; h: number }> = {
    story: { w: 540, h: 960 },
    post: { w: 540, h: 675 },
    square: { w: 540, h: 540 },
  };

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
      const file = new File([blob], cardFileName, { type: "image/png" });

      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: caption });
        // Native share completed — optimistic ✓ first (instant), then await server action
        setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));
        await markRecapPosted(currentWeek.offset);
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
        a.download = cardFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        // Fallback download completed — optimistic ✓ first (instant), then await server action
        setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));
        await markRecapPosted(currentWeek.offset);
        setShareError("Web Share unavailable — caption copied + card downloaded.");
      }
    } catch (e) {
      // AbortError = user dismissed the OS share sheet → NOT an error; NOT posted
      if ((e as Error)?.name !== "AbortError") {
        setShareError("Couldn't prepare the share. Try again.");
      }
      // markRecapPosted is NOT called on AbortError or on other errors
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
          width={previewSize[format].w}
          height={previewSize[format].h}
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

      {/* Format toggle — output dimensions for the shareable card */}
      <div className="flex gap-2">
        {(
          [
            { value: "story", label: "Story 9:16" },
            { value: "post", label: "Post 4:5" },
            { value: "square", label: "Square 1:1" },
          ] as const
        ).map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={format === f.value}
            onClick={() => {
              setFormat(f.value);
              setImageLoading(true);
            }}
            className={`flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition-colors ${
              format === f.value
                ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] text-[var(--muted)] hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
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
              {h.icon} {h.label}{h.meta ? ` — ${h.meta}` : ""}
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

      {/* Posted status — persistent polite live region, reserved height, no layout shift.
          Mounted empty so the optimistic text mutation announces (LogNoteForm.tsx:83 pattern).
          aria-live="polite" only — no role="status", no .focus(). */}
      <p
        className="text-sm min-h-[1.25rem] text-center text-[var(--success)]"
        aria-live="polite"
      >
        {isPosted ? (
          <>
            <span aria-hidden="true">✓ </span>Shared
          </>
        ) : null}
      </p>

      {/* Share — primary accent CTA when not posted; secondary border + "Share again" when posted.
          disabled only while sharing (never on isPosted); focus ring preserved. */}
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className={`flex items-center justify-center min-h-[44px] w-full rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
          isPosted
            ? "border border-[var(--border)] text-[var(--muted)] hover:text-foreground" // secondary
            : "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90" // primary
        }`}
      >
        {sharing ? "Preparing…" : isPosted ? "Share again" : "Share"}
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
        download={cardFileName}
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
