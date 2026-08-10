// src/lib/readiness-copy.test.ts
//
// #290 — the three gate copy states at the rawScore/ceiling boundary
// (research §4.2 table, binding; §7.8 test 3). Pure function, no mocks.

import { describe, it, expect } from "vitest";
import { gateCopyState, GATE_FRAMING_LINE } from "@/lib/readiness-copy";

describe("gateCopyState", () => {
  it("HELD: open gates + rawScore above the ceiling — capped reads as CAPPED, with the raw number shown", () => {
    const copy = gateCopyState({ rawScore: 91, ceiling: 80, openGateCount: 2 });
    expect(copy.state).toBe("held");
    expect(copy.eyebrow).toBe("HELD AT 80");
    expect(copy.body).toBe(
      "Your work adds up to 91 — the ceiling holds it at 80 until both gates clear.",
    );
  });

  it("HELD with one gate uses the singular phrase", () => {
    const copy = gateCopyState({ rawScore: 85, ceiling: 80, openGateCount: 1 });
    expect(copy.body).toContain("until the gate clears.");
  });

  it("HELD with 3+ gates counts them", () => {
    const copy = gateCopyState({ rawScore: 95, ceiling: 80, openGateCount: 3 });
    expect(copy.body).toContain("until all 3 gates clear.");
  });

  it("OPEN-NOT-BINDING: open gates but rawScore at/below the ceiling — taught while still free", () => {
    const copy = gateCopyState({ rawScore: 62, ceiling: 80, openGateCount: 2 });
    expect(copy.state).toBe("open");
    expect(copy.eyebrow).toBeNull();
    expect(copy.body).toBe("2 gates to clear before this can pass 80.");
  });

  it("boundary: rawScore === ceiling is still OPEN, not HELD (the cap has not bitten yet)", () => {
    const copy = gateCopyState({ rawScore: 80, ceiling: 80, openGateCount: 1 });
    expect(copy.state).toBe("open");
    expect(copy.body).toBe("1 gate to clear before this can pass 80.");
  });

  it("boundary: rawScore one above the ceiling flips to HELD", () => {
    const copy = gateCopyState({ rawScore: 81, ceiling: 80, openGateCount: 1 });
    expect(copy.state).toBe("held");
  });

  it("CLEAR: zero open gates", () => {
    const copy = gateCopyState({ rawScore: 91, ceiling: 100, openGateCount: 0 });
    expect(copy.state).toBe("clear");
    expect(copy.eyebrow).toBeNull();
    expect(copy.body).toBe("All gates cleared.");
  });

  it("tone rules: never 'blocked', no padlock — and the framing line names the covenant", () => {
    for (const snap of [
      { rawScore: 91, ceiling: 80, openGateCount: 2 },
      { rawScore: 62, ceiling: 80, openGateCount: 2 },
      { rawScore: 91, ceiling: 100, openGateCount: 0 },
    ]) {
      const copy = gateCopyState(snap);
      expect(copy.body.toLowerCase()).not.toContain("blocked");
      expect(copy.body).not.toContain("🔒");
    }
    expect(GATE_FRAMING_LINE).toBe(
      "Gates are mastery checks — the score waits for them, it doesn't lose points.",
    );
  });
});
