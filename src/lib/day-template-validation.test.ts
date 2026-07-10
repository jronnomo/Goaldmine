// src/lib/day-template-validation.test.ts
//
// Unit tests for the shared DayTemplate validators + the audible-with-baselines
// guard (#234). All three functions are pure (no DB, no mocks) — assertValidDayTemplate
// and assertDayTemplateWithinSize already backed applyDayOverrideCore (MCP path);
// assertBaselineDecisionMade is NEW here — its first-ever behavioral coverage,
// extracted from the inline guard that used to live only in tools.ts.

import { describe, expect, it } from "vitest";
import {
  MAX_DAY_TEMPLATE_BYTES,
  assertBaselineDecisionMade,
  assertDayTemplateWithinSize,
  assertValidDayTemplate,
} from "@/lib/day-template-validation";

const VALID_TEMPLATE = {
  dayOfWeek: 2,
  title: "Lower A",
  category: "lower",
  summary: "Lower body strength",
  blocks: [
    {
      type: "straight",
      exercises: [{ name: "Back Squat", sets: 4, reps: "6-8" }],
    },
  ],
};

describe("assertValidDayTemplate", () => {
  it("passes a well-formed DayTemplate through without throwing", () => {
    expect(() => assertValidDayTemplate(VALID_TEMPLATE)).not.toThrow();
  });

  it("passes a rest-day shape (empty blocks, no dayOfWeek/category)", () => {
    expect(() => assertValidDayTemplate({ title: "Rest", blocks: [] })).not.toThrow();
  });

  it("rejects a bare array with the object-shape message", () => {
    expect(() => assertValidDayTemplate([])).toThrowError(/must be an object \(matching DayTemplate\)/);
  });

  it("rejects a bare number", () => {
    expect(() => assertValidDayTemplate(42)).toThrowError(/must be an object/);
  });

  it("rejects null", () => {
    expect(() => assertValidDayTemplate(null)).toThrowError(/must be an object/);
  });

  it("joins multiple field errors into one message", () => {
    try {
      assertValidDayTemplate({ title: "", blocks: [{ type: "not-a-type", exercises: [{ name: "" }] }] });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain("workoutJson.title must be a non-empty string");
      expect(msg).toContain("workoutJson.blocks[0].type, if present, must be one of");
      expect(msg).toContain("workoutJson.blocks[0].exercises[0].name must be a non-empty string");
      // Errors are joined with a "- " bullet list, one throw for the whole batch.
      expect(msg.split("\n  - ").length).toBeGreaterThanOrEqual(3);
    }
  });

  it("rejects an exercise missing a name inside a nested block", () => {
    expect(() =>
      assertValidDayTemplate({
        title: "X",
        blocks: [{ exercises: [{ sets: 3 }] }],
      }),
    ).toThrowError(/exercises\[0\]\.name must be a non-empty string/);
  });

  it("rejects an out-of-range dayOfWeek when present", () => {
    expect(() => assertValidDayTemplate({ ...VALID_TEMPLATE, dayOfWeek: 9 })).toThrowError(
      /dayOfWeek, if present, must be an integer 1\.\.7/,
    );
  });

  it("rejects an unknown category when present", () => {
    expect(() => assertValidDayTemplate({ ...VALID_TEMPLATE, category: "made-up" })).toThrowError(
      /category, if present, must be one of/,
    );
  });
});

describe("assertDayTemplateWithinSize", () => {
  it("passes a real-sized DayTemplate (2-8KB range) through without throwing", () => {
    expect(() => assertDayTemplateWithinSize(VALID_TEMPLATE)).not.toThrow();
  });

  it("passes a payload exactly at the boundary", () => {
    // Build a string-valued field that lands stringified length exactly at the cap.
    const padTarget = MAX_DAY_TEMPLATE_BYTES;
    const base = { title: "" };
    const overheadLen = JSON.stringify(base).length; // {"title":""}
    const padLen = padTarget - overheadLen;
    const payload = { title: "x".repeat(padLen) };
    expect(JSON.stringify(payload).length).toBe(padTarget);
    expect(() => assertDayTemplateWithinSize(payload)).not.toThrow();
  });

  it("rejects a payload one byte over the boundary", () => {
    const padTarget = MAX_DAY_TEMPLATE_BYTES + 1;
    const base = { title: "" };
    const overheadLen = JSON.stringify(base).length;
    const padLen = padTarget - overheadLen;
    const payload = { title: "x".repeat(padLen) };
    expect(JSON.stringify(payload).length).toBe(padTarget);
    expect(() => assertDayTemplateWithinSize(payload)).toThrowError(/over the 65,536-byte limit/);
  });

  it("rejects a >64KB blob with a byte-count message", () => {
    const huge = { title: "x".repeat(200 * 1024) };
    expect(() => assertDayTemplateWithinSize(huge)).toThrowError(/workoutJson is .* bytes after JSON\.stringify/);
  });

  it("rejects a circular structure with a serialization message", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const circular: any = { title: "X" };
    circular.self = circular;
    expect(() => assertDayTemplateWithinSize(circular)).toThrowError(/could not be serialized to JSON/);
  });
});

describe("assertBaselineDecisionMade", () => {
  const base = {
    settingWorkout: true,
    baselineInputProvided: false,
    existingBaselineTestNames: undefined as unknown,
    rotationBaselineNames: ["Pull-Up Max Reps", "Plank Max Hold"],
    dateKey: "2026-07-10",
  };

  it("fires when setting a workout, no decision provided, no prior decision, rotation has baselines", () => {
    expect(() => assertBaselineDecisionMade(base)).toThrowError(
      /Audible on 2026-07-10 touches the workout but didn't make a baseline decision/,
    );
  });

  it("throws the message verbatim, including rotation names and the coach-voice closer", () => {
    try {
      assertBaselineDecisionMade(base);
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toBe(
        "Audible on 2026-07-10 touches the workout but didn't make a baseline decision. " +
          "Rotation default for this date: [Pull-Up Max Reps, Plank Max Hold]. " +
          "Re-pass baselineTestNames explicitly: same list to keep them, [] to suppress, or a different set to swap. " +
          "Don't punt this to the UI — own the call.",
      );
    }
  });

  it("is silent when not setting a workout (clearing / never touched)", () => {
    expect(() => assertBaselineDecisionMade({ ...base, settingWorkout: false })).not.toThrow();
  });

  it("is silent when a baselineTestNames decision is provided in this call", () => {
    expect(() => assertBaselineDecisionMade({ ...base, baselineInputProvided: true })).not.toThrow();
  });

  it("is silent when a decision is already on file (existing override has an array, even empty)", () => {
    expect(() => assertBaselineDecisionMade({ ...base, existingBaselineTestNames: [] })).not.toThrow();
    expect(() =>
      assertBaselineDecisionMade({ ...base, existingBaselineTestNames: ["Plank Max Hold"] }),
    ).not.toThrow();
  });

  it("is silent when the rotation default has no baselines for this date", () => {
    expect(() => assertBaselineDecisionMade({ ...base, rotationBaselineNames: [] })).not.toThrow();
  });

  it("does not treat a non-array existing value (null/undefined) as a decision on file", () => {
    expect(() => assertBaselineDecisionMade({ ...base, existingBaselineTestNames: null })).toThrow();
    expect(() => assertBaselineDecisionMade({ ...base, existingBaselineTestNames: undefined })).toThrow();
  });
});
