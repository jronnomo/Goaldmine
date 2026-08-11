// src/components/progress/SeamStrip.test.ts
//
// The Seam Strip matrix (task spec): 6 sessions × 3 thresholds × regression
// roll-out × untimed footnote — plus the deliberate a11y deviation (an <ol>
// with sr-only spans, real-DOM-text tallies) and the grayscale acceptance
// semantics: every assertion below is about SHAPE (data-rung heights, DOM
// order, words), never hue. House idiom: node env, createElement +
// renderToStaticMarkup.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeamStrip, type SeamStripTrack } from "@/components/progress/SeamStrip";
import { rollingMatrix, type RollingWorkoutSlotSource } from "@/lib/rolling-metrics";
import type { RollingParams } from "@/lib/metrics-registry";

const EX = "Freestanding Handstand Hold";
const P10: RollingParams = { exercise: EX, minSeconds: 10, hitsPerSession: 1, window: 6 };
const P20: RollingParams = { exercise: EX, minSeconds: 20, hitsPerSession: 1, window: 6 };
const TRIPLE: RollingParams = { exercise: EX, minSeconds: 20, hitsPerSession: 3, attemptCap: 5, window: 6 };

let seq = 0;
function w(dateIso: string, durations: (number | null)[]): RollingWorkoutSlotSource {
  return {
    id: `w-${String(++seq).padStart(3, "0")}`,
    startedAt: new Date(dateIso),
    exercises: [{ name: EX, sets: durations.map((d) => ({ durationSec: d })) }],
  };
}
function newestFirst(...ws: RollingWorkoutSlotSource[]): RollingWorkoutSlotSource[] {
  return [...ws].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

function tracksFrom(m: ReturnType<typeof rollingMatrix>): SeamStripTrack[] {
  const meta: Record<string, { key: string; label: string; gating: boolean; target: number }> = {
    "10:1": { key: "rolling:hs_sessions_10s_of6", label: "≥10s hold — sessions hit, last 6", gating: false, target: 4 },
    "20:1": { key: "rolling:hs_sessions_20s_of6", label: "≥20s hold — sessions hit, last 6", gating: false, target: 4 },
    "20:3": { key: "rolling:hs_triple20_of6", label: "3× ≥20s in one session — sessions hit, last 6", gating: true, target: 1 },
  };
  return m.rows.map((r) => {
    const k = `${r.params.minSeconds}:${r.params.hitsPerSession ?? 1}`;
    const info = meta[k]!;
    return { metricKey: info.key, label: info.label, gating: info.gating, target: info.target, hits: r.hits, params: r.params };
  });
}

function renderStrip(universe: RollingWorkoutSlotSource[], opts?: { retestWeeks?: number[] | null }) {
  const m = rollingMatrix(universe, EX, 6, [P10, P20, TRIPLE]);
  return renderToStaticMarkup(
    createElement(SeamStrip, {
      goalId: "g1",
      exercise: EX,
      window: 6,
      slots: m.sessions,
      tracks: tracksFrom(m),
      untimedSessionCount: m.untimedSessionCount,
      retestWeeks: opts?.retestWeeks ?? null,
    }),
  );
}

/** The storyboard F0 universe: 6 sessions, mixed rungs. */
const F0 = () =>
  newestFirst(
    w("2026-08-26T17:00:00Z", [8, 12]), // ≥10 → rung 1
    w("2026-09-01T17:00:00Z", [4, 6]), // stub → rung 0
    w("2026-09-05T17:00:00Z", [14]), // rung 1
    w("2026-09-09T17:00:00Z", [21, 12]), // rung 2
    w("2026-09-14T17:00:00Z", [22, 8, 20]), // rung 2
    w("2026-09-18T17:00:00Z", [25, 21, 24]), // triple → rung 3
  );

describe("SeamStrip — full-window matrix (F0)", () => {
  it("renders 6 slots oldest-left: DOM date order ascends", () => {
    seq = 0;
    const html = renderStrip(F0());
    const order = ["Aug 26", "Sep 1", "Sep 5", "Sep 9", "Sep 14", "Sep 18"];
    let pos = -1;
    for (const d of order) {
      const next = html.indexOf(d, pos + 1);
      expect(next, `${d} appears after its predecessor`).toBeGreaterThan(pos);
      pos = next;
    }
  });

  it("column heights carry the nested rungs (grayscale channel): 1,0,1,2,2,3", () => {
    seq = 0;
    const html = renderStrip(F0());
    const rungs = [...html.matchAll(/data-rung="(\d)"/g)].map((m) => Number(m[1]));
    expect(rungs).toEqual([1, 0, 1, 2, 2, 3]);
    // Height encodes rung — stub 5px, 1/3 → 11px, 2/3 → 23px, full 34px.
    expect(html).toContain("height:5px");
    expect(html).toContain("height:11px");
    expect(html).toContain("height:23px");
    expect(html).toContain("height:34px");
  });

  it("tallies are TEXT, with target counts, on real DOM text (no bars, no axis marker)", () => {
    seq = 0;
    const html = renderStrip(F0());
    expect(html).toContain("5 of 6"); // ≥10s: 5 hits
    expect(html).toContain("· HOLDING"); // 5 ≥ 4
    expect(html).toContain("3 of 6"); // ≥20s: 3 hits
    expect(html).toContain("· needs 4");
    expect(html).toContain("1 of 6"); // triple: 1 hit
    expect(html).toContain("GATE CLEAR");
    // Never a delta annotation (R6):
    expect(html).not.toContain("was ");
  });

  it("the roll-off bracket + mechanism caption render when the window is full", () => {
    seq = 0;
    const html = renderStrip(F0());
    expect(html).toContain("seam-rolloff-g1");
    expect(html).toContain("Aug 26 is the oldest in the window");
    expect(html).toContain("It leaves when the next timed session is logged");
    // A countdown framing is structurally absent — no day-count language.
    expect(html).not.toMatch(/days? (left|until|remaining)/i);
  });

  it("a11y: an <ol> of <li> slots with sr-only narration; NOT progressbar, NOT role=img", () => {
    seq = 0;
    const html = renderStrip(F0());
    expect(html).toContain("<ol");
    expect((html.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(html).toContain("sr-only");
    expect(html).toContain("thresholds reached");
    expect(html).not.toContain('role="progressbar"');
    // The strip's container carries aria-labelledby, and the only role=img on
    // the card is... none — the strip deviates from the house idiom on purpose.
    expect(html).not.toContain('role="img"');
  });

  it("the goal-identity triad never appears in the strip (UXR-PROG-72)", () => {
    seq = 0;
    const html = renderStrip(F0());
    for (const glyph of ["●", "■", "▲", "○", "□", "△"]) {
      expect(html).not.toContain(glyph);
    }
  });

  it("gate track carries the GATE chip (border, not hue) + the framing line", () => {
    seq = 0;
    const html = renderStrip(F0());
    expect(html).toContain(">gate<");
    expect(html).toContain("Gates are mastery checks");
  });
});

describe("SeamStrip — regression roll-out (F5: the un-crossing)", () => {
  it("the only triple20 rolls out: gate tally 1 → 0 while consistency is best-ever", () => {
    // Six sessions with the triple OLDEST → gate lit.
    const sixWithOldTriple = () =>
      newestFirst(
        w("2026-08-20T17:00:00Z", [30, 25, 22]), // the only triple — oldest slot
        w("2026-08-26T17:00:00Z", [12, 11]),
        w("2026-09-01T17:00:00Z", [14]),
        w("2026-09-05T17:00:00Z", [15]),
        w("2026-09-09T17:00:00Z", [21, 12]),
        w("2026-09-14T17:00:00Z", [22, 8, 20]),
      );
    seq = 0;
    const before = renderStrip(sixWithOldTriple());
    expect(before).toContain("GATE CLEAR");

    // A 7th qualifying session (not a triple) lands → Aug 20 rolls out.
    seq = 0;
    const seven = newestFirst(...sixWithOldTriple(), w("2026-09-18T17:00:00Z", [25, 12]));
    const html = renderStrip(seven);
    expect(html).toContain("0 of 6");
    expect(html).not.toContain("GATE CLEAR");
    expect(html).toContain("· needs 1");
    // Aug 20 rolled out — Aug 26 is now the oldest:
    expect(html).toContain("Aug 26 is the oldest in the window");
    expect(html).not.toContain("Aug 20");
    // The drop is never colored or apologised for:
    expect(html).not.toContain("lost");
    expect(html).not.toContain("was 1");
    // And the ≥10s tier is at its best — 6 of 6 — while the gate went dark:
    expect(html).toContain("6 of 6");
  });
});

describe("SeamStrip — partial window (UXR-TIA-49)", () => {
  it('3 sessions: tallies read "N of 3 so far", no bracket, no HOLDING verdicts', () => {
    seq = 0;
    const three = newestFirst(
      w("2026-08-26T17:00:00Z", [8, 12]),
      w("2026-09-01T17:00:00Z", [14]),
      w("2026-09-05T17:00:00Z", [21]),
    );
    const html = renderStrip(three);
    expect(html).toContain("of 3");
    expect(html).toContain("so far");
    expect(html).not.toContain("seam-rolloff");
    expect(html).not.toContain("HOLDING");
    expect(html).not.toContain("is the oldest in the window");
  });
});

describe("SeamStrip — day-1 truth (no sessions)", () => {
  it('all six needs-labels render while free; "— of 6", never "0 of 6"; no bracket/dates', () => {
    seq = 0;
    const html = renderStrip([]);
    expect(html).toContain("No timed Freestanding Handstand Hold session logged yet");
    expect((html.match(/— of 6/g) ?? []).length).toBe(3); // all three tiers
    expect(html).not.toContain("0 of 6");
    expect(html).toContain("needs 4");
    expect(html).toContain("needs 1"); // the gate's rule, taught while free
    expect(html).not.toContain("seam-rolloff");
    expect(html).not.toContain("data-rung");
  });
});

describe("SeamStrip — the untimed footnote (F3)", () => {
  it("renders only when count > 0, pluralized", () => {
    seq = 0;
    const withUntimed = newestFirst(...F0(), w("2026-09-16T17:00:00Z", [null]));
    const html = renderStrip(withUntimed);
    expect(html).toContain("seam-untimed-note-g1");
    expect(html).toContain("1 session in this stretch logged no hold time");
    expect(html).toContain("untimed sets aren");

    seq = 0;
    const none = renderStrip(F0());
    expect(none).not.toContain("seam-untimed-note");
  });
});

describe("SeamStrip — R24 retest footer", () => {
  it("renders the protocol-gap line when retest weeks are derivable", () => {
    seq = 0;
    const html = renderStrip(F0(), { retestWeeks: [10, 19] });
    expect(html).toContain("Baselines re-test in weeks 10 and 19 — the strip moves in between.");
  });
  it("omits it when not derivable", () => {
    seq = 0;
    const html = renderStrip(F0(), { retestWeeks: null });
    expect(html).not.toContain("re-test in weeks");
  });
});

describe("SeamStrip — fill + baseline semantics (iso-luminant constraints)", () => {
  it("fill is the --accent token; the baseline rule is always drawn (even empty slots)", () => {
    seq = 0;
    const html = renderStrip(F0());
    expect(html).toContain("bg-[var(--accent)]"); // UXR-PROG-69 resolved: --accent
    // 6 columns each carry the 2px baseline rule:
    expect((html.match(/border-b-2 border-\[var\(--muted\)\]/g) ?? []).length).toBe(6);
    // Date labels ship the SAFE branch (UXR-PROG-66): 11px + theme-aware class.
    expect(html).toContain("seam-date-label");
    expect(html).toContain("text-[11px]");
    expect(html).not.toContain("text-[10px] tabular-nums text-center"); // never the 10px variant
  });

  it("an empty slot draws NOTHING on the rule — absence, not a faint mark", () => {
    seq = 0;
    const two = newestFirst(w("2026-09-01T17:00:00Z", [14]), w("2026-09-05T17:00:00Z", [21]));
    const html = renderStrip(two);
    // 6 rules drawn, but only 2 fills:
    expect((html.match(/border-b-2 border-\[var\(--muted\)\]/g) ?? []).length).toBe(6);
    expect((html.match(/data-rung=/g) ?? []).length).toBe(2);
  });
});
