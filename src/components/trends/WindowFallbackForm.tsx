// src/components/trends/WindowFallbackForm.tsx — the accessible date-input
// path (REQ-010 / US-008). Chips and this form are PEERS, not fallbacks; the
// drag is the accelerator (research F-C — nobody ships drag as the only
// path). It sits directly under the rail caption, where a user who has just
// failed to discover the drag is already looking.
//
// A REAL `<form method="get" action="/trends">`: without JS it GETs
// ?from=&to= and the server renders that window; with JS, submit is
// intercepted → onCommit (the island clamps to the grid and commits with
// zero round-trip). Presets are JS conveniences computed by pure dateKey
// string/index math — no client Date construction anywhere.
//
// ⚠ MUST NEVER contain a chart: ResponsiveContainer inside a closed
// <details> measures 0×0 (UXR-TRENDS-50).
//
// Client-by-inheritance under TrendsBoard; directive-free.

import { useState } from "react";

export type WindowFallbackFormProps = {
  rangeKey: string;
  fromKey: string | null;
  toKey: string | null;
  minKey: string;
  maxKey: string;
  presetFromKeys: { last7: string; last14: string; month: string };
  committed: boolean;
  onCommit: (fromKey: string, toKey: string) => void;
  onClear: () => void;
};

export function WindowFallbackForm({
  rangeKey,
  fromKey,
  toKey,
  minKey,
  maxKey,
  presetFromKeys,
  committed,
  onCommit,
  onClear,
}: WindowFallbackFormProps) {
  // Controlled so the presets can fill the inputs; seeded from the committed
  // window when one exists.
  const [fromValue, setFromValue] = useState(fromKey ?? "");
  const [toValue, setToValue] = useState(toKey ?? "");

  const applyPreset = (from: string) => {
    setFromValue(from);
    setToValue(maxKey);
    onCommit(from, maxKey);
  };

  const inputClass =
    "h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
  const presetClass =
    "flex h-11 items-center rounded-full border border-[var(--border)] bg-[var(--card)] px-3 text-xs text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

  return (
    <details data-testid="trends-fallback-lid">
      <summary className="flex h-11 cursor-pointer list-none items-center text-sm text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
        <span aria-hidden="true" className="mr-1.5">
          ▸
        </span>
        Set dates
      </summary>
      <form
        method="get"
        action="/trends"
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          if (fromValue && toValue) {
            e.preventDefault();
            onCommit(fromValue, toValue);
          }
          // Missing values: let the native GET happen — the server discards
          // the partial mix and falls back to defaults (never throws).
        }}
      >
        <input type="hidden" name="range" value={rangeKey} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--muted)]">
            Start
            <input
              type="date"
              name="from"
              value={fromValue}
              min={minKey}
              max={maxKey}
              onChange={(e) => setFromValue(e.target.value)}
              className={`mt-0.5 ${inputClass}`}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            End
            <input
              type="date"
              name="to"
              value={toValue}
              min={minKey}
              max={maxKey}
              onChange={(e) => setToValue(e.target.value)}
              className={`mt-0.5 ${inputClass}`}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="flex h-11 items-center rounded-full border border-[var(--accent)] px-3.5 text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Apply
          </button>
          <button type="button" className={presetClass} onClick={() => applyPreset(presetFromKeys.last7)}>
            Last 7d
          </button>
          <button type="button" className={presetClass} onClick={() => applyPreset(presetFromKeys.last14)}>
            Last 14d
          </button>
          <button type="button" className={presetClass} onClick={() => applyPreset(presetFromKeys.month)}>
            This month
          </button>
          {committed && (
            <button
              type="button"
              className={presetClass}
              onClick={() => {
                setFromValue("");
                setToValue("");
                onClear();
              }}
            >
              Clear window
            </button>
          )}
        </div>
      </form>
    </details>
  );
}
