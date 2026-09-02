// Pure streaming aggregator for Apple Health export.xml (G2 / REQ-004).
//
// Feed arbitrary text chunks via pushChunk(); call finish() once. A tag
// scanner, NOT a DOM parse — DOM-parsing a 400 MB string is an immediate
// OOM. Purity rules (G2 §4.5, blueprint §8.1): no Prisma, no DOM, no `Date`
// construction of any kind, no locale/TZ calls. All time math is integer
// civil-date arithmetic (Hinnant's days_from_civil) on `dateKey` strings and
// explicit-offset wall-clock timestamps.
//
// Record shape: <Record type="…" sourceName="…" unit="…" startDate="…"
//   endDate="…" value="…"/> — attributes always live on the opening tag,
// whether or not the record carries MetadataEntry children (children are
// skipped by construction: only `<Record` opening tags are scanned).
//
// Rules implemented here (each unit-tested against the committed fixture):
//   - Day bucketing: the literal YYYY-MM-DD prefix of startDate (G2 §3.1.6).
//   - Sleep night grouping (C1 ruling / patched G2 §3.1.7): an asleep
//     segment whose END time-of-day is ≥ 18:00 belongs to the NEXT civil
//     date; otherwise to its own end date. InBed/Awake excluded.
//   - Multi-source dedupe (D9): per (dateKey, type) — sums take the largest
//     single-source total; mean metrics (rhr/spo2/hrv) take the source with
//     the most records and average over it; vo2max takes the latest record
//     by startDate across all sources. Ties break lexicographically by
//     sourceName (deterministic, value-independent). Sources are NEVER
//     summed together.
//   - SpO₂ normalization: a per-record value ≤ 1 is ×100 BEFORE averaging.
//   - Bounds (C3 ruling): finish() checks every aggregate against the shared
//     @/lib/health-bounds table; an out-of-range aggregate is dropped
//     (day-field nulled / metric row omitted) and its winning source's
//     record count moves from recordsUsed to recordsSkipped. A single glitch
//     value must never fail a batch.

import { HEALTH_DAY_BOUNDS, METRIC_BOUNDS } from "@/lib/health-bounds";
import type { HealthDayRow, BodyMetricRow } from "@/lib/health-import-actions"; // type-only — erased

export type ImportSummary = {
  dayRows: HealthDayRow[];
  metricRows: BodyMetricRow[];
  firstDateKey: string | null;
  lastDateKey: string | null;
  recordsSeen: number;      // every <Record opening tag encountered
  recordsUsed: number;      // records whose contribution survived into the output
  recordsSkipped: number;   // seen − used (unknown types, malformed, out-of-range — C3)
  perType: Record<string, number>;   // used-count per supported short key ("activeKcal", "rhr", …)
};

export type WorkerOutMsg =
  | { type: "progress"; pct: number; recordsSeen: number }
  | { type: "done"; summary: ImportSummary }
  | { type: "error"; message: string };

// ── civil-date arithmetic (pure integers — no Date) ──────────────────────────

/** Hinnant's days_from_civil: days since 1970-01-01 for a proleptic Gregorian date. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of daysFromCivil. */
function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [m <= 2 ? y + 1 : y, m, d];
}

const WALL_CLOCK_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Epoch ms of an Apple wall-clock timestamp ("2026-04-01 22:40:00 -0600").
 * Returns null when the string does not match — the caller must skip-and-count
 * that record; NaN never enters an accumulator. The explicit UTC offset makes
 * DST-straddling sleep durations correct by construction.
 */
export function wallClockMs(s: string): number | null {
  const m = WALL_CLOCK_RE.exec(s);
  if (!m) return null;
  const days = daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
  const localMs =
    days * 86_400_000 +
    Number(m[4]) * 3_600_000 +
    Number(m[5]) * 60_000 +
    Number(m[6]) * 1_000;
  const offMs = (Number(m[8]) * 3_600_000 + Number(m[9]) * 60_000) * (m[7] === "-" ? -1 : 1);
  return localMs - offMs; // UTC = local − offset
}

/** The civil date one day after `key` (handles month/year rollover and leap years). */
export function nextDateKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  const [ny, nm, nd] = civilFromDays(daysFromCivil(y, m, d) + 1);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

// ── supported identifiers ────────────────────────────────────────────────────

type DayField = "activeKcal" | "basalKcal" | "steps" | "exerciseMin" | "standHours";
type MetricField = "rhr" | "spo2" | "vo2max" | "sleep_hours" | "hrv";
type ShortKey = DayField | MetricField;

const QUANTITY_TYPES: Record<string, ShortKey> = {
  HKQuantityTypeIdentifierActiveEnergyBurned: "activeKcal",
  HKQuantityTypeIdentifierBasalEnergyBurned: "basalKcal",
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierAppleExerciseTime: "exerciseMin",
  HKQuantityTypeIdentifierRestingHeartRate: "rhr",
  HKQuantityTypeIdentifierVO2Max: "vo2max",
  HKQuantityTypeIdentifierOxygenSaturation: "spo2",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv",
};

const SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
const STAND_TYPE = "HKCategoryTypeIdentifierAppleStandHour";

/** Asleep category value suffixes that count toward sleep_hours (InBed/Awake excluded). */
const ASLEEP_VALUES = new Set([
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
]);

const METRIC_UNITS: Record<MetricField, string> = {
  rhr: "bpm",
  spo2: "%",
  vo2max: "ml/kg/min",
  sleep_hours: "h",
  hrv: "ms",
};

/**
 * Aggregation family per key — drives the multi-source dedupe rule (D9).
 * Mean metrics dedupe by most-records-wins; vo2max by latest record;
 * everything else (activeKcal/basalKcal/steps/exerciseMin/standHours/
 * sleep_hours) is a sum deduped by largest single-source total.
 */
const MEAN_KEYS = new Set<ShortKey>(["rhr", "spo2", "hrv"]);

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Carry buffer cap: a partial opening tag longer than this is malformed, not grown. */
const CARRY_CAP = 32 * 1024;

const OPEN_TAG = "<Record";

// ── accumulators ─────────────────────────────────────────────────────────────

type SourceAcc = {
  sum: number;      // running sum (sums + means)
  count: number;    // record count for this (dateKey, key, source)
  latestMs: number; // vo2max only: wall-clock ms of the latest record so far
  latestVal: number; // vo2max only: that record's value
};

// dateKey → key → sourceName → SourceAcc
type DayMap = Map<string, Map<ShortKey, Map<string, SourceAcc>>>;

function attr(tag: string, name: string): string | null {
  // Attribute values in Apple exports are double-quoted; entities are left
  // as-is (sourceName is only ever a grouping key, never displayed raw here).
  const i = tag.indexOf(` ${name}="`);
  if (i === -1) return null;
  const start = i + name.length + 3;
  const end = tag.indexOf('"', start);
  if (end === -1) return null;
  return tag.slice(start, end);
}

export function createHealthAggregator(): {
  pushChunk(text: string): void;
  finish(): ImportSummary;
  recordsSeen(): number;
} {
  const days: DayMap = new Map();
  let carry = "";
  let seen = 0;
  let invalid = 0; // unknown types, malformed, excluded categories — skipped before accumulation

  function accFor(dateKey: string, key: ShortKey, source: string): SourceAcc {
    let byKey = days.get(dateKey);
    if (!byKey) {
      byKey = new Map();
      days.set(dateKey, byKey);
    }
    let bySource = byKey.get(key);
    if (!bySource) {
      bySource = new Map();
      byKey.set(key, bySource);
    }
    let acc = bySource.get(source);
    if (!acc) {
      acc = { sum: 0, count: 0, latestMs: -Infinity, latestVal: 0 };
      bySource.set(source, acc);
    }
    return acc;
  }

  function processTag(tag: string): void {
    seen++;
    const type = attr(tag, "type");
    if (!type) {
      invalid++;
      return;
    }
    const source = attr(tag, "sourceName") ?? "";
    const startDate = attr(tag, "startDate") ?? "";
    const endDate = attr(tag, "endDate") ?? "";
    const rawValue = attr(tag, "value") ?? "";

    if (type === SLEEP_TYPE) {
      if (!ASLEEP_VALUES.has(rawValue)) {
        invalid++; // InBed / Awake / unknown category — excluded, counted skipped
        return;
      }
      const startMs = wallClockMs(startDate);
      const endMs = wallClockMs(endDate);
      if (startMs === null || endMs === null || endMs < startMs) {
        invalid++;
        return;
      }
      // Night grouping (C1): end hour-of-day ≥ 18 → next civil date, else the
      // end date itself. Every segment of one night lands on the wake date.
      const endKey = endDate.slice(0, 10);
      const endHour = Number(endDate.slice(11, 13));
      const nightKey = endHour >= 18 ? nextDateKey(endKey) : endKey;
      const acc = accFor(nightKey, "sleep_hours", source);
      acc.sum += (endMs - startMs) / 3_600_000;
      acc.count++;
      return;
    }

    if (type === STAND_TYPE) {
      if (!DATE_KEY_RE.test(startDate.slice(0, 10)) || wallClockMs(startDate) === null) {
        invalid++;
        return;
      }
      if (rawValue !== "HKCategoryValueAppleStandHourStood") {
        invalid++; // Idle hours don't count
        return;
      }
      const acc = accFor(startDate.slice(0, 10), "standHours", source);
      acc.sum += 1;
      acc.count++;
      return;
    }

    const key = QUANTITY_TYPES[type];
    if (!key) {
      invalid++; // unsupported type — skipped, never thrown on
      return;
    }
    const startMs = wallClockMs(startDate);
    if (startMs === null) {
      invalid++;
      return;
    }
    let value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      invalid++;
      return;
    }
    if (key === "spo2" && value <= 1) value *= 100; // Apple writes fractions despite unit="%"
    const dateKey = startDate.slice(0, 10);
    const acc = accFor(dateKey, key, source);
    if (key === "vo2max") {
      if (startMs > acc.latestMs) {
        acc.latestMs = startMs;
        acc.latestVal = value;
      }
      acc.count++;
    } else {
      acc.sum += value;
      acc.count++;
    }
  }

  function pushChunk(text: string): void {
    let buf = carry + text;
    carry = "";
    let pos = 0;
    for (;;) {
      const start = buf.indexOf(OPEN_TAG, pos);
      if (start === -1) {
        // Keep a possible partial "<Record" prefix at the buffer's very end.
        const tailFrom = Math.max(pos, buf.length - (OPEN_TAG.length - 1));
        for (let i = tailFrom; i < buf.length; i++) {
          if (buf[i] === "<" && OPEN_TAG.startsWith(buf.slice(i))) {
            carry = buf.slice(i);
            return;
          }
        }
        return;
      }
      const after = buf[start + OPEN_TAG.length];
      if (after === undefined) {
        carry = buf.slice(start); // chunk ended exactly at "<Record"
        return;
      }
      if (after !== " " && after !== "\t" && after !== "\n" && after !== "\r") {
        pos = start + OPEN_TAG.length; // "<Recording…" — not a Record tag
        continue;
      }
      const gt = buf.indexOf(">", start);
      if (gt === -1) {
        const partial = buf.slice(start);
        if (partial.length > CARRY_CAP) {
          // A tag longer than the cap is malformed — discard, never grow.
          seen++;
          invalid++;
          carry = "";
        } else {
          carry = partial;
        }
        return;
      }
      processTag(buf.slice(start, gt + 1));
      pos = gt + 1;
      if (pos > 1_000_000 && pos > buf.length / 2) {
        // Keep the working buffer small on huge chunks.
        buf = buf.slice(pos);
        pos = 0;
      }
    }
  }

  function finish(): ImportSummary {
    const dayRowsByKey = new Map<string, HealthDayRow>();
    const metricRows: BodyMetricRow[] = [];
    const perType: Record<string, number> = {};
    let used = 0;
    let boundsDropped = 0;
    let dedupeLosers = 0;

    const dateKeys = [...days.keys()].sort();
    for (const dateKey of dateKeys) {
      const byKey = days.get(dateKey)!;
      for (const [key, bySource] of byKey) {
        // Resolve the winning source per the D9 table.
        let winner: string | null = null;
        let winnerAcc: SourceAcc | null = null;
        if (key === "vo2max") {
          // Latest startDate across ALL sources.
          let latestMs = -Infinity;
          for (const [src, acc] of bySource) {
            if (acc.latestMs > latestMs || (acc.latestMs === latestMs && (winner === null || src < winner))) {
              latestMs = acc.latestMs;
              winner = src;
              winnerAcc = acc;
            }
          }
        } else if (MEAN_KEYS.has(key)) {
          // Most records wins (a "largest total" is meaningless for a mean);
          // tie → lexicographically first sourceName.
          for (const [src, acc] of bySource) {
            if (
              winnerAcc === null ||
              acc.count > winnerAcc.count ||
              (acc.count === winnerAcc.count && src < (winner as string))
            ) {
              winner = src;
              winnerAcc = acc;
            }
          }
        } else {
          // Sums: largest single-source total wins — never the sum of sources.
          for (const [src, acc] of bySource) {
            if (
              winnerAcc === null ||
              acc.sum > winnerAcc.sum ||
              (acc.sum === winnerAcc.sum && src < (winner as string))
            ) {
              winner = src;
              winnerAcc = acc;
            }
          }
        }
        if (!winnerAcc) continue;

        // Losing sources' records were valid but their contribution is
        // superseded by the winner — they still count as "used" (they are
        // neither unknown, malformed, nor out-of-range), keeping
        // recordsSkipped an honest count of actual problems.
        for (const acc of bySource.values()) {
          if (acc !== winnerAcc) {
            dedupeLosers += acc.count;
            perType[key] = (perType[key] ?? 0) + acc.count;
          }
        }

        // Aggregate the winner.
        let value: number;
        let winnerUsed: number;
        if (key === "vo2max") {
          value = round1(winnerAcc.latestVal);
          winnerUsed = winnerAcc.count;
        } else if (MEAN_KEYS.has(key)) {
          const mean = winnerAcc.sum / winnerAcc.count;
          value = key === "rhr" ? Math.round(mean) : round1(mean);
          winnerUsed = winnerAcc.count;
        } else {
          const total = winnerAcc.sum;
          value =
            key === "activeKcal" || key === "basalKcal" || key === "sleep_hours"
              ? round1(total)
              : Math.round(total);
          winnerUsed = winnerAcc.count;
        }

        // Bounds skip-layer (C3): drop the aggregate, count its contributors.
        const bounds =
          key in HEALTH_DAY_BOUNDS
            ? HEALTH_DAY_BOUNDS[key as DayField]
            : METRIC_BOUNDS[key as MetricField];
        if (value < bounds.min || value > bounds.max) {
          boundsDropped += winnerUsed;
          continue;
        }

        used += winnerUsed;
        perType[key] = (perType[key] ?? 0) + winnerUsed;

        if (key === "rhr" || key === "spo2" || key === "vo2max" || key === "hrv" || key === "sleep_hours") {
          metricRows.push({ dateKey, key, value, unit: METRIC_UNITS[key] });
        } else {
          let row = dayRowsByKey.get(dateKey);
          if (!row) {
            row = {
              dateKey,
              activeKcal: null,
              basalKcal: null,
              steps: null,
              exerciseMin: null,
              standHours: null,
            };
            dayRowsByKey.set(dateKey, row);
          }
          row[key] = value;
        }
      }
    }

    used += dedupeLosers;
    const dayRows = [...dayRowsByKey.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
    metricRows.sort((a, b) => (a.dateKey === b.dateKey ? (a.key < b.key ? -1 : 1) : a.dateKey < b.dateKey ? -1 : 1));

    const allKeys = [
      ...dayRows.map((r) => r.dateKey),
      ...metricRows.map((r) => r.dateKey),
    ].sort();

    // seen = (winners + losers + boundsDropped) + invalid, and
    // used = winners + losers, so seen === used + skipped by construction.
    return {
      dayRows,
      metricRows,
      firstDateKey: allKeys[0] ?? null,
      lastDateKey: allKeys[allKeys.length - 1] ?? null,
      recordsSeen: seen,
      recordsUsed: used,
      recordsSkipped: invalid + boundsDropped,
      perType,
    };
  }

  return { pushChunk, finish, recordsSeen: () => seen };
}
