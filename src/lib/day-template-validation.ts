// Soft structural validation for a DayTemplate before it lands in
// PlanDayOverride.workoutJson. Catches the malformations that produce opaque
// failures downstream (Prisma writes, calendar rendering, /days/[dateKey]
// page) and surfaces a field-level error message so the coach can fix the
// payload instead of guessing.
//
// Deliberately permissive about content (exercise names, weight hints, etc.
// are the user's prerogative) — only checks structural invariants the rest
// of the codebase relies on.

import type { DayTemplate } from "@/lib/program-template";

export type ValidationError = string;

// Caller-visible payload-size cap on workoutJson. Real DayTemplates are
// 2–8KB after stringification; 64KB is a generous ceiling that still rules
// out runaway accidental payloads (full plan snapshot pasted in by mistake,
// circular-ish structure, etc.). Keeping this in code (not env) so behavior
// is reproducible.
export const MAX_DAY_TEMPLATE_BYTES = 64 * 1024;

const ALLOWED_BLOCK_TYPES = new Set([
  "straight",
  "superset",
  "finisher",
  "mobility",
  "cardio",
]);

const ALLOWED_CATEGORIES = new Set([
  "upper",
  "lower",
  "zone2-mobility",
  "calisthenics",
  "lower-power",
  "long-endurance",
  "rest",
]);

export function validateDayTemplate(value: unknown): {
  ok: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(
      "workoutJson must be an object (matching DayTemplate). " +
        "Common mistake: passing a JSON-stringified template — pass the parsed object.",
    );
    return { ok: false, errors };
  }

  const v = value as Record<string, unknown>;

  if (typeof v.title !== "string" || v.title.length === 0) {
    errors.push("workoutJson.title must be a non-empty string");
  }

  // dayOfWeek and category are optional in practice (older overrides omitted
  // them); validate only if present.
  if (v.dayOfWeek !== undefined) {
    if (
      typeof v.dayOfWeek !== "number" ||
      !Number.isInteger(v.dayOfWeek) ||
      v.dayOfWeek < 1 ||
      v.dayOfWeek > 7
    ) {
      errors.push("workoutJson.dayOfWeek, if present, must be an integer 1..7");
    }
  }
  if (v.category !== undefined) {
    if (typeof v.category !== "string" || !ALLOWED_CATEGORIES.has(v.category)) {
      errors.push(
        `workoutJson.category, if present, must be one of: ${[...ALLOWED_CATEGORIES].join(", ")}`,
      );
    }
  }

  if (!Array.isArray(v.blocks)) {
    errors.push("workoutJson.blocks must be an array (use [] for a rest day)");
  } else {
    v.blocks.forEach((b, i) => {
      if (typeof b !== "object" || b === null || Array.isArray(b)) {
        errors.push(`workoutJson.blocks[${i}] must be an object`);
        return;
      }
      const block = b as Record<string, unknown>;
      if (block.type !== undefined && (typeof block.type !== "string" || !ALLOWED_BLOCK_TYPES.has(block.type))) {
        errors.push(
          `workoutJson.blocks[${i}].type, if present, must be one of: ${[...ALLOWED_BLOCK_TYPES].join(", ")}`,
        );
      }
      if (!Array.isArray(block.exercises)) {
        errors.push(`workoutJson.blocks[${i}].exercises must be an array`);
      } else {
        block.exercises.forEach((ex, j) => {
          if (typeof ex !== "object" || ex === null || Array.isArray(ex)) {
            errors.push(`workoutJson.blocks[${i}].exercises[${j}] must be an object`);
            return;
          }
          const exr = ex as Record<string, unknown>;
          if (typeof exr.name !== "string" || exr.name.length === 0) {
            errors.push(
              `workoutJson.blocks[${i}].exercises[${j}].name must be a non-empty string`,
            );
          }
        });
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidDayTemplate(value: unknown): asserts value is DayTemplate {
  const r = validateDayTemplate(value);
  if (!r.ok) {
    throw new Error(
      `Invalid workoutJson (DayTemplate). Fix these fields, then retry:\n  - ${r.errors.join("\n  - ")}\n\n` +
        `Reference shape: { title: string, dayOfWeek?: 1..7, category?: enum, blocks: [{ type?: enum, exercises: [{ name: string, … }] }] }.`,
    );
  }
}

// Throws with an explicit byte count + limit message if the payload is too
// large. JSON.stringify can itself throw on circular references — we let
// that propagate (Error message names the cycle, which is the actionable
// diagnostic) but catch it here to add a "workoutJson:" prefix so the user
// knows which field is at fault.
export function assertDayTemplateWithinSize(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (e) {
    throw new Error(
      `workoutJson could not be serialized to JSON: ${e instanceof Error ? e.message : String(e)}. ` +
        `Most often this is a circular reference. Pass a plain object with no back-references.`,
    );
  }
  if (serialized.length > MAX_DAY_TEMPLATE_BYTES) {
    throw new Error(
      `workoutJson is ${serialized.length.toLocaleString()} bytes after JSON.stringify, ` +
        `over the ${MAX_DAY_TEMPLATE_BYTES.toLocaleString()}-byte limit. ` +
        `Real DayTemplates are 2–8KB; this is ${Math.round(serialized.length / 1024)}KB. ` +
        `Likely causes: pasted a full plan snapshot instead of one day, duplicated blocks, ` +
        `or pathologically long notes/weightHints. Trim and retry.`,
    );
  }
}

// Audible-with-baselines guard, shared by the MCP write path
// (applyDayOverrideCore) and the dashboard form write path (day-actions.ts).
// Pure — callers own the DB read (existing override row) and the rotation
// lookup (rotationBaselineNamesForDate); this function only decides whether
// to throw and what to say.
//
// Fires only when ALL of:
// - the caller is SETTING a new workout (settingWorkout)
// - no baselineTestNames decision is in scope for this call (!baselineInputProvided)
// - no prior decision is already on file for this date (existing override's
//   baselineTestNames isn't an array — Array.isArray, not just non-null, since
//   a decision-on-file is stored as a JSON array, possibly empty ([] = "no tests"))
// - the rotation default actually has baselines for this date (otherwise there's
//   nothing to silently drop)
//
// Message is VERBATIM from the pre-extraction inline guard (tools.ts:314-318) —
// keep the coach voice ("Don't punt this to the UI — own the call.") intact.
// #235 adds a dashboard-native baselineTestNames affordance later; until then
// this is the correct (if blunt) stopgap for the form path too.
export function assertBaselineDecisionMade(args: {
  settingWorkout: boolean;
  baselineInputProvided: boolean;
  existingBaselineTestNames: unknown;
  rotationBaselineNames: string[];
  dateKey: string;
}): void {
  const { settingWorkout, baselineInputProvided, existingBaselineTestNames, rotationBaselineNames, dateKey } = args;
  if (!settingWorkout || baselineInputProvided) return;
  if (Array.isArray(existingBaselineTestNames)) return;
  if (rotationBaselineNames.length === 0) return;

  throw new Error(
    `Audible on ${dateKey} touches the workout but didn't make a baseline decision. ` +
      `Rotation default for this date: [${rotationBaselineNames.join(", ")}]. ` +
      `Re-pass baselineTestNames explicitly: same list to keep them, [] to suppress, or a different set to swap. ` +
      `Don't punt this to the UI — own the call.`,
  );
}
