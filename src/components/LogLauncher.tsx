"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogMeasurementForm } from "@/components/LogMeasurementForm";
import { LogBodyMetricForm } from "@/components/LogBodyMetricForm";
import { LogNutritionForm } from "@/components/LogNutritionForm";
import { LogNoteForm } from "@/components/LogNoteForm";
import { MealEditButton } from "@/components/MealEditButton";
import type { TodayMealLite, LogSheetData } from "@/lib/log-sheet-data";
import { formatDayMacros, hasAnyMacros } from "@/lib/nutrition-macros";

const MEAL_LABELS: Record<string, string> = {
  preworkout: "Preworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  postworkout: "Postworkout",
  dinner: "Dinner",
};

function mealSummary(items: TodayMealLite["items"]): string {
  return items
    .map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name))
    .join(", ");
}

export type LogLauncherProps = {
  /** Latest recorded weight in lb, or null. Passed to LogMeasurementForm as defaultValue.
   *  Defaults to null (weight input starts empty — by design; BottomNav cannot query Prisma). */
  latestWeight?: number | null;
  onClose: () => void;
  /** Whether the host BottomSheet is currently open. Drives the self-fetch:
   *  every closed→open transition re-fetches /api/log-sheet-data so the sheet
   *  never renders stale layout-threaded data mid-session. Undefined ⇒ treated
   *  as closed (safe default for a prop-less, post-#233 mount). */
  open?: boolean;
};

type ExpandedRow = "weight" | "metric" | "meal" | "note" | null;

type RowConfig = {
  key: ExpandedRow & string;
  label: string;
  sub: string;
  icon: React.ReactNode;
};

// ── Log-sheet self-fetch state machine ────────────────────────────────────────
// Four named phases, each carrying `data` so a background refetch failure never
// blinks away a good render. See PRD-232 / architecture-blueprint.md §4.
type LogSheetState =
  | { phase: "idle"; data: null }
  | { phase: "loading"; data: LogSheetData | null } // data present ⇒ background refresh, no skeleton
  | { phase: "ready"; data: LogSheetData }
  | { phase: "error"; data: LogSheetData | null; message: string; code?: number };

const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const rows: RowConfig[] = [
  {
    key: "weight",
    label: "Weight",
    sub: "Log today's weigh-in",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 17a5 5 0 0 1 10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "metric",
    label: "Body metric",
    sub: "RHR, sleep, SpO₂, VO₂ max, HRV…",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M2 10c1-3 2.5-5 4-5s2.5 2 4 5 2.5 5 4 5 3-2 4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "meal",
    label: "Meal",
    sub: "Log what you ate",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 3v6a4 4 0 0 0 8 0V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 13v4M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "note",
    label: "Note",
    sub: "Journal, audible, or feedback",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const ImportIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 3v10M7 10l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Fixed-height placeholder matching the meal list + macro line — no layout shift. */
function LogSheetSkeleton() {
  return (
    <div className="mb-4 animate-pulse" aria-hidden>
      <div className="h-3 w-32 rounded bg-[var(--border)] mb-3" />
      <div className="space-y-2">
        <div className="h-4 rounded bg-[var(--border)]" />
        <div className="h-4 rounded bg-[var(--border)]" />
      </div>
      <div className="h-3 w-40 rounded bg-[var(--border)] mt-4" />
    </div>
  );
}

export function LogLauncher({
  latestWeight = null,
  onClose,
  open,
}: LogLauncherProps) {
  const [expanded, setExpanded] = useState<ExpandedRow>(null);

  const [state, setState] = useState<LogSheetState>({ phase: "idle", data: null });

  const prevOpenRef = useRef(false);
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  async function fetchData() {
    const id = ++reqIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ phase: "loading", data: prev.data })); // never clears existing data
    try {
      const res = await fetch("/api/log-sheet-data", { signal: controller.signal });
      if (id !== reqIdRef.current) return; // superseded by a newer open
      if (res.status === 401) {
        setState({
          phase: "error",
          data: null,
          message: "Your session expired.",
          code: 401,
        });
        return;
      }
      if (!res.ok) throw new Error(`log-sheet-data ${res.status}`);
      const data: LogSheetData = await res.json();
      if (id === reqIdRef.current) setState({ phase: "ready", data });
    } catch {
      if (controller.signal.aborted) return; // superseded/aborted, not user-facing
      if (id === reqIdRef.current) {
        setState((prev) => ({
          phase: "error",
          data: prev.data,
          message: "Couldn't load — try again.",
        }));
      }
    }
  }

  // Fires on every closed→open transition (AC-2), including when initial prop
  // data already exists — the response silently replaces identical data.
  useEffect(() => {
    if (open && !prevOpenRef.current) void fetchData();
    prevOpenRef.current = !!open;
  }, [open]);

  const toggle = (key: ExpandedRow & string) => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  const data = state.data;
  const showSkeleton = data === null && state.phase === "loading";
  const mealSoFar = data?.trackedSoFar ?? null;
  const showMealSoFar = mealSoFar !== null && hasAnyMacros(mealSoFar);

  return (
    <div className="py-2">
      {rows.map(({ key, label, sub, icon }) => {
        const isOpen = expanded === key;
        return (
          <div key={key}>
            {/* Row button — ≥48px tap target */}
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
            >
              <span className="text-[var(--accent)] shrink-0">{icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
                <span className="block text-xs text-[var(--muted)]">{sub}</span>
              </span>
              <span className="text-[var(--muted)] shrink-0">
                {isOpen ? <ChevronUp /> : <ChevronDown />}
              </span>
            </button>

            {/* Inline expanded form */}
            {isOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]">
                {key === "weight" && <LogMeasurementForm latestWeight={latestWeight} />}
                {key === "metric" && <LogBodyMetricForm />}
                {key === "meal" && (
                  <>
                    {state.phase === "error" && (
                      <div className="mb-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)] flex items-center justify-between gap-2">
                        <span>{state.message}</span>
                        {state.code === 401 ? (
                          <Link href="/signin" className="font-medium underline shrink-0">
                            Sign in
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void fetchData()}
                            className="font-medium underline shrink-0"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                    {showSkeleton ? (
                      <LogSheetSkeleton />
                    ) : (
                      <>
                        {showMealSoFar && mealSoFar && (
                          <p className="text-xs text-[var(--muted)] mb-3 tabular-nums">
                            Today so far · <span className="font-mono">{formatDayMacros(mealSoFar)}</span>
                          </p>
                        )}
                        {data && data.todaysMeals.length > 0 && (
                          <div className="mb-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-2">
                              Logged today
                            </p>
                            <ul className="space-y-2">
                              {data.todaysMeals.map((meal) => {
                                const label = MEAL_LABELS[meal.mealType] ?? meal.mealType;
                                const summary = mealSummary(meal.items);
                                return (
                                  <li key={meal.id} className="flex items-baseline justify-between gap-2 border-l-2 border-[var(--border)] pl-3">
                                    <span className="flex-1 min-w-0 text-sm">
                                      <span className="text-xs uppercase tracking-wide text-[var(--muted)] mr-1">
                                        {label}
                                      </span>
                                      {summary && (
                                        <span className="text-[var(--foreground)]">· {summary}</span>
                                      )}
                                    </span>
                                    <MealEditButton
                                      meal={meal}
                                      quickPickFoods={data.quickPickFoods}
                                      onMutated={fetchData}
                                    />
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="border-t border-[var(--border)] mt-4 pt-4" />
                          </div>
                        )}
                        <LogNutritionForm
                          quickPickFoods={data?.quickPickFoods}
                          libraryFoods={data?.libraryFoods}
                          trackedSoFar={data?.trackedSoFar}
                          dayTarget={data?.dayTarget}
                          onLogged={fetchData}
                        />
                      </>
                    )}
                  </>
                )}
                {key === "note" && <LogNoteForm />}
              </div>
            )}
          </div>
        );
      })}

      {/* Import row — Link, not a button */}
      <Link
        href="/import"
        onClick={onClose}
        className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
      >
        <span className="text-[var(--accent)] shrink-0">
          <ImportIcon />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--foreground)]">Import</span>
          <span className="block text-xs text-[var(--muted)]">Paste a Strong-app export</span>
        </span>
      </Link>
    </div>
  );
}
