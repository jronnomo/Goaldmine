import { describe, it, expect } from "vitest";
import {
  blockTypeLabel,
  formatSecs,
  compactPrescription,
  prescriptionRight,
} from "@/lib/plan-format";
import type { ExercisePrescription } from "@/lib/program-template";

describe("formatSecs", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatSecs(45)).toBe("45s");
  });

  it("formats exact minutes as 'N min'", () => {
    expect(formatSecs(60)).toBe("1 min");
  });

  it("formats minute + remainder as m:ss", () => {
    expect(formatSecs(90)).toBe("1:30");
  });

  it("formats exact multi-minute durations as 'N min'", () => {
    expect(formatSecs(120)).toBe("2 min");
  });
});

describe("blockTypeLabel", () => {
  it("covers all five block type arms", () => {
    expect(blockTypeLabel("straight")).toBe("Straight sets");
    expect(blockTypeLabel("superset")).toBe("Superset");
    expect(blockTypeLabel("finisher")).toBe("Finisher");
    expect(blockTypeLabel("mobility")).toBe("Mobility");
    expect(blockTypeLabel("cardio")).toBe("Cardio");
  });
});

describe("compactPrescription vs prescriptionRight fallback", () => {
  it("compactPrescription falls back to an em-dash when empty", () => {
    const ex = { name: "Rest" } as ExercisePrescription;
    expect(compactPrescription(ex)).toBe("—");
  });

  it("prescriptionRight falls back to an empty string when empty", () => {
    const ex = { name: "Rest" } as ExercisePrescription;
    expect(prescriptionRight(ex)).toBe("");
  });
});

describe("prescriptionParts composition (via compactPrescription)", () => {
  it("renders sets only", () => {
    const ex = { name: "Squat", sets: 3 } as ExercisePrescription;
    expect(compactPrescription(ex)).toBe("3×");
  });

  it("omits sets when sets is 0 (truthy check, not undefined check)", () => {
    const ex = { name: "Squat", sets: 0, reps: 8 } as ExercisePrescription;
    expect(compactPrescription(ex)).toBe("8");
  });

  it("preserves a string reps prescription verbatim", () => {
    const ex = { name: "Squat", reps: "8-10" } as ExercisePrescription;
    expect(compactPrescription(ex)).toBe("8-10");
  });

  it("joins sets + reps + duration with single spaces", () => {
    const ex = { name: "Plank", sets: 3, reps: 8, durationSec: 90 } as ExercisePrescription;
    expect(compactPrescription(ex)).toBe("3× 8 1:30");
  });
});
