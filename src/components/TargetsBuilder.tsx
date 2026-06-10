"use client";

import { useState } from "react";
// Import from the client-safe barrel — goal-targets.ts pulls in Prisma and
// can't be bundled for the browser.
import { METRICS, METRIC_BY_ID } from "@/lib/metrics-registry";
import type { GoalTarget, Direction } from "@/lib/metrics-registry";

type Importance = 1 | 2 | 3;

type Row = {
  rowId: string;
  /** Actual metric id from METRICS, or "__custom__" while user is picking. */
  metric: string;
  isCustom: boolean;
  customLabel: string;
  customSlug: string;
  customUnits: string;
  customDirection: Direction;
  target: string;
  importance: Importance;
  /** Round-trip preserved — never rendered in the builder UI. */
  rationale?: string;
  start?: number;
};

function secToMmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Convert builder rows → GoalTarget[].
 * Importance values (1/2/3) are normalized to weights that sum to 1.
 * The last row absorbs rounding to guarantee the exact sum.
 */
function rowsToTargets(rows: Row[]): GoalTarget[] {
  if (rows.length === 0) return [];
  const total = rows.reduce((s, r) => s + r.importance, 0) || 1;
  const weights = rows.map((r) => Math.round((r.importance / total) * 100) / 100);
  // fix last to guarantee sum = 1.00
  const sumRest = weights.slice(0, -1).reduce((a, b) => a + b, 0);
  weights[weights.length - 1] = Math.round((1 - sumRest) * 100) / 100;

  return rows.map((r, i) => {
    const spec = METRIC_BY_ID.get(r.metric);
    const result: GoalTarget = {
      metric: r.isCustom ? `log:${r.customSlug}` : r.metric,
      label: r.isCustom ? r.customLabel : (spec?.label ?? r.metric),
      units: r.isCustom ? r.customUnits : (spec?.units ?? ""),
      direction: r.isCustom ? r.customDirection : (spec?.direction ?? "increase"),
      target: parseFloat(r.target) || 0,
      weight: weights[i],
    };
    if (r.rationale !== undefined) result.rationale = r.rationale;
    if (r.start !== undefined) result.start = r.start;
    return result;
  });
}

function importanceFromWeight(weight: number, avgWeight: number): Importance {
  if (weight < avgWeight * 0.6) return 1;
  if (weight > avgWeight * 1.6) return 3;
  return 2;
}

/**
 * Parse an existing GoalTarget[] JSON string into builder rows.
 * Reverse-engineers importance from each target's weight relative to the
 * per-target average. Preserves rationale and start for round-trip fidelity.
 */
function parseRows(json?: string): Row[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as GoalTarget[];
    if (!Array.isArray(arr) || arr.length === 0) return [];
    const avgWeight = 1 / arr.length;
    return arr.map((t) => {
      // A metric is "custom" if it's not in the curated registry.
      // Registered log:* metrics (e.g. log:mrr) are curated and stay in the select.
      const isCustom = !METRIC_BY_ID.has(t.metric);
      const customSlug =
        isCustom && typeof t.metric === "string" && t.metric.startsWith("log:")
          ? t.metric.slice(4)
          : "";
      const row: Row = {
        rowId: Math.random().toString(36).slice(2),
        metric: t.metric,
        isCustom,
        customLabel: isCustom ? (t.label ?? "") : "",
        customSlug,
        customUnits: isCustom ? (t.units ?? "") : "",
        customDirection: isCustom ? (t.direction ?? "increase") : "increase",
        target: String(t.target ?? ""),
        importance: importanceFromWeight(t.weight ?? 0, avgWeight),
      };
      if (t.rationale !== undefined) row.rationale = t.rationale;
      if (t.start !== undefined) row.start = t.start;
      return row;
    });
  } catch {
    return [];
  }
}

/**
 * Friendly row-based targets builder.
 *
 * Props:
 *   defaultTargetsJson — existing JSON string to pre-populate rows from.
 *   alwaysEmit — when true, always renders the hidden <input name="targets">
 *                (use in edit forms so saving zero rows still clears the field).
 *                When false (default, for create forms) the input is omitted
 *                when there are no rows, allowing the server's copyFromGoalId
 *                path to kick in.
 */
export function TargetsBuilder({
  defaultTargetsJson,
  alwaysEmit = false,
}: {
  defaultTargetsJson?: string;
  alwaysEmit?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => parseRows(defaultTargetsJson));
  const [mode, setMode] = useState<"builder" | "advanced">("builder");
  const [advancedJson, setAdvancedJson] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  const targets = rowsToTargets(rows);
  const serialized = JSON.stringify(targets);
  const totalImportance = rows.reduce((s, r) => s + r.importance, 0) || 1;
  const showHiddenInput = alwaysEmit || rows.length > 0;

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        rowId: Math.random().toString(36).slice(2),
        metric: METRICS[0].id,
        isCustom: false,
        customLabel: "",
        customSlug: "",
        customUnits: "",
        customDirection: "increase",
        target: "",
        importance: 2,
      },
    ]);
  }

  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function updateRow(rowId: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function openAdvanced() {
    setAdvancedJson(JSON.stringify(rowsToTargets(rows), null, 2));
    setAdvancedError(null);
    setMode("advanced");
  }

  function switchToBuilder() {
    try {
      const parsed = JSON.parse(advancedJson);
      if (!Array.isArray(parsed)) throw new Error("Root value must be an array");
      setRows(parseRows(advancedJson));
      setAdvancedError(null);
      setMode("builder");
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Targets</span>
        <button
          type="button"
          onClick={mode === "builder" ? openAdvanced : switchToBuilder}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          {mode === "builder" ? "Advanced: edit as JSON →" : "← Back to builder"}
        </button>
      </div>

      {/* Hidden form field — keeps server actions untouched */}
      {showHiddenInput && (
        <input
          type="hidden"
          name="targets"
          value={rows.length === 0 ? "[]" : serialized}
        />
      )}

      {mode === "advanced" ? (
        /* ── Advanced JSON tab ── */
        <div className="flex flex-col gap-2">
          <textarea
            value={advancedJson}
            onChange={(e) => setAdvancedJson(e.target.value)}
            rows={12}
            aria-label="Targets JSON (advanced)"
            spellCheck={false}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs font-mono resize-y"
          />
          {advancedError && (
            <p className="text-xs text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
              Fix before switching back: {advancedError}
            </p>
          )}
        </div>
      ) : (
        /* ── Builder tab ── */
        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <p className="text-sm text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg px-3 py-3 text-center">
              No targets yet — add one below.
            </p>
          )}

          {rows.map((row) => {
            const spec = METRIC_BY_ID.get(row.metric);
            const units = row.isCustom ? row.customUnits : (spec?.units ?? "");
            const isSeconds = units === "sec";
            const targetNum = parseFloat(row.target);
            const pct = Math.round((row.importance / totalImportance) * 100);

            return (
              <div
                key={row.rowId}
                className="rounded-lg border border-[var(--border)] p-3 flex flex-col gap-2"
              >
                {/* Metric select + remove */}
                <div className="flex items-start gap-2">
                  <label className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="sr-only">Metric</span>
                    <select
                      value={row.isCustom ? "__custom__" : row.metric}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__custom__") {
                          updateRow(row.rowId, {
                            isCustom: true,
                            metric: "__custom__",
                          });
                        } else {
                          updateRow(row.rowId, {
                            isCustom: false,
                            metric: val,
                          });
                        }
                      }}
                      aria-label="Metric"
                      className="rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-sm min-h-[44px]"
                    >
                      {METRICS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.units})
                        </option>
                      ))}
                      <option value="__custom__">Custom metric…</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRow(row.rowId)}
                    aria-label="Remove target"
                    className="mt-0.5 flex-none flex items-center justify-center w-11 h-11 rounded-md text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition"
                  >
                    ✕
                  </button>
                </div>

                {/* Custom metric extra fields (shown only for custom) */}
                {row.isCustom && (
                  <div className="flex flex-col gap-2 border-l-2 border-[var(--border)] pl-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-[var(--muted)]">Metric name</span>
                      <input
                        type="text"
                        value={row.customLabel}
                        onChange={(e) => {
                          const label = e.target.value;
                          const slug = label
                            .toLowerCase()
                            .replace(/\s+/g, "_")
                            .replace(/[^a-z0-9_]/g, "");
                          updateRow(row.rowId, {
                            customLabel: label,
                            customSlug: slug,
                            metric: `log:${slug}`,
                          });
                        }}
                        placeholder="e.g. Monthly revenue"
                        aria-label="Custom metric name"
                        className="rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-sm min-h-[44px]"
                      />
                    </label>
                    <div className="flex gap-2">
                      <label className="flex-1 flex flex-col gap-1">
                        <span className="text-xs text-[var(--muted)]">Units</span>
                        <input
                          type="text"
                          value={row.customUnits}
                          onChange={(e) =>
                            updateRow(row.rowId, { customUnits: e.target.value })
                          }
                          placeholder="$, reps, km…"
                          aria-label="Custom metric units"
                          className="rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-sm min-h-[44px]"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-[var(--muted)]">Direction</span>
                        <select
                          value={row.customDirection}
                          onChange={(e) =>
                            updateRow(row.rowId, {
                              customDirection: e.target.value as Direction,
                            })
                          }
                          aria-label="Goal direction"
                          className="rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-sm min-h-[44px]"
                        >
                          <option value="increase">Higher is better</option>
                          <option value="decrease">Lower is better</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                {/* Target value input */}
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-[var(--muted)] shrink-0">Target</span>
                    <input
                      type="number"
                      value={row.target}
                      onChange={(e) => updateRow(row.rowId, { target: e.target.value })}
                      placeholder="0"
                      step="any"
                      aria-label={`Target value${units ? ` in ${units}` : ""}`}
                      className="rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-sm min-h-[44px] w-24"
                    />
                    {units && (
                      <span className="text-xs text-[var(--muted)] shrink-0">{units}</span>
                    )}
                  </label>
                  {/* mm:ss preview for second-valued metrics */}
                  {isSeconds && !Number.isNaN(targetNum) && targetNum > 0 && (
                    <span className="text-xs text-[var(--muted)] tabular-nums shrink-0">
                      ({secToMmss(Math.round(targetNum))})
                    </span>
                  )}
                </div>

                {/* Importance segmented control */}
                <div className="flex items-center gap-2">
                  <span
                    id={`imp-label-${row.rowId}`}
                    className="text-xs text-[var(--muted)] shrink-0 w-[5rem]"
                  >
                    Importance
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby={`imp-label-${row.rowId}`}
                    className="flex rounded-md border border-[var(--border)] overflow-hidden"
                  >
                    {([1, 2, 3] as const).map((level) => {
                      const labelMap: Record<number, string> = {
                        1: "Low",
                        2: "Normal",
                        3: "High",
                      };
                      const active = row.importance === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          tabIndex={active ? 0 : -1}
                          onClick={() => updateRow(row.rowId, { importance: level })}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowLeft") {
                              updateRow(row.rowId, {
                                importance: Math.max(1, row.importance - 1) as Importance,
                              });
                              e.preventDefault();
                            }
                            if (e.key === "ArrowRight") {
                              updateRow(row.rowId, {
                                importance: Math.min(3, row.importance + 1) as Importance,
                              });
                              e.preventDefault();
                            }
                          }}
                          className={[
                            "px-3 min-h-[44px] text-xs font-medium transition",
                            "border-r last:border-r-0 border-[var(--border)]",
                            active
                              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                              : "bg-transparent text-[var(--muted)] hover:text-[var(--foreground)]",
                          ].join(" ")}
                        >
                          {labelMap[level]}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-xs text-[var(--muted)] ml-auto tabular-nums">
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-dashed border-[var(--border)] px-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition min-h-[44px]"
          >
            + Add target
          </button>

          <p className="text-xs text-[var(--muted)]">
            Tip: you can also just tell your coach what success looks like — it can set these for you.
          </p>
        </div>
      )}
    </div>
  );
}
