// --- Date utilities (USER_TZ-aware) ---
//
// Pure date primitives extracted from calendar.ts so Client Components can import
// them without pulling the server-only modules (prisma, program, records, …) into
// the client bundle. This file MUST stay pure: no `@/lib/db`/prisma imports, no
// `"use server"`, no DB or IO. Only Intl + USER_TZ wall-clock math.
//
// The Vercel runtime is UTC, but the user's day rolls over at their local
// midnight. All date-bucketing logic — "today", week ranges, dateKey strings,
// the strict-equality lookup for PlanDayOverride.date — must be computed in
// the user's TZ, not the server's. Override via USER_TZ env (defaults to
// America/Denver for this single-user app).

export const USER_TZ = process.env.USER_TZ ?? "America/Denver";

const userPartsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: USER_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const userWeekdayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: USER_TZ,
  weekday: "short",
});

function userParts(d: Date) {
  const map: Record<string, string> = {};
  for (const p of userPartsFmt.formatToParts(d)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Some runtimes return "24" for midnight; fold to 0.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

// Convert a user-TZ wall-clock (year, month1=1..12, day, hms) to the UTC
// instant that represents that wall clock. Handles DST by computing the
// effective offset for our naive UTC guess, then correcting once.
// Exported for day-log-actions.ts (REQ-65-2 / UXR-65-29): server actions
// compose dateKey + HH:MM into a DST-safe startedAt Date.
export function userTzWallClockToUTC(
  year: number,
  month1: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = new Date(Date.UTC(year, month1 - 1, day, hour, minute, second, ms));
  const np = userParts(naive);
  const naiveAsWall = Date.UTC(
    np.year,
    np.month - 1,
    np.day,
    np.hour,
    np.minute,
    np.second,
  );
  const desiredAsWall = Date.UTC(year, month1 - 1, day, hour, minute, second);
  return new Date(naive.getTime() + (desiredAsWall - naiveAsWall));
}

// Calendar weekday in USER_TZ. 1=Monday … 7=Sunday.
export function userWeekdayMon1(d: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const wd = userWeekdayFmt.format(d);
  const map: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[wd] ?? 1;
}

export function dateKey(d: Date): string {
  const { year, month, day } = userParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return userTzWallClockToUTC(y!, m!, d!);
}

export function startOfDay(d: Date): Date {
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day);
}

export function endOfDay(d: Date): Date {
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day, 23, 59, 59, 999);
}

export function startOfWeekMonday(d: Date): Date {
  const { year, month, day } = userParts(d);
  const wd = userWeekdayMon1(d);
  // Date.UTC normalizes negative days into the previous month.
  const monday = new Date(Date.UTC(year, month - 1, day - (wd - 1)));
  return userTzWallClockToUTC(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

export function endOfWeekSunday(d: Date): Date {
  const { year, month, day } = userParts(d);
  const wd = userWeekdayMon1(d);
  const sunday = new Date(Date.UTC(year, month - 1, day - (wd - 1) + 6));
  return userTzWallClockToUTC(
    sunday.getUTCFullYear(),
    sunday.getUTCMonth() + 1,
    sunday.getUTCDate(),
    23,
    59,
    59,
    999,
  );
}

export function addDays(d: Date, days: number): Date {
  const { year, month, day } = userParts(d);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return userTzWallClockToUTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

// Shift a Date by a wall-clock delta in USER_TZ, preserving the local clock.
// Unlike raw millisecond arithmetic, this reads the user-TZ wall-clock parts of
// `d`, applies the deltas to those parts, and converts back through
// userTzWallClockToUTC — so { days: -1 } keeps the same local time across a DST
// boundary, and { hours: -2 } subtracts exactly two wall-clock hours. Date.UTC
// normalizes out-of-range parts (e.g. negative minutes roll into the prior hour).
export function shiftWallClock(
  d: Date,
  delta: { days?: number; hours?: number; minutes?: number },
): Date {
  const { year, month, day, hour, minute, second } = userParts(d);
  const shifted = new Date(
    Date.UTC(
      year,
      month - 1,
      day + (delta.days ?? 0),
      hour + (delta.hours ?? 0),
      minute + (delta.minutes ?? 0),
      second,
    ),
  );
  return userTzWallClockToUTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
  );
}

// Format a Date as a USER_TZ wall-clock "YYYY-MM-DDTHH:MM" string for an
// <input type="datetime-local"> value. Uses USER_TZ parts, never raw getters.
export function toDatetimeLocalValue(d: Date): string {
  const { year, month, day, hour, minute } = userParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

// ─── weekRangeLabel ───────────────────────────────────────────────────────────

/**
 * Pure label, no DB. USER_TZ-aware via the exported USER_TZ constant + Intl.
 * e.g. "Jun 9 – Jun 15"
 *
 * weekOffset: 0 = current week, -1 = last week, etc.
 * Uses startOfWeekMonday / endOfWeekSunday / addDays — no raw Date primitives.
 *
 * Moved here from recap.ts (REV-3/DC-1) so recap-actions.ts can import it from
 * @/lib/calendar without pulling the full recap engine (prisma, records, game)
 * into the server-action module graph. Re-exported from recap.ts for backward compat.
 */
export function weekRangeLabel(asOf: Date, weekOffset: number): string {
  const thisMonday = startOfWeekMonday(asOf);
  const monday = addDays(thisMonday, weekOffset * 7);
  const sunday = endOfWeekSunday(monday);

  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: USER_TZ,
  });

  return `${fmt.format(monday)} – ${fmt.format(sunday)}`;
}

// ─── bucketDatesToWeekOffsets ─────────────────────────────────────────────────

/**
 * Pure helper (#231): bucket a list of row dates into week offsets against a
 * list of week-start Mondays, via dateKey(startOfWeekMonday(d)) equality —
 * the same pattern recap/page.tsx already hand-rolls for `postedWeeks`.
 *
 * `mondays` must be ordered so `mondays[i]` corresponds to offset `-i`
 * (mondays[0] = current week's Monday, matching recap/page.tsx's construction
 * via `addDays(startOfWeekMonday(now), -i * 7)`). A date whose USER_TZ week
 * doesn't match any entry in `mondays` (outside the window) is dropped.
 * Deduped via Set; result order is not guaranteed — sort at the call site if
 * a stable order matters.
 */
export function bucketDatesToWeekOffsets(dates: Date[], mondays: Date[]): number[] {
  const offsets = new Set<number>();
  for (const d of dates) {
    const dk = dateKey(startOfWeekMonday(d));
    const matchIdx = mondays.findIndex((m) => dateKey(m) === dk);
    if (matchIdx !== -1) {
      offsets.add(-matchIdx);
    }
  }
  return [...offsets];
}
