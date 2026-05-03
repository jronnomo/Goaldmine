// Validation for ProgramTemplate snapshots before they're written to Plan.planJson.
// We only enforce the structural shape — content (e.g., specific exercises) is
// the user's prerogative.

import type { ProgramTemplate } from "@/lib/program-template";

export type ValidationError = string;

export function validateProgramTemplate(value: unknown): {
  ok: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(
      "snapshotJson must be an object (matching ProgramTemplate). " +
        "Common mistake: passing a JSON-stringified template — pass the parsed object.",
    );
    return { ok: false, errors };
  }

  const v = value as Record<string, unknown>;

  if (typeof v.name !== "string") errors.push("missing string field: name");
  if (typeof v.totalWeeks !== "number") errors.push("missing number field: totalWeeks");
  if (!Array.isArray(v.phases) || v.phases.length === 0) {
    errors.push("missing or empty array: phases");
  } else {
    v.phases.forEach((p, i) => {
      if (typeof p !== "object" || p === null) errors.push(`phases[${i}] not an object`);
      else {
        const ph = p as Record<string, unknown>;
        if (typeof ph.index !== "number") errors.push(`phases[${i}].index missing`);
        if (typeof ph.name !== "string") errors.push(`phases[${i}].name missing`);
        if (!Array.isArray(ph.weeks) || ph.weeks.length === 0)
          errors.push(`phases[${i}].weeks must be a non-empty array`);
        if (typeof ph.nutrition !== "object" || ph.nutrition === null)
          errors.push(`phases[${i}].nutrition missing`);
        if (typeof ph.mobility !== "object" || ph.mobility === null)
          errors.push(`phases[${i}].mobility missing`);
      }
    });
  }
  if (!Array.isArray(v.weeklySplit) || v.weeklySplit.length !== 7) {
    errors.push("weeklySplit must be an array of exactly 7 days");
  } else {
    v.weeklySplit.forEach((d, i) => {
      if (typeof d !== "object" || d === null) errors.push(`weeklySplit[${i}] not an object`);
      else {
        const day = d as Record<string, unknown>;
        if (typeof day.dayOfWeek !== "number" || day.dayOfWeek < 1 || day.dayOfWeek > 7)
          errors.push(`weeklySplit[${i}].dayOfWeek must be 1..7`);
        if (typeof day.title !== "string") errors.push(`weeklySplit[${i}].title missing`);
        if (!Array.isArray(day.blocks)) errors.push(`weeklySplit[${i}].blocks must be an array`);
      }
    });
    const dows = (v.weeklySplit as Array<Record<string, unknown>>).map((d) => d.dayOfWeek);
    const seen = new Set(dows);
    if (seen.size !== 7) errors.push("weeklySplit must cover dayOfWeek 1..7 exactly once");
  }
  if (!Array.isArray(v.baselineWeek)) errors.push("baselineWeek must be an array");
  if (typeof v.dailyMobility !== "object" || v.dailyMobility === null) {
    errors.push("dailyMobility must be an object");
  } else {
    const dm = v.dailyMobility as Record<string, unknown>;
    if (!Array.isArray(dm.exercises)) errors.push("dailyMobility.exercises must be an array");
  }
  if (typeof v.hikingSuperset !== "object" || v.hikingSuperset === null)
    errors.push("hikingSuperset must be an object");

  return { ok: errors.length === 0, errors };
}

export function assertValidProgramTemplate(value: unknown): asserts value is ProgramTemplate {
  const r = validateProgramTemplate(value);
  if (!r.ok) {
    throw new Error(
      `Invalid ProgramTemplate snapshot:\n  - ${r.errors.join("\n  - ")}\n\n` +
        `Pass the *full* ProgramTemplate as a plain object. Reference shape: ` +
        `{ name, totalWeeks, phases[], weeklySplit[7], baselineWeek[], dailyMobility, hikingSuperset, goals[] }.`,
    );
  }
}
