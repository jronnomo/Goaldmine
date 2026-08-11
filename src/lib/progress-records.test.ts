// src/lib/progress-records.test.ts
//
// PR noise filters (UXR-PROG-37), the shared-scan PR pass (UXR-PROG-38), the
// mixed-kind feed's window + ordering (UXR-PROG-33), and the RecordsFeed
// component's glyph gating (UXR-PROG-34: column only when distinctKinds > 1),
// NEW-chip window, and delta-is-the-celebration rendering (UXR-PROG-36).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildRecordsFeed,
  derivePrEvents,
  feedValueText,
  type RecordFeedItem,
} from "@/lib/progress-records";
import { RecordsFeed } from "@/components/progress/RecordsFeed";
import type { ScanWorkout } from "@/lib/progress-asof";

let seq = 0;
function liftWorkout(dateIso: string, name: string, sets: { weightLb?: number; reps?: number; durationSec?: number }[]): ScanWorkout {
  return {
    id: `w-${String(++seq).padStart(3, "0")}`,
    startedAt: new Date(dateIso),
    exercises: [
      {
        name,
        equipment: null,
        sets: sets.map((s) => ({
          weightLb: s.weightLb ?? null,
          reps: s.reps ?? null,
          durationSec: s.durationSec ?? null,
          distanceMi: null,
        })),
      },
    ],
  };
}

const newestFirst = (ws: ScanWorkout[]) =>
  [...ws].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

describe("derivePrEvents — noise filters", () => {
  it("a near-new movement PRing every session is LEARNING, not records (prior-session floor 4)", () => {
    seq = 0;
    // 4 sessions, each better than the last — floor requires ≥4 PRIOR sessions.
    const scan = newestFirst([
      liftWorkout("2026-09-01T17:00Z", "Bench Press", [{ weightLb: 95, reps: 5 }]),
      liftWorkout("2026-09-03T17:00Z", "Bench Press", [{ weightLb: 105, reps: 5 }]),
      liftWorkout("2026-09-05T17:00Z", "Bench Press", [{ weightLb: 115, reps: 5 }]),
      liftWorkout("2026-09-07T17:00Z", "Bench Press", [{ weightLb: 125, reps: 5 }]),
    ]);
    expect(derivePrEvents(scan)).toEqual([]);
  });

  it("the 5th session's strict beat with ≥3% improvement IS a PR", () => {
    seq = 0;
    const scan = newestFirst([
      liftWorkout("2026-09-01T17:00Z", "Bench Press", [{ weightLb: 115, reps: 5 }]),
      liftWorkout("2026-09-03T17:00Z", "Bench Press", [{ weightLb: 115, reps: 5 }]),
      liftWorkout("2026-09-05T17:00Z", "Bench Press", [{ weightLb: 115, reps: 5 }]),
      liftWorkout("2026-09-07T17:00Z", "Bench Press", [{ weightLb: 115, reps: 5 }]),
      liftWorkout("2026-09-09T17:00Z", "Bench Press", [{ weightLb: 135, reps: 5 }]),
    ]);
    const events = derivePrEvents(scan);
    expect(events).toHaveLength(1);
    expect(events[0]!.exercise).toBe("Bench Press");
    expect(events[0]!.priorSessions).toBe(4);
    expect(events[0]!.relImprovement).toBeGreaterThan(0.03);
  });

  it("Epley-continuous micro-PRs under the 3% floor are filtered (135×8 → 135×9)", () => {
    seq = 0;
    const scan = newestFirst([
      liftWorkout("2026-08-20T17:00Z", "Bench Press", [{ weightLb: 135, reps: 8 }]),
      liftWorkout("2026-08-24T17:00Z", "Bench Press", [{ weightLb: 135, reps: 8 }]),
      liftWorkout("2026-08-28T17:00Z", "Bench Press", [{ weightLb: 135, reps: 8 }]),
      liftWorkout("2026-09-01T17:00Z", "Bench Press", [{ weightLb: 135, reps: 8 }]),
      // est-1RM 171.0 → 175.5 = +2.6% — under the floor:
      liftWorkout("2026-09-05T17:00Z", "Bench Press", [{ weightLb: 135, reps: 9 }]),
    ]);
    expect(derivePrEvents(scan)).toEqual([]);
  });
});

describe("buildRecordsFeed — the 21-day mixed-kind window", () => {
  const NOW = new Date("2026-09-20T15:00:00Z");

  it("interleaves kinds date-ASC; outside-window rows drop; priors resolve", () => {
    seq = 0;
    const feed = buildRecordsFeed({
      now: NOW,
      prEvents: [
        {
          exercise: "Wall Handstand Push-Up",
          kind: "reps",
          date: new Date("2026-09-09T17:00Z"),
          workoutId: "w1",
          value: 2,
          prior: 1,
          relImprovement: 1,
          priorSessions: 5,
        },
      ],
      baselines: [
        { id: "b1", testName: "L-Sit (Parallettes)", value: 38, units: "sec", date: new Date("2026-09-12T17:00Z") },
        { id: "b2", testName: "L-Sit (Parallettes)", value: 30, units: "sec", date: new Date("2026-08-13T17:00Z") }, // outside 21d
      ],
      priorBaselineValue: (name, before) =>
        name === "L-Sit (Parallettes)" && before.getTime() > new Date("2026-08-13").getTime() ? 30 : null,
      hikes: [
        { id: "h1", route: "Mission Peak", distanceMi: 6.4, elevationFt: 2517, date: new Date("2026-09-06T16:00Z") },
      ],
    });
    expect(feed.map((i) => i.kind)).toEqual(["hike", "pr", "baseline"]); // date ASC
    const baseline = feed.find((i) => i.kind === "baseline")!;
    expect(feedValueText(baseline)).toBe("30 → 38 sec");
    const pr = feed.find((i) => i.kind === "pr")!;
    expect(feedValueText(pr)).toBe("1 → 2 reps");
  });
});

describe("RecordsFeed — glyph gating + NEW chip + honest zero", () => {
  const NOW = new Date("2026-09-20T15:00:00Z");
  const prItem = (over: Partial<RecordFeedItem>): RecordFeedItem => ({
    kind: "pr",
    id: "pr-1",
    date: new Date("2026-09-18T17:00Z"),
    title: "Freestanding Handstand Hold",
    prior: 18,
    value: 22,
    units: "sec",
    relImprovement: 0.22,
    ...over,
  });

  it("single-kind list renders NO glyph column (clip-art rule, R26)", () => {
    const html = renderToStaticMarkup(
      createElement(RecordsFeed, {
        items: [prItem({}), prItem({ id: "pr-2", date: new Date("2026-09-10T17:00Z") })],
        now: NOW,
      }),
    );
    expect(html).not.toContain("record-glyph");
  });

  it("mixed kinds render the 24px glyph column", () => {
    const html = renderToStaticMarkup(
      createElement(RecordsFeed, {
        items: [
          prItem({}),
          {
            kind: "hike",
            id: "h1",
            date: new Date("2026-09-06T16:00Z"),
            title: "Mission Peak",
            prior: null,
            value: 2517,
            units: "ft · 6.4 mi",
            relImprovement: 0,
          },
        ],
        now: NOW,
      }),
    );
    expect(html).toContain("record-glyph-pr");
    expect(html).toContain("record-glyph-hike");
    expect(html).toContain('width="24"'); // the hard floor
  });

  it("NEW chip + accent value only within 7 days; the delta is the celebration", () => {
    const fresh = renderToStaticMarkup(
      createElement(RecordsFeed, { items: [prItem({})], now: NOW }),
    );
    expect(fresh).toContain(">new<");
    expect(fresh).toContain("18 → 22 sec");
    expect(fresh).not.toContain("🎉");
    const stale = renderToStaticMarkup(
      createElement(RecordsFeed, { items: [prItem({ date: new Date("2026-09-01T17:00Z") })], now: NOW }),
    );
    expect(stale).not.toContain(">new<");
  });

  it("zero state: honest copy; numeral only when the count was computed (R11 carve-out)", () => {
    const computed = renderToStaticMarkup(createElement(RecordsFeed, { items: [], now: NOW }));
    expect(computed).toContain("None in the last 21 days");
    expect(computed).toContain(">0<"); // TRUE zero — computed
    const zeroRow = renderToStaticMarkup(
      createElement(RecordsFeed, { items: [], now: NOW, countKnown: false }),
    );
    expect(zeroRow).not.toContain(">0<"); // nothing computed — no claimed count
  });

  it('the register link reads "All records →" (UXR-PROG-100)', () => {
    const html = renderToStaticMarkup(createElement(RecordsFeed, { items: [], now: NOW }));
    expect(html).toContain("All records →");
    expect(html).not.toContain("All baselines");
  });
});
