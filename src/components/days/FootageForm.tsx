"use client";

import { useState, useTransition } from "react";
import { logFootageMarker } from "@/lib/footage-actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FootageFormProps {
  date: string; // yyyy-mm-dd — written into hidden FormData field
  exercises: { name: string }[]; // deduplicated, canonicalized — drives the exercise picker
}

// ---------------------------------------------------------------------------
// FootageForm
// ---------------------------------------------------------------------------

export function FootageForm({ date, exercises }: FootageFormProps) {
  const [isPending, startTransition] = useTransition();

  // Controlled fields
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"video" | "photo">("video");
  const [exerciseName, setExerciseName] = useState(""); // "" = whole day / no exercise
  const [filename, setFilename] = useState("");
  const [highlight, setHighlight] = useState(false);

  // Feedback states
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit() {
    setError(null);
    setSuccess(false);

    const fd = new FormData();
    fd.set("date", date);
    fd.set("label", label.trim());
    fd.set("kind", kind);
    fd.set("exerciseName", exerciseName); // "" = no exercise (server-action coerces to null)
    fd.set("filename", filename.trim());
    fd.set("highlight", String(highlight));
    // capturedAt: omitted (MCP-only for v1 — DC-3)

    startTransition(async () => {
      try {
        await logFootageMarker(fd);
        // Reset on success (MR-2: brief "Added ✓" shown)
        setLabel("");
        setFilename("");
        setHighlight(false);
        setExerciseName("");
        setSuccess(true);
        // Fade success after 2.5 s
        setTimeout(() => setSuccess(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="border-t border-[var(--border)] pt-3 mt-1 space-y-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)] font-medium">
        Add footage
      </p>

      {/* Label */}
      <div className="flex flex-col gap-1">
        <label htmlFor="footage-label" className="text-xs font-medium text-[var(--muted)]">
          Label <span aria-hidden className="text-[var(--danger)]">*</span>
        </label>
        <input
          id="footage-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='e.g. "24-pull-up PR — hero shot"'
          required
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
        />
      </div>

      {/* Kind toggle */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--muted)]">Kind</span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={kind === "video"}
            onClick={() => setKind("video")}
            className={[
              "flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition",
              kind === "video"
                ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                : "border-[var(--border)] text-[var(--muted)]",
            ].join(" ")}
          >
            ▶ video
          </button>
          <button
            type="button"
            aria-pressed={kind === "photo"}
            onClick={() => setKind("photo")}
            className={[
              "flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition",
              kind === "photo"
                ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                : "border-[var(--border)] text-[var(--muted)]",
            ].join(" ")}
          >
            ⊞ photo
          </button>
        </div>
      </div>

      {/* Exercise picker */}
      <div className="flex flex-col gap-1">
        <label htmlFor="footage-exercise" className="text-xs font-medium text-[var(--muted)]">
          Exercise
        </label>
        <select
          id="footage-exercise"
          value={exerciseName}
          onChange={(e) => setExerciseName(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] text-[var(--foreground)]"
        >
          <option value="">whole day / no exercise</option>
          {exercises.map((ex) => (
            <option key={ex.name} value={ex.name}>
              {ex.name}
            </option>
          ))}
        </select>
      </div>

      {/* Filename */}
      <div className="flex flex-col gap-1">
        <label htmlFor="footage-filename" className="text-xs font-medium text-[var(--muted)]">
          Filename
        </label>
        <input
          id="footage-filename"
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="IMG_4412.mov"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
        />
      </div>

      {/* Highlight toggle + submit row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-pressed={highlight}
          onClick={() => setHighlight((h) => !h)}
          className={[
            "min-h-[44px] px-4 rounded-lg border text-sm font-medium transition flex-1",
            highlight
              ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
              : "border-[var(--border)] text-[var(--muted)]",
          ].join(" ")}
        >
          {highlight ? "★ hero shot" : "☆ hero shot"}
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !label.trim()}
          className="min-h-[44px] px-5 rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] font-semibold text-sm disabled:opacity-50 transition"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </div>

      {/* Feedback: success (MR-2) or error (CRIT-2) */}
      {success && !error && (
        <p className="text-xs text-[var(--accent)]" role="status" aria-live="polite">
          Added ✓
        </p>
      )}
      {error && (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
