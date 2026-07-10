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
