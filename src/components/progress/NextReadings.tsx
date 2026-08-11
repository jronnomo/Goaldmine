// src/components/progress/NextReadings.tsx
//
// Manifest key 7 (graft: A's NEXT READINGS strip) — turns a dead day-1
// baseline card into a live one for ⚠[64–80px] using ScheduledCheckpoint data
// nothing read before. Tier-2 strip: eyebrow + compact due list + the R11
// tabular numeral (pending count). Self-nulls on empty (stadium node).
//
// Dates through USER_TZ (A9-class fix); "today" compares dateKeys, never raw
// Date day math.
//
// Server component.

import Link from "next/link";
import { dateKey, USER_TZ } from "@/lib/calendar-core";

export type NextReading = {
  testName: string;
  targetDate: Date;
  status: "upcoming" | "due" | "overdue";
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

export function NextReadings({
  readings,
  now,
  max = 3,
}: {
  readings: NextReading[];
  now: Date;
  max?: number;
}) {
  if (readings.length === 0) return null;
  const todayKey = dateKey(now);
  const shown = readings.slice(0, max);
  return (
    <Link
      href="/baselines"
      id="next-readings"
      data-testid="next-readings"
      className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm scroll-mt-16 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Next readings
        </span>
        <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
          {readings.length}
        </span>
      </div>
      <p className="mt-1 text-sm truncate">
        {shown.map((r, i) => (
          <span key={r.testName}>
            {i > 0 && <span className="text-[var(--muted)]"> · </span>}
            <span className="font-medium">{r.testName}</span>{" "}
            <span className={r.status === "overdue" ? "text-[var(--warning)]" : "text-[var(--muted)]"}>
              {dateKey(r.targetDate) === todayKey ? "today" : dateFmt.format(r.targetDate)}
            </span>
          </span>
        ))}
      </p>
    </Link>
  );
}
