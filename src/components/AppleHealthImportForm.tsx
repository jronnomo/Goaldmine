"use client";

// Apple Health import flow (G2 / REQ-005): file → Web Worker (unzip + stream
// + aggregate, all on-device) → preview → batched importHealthDaysBatch calls
// → summary. The raw export NEVER crosses the network — only daily totals do.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  importHealthDaysBatch,
  type BodyMetricRow,
  type HealthDayRow,
} from "@/lib/health-import-actions";
import type { ImportSummary, WorkerOutMsg } from "@/lib/parsers/apple-health";

type Phase = "idle" | "parsing" | "preview" | "uploading" | "done" | "error";

const MAX_DAYS_PER_BATCH = 500;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-01" → "Sep 1 2026" — pure string math, no Date construction. */
function formatDateKey(key: string): string {
  const m = Number(key.slice(5, 7));
  return `${MONTHS[m - 1] ?? "?"} ${Number(key.slice(8, 10))} ${key.slice(0, 4)}`;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Sorted unique dateKeys across both row sets, chunked into ≤500-day groups (§4c). */
function batchByDate(
  dayRows: HealthDayRow[],
  metricRows: BodyMetricRow[],
): Array<{ rows: HealthDayRow[]; metrics: BodyMetricRow[] }> {
  const allKeys = [...new Set([...dayRows.map((r) => r.dateKey), ...metricRows.map((r) => r.dateKey)])].sort();
  const batches: Array<{ rows: HealthDayRow[]; metrics: BodyMetricRow[] }> = [];
  for (let i = 0; i < allKeys.length; i += MAX_DAYS_PER_BATCH) {
    const group = new Set(allKeys.slice(i, i + MAX_DAYS_PER_BATCH));
    batches.push({
      rows: dayRows.filter((r) => group.has(r.dateKey)),
      metrics: metricRows.filter((r) => group.has(r.dateKey)),
    });
  }
  return batches;
}

/** Day counts per type for the preview (the mock's "energy 1,096 · steps 1,090" line). */
function dayCounts(summary: ImportSummary): Array<[string, number]> {
  const counts: Array<[string, number]> = [];
  const dayField = (label: string, get: (r: HealthDayRow) => number | null) => {
    const n = summary.dayRows.filter((r) => get(r) !== null).length;
    if (n > 0) counts.push([label, n]);
  };
  dayField("energy", (r) => r.activeKcal ?? r.basalKcal);
  dayField("steps", (r) => r.steps);
  dayField("exercise", (r) => r.exerciseMin);
  dayField("stand", (r) => r.standHours);
  for (const key of ["rhr", "vo2max", "spo2", "sleep_hours", "hrv"]) {
    const n = summary.metricRows.filter((r) => r.key === key).length;
    if (n > 0) counts.push([key === "sleep_hours" ? "sleep" : key, n]);
  }
  return counts;
}

const BTN_PRIMARY =
  "inline-flex items-center justify-center min-h-[44px] rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2";
const BTN_SECONDARY =
  "inline-flex items-center justify-center min-h-[44px] rounded-lg border border-[var(--border)] px-4 py-2.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2";

export function AppleHealthImportForm() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [recordsSeen, setRecordsSeen] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [written, setWritten] = useState({ days: 0, metrics: 0 });
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  function reset() {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setPhase("idle");
    setFileName(null);
    setPct(0);
    setRecordsSeen(0);
    setSummary(null);
    setError(null);
  }

  function onFileChosen(file: File | undefined) {
    if (!file) return;
    workerRef.current?.terminate();
    setFileName(file.name);
    setPct(0);
    setRecordsSeen(0);
    setError(null);
    setPhase("parsing");
    const worker = new Worker(new URL("../lib/parsers/apple-health.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setPct(msg.pct);
        setRecordsSeen(msg.recordsSeen);
      } else if (msg.type === "done") {
        setSummary(msg.summary);
        setPhase("preview");
        worker.terminate();
        workerRef.current = null;
      } else {
        setError(msg.message);
        setPhase("error");
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = (e) => {
      setError(e.message || "The file could not be read.");
      setPhase("error");
      worker.terminate();
      workerRef.current = null;
    };
    worker.postMessage({ type: "parse", file });
  }

  async function upload() {
    if (!summary) return;
    const batches = batchByDate(summary.dayRows, summary.metricRows);
    setBatchTotal(batches.length);
    setBatchIndex(0);
    setPhase("uploading");
    let days = 0;
    let metrics = 0;
    for (let i = 0; i < batches.length; i++) {
      setBatchIndex(i + 1);
      const res = await importHealthDaysBatch(batches[i]!);
      if (!res.ok) {
        setError(
          `Batch ${i + 1} of ${batches.length} failed: ${res.error} Already-written batches are valid — importing again is safe.`,
        );
        setPhase("error");
        return;
      }
      days += res.dayRowsWritten;
      metrics += res.metricRowsWritten;
    }
    setWritten({ days, metrics });
    setPhase("done");
  }

  const hasAnything =
    summary !== null && (summary.dayRows.length > 0 || summary.metricRows.length > 0);

  const phaseAnnouncement =
    phase === "parsing"
      ? "Reading your export on this device."
      : phase === "preview"
        ? "Ready to import."
        : phase === "uploading"
          ? "Uploading daily totals."
          : phase === "done"
            ? "Import complete."
            : "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">
        Energy, steps, exercise minutes, resting HR, VO₂ max, SpO₂, HRV and sleep — one row per
        day.
      </p>
      <p className="text-sm">
        Your export is read on this device. Only daily totals are uploaded.
      </p>

      {/* Live region: phase changes only, never per-percent ticks. */}
      <p aria-live="polite" className="sr-only">
        {phaseAnnouncement}
      </p>

      {phase === "error" && summary && (
        <button type="button" onClick={upload} className={BTN_PRIMARY}>
          Retry import
        </button>
      )}

      {(phase === "idle" || phase === "error") && (
        <>
          <input
            ref={inputRef}
            id="apple-health-file"
            type="file"
            accept=".zip,.xml"
            className="peer sr-only"
            onChange={(e) => onFileChosen(e.target.files?.[0])}
          />
          <label
            htmlFor="apple-health-file"
            className={`${BTN_PRIMARY} cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2`}
          >
            Choose export.zip
          </label>
          <details className="text-sm text-[var(--muted)]">
            <summary className="cursor-pointer min-h-[44px] flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg">
              How do I get my export?
            </summary>
            <p className="mt-1">
              On your iPhone: Health app ▸ tap your photo ▸ Export All Health Data. AirDrop or
              save the resulting export.zip, then choose it here.
            </p>
          </details>
        </>
      )}

      {phase === "parsing" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ellipsis overflow-hidden whitespace-nowrap">
            Reading {fileName}…
          </p>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Parsing progress"
            className="h-2 w-full rounded-full bg-[var(--border)] overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            {pct}% · {fmt(recordsSeen)} records scanned. Keep this tab open.
          </p>
          <button type="button" onClick={reset} className={BTN_SECONDARY}>
            Cancel
          </button>
        </div>
      )}

      {phase === "preview" && summary && (
        <div className="flex flex-col gap-2">
          {hasAnything ? (
            <>
              <p className="text-base font-semibold">Ready to import</p>
              <p className="text-sm">
                {fmt(summary.dayRows.length)} days
                {summary.firstDateKey && summary.lastDateKey && (
                  <>
                    {" · "}
                    {formatDateKey(summary.firstDateKey)} → {formatDateKey(summary.lastDateKey)}
                  </>
                )}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {dayCounts(summary)
                  .map(([label, n]) => `${label} ${fmt(n)}`)
                  .join(" · ")}
              </p>
              {summary.recordsSkipped > 0 && (
                <p className="text-sm text-[var(--muted)]">
                  {fmt(summary.recordsSkipped)} of {fmt(summary.recordsSeen)} records skipped
                  (unrecognized, malformed or out of range).
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={upload} className={`${BTN_PRIMARY} flex-1`}>
                  Import
                </button>
                <button type="button" onClick={reset} className={`${BTN_SECONDARY} flex-1`}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">
                No supported records found — is this the right file? Pick the export.zip (or
                export.xml) that the Health app produces.
              </p>
              <button type="button" onClick={reset} className={BTN_SECONDARY}>
                Choose a different file
              </button>
            </>
          )}
        </div>
      )}

      {phase === "uploading" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Uploading batch {batchIndex} of {batchTotal}…
          </p>
          <div
            role="progressbar"
            aria-valuenow={batchIndex}
            aria-valuemin={0}
            aria-valuemax={batchTotal}
            aria-label="Upload progress"
            className="h-2 w-full rounded-full bg-[var(--border)] overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width]"
              style={{ width: batchTotal > 0 ? `${(batchIndex / batchTotal) * 100}%` : "0%" }}
            />
          </div>
        </div>
      )}

      {phase === "done" && summary && (
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold">✓ Imported</p>
          <p className="text-sm">
            {fmt(written.days)} day rows · {fmt(written.metrics)} metric readings
            {summary.firstDateKey && summary.lastDateKey && (
              <>
                {" · "}
                {formatDateKey(summary.firstDateKey)} → {formatDateKey(summary.lastDateKey)}
              </>
            )}
          </p>
          {summary.recordsSkipped > 0 && (
            <p className="text-sm text-[var(--muted)]">
              {fmt(summary.recordsSkipped)} records skipped.
            </p>
          )}
          <div className="flex gap-2">
            <Link href="/trends" className={`${BTN_PRIMARY} flex-1`}>
              See trends →
            </Link>
            <button type="button" onClick={reset} className={`${BTN_SECONDARY} flex-1`}>
              Import another
            </button>
          </div>
        </div>
      )}

      {/* Errors: assertive, text, never color alone. */}
      <p aria-live="assertive" role="alert" className={error ? "text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2" : "sr-only"}>
        {error ?? ""}
      </p>
    </div>
  );
}
