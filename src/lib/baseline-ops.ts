// Surgical ops for editing a plan's baselineWeek tests without re-emitting the
// whole ProgramTemplate. Mirrors nutrition-log-ops.ts / day-template-ops.ts.
//
// Pure transform — accepts the current baselineWeek array + an ops array,
// returns a new baselineWeek plus a change log. The caller (the baseline_ops
// MCP tool) handles the fetch / lint / PlanRevision write. Baseline tests are
// template-level (the schedule derives checkpoints from initialWeek/retestWeeks),
// so writing the patched template to Plan.planJson is enough — no calendar
// cascade is needed, unlike date overrides.

import { z } from "zod";
import type { BaselineDay, BaselineTest } from "@/lib/program-template";

// Select a baseline day by dayOfWeek (1-7) or a case-insensitive substring of
// its title (must match exactly one day).
const DaySelectorShape = z
  .union([z.number().int().min(1).max(7), z.string().min(1)])
  .describe("Baseline day — dayOfWeek 1-7, or a case-insensitive substring of the day title (must match exactly one day).");

// Match a test by 0-based index (within a day — requires `day`) or by
// case-insensitive substring against testName.
const TestMatchShape = z.union([z.string().min(1), z.number().int().min(0)]);

// Shared field shapes. addTest requires the full set (retestWeeks may be [] for
// a one-shot baseline with no retest); updateTest uses the partial form so an
// omitted field is left unchanged.
const BaselineTestFields = {
  testName: z.string().min(1),
  units: z.string().min(1),
  protocol: z.string().min(1),
  initialWeek: z.number().int().min(1).optional(),
  retestWeeks: z.array(z.number().int().min(1)),
  signed: z.boolean().optional(),
};
const BaselineTestInputShape = z.object(BaselineTestFields);
const BaselineTestPatchShape = z.object(BaselineTestFields).partial();

const AddTestOp = z.object({
  op: z.literal("addTest"),
  day: DaySelectorShape,
  test: BaselineTestInputShape,
  at: z
    .union([z.enum(["end", "start"]), z.number().int().min(0)])
    .optional()
    .describe("Position within the day's tests: 'end' (default), 'start', or a 0-based index."),
});

const UpdateTestOp = z.object({
  op: z.literal("updateTest"),
  day: DaySelectorShape.optional().describe(
    "Optional — scope the match to one day. Omit to search all days (match must then be unique).",
  ),
  match: TestMatchShape.describe(
    "Which test to update — case-insensitive substring against testName, or a 0-based index (index requires `day`). Substring must match exactly one test.",
  ),
  patch: BaselineTestPatchShape.describe(
    "Fields to overwrite on the matched test. Pass only what changes; omitted fields are preserved.",
  ),
});

const RemoveTestOp = z.object({
  op: z.literal("removeTest"),
  day: DaySelectorShape.optional().describe(
    "Optional — scope the match to one day. Omit to search all days (match must then be unique).",
  ),
  match: TestMatchShape.describe(
    "Which test to remove — case-insensitive substring against testName, or a 0-based index (index requires `day`). Substring must match exactly one test.",
  ),
});

export const BaselineOpSchema = z.discriminatedUnion("op", [AddTestOp, UpdateTestOp, RemoveTestOp]);
export type BaselineOp = z.infer<typeof BaselineOpSchema>;

export type BaselineChange = {
  op: "addTest" | "updateTest" | "removeTest";
  dayOfWeek: number;
  testName: string;
};

// Resolve a DaySelector to an index into the baselineWeek array.
function resolveDayIndex(week: BaselineDay[], day: number | string, opIndex: number): number {
  const avail = () => week.map((d) => `${d.dayOfWeek}: ${d.title}`).join(", ");
  if (typeof day === "number") {
    const idx = week.findIndex((d) => d.dayOfWeek === day);
    if (idx === -1) {
      throw new Error(`ops[${opIndex}]: no baseline day with dayOfWeek ${day}. Days: [${avail()}].`);
    }
    return idx;
  }
  const needle = day.toLowerCase();
  const hits = week.map((d, i) => ({ d, i })).filter(({ d }) => d.title.toLowerCase().includes(needle));
  if (hits.length === 0) {
    throw new Error(`ops[${opIndex}]: no baseline day title matching "${day}". Days: [${avail()}].`);
  }
  if (hits.length > 1) {
    const where = hits.map((h) => `${h.d.dayOfWeek}: ${h.d.title}`).join(", ");
    throw new Error(
      `ops[${opIndex}]: "${day}" matched ${hits.length} days (${where}). Use the dayOfWeek number or a more specific title.`,
    );
  }
  return hits[0]!.i;
}

// Resolve a (day?, match) pair to a concrete (dayIdx, testIdx).
function findTest(
  week: BaselineDay[],
  day: number | string | undefined,
  match: string | number,
  opIndex: number,
): { dayIdx: number; testIdx: number } {
  if (typeof match === "number") {
    if (day === undefined) {
      throw new Error(
        `ops[${opIndex}]: a numeric match (index ${match}) needs a day so the index is unambiguous. Pass day, or match by testName substring.`,
      );
    }
    const dayIdx = resolveDayIndex(week, day, opIndex);
    const tests = week[dayIdx]!.tests;
    if (match < 0 || match >= tests.length) {
      throw new Error(
        `ops[${opIndex}]: index ${match} is out of range (day ${week[dayIdx]!.dayOfWeek} has ${tests.length} test${tests.length === 1 ? "" : "s"}).`,
      );
    }
    return { dayIdx, testIdx: match };
  }
  const scope = day !== undefined ? [resolveDayIndex(week, day, opIndex)] : week.map((_, i) => i);
  const needle = match.toLowerCase();
  const hits: { dayIdx: number; testIdx: number; name: string; dow: number }[] = [];
  for (const di of scope) {
    week[di]!.tests.forEach((t, ti) => {
      if (t.testName.toLowerCase().includes(needle)) {
        hits.push({ dayIdx: di, testIdx: ti, name: t.testName, dow: week[di]!.dayOfWeek });
      }
    });
  }
  if (hits.length === 0) {
    throw new Error(
      `ops[${opIndex}]: no baseline test matching "${match}"${day !== undefined ? " on the selected day" : ""}.`,
    );
  }
  if (hits.length > 1) {
    const where = hits.map((h) => `day ${h.dow}/${h.name}`).join(", ");
    throw new Error(
      `ops[${opIndex}]: "${match}" matched ${hits.length} tests (${where}). Add a day or use a more specific substring.`,
    );
  }
  return { dayIdx: hits[0]!.dayIdx, testIdx: hits[0]!.testIdx };
}

// Build a BaselineTest from validated input, dropping undefined optionals so the
// stored JSON stays clean (no `initialWeek: undefined`).
function buildTest(input: z.infer<typeof BaselineTestInputShape>): BaselineTest {
  return {
    testName: input.testName,
    units: input.units,
    protocol: input.protocol,
    retestWeeks: input.retestWeeks,
    ...(input.initialWeek !== undefined ? { initialWeek: input.initialWeek } : {}),
    ...(input.signed !== undefined ? { signed: input.signed } : {}),
  };
}

// Apply ops sequentially to a deep clone of the input baselineWeek. Each op sees
// the result of prior ops. Throws on the first op that can't be applied; the
// caller never sees a half-applied result.
export function applyBaselineOps(
  base: BaselineDay[],
  ops: BaselineOp[],
): { baselineWeek: BaselineDay[]; changes: BaselineChange[] } {
  if (ops.length === 0) {
    throw new Error("ops was empty — pass at least one operation.");
  }
  const working: BaselineDay[] = base.map((d) => ({ ...d, tests: d.tests.map((t) => ({ ...t })) }));
  const changes: BaselineChange[] = [];

  ops.forEach((op, i) => {
    switch (op.op) {
      case "addTest": {
        const dayIdx = resolveDayIndex(working, op.day, i);
        const day = working[dayIdx]!;
        const dup = day.tests.some((t) => t.testName.toLowerCase() === op.test.testName.toLowerCase());
        if (dup) {
          throw new Error(
            `ops[${i}]: day ${day.dayOfWeek} already has a test named "${op.test.testName}". Use updateTest to change it.`,
          );
        }
        const test = buildTest(op.test);
        if (op.at === "start") {
          day.tests.unshift(test);
        } else if (typeof op.at === "number") {
          if (op.at < 0 || op.at > day.tests.length) {
            throw new Error(
              `ops[${i}]: position ${op.at} is out of range (day has ${day.tests.length} test${day.tests.length === 1 ? "" : "s"}; valid 0..${day.tests.length}).`,
            );
          }
          day.tests.splice(op.at, 0, test);
        } else {
          day.tests.push(test);
        }
        changes.push({ op: "addTest", dayOfWeek: day.dayOfWeek, testName: test.testName });
        break;
      }
      case "updateTest": {
        const { dayIdx, testIdx } = findTest(working, op.day, op.match, i);
        const day = working[dayIdx]!;
        const prev = day.tests[testIdx]!;
        const renaming =
          op.patch.testName !== undefined && op.patch.testName.toLowerCase() !== prev.testName.toLowerCase();
        if (renaming) {
          const dup = day.tests.some(
            (t, ti) => ti !== testIdx && t.testName.toLowerCase() === op.patch.testName!.toLowerCase(),
          );
          if (dup) {
            throw new Error(`ops[${i}]: day ${day.dayOfWeek} already has a test named "${op.patch.testName}".`);
          }
        }
        const merged: BaselineTest = { ...prev, ...op.patch };
        day.tests[testIdx] = merged;
        changes.push({ op: "updateTest", dayOfWeek: day.dayOfWeek, testName: merged.testName });
        break;
      }
      case "removeTest": {
        const { dayIdx, testIdx } = findTest(working, op.day, op.match, i);
        const day = working[dayIdx]!;
        const [removed] = day.tests.splice(testIdx, 1);
        changes.push({ op: "removeTest", dayOfWeek: day.dayOfWeek, testName: removed!.testName });
        break;
      }
    }
  });

  return { baselineWeek: working, changes };
}

// One-line audit summary for the PlanRevision when the caller didn't supply one.
export function summarizeBaselineChanges(changes: BaselineChange[]): string {
  const sign = { addTest: "+", updateTest: "~", removeTest: "−" } as const;
  const parts = changes.map((c) => `${sign[c.op]}${c.testName} (d${c.dayOfWeek})`);
  const s = `Baseline: ${parts.join(", ")}`;
  return s.length <= 200 ? s : `${s.slice(0, 197)}...`;
}
