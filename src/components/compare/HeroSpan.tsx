// src/components/compare/HeroSpan.tsx
//
// /compare hero — "The Span, earned and disciplined" (UX amendment §5 +
// pixel mockup docs/ux-research/glance-back-forge-ahead.html §1 hero band).
// Server-safe (no "use client").
//
// DM-Serif date span (text-4xl max, per UXR-01 wrap guidance at 390px),
// "N days of showing up." subtitle, muted normalization notes, and a
// paired-Bullseye readiness row for the focus goal: A side muted/receded,
// B side foreground/full weight — the then→now hierarchy is done with
// weight, not color, and the Bullseye motif becomes the delta (more rings
// filled on the right). Null-safe: no focus goal / no readiness → date span
// only, no Bullseye row; null A-side readiness → "—" in the muted A slot,
// no A ring (blueprint v3 Fix 1).

import { Bullseye } from "@/components/Bullseye";
import { parseDateKey, USER_TZ } from "@/lib/calendar-core";

/**
 * yyyy-mm-dd → "Mar 1". v3 Fix 4: MUST pin timeZone to USER_TZ — bare
 * toLocaleDateString on a Vercel-UTC runtime shifts the day. Idiom precedent:
 * src/app/goals/[id]/page.tsx (targetDateLabel).
 */
export function formatHeroDate(key: string): string {
  return parseDateKey(key).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: USER_TZ,
  });
}

/** v3 Fix 1: readiness scores are 0–100; Bullseye's progress prop is 0–1. */
function readinessProgress(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}

export function HeroSpan({
  dateA,
  dateB,
  spanDays,
  readinessA,
  readinessB,
  focusObjective,
  swapped,
  sameDay,
  clampedToToday,
}: {
  dateA: string;
  dateB: string;
  spanDays: number;
  readinessA: number | null;
  readinessB: number | null;
  focusObjective: string | null;
  swapped: boolean;
  sameDay: boolean;
  clampedToToday: boolean;
}) {
  const showReadiness = focusObjective !== null && readinessB !== null;

  return (
    <header className="px-1 pt-4 pb-2">
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-tight">
        {formatHeroDate(dateA)} → {formatHeroDate(dateB)}{" "}
        <span className="text-[var(--muted)]">· {spanDays} days</span>
      </h1>
      <p className="mt-1 text-xs text-[var(--muted)]">Values as of end of each day.</p>
      <p className="mt-2 text-[15px] text-[var(--muted)]">{spanDays} days of showing up.</p>
      {swapped && <p className="mt-1 text-xs text-[var(--muted)]">Dates reordered.</p>}
      {sameDay && <p className="mt-1 text-xs text-[var(--muted)]">Same day selected.</p>}
      {clampedToToday && (
        <p className="mt-1 text-xs text-[var(--muted)]">Future date clamped to today.</p>
      )}

      {showReadiness && (
        <div className="mt-5">
          <p className="mb-1.5 text-xs tracking-wide text-[var(--muted)]">
            {focusObjective} readiness
          </p>
          <div
            className="flex items-center gap-3"
            aria-label={`${focusObjective} readiness, ${readinessA ?? "no data"} to ${readinessB}`}
          >
            <span className="flex items-center gap-2 text-[var(--muted)] opacity-50">
              {readinessA !== null && (
                <Bullseye size={28} progress={readinessProgress(readinessA)} aria-hidden />
              )}
              <span className="font-mono text-4xl leading-none tabular-nums">
                {readinessA ?? "—"}
              </span>
            </span>
            <span aria-hidden className="text-xl text-[var(--muted)]">
              →
            </span>
            <span className="flex items-center gap-2 text-[var(--foreground)]">
              <Bullseye size={28} progress={readinessProgress(readinessB)} aria-hidden />
              <span className="font-mono text-4xl font-semibold leading-none tabular-nums">
                {readinessB}
              </span>
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
