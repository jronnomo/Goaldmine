// src/lib/calendar-core.test.ts
// Pure-function unit tests for calendar-core.ts's USER_TZ date primitives.
// #231: bucketDatesToWeekOffsets — bucketing row dates into week offsets
// against a `mondays[]` window (same equality pattern recap/page.tsx already
// hand-rolls for `postedWeeks`). No mocks — pure Date in, number[] out.

import { describe, expect, it } from "vitest";
import {
  bucketDatesToWeekOffsets,
  startOfWeekMonday,
  endOfWeekSunday,
  addDays,
  userTzWallClockToUTC,
  dateKeyAtCurrentTime,
  dateKey,
  toDatetimeLocalValue,
  parseDatetimeLocalValue,
} from "@/lib/calendar-core";

describe("bucketDatesToWeekOffsets", () => {
  // Fixed reference instant (DST-neutral month) so the test is deterministic
  // regardless of when it runs. mondays[i] mirrors recap/page.tsx's
  // construction: mondays[0] = current week's Monday, offset -i per index.
  const now = userTzWallClockToUTC(2026, 3, 11, 12, 0, 0); // Wed, 2026-03-11 noon USER_TZ
  const thisMonday = startOfWeekMonday(now);
  const mondays = Array.from({ length: 13 }, (_, i) => addDays(thisMonday, -i * 7));

  it("buckets a row at Monday 00:00 of the current week to offset 0", () => {
    expect(bucketDatesToWeekOffsets([mondays[0]!], mondays)).toEqual([0]);
  });

  it("buckets a Sunday 23:59:59.999 USER_TZ row to its own week's Monday, not the following week", () => {
    const sundayEnd = endOfWeekSunday(mondays[0]!); // last instant of the current week
    expect(bucketDatesToWeekOffsets([sundayEnd], mondays)).toEqual([0]);
  });

  it("buckets a mid-week row to the matching negative offset", () => {
    const wednesdayThreeWeeksBack = addDays(mondays[3]!, 2);
    expect(bucketDatesToWeekOffsets([wednesdayThreeWeeksBack], mondays)).toEqual([-3]);
  });

  it("drops rows outside the mondays window", () => {
    const oneWeekBeforeOldest = addDays(mondays[12]!, -7);
    expect(bucketDatesToWeekOffsets([oneWeekBeforeOldest], mondays)).toEqual([]);
  });

  it("dedupes multiple rows landing in the same week", () => {
    const a = mondays[2]!;
    const b = addDays(mondays[2]!, 4);
    expect(bucketDatesToWeekOffsets([a, b], mondays)).toEqual([-2]);
  });

  it("returns [] for an empty dates array", () => {
    expect(bucketDatesToWeekOffsets([], mondays)).toEqual([]);
  });

  it("buckets rows across multiple distinct weeks (set equality; order not asserted)", () => {
    const rows = [mondays[0]!, mondays[5]!, addDays(mondays[5]!, 1)];
    const result = bucketDatesToWeekOffsets(rows, mondays);
    expect(new Set(result)).toEqual(new Set([0, -5]));
  });

  it("oldest-boundary Monday (mondays[12]) buckets to offset -12", () => {
    expect(bucketDatesToWeekOffsets([mondays[12]!], mondays)).toEqual([-12]);
  });
});

// #294: MealComposer's `defaultDate` seeding — the day-detail page pre-fills a
// past/future date with "this time of day" rather than midnight, so backfilled
// meals read naturally (e.g. "Aug 5, 7:42 PM") instead of all landing at 00:00.
describe("dateKeyAtCurrentTime", () => {
  it("combines a target dateKey with now's USER_TZ wall-clock time-of-day", () => {
    const now = userTzWallClockToUTC(2026, 8, 9, 19, 42, 0); // 7:42 PM USER_TZ
    const result = dateKeyAtCurrentTime("2026-08-05", now);
    expect(toDatetimeLocalValue(result)).toBe("2026-08-05T19:42");
  });

  it("round-trips through dateKey() back to the requested day", () => {
    const now = userTzWallClockToUTC(2026, 8, 9, 23, 59, 0);
    const result = dateKeyAtCurrentTime("2026-12-31", now);
    expect(dateKey(result)).toBe("2026-12-31");
  });

  it("supports a future dateKey (pre-planning) the same as a past one (backfill)", () => {
    const now = userTzWallClockToUTC(2026, 8, 9, 8, 5, 0);
    const past = dateKeyAtCurrentTime("2026-01-01", now);
    const future = dateKeyAtCurrentTime("2027-01-01", now);
    expect(dateKey(past)).toBe("2026-01-01");
    expect(dateKey(future)).toBe("2027-01-01");
    // Time-of-day is preserved on both sides of "now".
    expect(toDatetimeLocalValue(past).endsWith("T08:05")).toBe(true);
    expect(toDatetimeLocalValue(future).endsWith("T08:05")).toBe(true);
  });

  it("is stable across a DST boundary (America/Denver spring-forward, 2026-03-08)", () => {
    const now = userTzWallClockToUTC(2026, 3, 15, 6, 30, 0); // week after the jump
    const result = dateKeyAtCurrentTime("2026-03-01", now); // week before the jump
    expect(toDatetimeLocalValue(result)).toBe("2026-03-01T06:30");
  });
});

// The inverse of toDatetimeLocalValue — parses the exact string shape an
// <input type="datetime-local"> submits (what logNutrition/updateNutrition
// receive as `form.get("date")`). UXR-meal-edit-11: `new Date(s)` on this
// shape parses as server-local/UTC, not USER_TZ, and silently shifts the meal.
describe("parseDatetimeLocalValue", () => {
  it("parses a datetime-local string as a USER_TZ wall clock, round-tripping through toDatetimeLocalValue", () => {
    const result = parseDatetimeLocalValue("2026-08-05T19:42");
    expect(toDatetimeLocalValue(result)).toBe("2026-08-05T19:42");
  });

  it("is the exact inverse of toDatetimeLocalValue for an arbitrary instant", () => {
    const original = userTzWallClockToUTC(2026, 11, 3, 6, 15, 0);
    const roundTripped = parseDatetimeLocalValue(toDatetimeLocalValue(original));
    expect(roundTripped.getTime()).toBe(original.getTime());
  });

  it("falls back to a permissive Date parse for a shape without a YYYY-MM-DDTHH:MM prefix", () => {
    const weird = "August 5, 2026 19:42:00";
    expect(parseDatetimeLocalValue(weird).getTime()).toBe(new Date(weird).getTime());
  });
});

// #294 end-to-end (pure-logic) proof: the day-detail page seeds MealComposer's
// `defaultDate`, the hidden <input name="date"> submits toDatetimeLocalValue of
// that seed, and logNutrition/updateNutrition parse it back via
// parseDatetimeLocalValue before writing NutritionLog.date. This chains all
// three so a regression in any link (wrong TZ, wrong day, wrong rounding)
// shows up as the wrong dateKey landing on "the created NutritionLog" — the
// property the day-detail-page log entry point exists to guarantee.
describe("defaultDate seeding round-trip (MealComposer → logNutrition)", () => {
  it("a backfilled past day lands on that exact day, not the day the form was submitted", () => {
    const submittedAt = userTzWallClockToUTC(2026, 8, 9, 21, 15, 0); // "now" at submit time
    const targetDateKey = "2026-08-05"; // day-detail page being viewed/backfilled
    const seeded = dateKeyAtCurrentTime(targetDateKey, submittedAt);
    const formFieldValue = toDatetimeLocalValue(seeded); // what the visible input holds
    const persistedDate = parseDatetimeLocalValue(formFieldValue); // what logNutrition parses
    expect(dateKey(persistedDate)).toBe(targetDateKey);
  });

  it("a pre-planned future day lands on that exact day", () => {
    const submittedAt = userTzWallClockToUTC(2026, 8, 9, 7, 0, 0);
    const targetDateKey = "2026-09-20";
    const seeded = dateKeyAtCurrentTime(targetDateKey, submittedAt);
    const persistedDate = parseDatetimeLocalValue(toDatetimeLocalValue(seeded));
    expect(dateKey(persistedDate)).toBe(targetDateKey);
  });

  it("with no defaultDate (global Log sheet, unchanged behavior), 'now' lands on today's dateKey", () => {
    const now = userTzWallClockToUTC(2026, 8, 9, 12, 0, 0);
    // No defaultDate ⇒ MealComposer seeds `new Date()` directly (not this
    // helper) — assert the pre-existing contract still holds: whatever "now"
    // is submitted as, it parses back to today's dateKey.
    const persistedDate = parseDatetimeLocalValue(toDatetimeLocalValue(now));
    expect(dateKey(persistedDate)).toBe(dateKey(now));
  });
});
