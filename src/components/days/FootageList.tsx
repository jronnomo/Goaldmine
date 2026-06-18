"use client";

import { useTransition } from "react";
import { deleteFootageMarker } from "@/lib/footage-actions";

// ---------------------------------------------------------------------------
// Serialized type — capturedAt is always an ISO string (never a Date).
// Exported so page.tsx can build and type-check the array before passing it.
// ---------------------------------------------------------------------------

export type SerializedMarker = {
  id: string;
  label: string;
  kind: string; // "video" | "photo"
  filename: string | null;
  externalRef: string | null; // stored only, never linked (MR-1)
  capturedAt: string | null; // ISO string — NEVER a Date (client component constraint)
  exerciseName: string | null;
  highlight: boolean;
  // createdAt intentionally omitted — not needed in the UI
};

// ---------------------------------------------------------------------------
// FootageMarkerItem — inline sub-component
// ---------------------------------------------------------------------------

function FootageMarkerItem({
  marker,
  dateKey,
  isPending,
  onDelete,
}: {
  marker: SerializedMarker;
  dateKey: string;
  isPending: boolean;
  onDelete: (marker: SerializedMarker, dateKey: string) => void;
}) {
  const kindIcon = marker.kind === "photo" ? "⊞" : "▶";

  return (
    <li className="flex items-start gap-2 py-2 border-b border-[var(--border)] last:border-0">
      {/* Left: kind icon + content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        {/* First line: icon · filename · exercise · hero star */}
        <p className="text-sm flex flex-wrap items-center gap-1 min-w-0">
          <span aria-hidden className="shrink-0 text-[var(--muted)]">
            {kindIcon}
          </span>
          {marker.filename && (
            <span className="truncate max-w-[120px] font-medium">{marker.filename}</span>
          )}
          {marker.exerciseName && (
            <span className="text-[var(--muted)]">· {marker.exerciseName}</span>
          )}
          {marker.highlight && (
            <span
              className="text-[var(--accent)] shrink-0"
              aria-hidden
              title="hero shot"
            >
              ★
            </span>
          )}
        </p>

        {/* Second line: label */}
        <p className="text-xs text-[var(--muted)]">{marker.label}</p>

        {/* Third line: "hero shot" text label (a11y — highlight not icon-only) */}
        {marker.highlight && (
          <p className="text-xs text-[var(--accent)]">hero shot</p>
        )}

        {/* externalRef: muted text only, NEVER a link (MR-1: XSS guard) */}
        {marker.externalRef && (
          <p className="text-xs text-[var(--muted)] truncate" title={marker.externalRef}>
            ref: {marker.externalRef}
          </p>
        )}
      </div>

      {/* Right: delete button */}
      <button
        type="button"
        disabled={isPending}
        onClick={() => onDelete(marker, dateKey)}
        aria-label={`Delete footage marker: ${marker.label}`}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-30 transition shrink-0"
      >
        ×
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FootageList
// ---------------------------------------------------------------------------

interface FootageListProps {
  dateKey: string; // yyyy-mm-dd — passed to deleteFootageMarker as hidden field
  markers: SerializedMarker[];
}

export function FootageList({ dateKey, markers }: FootageListProps) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(marker: SerializedMarker, dk: string) {
    if (!confirm("Remove this footage marker?")) return;
    const fd = new FormData();
    fd.set("id", marker.id);
    fd.set("dateKey", dk);
    startTransition(async () => {
      try {
        await deleteFootageMarker(fd);
      } catch (e) {
        // Surface error without crashing the component tree
        console.error("Failed to delete footage marker:", e);
      }
    });
  }

  if (markers.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">No footage tagged for this day yet.</p>
    );
  }

  return (
    <ul className="mb-4">
      {markers.map((m) => (
        <FootageMarkerItem
          key={m.id}
          marker={m}
          dateKey={dateKey}
          isPending={isPending}
          onDelete={handleDelete}
        />
      ))}
    </ul>
  );
}
