// src/lib/goal-assay-core.test.ts
// Pure-function unit tests — no mocks, no DB. Covers ceremonyTier's modal
// vote (incl. the tie rule), the heroStatPrecedence honesty guards,
// buildEvidenceRows' reserve-last-slot-for-first-miss corollary, the
// zero-target fixture, and shouldBurnToken's predicate table.

import { describe, expect, it } from "vitest";
import {
  ceremonyTier,
  heroStatPrecedence,
  buildEvidenceRows,
  shouldBurnToken,
  readinessSeriesHint,
  READINESS_FRAMING,
  ZERO_TARGET_EVIDENCE_SENTENCE,
  type CeremonyTierInputs,
  type HeroStatSnapshotInputs,
} from "@/lib/goal-assay-core";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

// ─────────────────────────────────────────────────────────
// ceremonyTier
// ─────────────────────────────────────────────────────────

function tierInputs(overrides: Partial<CeremonyTierInputs> = {}): CeremonyTierInputs {
  return {
    feasibilityTierAtCompletion: null,
    xpBasisWeeks: 0,
    targetsMet: 0,
    evidenceDensity: 0,
    ...overrides,
  };
}

describe("ceremonyTier — modal vote", () => {
  it("all-marker signals -> marker", () => {
    expect(
      ceremonyTier(
        tierInputs({ feasibilityTierAtCompletion: "common", xpBasisWeeks: 2, targetsMet: 0, evidenceDensity: 1 }),
      ),
    ).toBe("marker");
  });

  it("null feasibility counts as marker (not a crash, not summit)", () => {
    expect(
      ceremonyTier(
        tierInputs({ feasibilityTierAtCompletion: null, xpBasisWeeks: 1, targetsMet: 0, evidenceDensity: 0 }),
      ),
    ).toBe("marker");
  });

  it("all-summit signals -> summit", () => {
    expect(
      ceremonyTier(
        tierInputs({
          feasibilityTierAtCompletion: "legendary",
          xpBasisWeeks: 20,
          targetsMet: 6,
          evidenceDensity: 25,
        }),
      ),
    ).toBe("summit");
  });

  it("3 ascent votes + 1 marker vote -> ascent (true modal, not max)", () => {
    // feasibility=rare(ascent), weeks=8(ascent), targetsMet=3(ascent), evidenceDensity=1(marker)
    expect(
      ceremonyTier(
        tierInputs({ feasibilityTierAtCompletion: "rare", xpBasisWeeks: 8, targetsMet: 3, evidenceDensity: 1 }),
      ),
    ).toBe("ascent");
  });

  it("modal-not-max: 3 marker votes + 1 summit vote -> marker, never summit", () => {
    // feasibility=common(marker), weeks=1(marker), targetsMet=0(marker), evidenceDensity=25(summit)
    expect(
      ceremonyTier(
        tierInputs({
          feasibilityTierAtCompletion: "common",
          xpBasisWeeks: 1,
          targetsMet: 0,
          evidenceDensity: 25,
        }),
      ),
    ).toBe("marker");
  });

  it("tie: 2 marker + 2 summit (0 ascent votes) resolves to the MIDDLE tier (ascent)", () => {
    // feasibility=common(marker), weeks=1(marker), targetsMet=6(summit), evidenceDensity=25(summit)
    expect(
      ceremonyTier(
        tierInputs({
          feasibilityTierAtCompletion: "common",
          xpBasisWeeks: 1,
          targetsMet: 6,
          evidenceDensity: 25,
        }),
      ),
    ).toBe("ascent");
  });

  it("tie: 2 marker + 2 ascent resolves to ascent (the middle tier, not the marker side)", () => {
    // feasibility=common(marker), weeks=1(marker), targetsMet=3(ascent), evidenceDensity=5(ascent)
    expect(
      ceremonyTier(
        tierInputs({
          feasibilityTierAtCompletion: "common",
          xpBasisWeeks: 1,
          targetsMet: 3,
          evidenceDensity: 5,
        }),
      ),
    ).toBe("ascent");
  });

  it("an unrecognized feasibility tier string fails closed to a marker vote", () => {
    expect(
      ceremonyTier(
        tierInputs({
          feasibilityTierAtCompletion: "some-future-tier",
          xpBasisWeeks: 1,
          targetsMet: 0,
          evidenceDensity: 0,
        }),
      ),
    ).toBe("marker");
  });

  it("weeks bucket boundaries: unanimous-with-the-other-three votes at 3/4/11/12 weeks land marker/ascent/ascent/summit", () => {
    const BY_TIER = {
      marker: { feasibilityTierAtCompletion: "common" as const, targetsMet: 0, evidenceDensity: 0 },
      ascent: { feasibilityTierAtCompletion: "rare" as const, targetsMet: 3, evidenceDensity: 5 },
      summit: { feasibilityTierAtCompletion: "legendary" as const, targetsMet: 6, evidenceDensity: 25 },
    };
    const unanimousAt = (weeks: number, tier: keyof typeof BY_TIER) =>
      ceremonyTier(tierInputs({ ...BY_TIER[tier], xpBasisWeeks: weeks }));

    expect(unanimousAt(3, "marker")).toBe("marker");
    expect(unanimousAt(4, "ascent")).toBe("ascent");
    expect(unanimousAt(11, "ascent")).toBe("ascent");
    expect(unanimousAt(12, "summit")).toBe("summit");
  });

  it("modal-not-max reconfirmed at the weeks boundary: a 3-vote marker majority survives weeks jumping all the way to 12", () => {
    const anchorMarker = { feasibilityTierAtCompletion: "common" as const, targetsMet: 0, evidenceDensity: 0 };
    expect(ceremonyTier(tierInputs({ ...anchorMarker, xpBasisWeeks: 3 }))).toBe("marker");
    expect(ceremonyTier(tierInputs({ ...anchorMarker, xpBasisWeeks: 12 }))).toBe("marker");
  });
});

// ─────────────────────────────────────────────────────────
// heroStatPrecedence
// ─────────────────────────────────────────────────────────

function heroInputs(overrides: Partial<HeroStatSnapshotInputs> = {}): HeroStatSnapshotInputs {
  return {
    readiness: null,
    targetsMet: 0,
    targetsTotal: 0,
    daysElapsed: 10,
    ...overrides,
  };
}

describe("heroStatPrecedence — §8.5 honesty guards", () => {
  it("uses readiness as the hero stat when it's a real measurement (not capped, fully covered)", () => {
    const stat = heroStatPrecedence(
      heroInputs({
        readiness: { score: 89, rawScore: 89, ceiling: 100, coverage: { tested: 9, total: 9 }, openGateCount: 0 },
      }),
    );
    expect(stat).toEqual({
      kind: "readiness",
      score: 89,
      showDenominator: false,
      coverage: { tested: 9, total: 9 },
    });
  });

  it("coverage guard: tested < total forces showDenominator true even with a normal score", () => {
    const stat = heroStatPrecedence(
      heroInputs({
        readiness: { score: 89, rawScore: 89, ceiling: 100, coverage: { tested: 3, total: 9 }, openGateCount: 0 },
      }),
    );
    expect(stat).toEqual({
      kind: "readiness",
      score: 89,
      showDenominator: true,
      coverage: { tested: 3, total: 9 },
    });
  });

  it("ceiling guard: score === ceiling < 100 with an open gate disqualifies readiness as hero — falls to targets", () => {
    const stat = heroStatPrecedence(
      heroInputs({
        readiness: { score: 80, rawScore: 95, ceiling: 80, coverage: { tested: 9, total: 9 }, openGateCount: 1 },
        targetsMet: 7,
        targetsTotal: 9,
      }),
    );
    expect(stat).toEqual({ kind: "targets", targetsMet: 7, targetsTotal: 9 });
  });

  it("ceiling === 100 is a real perfect score, not a cap — readiness still wins even if score === ceiling", () => {
    const stat = heroStatPrecedence(
      heroInputs({
        readiness: { score: 100, rawScore: 100, ceiling: 100, coverage: { tested: 5, total: 5 }, openGateCount: 0 },
      }),
    );
    expect(stat.kind).toBe("readiness");
  });

  it("score === ceiling < 100 but openGateCount === 0 is NOT a cap (nothing open to blame) — readiness still wins", () => {
    const stat = heroStatPrecedence(
      heroInputs({
        readiness: { score: 80, rawScore: 80, ceiling: 80, coverage: { tested: 5, total: 5 }, openGateCount: 0 },
      }),
    );
    expect(stat.kind).toBe("readiness");
  });

  it("zero-target goal (readiness null, no targets) falls all the way to the days-elapsed floor", () => {
    const stat = heroStatPrecedence(heroInputs({ readiness: null, targetsMet: 0, targetsTotal: 0, daysElapsed: 14 }));
    expect(stat).toEqual({ kind: "days", daysElapsed: 14 });
  });

  it("readiness null but targets exist -> targets, never days (targets take precedence over the floor)", () => {
    const stat = heroStatPrecedence(heroInputs({ readiness: null, targetsMet: 2, targetsTotal: 3, daysElapsed: 14 }));
    expect(stat).toEqual({ kind: "targets", targetsMet: 2, targetsTotal: 3 });
  });
});

// ─────────────────────────────────────────────────────────
// buildEvidenceRows
// ─────────────────────────────────────────────────────────

type Target = GoalCompletionSnapshot["targets"][number];

function target(overrides: Partial<Target> & { metric: string; met: boolean }): Target {
  return {
    label: overrides.metric,
    units: "lb",
    start: 0,
    final: 10,
    target: 10,
    progress: overrides.met ? 1 : 0.5,
    ...overrides,
  };
}

describe("buildEvidenceRows", () => {
  it("zero targets -> empty rows, hiddenCount 0", () => {
    expect(buildEvidenceRows([], 6)).toEqual({ rows: [], hiddenCount: 0 });
  });

  it("cap <= 0 -> empty rows, everything hidden", () => {
    const targets = [target({ metric: "a", met: true })];
    expect(buildEvidenceRows(targets, 0)).toEqual({ rows: [], hiddenCount: 1 });
  });

  it("fewer targets than cap -> all shown, met-first, hiddenCount 0", () => {
    const missed = target({ metric: "missed", met: false });
    const met = target({ metric: "met", met: true });
    const { rows, hiddenCount } = buildEvidenceRows([missed, met], 6);
    expect(rows.map((r) => r.target.metric)).toEqual(["met", "missed"]);
    expect(hiddenCount).toBe(0);
  });

  it("formats the range as 'start → final units' (ported from completion-card.tsx TargetRow)", () => {
    const t = target({ metric: "pullups", met: true, start: 5, final: 15, units: "reps" });
    const { rows } = buildEvidenceRows([t], 6);
    expect(rows[0]!.formattedRange).toBe("5 → 15 reps");
  });

  it("formats null start/final as an em dash", () => {
    const t = target({ metric: "m", met: true, start: null, final: null, units: "lb" });
    const { rows } = buildEvidenceRows([t], 6);
    expect(rows[0]!.formattedRange).toBe("— → —");
  });

  // Number formatting fixture — founder complaint: naive integer rounding
  // silently swallowed non-integral change/beats ("5.9 → 6.3 mi" rendered as
  // "6 → 6 mi"). Rule: round to 1 decimal first; integral result -> plain
  // comma'd integer, non-integral result -> exactly 1 decimal, at any
  // magnitude.
  describe("fmtTargetValue (via formattedRange) — one-decimal-or-integer rule", () => {
    function rangeOf(start: number, final: number, units = "mi"): string {
      const { rows } = buildEvidenceRows([target({ metric: "m", met: true, start, final, units })], 6);
      return rows[0]!.formattedRange;
    }

    it("5.9 -> 6.3 mi: non-integral values keep exactly one decimal", () => {
      expect(rangeOf(5.9, 6.3)).toBe("5.9 → 6.3 mi");
    });

    it("159.2 -> 154.8 lb: one decimal preserved at 3-digit magnitude", () => {
      expect(rangeOf(159.2, 154.8, "lb")).toBe("159.2 → 154.8 lb");
    });

    it("155 (clean integer) never grows a trailing .0", () => {
      expect(rangeOf(159, 155, "lb")).toBe("159 → 155 lb");
    });

    it("405 stays a plain integer, no decimal", () => {
      expect(rangeOf(0, 405, "reps")).toBe("0 → 405 reps");
    });

    it("36102 gets a locale comma separator, still no decimal", () => {
      expect(rangeOf(12000, 36102, "lb")).toBe("12,000 → 36,102 lb");
    });

    it("0 renders as a plain integer", () => {
      expect(rangeOf(0, 0, "reps")).toBe("0 → 0 reps");
    });

    it("5.95 rounds to 1 decimal first (6.0), which is integral -> renders as the integer 6", () => {
      expect(rangeOf(0, 5.95, "mi")).toBe("0 → 6 mi");
    });
  });

  it("7/9-met fixture (Elbert): naive met-first cap-6 would hide BOTH misses — reserve rule shows the first one", () => {
    const met = Array.from({ length: 7 }, (_, i) => target({ metric: `met-${i}`, met: true }));
    const missed = [target({ metric: "missed-A", met: false }), target({ metric: "missed-B", met: false })];
    const targets = [...met, ...missed];

    const { rows, hiddenCount } = buildEvidenceRows(targets, 6);

    expect(rows).toHaveLength(6);
    // First 5 met rows kept, 6th slot is the FIRST miss (missed-A), not a 6th met row.
    expect(rows.map((r) => r.target.metric)).toEqual([
      "met-0",
      "met-1",
      "met-2",
      "met-3",
      "met-4",
      "missed-A",
    ]);
    // hiddenCount unaffected by the swap — still exactly "how many didn't fit."
    expect(hiddenCount).toBe(3); // met-5, met-6, missed-B
  });

  it("does not reserve a slot when a miss already survived the naive cap on its own", () => {
    // 3 met + 3 missed, cap 4: naive met-first slice(0,4) = [met,met,met,missed-A] — already has a miss.
    const met = Array.from({ length: 3 }, (_, i) => target({ metric: `met-${i}`, met: true }));
    const missed = Array.from({ length: 3 }, (_, i) => target({ metric: `missed-${i}`, met: false }));
    const { rows, hiddenCount } = buildEvidenceRows([...met, ...missed], 4);

    expect(rows.map((r) => r.target.metric)).toEqual(["met-0", "met-1", "met-2", "missed-0"]);
    expect(hiddenCount).toBe(2);
  });

  it("all targets met, more than cap -> no reserve triggers (no misses to reserve for)", () => {
    const met = Array.from({ length: 8 }, (_, i) => target({ metric: `met-${i}`, met: true }));
    const { rows, hiddenCount } = buildEvidenceRows(met, 6);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.target.met)).toBe(true);
    expect(hiddenCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────
// shouldBurnToken
// ─────────────────────────────────────────────────────────

describe("shouldBurnToken", () => {
  it("visible + not burned -> true", () => {
    expect(shouldBurnToken("visible", false)).toBe(true);
  });

  it("visible + already burned -> false", () => {
    expect(shouldBurnToken("visible", true)).toBe(false);
  });

  it("hidden + not burned -> false (never write while the tab is hidden)", () => {
    expect(shouldBurnToken("hidden", false)).toBe(false);
  });

  it("hidden + already burned -> false", () => {
    expect(shouldBurnToken("hidden", true)).toBe(false);
  });

  it("any non-'visible' string (e.g. 'prerender') -> false", () => {
    expect(shouldBurnToken("prerender", false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// Honest-copy helpers
// ─────────────────────────────────────────────────────────

describe("readinessSeriesHint — resolves the readinessSeries===null ambiguity (§8.5)", () => {
  it("zero-target goal gets the honest 'no measurable targets' copy, not the misleading reopen hint", () => {
    expect(readinessSeriesHint(0)).toMatch(/no measurable targets/i);
    expect(readinessSeriesHint(0)).not.toMatch(/reopen/i);
  });

  it("goal with targets (legacy pre-freeze row) gets the reopen-and-recomplete hint", () => {
    expect(readinessSeriesHint(5)).toMatch(/reopen/i);
  });
});

describe("READINESS_FRAMING", () => {
  it("is the exact §8.5 framing noun — never implies raw fitness", () => {
    expect(READINESS_FRAMING).toBe("weighted progress across your targets");
  });
});

describe("ZERO_TARGET_EVIDENCE_SENTENCE — REQ-003 Marker-floor WHAT MOVED copy", () => {
  it("is a non-empty, non-apologetic honest sentence", () => {
    expect(ZERO_TARGET_EVIDENCE_SENTENCE.length).toBeGreaterThan(0);
    expect(ZERO_TARGET_EVIDENCE_SENTENCE).toMatch(/no numeric targets/i);
    expect(ZERO_TARGET_EVIDENCE_SENTENCE).not.toMatch(/sorry|amazing|great job/i);
  });
});
