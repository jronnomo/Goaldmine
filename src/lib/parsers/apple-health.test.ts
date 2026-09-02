// Tests for the pure Apple Health streaming aggregator (G2 / REQ-004).
// Fixture: examples/apple-health-sample.xml — hand-written, no real personal
// data, exercising every parser rule as its own assertion target.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createHealthAggregator,
  nextDateKey,
  wallClockMs,
  type ImportSummary,
} from "./apple-health";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  path.join(here, "..", "..", "..", "examples", "apple-health-sample.xml"),
  "utf8",
);

function parseChunked(text: string, chunkSize: number): ImportSummary {
  const agg = createHealthAggregator();
  for (let i = 0; i < text.length; i += chunkSize) {
    agg.pushChunk(text.slice(i, i + chunkSize));
  }
  return agg.finish();
}

function parseWhole(text: string): ImportSummary {
  const agg = createHealthAggregator();
  agg.pushChunk(text);
  return agg.finish();
}

describe("wallClockMs — pure wall-clock timestamp math", () => {
  it("applies the explicit UTC offset", () => {
    // 2026-04-01 00:00:00 UTC is epoch-day 20544 (via any independent source).
    expect(wallClockMs("2026-04-01 00:00:00 +0000")).toBe(20544 * 86_400_000);
    // -0600 local midnight is 06:00 UTC.
    expect(wallClockMs("2026-04-01 00:00:00 -0600")).toBe(
      20544 * 86_400_000 + 6 * 3_600_000,
    );
  });

  it("a DST night with differing offsets yields the real elapsed duration", () => {
    const start = wallClockMs("2026-03-08 01:30:00 -0800")!;
    const end = wallClockMs("2026-03-08 03:30:00 -0700")!;
    expect((end - start) / 3_600_000).toBe(1); // not the naive 2h
  });

  it("returns null for malformed strings — NaN never enters an accumulator", () => {
    expect(wallClockMs("2026-04-01T08:00:00Z")).toBeNull();
    expect(wallClockMs("garbage")).toBeNull();
    expect(wallClockMs("")).toBeNull();
    expect(wallClockMs("2026-4-1 08:00:00 -0600")).toBeNull();
  });
});

describe("nextDateKey — civil-date rollover", () => {
  it("Feb 28 → Feb 29 in a leap year; Feb 29 → Mar 1", () => {
    expect(nextDateKey("2024-02-28")).toBe("2024-02-29");
    expect(nextDateKey("2024-02-29")).toBe("2024-03-01");
  });
  it("Feb 28 → Mar 1 in a non-leap year", () => {
    expect(nextDateKey("2026-02-28")).toBe("2026-03-01");
  });
  it("Dec 31 → Jan 1 across the year boundary", () => {
    expect(nextDateKey("2025-12-31")).toBe("2026-01-01");
  });
  it("plain mid-month increment", () => {
    expect(nextDateKey("2026-04-01")).toBe("2026-04-02");
  });
});

describe("fixture parse — day aggregation rules", () => {
  const summary = parseWhole(fixture);

  it("multi-source steps: the largest single-source total wins, never the sum", () => {
    const day = summary.dayRows.find((r) => r.dateKey === "2026-04-01")!;
    expect(day.steps).toBe(9100); // Watch 4500+4600; NOT 16300 (Watch+Phone)
  });

  it("energy sums to 1dp; basal intact; exercise minutes and stand hours aggregate", () => {
    const day = summary.dayRows.find((r) => r.dateKey === "2026-04-01")!;
    expect(day.activeKcal).toBe(534.8); // 320.25 + 214.5
    expect(day.basalKcal).toBe(1650.4);
    expect(day.exerciseMin).toBe(35); // 22 + 13
    expect(day.standHours).toBe(3); // 3 Stood; the Idle hour does not count
  });

  it("out-of-range winner is bounds-dropped (C3): 25000 kcal wins its dedupe, then nulls the field", () => {
    const day = summary.dayRows.find((r) => r.dateKey === "2026-04-03")!;
    expect(day.activeKcal).toBeNull(); // dropped — no fallback to the honest source
    expect(day.basalKcal).toBe(1700); // the rest of the day survives
  });

  it("a single glitch value never aborts the parse — other days are intact", () => {
    expect(summary.dayRows.map((r) => r.dateKey)).toEqual(["2026-04-01", "2026-04-03"]);
  });
});

describe("fixture parse — body metric rules", () => {
  const summary = parseWhole(fixture);
  const metric = (dateKey: string, key: string) =>
    summary.metricRows.find((r) => r.dateKey === dateKey && r.key === key);

  it("resting HR is the day mean, integer", () => {
    expect(metric("2026-04-01", "rhr")).toEqual({
      dateKey: "2026-04-01",
      key: "rhr",
      value: 56,
      unit: "bpm",
    });
  });

  it("fractional SpO2 (0.97 with unit=%) normalizes to percent BEFORE averaging", () => {
    expect(metric("2026-04-01", "spo2")?.value).toBe(96); // mean(97, 95)
  });

  it("vo2max takes the latest record by startDate across all sources", () => {
    expect(metric("2026-04-01", "vo2max")?.value).toBe(41.2); // 10:00 beats 08:00
  });

  it("hrv (secondary REQ) is the day mean in ms", () => {
    expect(metric("2026-04-01", "hrv")).toEqual({
      dateKey: "2026-04-01",
      key: "hrv",
      value: 48,
      unit: "ms",
    });
  });
});

describe("fixture parse — the mandatory realistic night (C1 / patched G2 §3.1.7)", () => {
  const summary = parseWhole(fixture);
  const sleepRows = summary.metricRows.filter((r) => r.key === "sleep_hours");

  it("all 7 asleep segments of the 22:40→06:35 night land on ONE wake date", () => {
    const night = sleepRows.filter((r) => r.dateKey === "2026-04-02");
    expect(night).toHaveLength(1);
    // Hand-summed: 55+23+47+98+100+70+75 min = 468 min = 7.8 h exactly.
    expect(night[0]!.value).toBe(7.8);
    expect(night[0]!.unit).toBe("h");
  });

  it("NOTHING lands on the onset date — the split bug stays dead", () => {
    expect(sleepRows.find((r) => r.dateKey === "2026-04-01")).toBeUndefined();
  });

  it("InBed and Awake decoys are excluded from the total", () => {
    // InBed spans 8h10m and Awake 7m; including either would break 7.8.
    // (Asserted by the exact total above; this pins the row count too.)
    expect(sleepRows.filter((r) => r.dateKey === "2026-04-02")).toHaveLength(1);
  });

  it("multi-source sleep dedupe: the larger asleep total wins, never the sum", () => {
    // Phone's single 7.0h segment lost to Watch's 7.8h; a summed value would be 14.8.
    expect(sleepRows.find((r) => r.dateKey === "2026-04-02")!.value).toBe(7.8);
  });

  it("a DST-straddling segment reports real elapsed hours", () => {
    expect(sleepRows.find((r) => r.dateKey === "2026-03-08")?.value).toBe(1);
  });

  it("a segment ending exactly at midnight belongs to its own end date (hour 0 < 18)", () => {
    expect(sleepRows.find((r) => r.dateKey === "2026-05-03")?.value).toBe(0.7); // 40 min
    expect(sleepRows.find((r) => r.dateKey === "2026-05-02")).toBeUndefined();
  });
});

describe("fixture parse — record accounting", () => {
  const summary = parseWhole(fixture);

  it("counts every <Record tag and keeps seen = used + skipped", () => {
    expect(summary.recordsSeen).toBe(39);
    expect(summary.recordsUsed + summary.recordsSkipped).toBe(summary.recordsSeen);
  });

  it("unknown type, malformed timestamp, negative value, Idle hour, InBed, Awake and the bounds-dropped record are skipped — not thrown on", () => {
    expect(summary.recordsSkipped).toBe(7);
    expect(summary.recordsUsed).toBe(32);
  });

  it("perType used-counts add up to recordsUsed", () => {
    expect(Object.values(summary.perType).reduce((a, b) => a + b, 0)).toBe(
      summary.recordsUsed,
    );
    expect(summary.perType.steps).toBe(4);
    expect(summary.perType.sleep_hours).toBe(10);
  });

  it("first/last dateKey span the output", () => {
    expect(summary.firstDateKey).toBe("2026-03-08");
    expect(summary.lastDateKey).toBe("2026-05-03");
  });

  it("recordsSeen() live counter matches the final count", () => {
    const agg = createHealthAggregator();
    agg.pushChunk(fixture);
    expect(agg.recordsSeen()).toBe(39);
  });
});

describe("chunk-boundary safety", () => {
  const whole = parseWhole(fixture);

  it("hostile chunk sizes produce output identical to the single-chunk parse", () => {
    for (const size of [7, 64, 256, 1024]) {
      expect(parseChunked(fixture, size)).toEqual(whole);
    }
  });

  it("a split in the middle of '<Record' and mid-attribute both survive", () => {
    const recAt = fixture.indexOf("<Record");
    const midTag = recAt + 4; // "<Rec|ord …"
    const midAttr = fixture.indexOf('value="4500"') + 8; // value="45|00"
    for (const cut of [midTag, midAttr]) {
      const agg = createHealthAggregator();
      agg.pushChunk(fixture.slice(0, cut));
      agg.pushChunk(fixture.slice(cut));
      expect(agg.finish()).toEqual(whole);
    }
  });
});

describe("wrong or empty input", () => {
  it("plain text yields zero rows and zero records — never a throw", () => {
    const summary = parseWhole("This is a CSV,not,an,export\n1,2,3\n");
    expect(summary.dayRows).toEqual([]);
    expect(summary.metricRows).toEqual([]);
    expect(summary.recordsSeen).toBe(0);
    expect(summary.firstDateKey).toBeNull();
    expect(summary.lastDateKey).toBeNull();
  });

  it("empty input finishes cleanly", () => {
    const agg = createHealthAggregator();
    expect(agg.finish().recordsSeen).toBe(0);
  });
});
