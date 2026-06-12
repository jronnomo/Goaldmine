"use client";

// HikeLogForm — REQ-65-2 hike logging island.
//
// DA fixes encoded:
//   M1/M2 — revalidates /history + /character (in server action logHikeForDay)
// UXR: dashed door styling; finalize variant with accent-soft band when plannedHike.

import { useState, useTransition } from "react";
import { logHikeForDay } from "@/lib/day-log-actions";
import Link from "next/link";

interface PlannedHike {
  id: string;
  route: string;
  distanceMi: number;
  elevationFt: number;
  packWeightLb: number | null;
  durationMin: number;
  date: Date;
}

interface HikeLogFormProps {
  dateKey: string;
  plannedHike: PlannedHike | null;
}

function numStr(v: number | null): string {
  return v == null ? "" : String(v);
}

export function HikeLogForm({ dateKey, plannedHike }: HikeLogFormProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Pre-fill from planned hike when present.
  const [route, setRoute] = useState(plannedHike?.route ?? "");
  const [distanceMi, setDistanceMi] = useState(numStr(plannedHike?.distanceMi ?? null));
  const [elevationFt, setElevationFt] = useState(numStr(plannedHike?.elevationFt ?? null));
  const [durationMin, setDurationMin] = useState(numStr(plannedHike?.durationMin ?? null));
  const [packWeightLb, setPackWeightLb] = useState(numStr(plannedHike?.packWeightLb ?? null));
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit() {
    setError(null);
    const dist = parseFloat(distanceMi);
    const elev = parseFloat(elevationFt);
    const dur = parseFloat(durationMin);
    if (!route.trim()) {
      setError("Route name is required.");
      return;
    }
    if (!dist || dist <= 0) {
      setError("Distance must be a positive number.");
      return;
    }
    if (!elev || elev <= 0) {
      setError("Elevation must be a positive number.");
      return;
    }
    if (!dur || dur <= 0) {
      setError("Duration must be a positive number.");
      return;
    }

    startTransition(async () => {
      try {
        await logHikeForDay({
          dateKey,
          route: route.trim(),
          distanceMi: dist,
          elevationFt: elev,
          durationMin: dur,
          packWeightLb: packWeightLb.trim() ? parseFloat(packWeightLb) || null : null,
          rpe: rpe.trim() ? parseFloat(rpe) || null : null,
          notes: notes.trim() || null,
          ...(plannedHike && { replacesPlannedHikeId: plannedHike.id }),
        });
        setDone(true);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <p className="text-sm text-[var(--muted)]">
          Hike logged.{" "}
          <Link href="/history" className="text-[var(--accent)] hover:underline">
            View in history →
          </Link>
        </p>
      </div>
    );
  }

  // Collapsed state — dashed door styling.
  if (!open) {
    if (plannedHike) {
      // Finalize variant: accent-soft band.
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full min-h-[52px] rounded-2xl border border-dashed border-[var(--accent)] text-sm flex items-center gap-3 px-4 hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] transition"
          style={{ backgroundColor: "color-mix(in srgb, var(--accent) 4%, var(--card))" }}
        >
          <span className="text-lg" aria-hidden>🥾</span>
          <span className="text-left">
            <span className="block font-medium text-[var(--accent)]">Finalize hike</span>
            <span className="block text-xs text-[var(--muted)]">{plannedHike.route}</span>
          </span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[44px] rounded-2xl border border-dashed border-[var(--border)] text-[var(--muted)] text-sm flex items-center justify-center gap-2 hover:border-[var(--muted)] hover:text-[var(--foreground)] transition"
      >
        <span aria-hidden>🥾</span> Log hike
      </button>
    );
  }

  // Expanded form.
  const isFinalize = !!plannedHike;

  return (
    <div
      className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] p-4 space-y-3"
      style={isFinalize ? { backgroundColor: "color-mix(in srgb, var(--accent) 4%, var(--card))" } : undefined}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">
            {isFinalize ? "Finalize hike" : "Log hike"}
          </h3>
          {isFinalize && (
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Filling in actuals from your planned hike — {plannedHike.route}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition"
        >
          ×
        </button>
      </div>

      {/* Route */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Route</span>
        <input
          type="text"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="Trail or route name"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
        />
      </label>

      {/* Distance + Elevation row */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Distance (mi)</span>
          <input
            type="text"
            inputMode="decimal"
            value={distanceMi}
            onChange={(e) => setDistanceMi(e.target.value)}
            placeholder="e.g. 11.2"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Elevation (ft)</span>
          <input
            type="text"
            inputMode="numeric"
            value={elevationFt}
            onChange={(e) => setElevationFt(e.target.value)}
            placeholder="e.g. 5200"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
      </div>

      {/* Duration + Pack weight row */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Duration (min)</span>
          <input
            type="text"
            inputMode="numeric"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            placeholder="e.g. 480"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Pack weight (lb)</span>
          <input
            type="text"
            inputMode="decimal"
            value={packWeightLb}
            onChange={(e) => setPackWeightLb(e.target.value)}
            placeholder="Optional"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
      </div>

      {/* RPE + Notes row */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">RPE (0–10)</span>
          <input
            type="text"
            inputMode="decimal"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            placeholder="Optional"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Notes</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
      </div>

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending}
        className="w-full min-h-[52px] rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] font-semibold disabled:opacity-50 transition"
      >
        {pending ? "Saving…" : isFinalize ? "Finalize hike" : "Log hike"}
      </button>
    </div>
  );
}
