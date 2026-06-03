// Tools registered on the MCP server. Pure read/write — no LLM calls.
// Each tool returns JSON content; errors set isError on the result.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@/generated/prisma/client";
import {
  appendBaselineToDayWorkout,
  removeBaselineFromDayWorkout,
  syncBaselineUpdateToWorkout,
} from "@/lib/baseline-workout";
import {
  addDays,
  dateKey as toDateKey,
  endOfDay,
  endOfWeekSunday,
  parseDateKey,
  resolveDay,
  rotationBaselineNamesForDate,
  startOfDay,
  startOfWeekMonday,
  templateForRotationDay,
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { formatWorkout, type ExportFormat } from "@/lib/formatters";
import { createGoalCore } from "@/lib/goal-core";
import { LegendSchema } from "@/lib/legend";
import { getActiveProgram, type ActiveProgramSnapshot } from "@/lib/program";
import {
  MAX_DAY_TEMPLATE_BYTES,
  assertDayTemplateWithinSize,
  assertValidDayTemplate,
} from "@/lib/day-template-validation";
import { WorkoutJsonOpSchema, applyWorkoutJsonOps } from "@/lib/day-template-ops";
import type { DayTemplate, ProgramTemplate } from "@/lib/program-template";
import { assertValidProgramTemplate } from "@/lib/program-validation";
import { lintActivePlan, lintTemplate, type LintFinding } from "@/lib/plan-lint";
import {
  getBaselineHistory,
  getBaselineSchedule,
  getBaselineSummaries,
  getExerciseHistory,
  getExerciseSummaries,
  recordsSetInWorkout,
} from "@/lib/records";
import {
  NutritionPlanShape,
  PlannedMealMacrosShape,
  MACRO_KEYS,
  applyNutritionPlanPatch,
  parseStoredNutritionPlan,
} from "@/lib/nutrition-plan";
import {
  NutritionLogOpSchema,
  applyNutritionLogOps,
  parseStoredItems,
} from "@/lib/nutrition-log-ops";

const DateKeyShape = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
  .describe("ISO date yyyy-mm-dd in the user's local time zone");

const NoteTypeShape = z.enum(["journal", "audible", "feedback", "standing_rule", "review"]);

/** Note types surfaced by recent_history. First-class types (review, open_item,
 *  standing_rule) are excluded — they have dedicated read tools. */
const ACTIVITY_NOTE_TYPES = ["journal", "audible", "feedback"] as const;

const MealTypeShape = z.enum([
  "preworkout",
  "postworkout",
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);

const NutritionItemShape = z.object({
  name: z.string().min(1).describe("Food group / brand item, e.g. '97% beef', 'Kroger hamburger buns'"),
  qty: z.string().optional().describe("Free-form quantity, e.g. '8 oz', '1 cup', '2 slices'"),
  notes: z.string().optional(),
});

// Shared input shapes for the single-op tools below. Exposed as constants so
// the batch tools (batch_apply_day_overrides, batch_log_nutrition,
// batch_log_note) can reuse them inside an `operations` array without
// drifting from the single-op contract.
const ApplyDayOverrideShape = {
  date: DateKeyShape,
  workoutJson: z
    .unknown()
    .nullish()
    .describe(
      "Full DayTemplate to swap the day's blocks. null clears a prior workout swap; omit to leave unchanged. Mutually exclusive with workoutJsonOps.",
    ),
  workoutJsonOps: z
    .array(WorkoutJsonOpSchema)
    .min(1)
    .optional()
    .describe(
      "Surgical edits to the day's workout — addExercise / updateExercise / removeExercise. Applied against the existing override (if any) or the rotation-day template (if no override yet), so you can edit one exercise without re-emitting the full DayTemplate. Mutually exclusive with workoutJson.",
    ),
  baselineTestNames: z
    .array(z.string())
    .nullish()
    .describe(
      "Override which baseline tests show today. Empty array suppresses tests; null reverts to rotation default; omit to leave unchanged. Required when workoutJson is being set on a date with rotation-default baselines and no prior baseline decision exists.",
    ),
  nutritionText: z
    .string()
    .nullish()
    .describe(
      "Free-form day-level nutrition guidance (e.g. 'hydrate heavily', 'watch sodium'). " +
        "Use nutritionPlan for structured per-meal planning. null clears; omit to leave unchanged.",
    ),
  nutritionPlan: NutritionPlanShape
    .nullish()
    .describe(
      "Structured per-slot meal plan: { preworkout?, breakfast?, lunch?, snack?, postworkout?, dinner? }. " +
        "Each slot is { items: [{name, qty?, notes?}], macros?: {calories?, proteinG?, carbsG?, fatG?, sodiumMg?, fiberG?}, notes? }. " +
        "PATCH semantics: omit a slot to leave it unchanged, set it to null to clear that slot, pass an object to replace it. " +
        "Pass null on this whole field to clear the entire plan; omit to leave unchanged.",
    ),
  mobilityText: z
    .string()
    .nullish()
    .describe("Per-day mobility guidance. null clears; omit to leave unchanged."),
  notes: z
    .string()
    .nullish()
    .describe("Why this date diverges. null clears; omit to leave unchanged."),
} as const;
const ApplyDayOverrideSchema = z.object(ApplyDayOverrideShape);
type ApplyDayOverrideInput = z.infer<typeof ApplyDayOverrideSchema>;

const LogNoteShape = {
  body: z.string(),
  type: NoteTypeShape.default("journal"),
  targetDate: DateKeyShape.optional(),
} as const;
const LogNoteSchema = z.object(LogNoteShape);
type LogNoteInput = z.infer<typeof LogNoteSchema>;

// Shapes for workout_ops — structural edits to a logged Workout (add/remove
// exercises and sets). Editing existing rows is covered by update_workout_*.
const OpSetInputShape = z.object({
  setIndex: z.number().int().min(1).optional().describe("1-based set number within the exercise. Defaults to max+1."),
  reps: z.number().int().min(0).optional(),
  weightLb: z.number().min(0).optional(),
  durationSec: z.number().min(0).optional(),
  distanceMi: z.number().min(0).optional(),
  rpe: z.number().min(0).max(10).optional(),
  notes: z.string().optional(),
});

const AddExerciseInputShape = z.object({
  name: z.string().min(1),
  equipment: z.string().optional(),
  notes: z.string().optional(),
  orderIndex: z.number().int().min(0).optional().describe("Position in the workout's exercise list. Defaults to max+1 (append)."),
  sets: z.array(OpSetInputShape).optional().describe("Optional initial sets to create alongside the exercise. setIndex auto-numbers 1..N when omitted."),
});

const AddExerciseOpShape = z.object({
  op: z.literal("addExercise"),
  workoutId: z.string(),
  exercise: AddExerciseInputShape,
});

const RemoveExerciseOpShape = z.object({
  op: z.literal("removeExercise"),
  exerciseId: z.string().describe("WorkoutExercise.id — cascade-deletes the exercise's sets."),
});

const AddSetOpShape = z.object({
  op: z.literal("addSet"),
  workoutExerciseId: z.string(),
  set: OpSetInputShape,
});

const RemoveSetOpShape = z.object({
  op: z.literal("removeSet"),
  setId: z.string(),
});

const WorkoutOpSchema = z.discriminatedUnion("op", [
  AddExerciseOpShape,
  RemoveExerciseOpShape,
  AddSetOpShape,
  RemoveSetOpShape,
]);

const LogNutritionShape = {
  mealType: MealTypeShape,
  items: z.array(NutritionItemShape).min(1),
  notes: z.string().optional(),
  macros: PlannedMealMacrosShape.optional().describe(
    "Optional estimated macros for this meal (calories, proteinG, carbsG, fatG, fiberG, sodiumMg). Provide your best estimate from the items so the dashboard can total the day; omit any field you can't estimate.",
  ),
  date: z.string().optional().describe("ISO datetime; default = now"),
} as const;
const LogNutritionSchema = z.object(LogNutritionShape);
type LogNutritionInput = z.infer<typeof LogNutritionSchema>;

// The functional-overload of $transaction passes a stripped Prisma client (no
// $transaction/$connect/etc.). Capture that exact type so the *_Core helpers
// below can accept either the global `prisma` or a transaction client `tx`.
// Picking the second overload via Parameters<…>[0] resolves to the callback,
// then [0] grabs its first param.
type DbClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

// Bare yyyy-mm-dd is otherwise parsed as UTC midnight, which lands in
// yesterday's MT day. Treat date-only as USER_TZ midnight; full ISO strings
// are returned verbatim.
function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}

// ----------------------------------------------------------------------------
// Core write helpers. Each takes a DbClient (either the global prisma or a
// transaction client) so the single-op MCP tools and the batch_* tools can
// share one source of truth for write semantics. Inputs are the same shape
// Zod produces from the registered tool's inputSchema.
// ----------------------------------------------------------------------------

type ApplyDayOverrideResult = {
  overrideId: string | null;
  dateKey: string;
  updatedFields: string[];
  preservedFields?: string[];
  message: string;
};

async function applyDayOverrideCore(
  db: DbClient,
  program: ActiveProgramSnapshot,
  input: ApplyDayOverrideInput,
): Promise<ApplyDayOverrideResult> {
  const date = startOfDay(parseDateKey(input.date));

  // PATCH semantics: fetch existing first, merge against it, baseline-guard
  // relaxation checks whether a prior decision is already on file.
  const existing = await db.planDayOverride.findUnique({
    where: { planId_date: { planId: program.id, date } },
  });

  // Mutex: workoutJson (full replace) and workoutJsonOps (surgical edit)
  // describe two different write modes for the same field. Allowing both at
  // once would silently make one win, so we reject up front.
  if (input.workoutJson !== undefined && input.workoutJsonOps !== undefined) {
    throw new Error(
      "workoutJson and workoutJsonOps are mutually exclusive — pass workoutJson for a full replace, workoutJsonOps for surgical edits to the existing workout.",
    );
  }

  // Auto-recover: occasionally workoutJson comes in stringified. Parse it
  // back to an object so resolveDay can read it as a DayTemplate.
  let workoutValue: unknown = input.workoutJson;
  if (typeof workoutValue === "string") {
    try {
      workoutValue = JSON.parse(workoutValue);
    } catch (e) {
      throw new Error(
        `workoutJson was passed as a string but isn't valid JSON: ${e instanceof Error ? e.message : String(e)}. ` +
          `Pass the DayTemplate as a plain object.`,
      );
    }
  }

  // workoutJsonOps path: resolve a base DayTemplate (existing override's
  // workoutJson if present, else the rotation-day template) and apply ops.
  // The resulting object replaces workoutValue from here on, so the rest of
  // the pipeline (size guard, structural validation, baseline guard, write)
  // treats it identically to a full workoutJson replace.
  if (input.workoutJsonOps !== undefined) {
    let base: DayTemplate | null = null;
    if (existing?.workoutJson != null && typeof existing.workoutJson === "object" && !Array.isArray(existing.workoutJson)) {
      base = existing.workoutJson as unknown as DayTemplate;
    } else {
      base = templateForRotationDay(program, date);
    }
    if (!base) {
      throw new Error(
        `workoutJsonOps needs a base workout to edit, but ${input.date} has no override and no rotation-day template (out of plan range). Use workoutJson to seed an override from scratch first.`,
      );
    }
    try {
      workoutValue = applyWorkoutJsonOps(base, input.workoutJsonOps);
    } catch (e) {
      throw new Error(
        `workoutJsonOps failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Structural + size validation. Field-level error messages instead of a
  // generic downstream Prisma error. Runs on whatever produced workoutValue —
  // either a direct workoutJson replace or the result of workoutJsonOps.
  if (workoutValue !== undefined && workoutValue !== null) {
    assertDayTemplateWithinSize(workoutValue);
    assertValidDayTemplate(workoutValue);
  }

  // Audible-with-baselines guard: fires only when SETTING a new workout, no
  // baselineTestNames is in scope (input undefined AND no prior decision on
  // file), and the rotation default has baselines for this date.
  const settingWorkout = workoutValue !== undefined && workoutValue !== null;
  const baselineInputProvided = input.baselineTestNames !== undefined;
  const existingBaselineDecision = Array.isArray(existing?.baselineTestNames);
  if (settingWorkout && !baselineInputProvided && !existingBaselineDecision) {
    const rotationDefaults = rotationBaselineNamesForDate(program, date);
    if (rotationDefaults.length > 0) {
      throw new Error(
        `Audible on ${input.date} touches the workout but didn't make a baseline decision. ` +
          `Rotation default for this date: [${rotationDefaults.join(", ")}]. ` +
          `Re-pass baselineTestNames explicitly: same list to keep them, [] to suppress, or a different set to swap. ` +
          `Don't punt this to the UI — own the call.`,
      );
    }
  }

  const updateData: Prisma.PlanDayOverrideUpdateInput = {};
  const updatedFields: string[] = [];

  // workoutJson was "touched" by this call if EITHER:
  // - the caller passed workoutJson directly (full replace, including null=clear), or
  // - the caller passed workoutJsonOps (surgical edit; workoutValue holds the result).
  // Both modes write to the workoutJson column via the same workoutValue var.
  const touchedWorkout = input.workoutJson !== undefined || input.workoutJsonOps !== undefined;
  const touchedViaOps = input.workoutJsonOps !== undefined;
  if (touchedWorkout) {
    updateData.workoutJson =
      workoutValue === null || workoutValue === undefined
        ? Prisma.JsonNull
        : (workoutValue as Prisma.InputJsonValue);
    updatedFields.push("workoutJson");
  }
  if (input.baselineTestNames !== undefined) {
    updateData.baselineTestNames =
      input.baselineTestNames === null
        ? Prisma.JsonNull
        : (input.baselineTestNames as Prisma.InputJsonValue);
    updatedFields.push("baselineTestNames");
  }
  if (input.nutritionText !== undefined) {
    updateData.nutritionText = input.nutritionText;
    updatedFields.push("nutritionText");
  }
  // PATCH-merge nutritionPlan slot-by-slot against the existing stored plan
  // so callers can update one meal without re-emitting the whole day.
  let mergedNutritionPlan: ReturnType<typeof applyNutritionPlanPatch> | undefined;
  if (input.nutritionPlan !== undefined) {
    const existingPlan = parseStoredNutritionPlan(existing?.nutritionPlan);
    mergedNutritionPlan = applyNutritionPlanPatch(existingPlan, input.nutritionPlan);
    updateData.nutritionPlan =
      mergedNutritionPlan === null
        ? Prisma.JsonNull
        : (mergedNutritionPlan as unknown as Prisma.InputJsonValue);
    updatedFields.push("nutritionPlan");
  }
  if (input.mobilityText !== undefined) {
    updateData.mobilityText = input.mobilityText;
    updatedFields.push("mobilityText");
  }
  if (input.notes !== undefined) {
    updateData.notes = input.notes;
    updatedFields.push("notes");
  }

  if (updatedFields.length === 0) {
    return {
      overrideId: existing?.id ?? null,
      dateKey: toDateKey(date),
      updatedFields,
      message: "No fields provided — nothing changed.",
    };
  }

  const written = await db.planDayOverride.upsert({
    where: { planId_date: { planId: program.id, date } },
    create: {
      planId: program.id,
      date,
      workoutJson:
        workoutValue === undefined || workoutValue === null
          ? Prisma.JsonNull
          : (workoutValue as Prisma.InputJsonValue),
      baselineTestNames:
        input.baselineTestNames === undefined || input.baselineTestNames === null
          ? Prisma.JsonNull
          : (input.baselineTestNames as Prisma.InputJsonValue),
      nutritionText: input.nutritionText ?? null,
      nutritionPlan:
        mergedNutritionPlan == null
          ? Prisma.JsonNull
          : (mergedNutritionPlan as unknown as Prisma.InputJsonValue),
      mobilityText: input.mobilityText ?? null,
      notes: input.notes ?? null,
    },
    update: updateData,
  });

  const preserved =
    existing != null
      ? ["workoutJson", "baselineTestNames", "nutritionText", "nutritionPlan", "mobilityText", "notes"].filter(
          (f) => !updatedFields.includes(f),
        )
      : [];

  const opsSuffix = touchedViaOps ? ` workoutJson edited via ${input.workoutJsonOps!.length} op${input.workoutJsonOps!.length === 1 ? "" : "s"}.` : "";
  return {
    overrideId: written.id,
    dateKey: toDateKey(date),
    updatedFields,
    preservedFields: preserved,
    message:
      existing == null
        ? `Override created (set: ${updatedFields.join(", ")}).${opsSuffix}`
        : `Override updated (changed: ${updatedFields.join(", ")}). Other fields preserved.${opsSuffix}`,
  };
}

async function logNoteCore(db: DbClient, input: LogNoteInput): Promise<{ id: string; message: string }> {
  const n = await db.note.create({
    data: {
      body: input.body,
      type: input.type,
      targetDate: input.targetDate ? startOfDay(parseDateKey(input.targetDate)) : null,
      lastAcknowledgedAt: input.type === "standing_rule" ? new Date() : null,
    },
  });
  return { id: n.id, message: "Note logged" };
}

async function logNutritionCore(db: DbClient, input: LogNutritionInput): Promise<{ id: string; message: string }> {
  const n = await db.nutritionLog.create({
    data: {
      date: input.date ? parseDateInput(input.date) : new Date(),
      mealType: input.mealType,
      items: input.items as Prisma.InputJsonValue,
      notes: input.notes ?? null,
      // Optional macros — undefined fields are omitted (stored as null).
      ...input.macros,
    },
  });
  return { id: n.id, message: "Nutrition logged" };
}

// Decode a literal `\uXXXX` escape into its character. Conservative on purpose:
// it ONLY touches \uXXXX sequences, never \n / \" / \\, so a legitimate
// backslash in free text is left alone. A no-op on any string lacking the
// pattern (ids, dates, enums pass through untouched).
function decodeUnicodeEscapes(s: string): string {
  // Single pass: an escaped backslash (\\) is consumed untouched so a
  // double-escaped sequence like "\\u2014" stays literal, while a lone
  // \uXXXX decodes to its character.
  return s.replace(/\\\\|\\u([0-9a-fA-F]{4})/g, (m, hex: string | undefined) =>
    hex === undefined ? m : String.fromCodePoint(parseInt(hex, 16)),
  );
}

// Recursively decode \uXXXX escapes across all string values of a tool's
// validated arguments. Plain JSON-RPC payloads only (objects/arrays/primitives).
function decodeArgsDeep<T>(v: T): T {
  if (typeof v === "string") return decodeUnicodeEscapes(v) as T;
  if (Array.isArray(v)) return v.map((x) => decodeArgsDeep(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = decodeArgsDeep(val);
    return out as T;
  }
  return v;
}

export function registerAll(server: McpServer) {
  // Defensive guard against re-introducing the literal-escape corruption that
  // had to be batch-fixed once: when a caller double-escapes JSON, free text
  // arrives as e.g. "—" instead of "—" and gets stored verbatim. Decode at
  // this single registration chokepoint so every tool's args are normalized
  // before its handler runs — no need to touch 48 handlers individually.
  const origRegister = server.registerTool.bind(server) as (
    ...a: unknown[]
  ) => unknown;
  (server as { registerTool: unknown }).registerTool = (
    name: unknown,
    config: unknown,
    cb: unknown,
  ) => {
    const handler = cb as (args: unknown, ...rest: unknown[]) => unknown;
    return origRegister(name, config, (args: unknown, ...rest: unknown[]) =>
      handler(decodeArgsDeep(args), ...rest),
    );
  };

  registerReadTools(server);
  registerWriteTools(server);
}

// ----------------------------------------------------------------------------
// Module helpers for new cold-start tools
// ----------------------------------------------------------------------------

// Shared helper: fetch unresolved open_item notes sorted by targetDate
// (nulls last) then createdAt date. Computes overdue flag from startOfDay(now).
async function fetchOpenItems(): Promise<
  { id: string; body: string; targetDate: string | null; priority: string | null; overdue: boolean }[]
> {
  const now = startOfDay(new Date());
  const items = await prisma.note.findMany({
    where: { type: "open_item", resolvedAt: null },
    orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }],
    select: { id: true, body: true, targetDate: true, priority: true, date: true },
  });
  return items.map((item) => ({
    id: item.id,
    body: item.body,
    targetDate: item.targetDate ? toDateKey(item.targetDate) : null,
    priority: item.priority,
    overdue: item.targetDate !== null && item.targetDate < now,
  }));
}

/** Returns the first line of `body`, capped at 80 chars. Used for standing-rule
 *  headers in get_session_brief so full bodies are not repeated there. */
function noteHeader(body: string): string {
  const firstLine = body.split("\n")[0] ?? body;
  return firstLine.length <= 80 ? firstLine : firstLine.slice(0, 77) + "...";
}

// ----------------------------------------------------------------------------
// Read tools — context for coaching reasoning
// ----------------------------------------------------------------------------

function registerReadTools(server: McpServer) {
  server.registerTool(
    "get_today_plan",
    {
      title: "Get today's plan",
      description:
        "Resolve today's workout, nutrition phase, mobility, baselines due, and any logged workouts. Combines the user's active plan rotation with per-day overrides. Returns full DayTemplate plus context. Also surfaces all active standing_rule notes (with lastAcknowledgedAt freshness) under `standingRules` so the coach sees persistent guidance at session start. Call acknowledge_standing_rule when you reference one in a turn so the freshness timestamp stays current.",
    },
    async () =>
      safe(async () => {
        const [r, standingRules, activeGoalRow] = await Promise.all([
          resolveDay(new Date()),
          prisma.note.findMany({
            where: { type: "standing_rule", resolvedAt: null },
            // nulls: "last" so freshly-acknowledged rules bubble up first
            // and never-acknowledged rules (lastAcknowledgedAt IS NULL) don't
            // outrank them by Postgres's default null-greater-than treatment.
            orderBy: [{ lastAcknowledgedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }],
            select: {
              id: true,
              body: true,
              date: true,
              lastAcknowledgedAt: true,
            },
          }),
          prisma.goal.findFirst({
            where: { active: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true, kind: true, objective: true, githubRepo: true },
          }),
        ]);
        const activeGoal = activeGoalRow
          ? {
              id: activeGoalRow.id,
              kind: activeGoalRow.kind,
              objective: activeGoalRow.objective,
              githubRepo: activeGoalRow.githubRepo,
            }
          : null;
        return { ...r, standingRules, activeGoal };
      }),
  );

  server.registerTool(
    "get_day",
    {
      title: "Get any day's plan",
      description:
        "Resolve a specific date the same way as get_today_plan. Past dates surface logged workouts; future dates surface the planned rotation + any override. Use to scope a coaching turn to one date.",
      inputSchema: { date: DateKeyShape },
    },
    async ({ date }) =>
      safe(async () => {
        const r = await resolveDay(parseDateKey(date));
        return r;
      }),
  );

  server.registerTool(
    "recent_history",
    {
      title: "Recent activity / lookback window — workouts, measurements, notes, baselines, hikes",
      description:
        "Pull the last N days of activity across every log type — workouts, body measurements, notes (journal/audible/feedback only), baseline test results, hikes, nutrition. " +
        "Use to answer 'what happened recently', 'what did I do last week', or before proposing a plan revision so the audible reflects actual recent state. " +
        "Default lookback is 14 days; max 180. " +
        "NOTE: this is a firehose — a wide window (e.g. 42 days) can exceed the client's tool-result size cap and get truncated. " +
        "For nutrition-only questions use get_nutrition_history; for a single day use get_day. " +
        "For standing-rule bodies use get_today_plan; for reviews use get_latest_review; for open items use list_open_items.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(180)
          .default(14)
          .describe("Look-back window in days (default 14, max 180)"),
      },
    },
    async ({ days }) =>
      safe(async () => {
        const since = startOfDay(addDays(new Date(), -days));

        const [workouts, measurements, notes, baselines, hikes, nutrition] = await Promise.all([
          prisma.workout.findMany({
            where: { startedAt: { gte: since } },
            include: { exercises: { include: { sets: true } } },
            orderBy: { startedAt: "desc" },
          }),
          prisma.measurement.findMany({
            where: { date: { gte: since } },
            orderBy: { date: "desc" },
          }),
          prisma.note.findMany({
            where: { date: { gte: since }, type: { in: [...ACTIVITY_NOTE_TYPES] } },
            orderBy: { date: "desc" },
          }),
          prisma.baseline.findMany({
            where: { date: { gte: since } },
            orderBy: { date: "desc" },
          }),
          prisma.hike.findMany({
            where: { date: { gte: since } },
            orderBy: { date: "desc" },
          }),
          prisma.nutritionLog.findMany({
            where: { date: { gte: since } },
            orderBy: { date: "desc" },
          }),
        ]);

        return { since, days, workouts, measurements, notes, baselines, hikes, nutrition };
      }),
  );

  server.registerTool(
    "list_goals",
    {
      title: "List all training goals",
      description:
        "Show every training goal — active and inactive — with active flag, target date / race day / event date, status, and target count. " +
        "Use to find the active goal id, see past or paused goals, or surface what the user is training toward. " +
        "Pair with get_goal for full detail on one goal.",
    },
    async () =>
      safe(async () => {
        const goals = await prisma.goal.findMany({
          orderBy: [{ active: "desc" }, { targetDate: "asc" }],
          include: { plans: { where: { active: true }, select: { id: true, weeks: true } } },
        });
        return goals.map((g) => ({
          id: g.id,
          objective: g.objective,
          targetDate: g.targetDate,
          status: g.status,
          active: g.active,
          kind: g.kind,
          targetCount: Array.isArray(g.targets) ? (g.targets as unknown[]).length : 0,
          activePlanId: g.plans[0]?.id ?? null,
        }));
      }),
  );

  server.registerTool(
    "get_goal",
    {
      title: "Get goal detail (with active plan, revisions, upcoming overrides)",
      description:
        "Full goal with targets, references, the active plan (with planJson — the ROTATION TEMPLATE, not the resolved per-date prescription), the most recent plan revisions, and an upcomingOverrides summary so you can see which dates diverge from the template. " +
        "Important: planJson tells you 'Mondays do this' — it does NOT include per-date overrides. To answer 'what's actually prescribed on date X', call get_day(X), not get_goal. To answer 'what's exercise Y prescribed at on its next occurrences', call find_exercise_in_plan. " +
        "Use get_goal to gather goal context (targets, references, recent revisions) before proposing a plan revision.",
      inputSchema: {
        goalId: z.string().describe("Goal id; use list_goals to discover"),
      },
    },
    async ({ goalId }) =>
      safe(async () => {
        const goal = await prisma.goal.findUniqueOrThrow({
          where: { id: goalId },
          include: {
            plans: {
              where: { active: true },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                revisions: {
                  orderBy: { createdAt: "desc" },
                  take: 10,
                  include: { triggerNote: true },
                },
              },
            },
          },
        });

        // Surface upcoming per-date overrides so the coach can't accidentally
        // read planJson and miss that a date diverges. Window starts today
        // and extends 60 days — long enough to cover any plan in flight.
        // Each entry lists *which* fields are actively overriding so the
        // coach knows whether to call get_day to see the details.
        const activePlan = goal.plans[0];
        let upcomingOverrides: Array<{
          dateKey: string;
          date: Date;
          overrides: string[];
          workoutTitle: string | null;
        }> = [];
        if (activePlan) {
          const today = startOfDay(new Date());
          const windowEnd = addDays(today, 60);
          const rows = await prisma.planDayOverride.findMany({
            where: {
              planId: activePlan.id,
              date: { gte: today, lte: windowEnd },
            },
            orderBy: { date: "asc" },
          });
          upcomingOverrides = rows.map((o) => {
            const driving: string[] = [];
            if (o.workoutJson != null) driving.push("workoutJson");
            if (o.baselineTestNames != null) driving.push("baselineTestNames");
            if (o.nutritionText != null) driving.push("nutritionText");
            if (o.nutritionPlan != null) driving.push("nutritionPlan");
            if (o.mobilityText != null) driving.push("mobilityText");
            if (o.notes != null) driving.push("notes");
            const workoutTitle =
              o.workoutJson != null && typeof o.workoutJson === "object" && !Array.isArray(o.workoutJson)
                ? ((o.workoutJson as Record<string, unknown>).title as string | undefined) ?? null
                : null;
            return {
              dateKey: toDateKey(o.date),
              date: o.date,
              overrides: driving,
              workoutTitle,
            };
          });
        }

        return { ...goal, upcomingOverrides };
      }),
  );

  server.registerTool(
    "get_pending_notes",
    {
      title: "Unresolved notes",
      description:
        "Notes (audibles/journals/feedback) that haven't been resolved yet — i.e. resolvedAt IS NULL. The natural input set for a 'review my notes' coaching turn. Resolve a note either by including its id in apply_plan_revision.resolvedNoteIds when the revision addresses it, or by calling acknowledge_notes when no plan change is warranted.",
    },
    async () =>
      safe(async () => {
        const plan = await prisma.plan.findFirst({
          where: { active: true },
          orderBy: { updatedAt: "desc" },
        });
        const notes = await prisma.note.findMany({
          where: { resolvedAt: null },
          orderBy: { date: "desc" },
        });
        return {
          planId: plan?.id ?? null,
          notes,
          count: notes.length,
        };
      }),
  );

  server.registerTool(
    "list_promotable_notes",
    {
      title: "Notes that might be standing rules",
      description:
        "Lists feedback-type notes (and optionally existing standing_rule notes) so the coach can review them and propose promotions via promote_note. Use on first session after the standing_rule migration — or any time the user mentions a rule that may not yet be promoted. Returns all matching notes sorted newest first; resolvedAt is included so you can tell pending from folded-in. Pure read — no side effects.",
      inputSchema: {
        includeStandingRules: z
          .boolean()
          .default(false)
          .describe(
            "When true, also include notes that are already type='standing_rule' (useful for a freshness audit). Default false — only surfaces unpromoted feedback notes.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max notes to return. Default 50."),
      },
    },
    async ({ includeStandingRules, limit }) =>
      safe(async () => {
        const types = includeStandingRules
          ? ["feedback", "standing_rule"]
          : ["feedback"];
        const notes = await prisma.note.findMany({
          where: { type: { in: types } },
          orderBy: { date: "desc" },
          take: limit,
          select: {
            id: true,
            body: true,
            type: true,
            date: true,
            targetDate: true,
            resolvedAt: true,
            lastAcknowledgedAt: true,
          },
        });
        return { count: notes.length, notes };
      }),
  );

  server.registerTool(
    "acknowledge_notes",
    {
      title: "Acknowledge notes without revising the plan",
      description:
        "Mark notes resolved when they don't warrant a plan change (pure journals, observations already addressed, etc.). Sets resolvedAt = now and stores the reason. Always propose to the user before calling — same propose-before-apply rule as apply_plan_revision.",
      inputSchema: {
        noteIds: z.array(z.string()).min(1),
        reason: z
          .string()
          .min(1)
          .describe(
            "Why these notes don't need a plan change. Stored on each note as resolvedReason.",
          ),
      },
    },
    async ({ noteIds, reason }) =>
      safe(async () => {
        const result = await prisma.note.updateMany({
          where: { id: { in: noteIds }, resolvedAt: null },
          data: { resolvedAt: new Date(), resolvedReason: reason },
        });
        return { resolved: result.count, message: `Resolved ${result.count} note(s)` };
      }),
  );

  server.registerTool(
    "weekly_summary_data",
    {
      title: "Weekly recap / Sunday review data bundle",
      description:
        "Bundle one week's data (workouts, measurements, notes, baselines, hikes, nutrition) for a coaching review or Sunday weekly recap. " +
        "Use when the user asks 'how did this week go', 'summarize last week', or for the standing Sunday review cadence. " +
        "weekOffset=0 is the current week, -1 is last week, -2 the week before, etc.",
      inputSchema: {
        weekOffset: z
          .number()
          .int()
          .min(-26)
          .max(0)
          .default(-1)
          .describe("Negative offset from this week (default -1 = last week)"),
      },
    },
    async ({ weekOffset }) =>
      safe(async () => {
        const now = new Date();
        const thisMonday = startOfWeekMonday(now);
        const monday = addDays(thisMonday, weekOffset * 7);
        const sunday = endOfWeekSunday(monday);

        const [workouts, measurements, notes, baselines, hikes, nutrition] = await Promise.all([
          prisma.workout.findMany({
            where: { startedAt: { gte: monday, lte: sunday } },
            include: { exercises: { include: { sets: true } } },
            orderBy: { startedAt: "asc" },
          }),
          prisma.measurement.findMany({
            where: { date: { gte: monday, lte: sunday } },
            orderBy: { date: "asc" },
          }),
          prisma.note.findMany({
            where: { date: { gte: monday, lte: sunday } },
            orderBy: { date: "asc" },
          }),
          prisma.baseline.findMany({
            where: { date: { gte: monday, lte: sunday } },
            orderBy: { date: "asc" },
          }),
          prisma.hike.findMany({
            where: { date: { gte: monday, lte: sunday } },
            orderBy: { date: "asc" },
          }),
          prisma.nutritionLog.findMany({
            where: { date: { gte: monday, lte: sunday } },
            orderBy: { date: "asc" },
          }),
        ]);

        return { monday, sunday, weekOffset, workouts, measurements, notes, baselines, hikes, nutrition };
      }),
  );

  server.registerTool(
    "get_baseline_schedule",
    {
      title: "Baseline test schedule — what's due, overdue, upcoming",
      description:
        "Every scheduled baseline test for the active plan with per-checkpoint status: initial collection (week 1) and each retest week. " +
        "Use to answer 'what fitness tests are due', 'what baselines are overdue', 'when's the next retest', or to plan a baseline-collection day. " +
        "Includes overdue/due flags so the coach can call out missed tests before they drift.",
    },
    async () => safe(() => getBaselineSchedule()),
  );

  server.registerTool(
    "get_baseline_history",
    {
      title: "Baseline / fitness test trend over time",
      description:
        "Every recorded result for one named baseline test (initial + every retest), oldest first. " +
        "Use to see the trend / progression / progress on a specific test ('how has my 1.5-mile run improved', 'pull-up max over time'). " +
        "For PRs on regular exercises (not baseline tests), use get_exercise_history.",
      inputSchema: { testName: z.string() },
    },
    async ({ testName }) => safe(() => getBaselineHistory(testName)),
  );

  server.registerTool(
    "get_records_summary",
    {
      title: "All-time PRs / personal records / max lifts summary",
      description:
        "Every exercise's personal record (PR) — best 1RM, max reps, longest duration — plus a summary row for each baseline test. " +
        "Use to answer 'what are my PRs', 'what's my best ever for X', 'max lift on bench/squat/deadlift', or to anchor a coaching turn in lifetime bests. " +
        "For the trend of one exercise (not just the peak), use get_exercise_history.",
    },
    async () =>
      safe(async () => {
        const [exercises, baselines] = await Promise.all([
          getExerciseSummaries(),
          getBaselineSummaries(),
        ]);
        return { exercises, baselines };
      }),
  );

  server.registerTool(
    "list_open_items",
    {
      title: "List unresolved open items (action threads)",
      description:
        "All unresolved open items — structured action threads, decisions, or reminders created via log_open_item. " +
        "Returns them sorted by targetDate (soonest first, nulls last) with an overdue flag. " +
        "Use this (NOT recent_history) to surface pending decisions and in-flight threads across coaching sessions. " +
        "To create an open item use log_open_item; to resolve one use resolve_open_item. " +
        "Surfaced in get_session_brief.openItems — call this for a live standalone view.",
    },
    async () =>
      safe(async () => {
        const openItems = await fetchOpenItems();
        return { count: openItems.length, openItems };
      }),
  );

  server.registerTool(
    "get_latest_review",
    {
      title: "Get the most recent weekly review",
      description:
        "The most recent review note (type:'review') as a discrete object with body, date, and weekOf. " +
        "Returns null when no review has been logged yet. " +
        "Use this (NOT recent_history) to surface the most recent Sunday recap in a coaching session. " +
        "To log a review use log_review. " +
        "Surfaced in get_session_brief.latestReview — call this for a standalone latest review.",
    },
    async () =>
      safe(async () => {
        const note = await prisma.note.findFirst({
          where: { type: "review" },
          orderBy: { date: "desc" },
          select: { id: true, body: true, date: true, targetDate: true },
        });
        if (!note) return { review: null };
        return {
          review: {
            body: note.body,
            date: toDateKey(note.date),
            weekOf: note.targetDate ? toDateKey(note.targetDate) : null,
          },
        };
      }),
  );

  server.registerTool(
    "get_session_brief",
    {
      title: "Cold-start coaching catch-up (one call)",
      description:
        "One-call cold-start catch-up for a NEW coaching conversation — today's date, active goal + days-to-go, " +
        "current plan week/phase, the last ~5 sessions (workouts + hikes blended newest-first), weight trend, " +
        "standing-rule HEADERS (NOT bodies; call get_today_plan for full bodies + today's prescription), " +
        "the latest review, and unresolved open items. " +
        "Call this FIRST in a fresh chat instead of stitching together get_today_plan + recent_history + get_goal. " +
        "For today's full workout/nutrition/baselines use get_today_plan; " +
        "for a wide activity lookback use recent_history; " +
        "for all-time PRs use get_records_summary.",
    },
    async () =>
      safe(async () => {
        const now = new Date();
        const MS_PER_DAY = 1000 * 60 * 60 * 24;
        const cutoff30 = addDays(startOfDay(now), -31);

        // Parallel fetch everything — resolveDay + getActiveProgram both call
        // getActiveProgram internally but since they're separate awaits the
        // overhead is one extra DB round-trip (acceptable for a cold-start tool).
        const [
          resolved,
          program,
          activeGoal,
          standingRules,
          recentWorkouts,
          recentHikes,
          latestReviewNote,
          openItems,
          measurements,
        ] = await Promise.all([
          resolveDay(now),
          getActiveProgram(),
          prisma.goal.findFirst({
            where: { active: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true, objective: true, targetDate: true, kind: true },
          }),
          // ASC puts NULL first (Postgres default) → never-acknowledged rules surface
          // first in the brief. Intentional: stale rules are the ones the coach is most
          // at risk of forgetting. get_today_plan uses desc/nulls-last (freshest first)
          // because it's a per-turn surface, not a cold-start orientation.
          prisma.note.findMany({
            where: { type: "standing_rule", resolvedAt: null },
            orderBy: { lastAcknowledgedAt: "asc" },
            select: { id: true, body: true, lastAcknowledgedAt: true },
          }),
          prisma.workout.findMany({
            where: { status: "completed", startedAt: { lte: now } },
            orderBy: { startedAt: "desc" },
            take: 5,
            select: {
              id: true,
              startedAt: true,
              title: true,
              notes: true,
              exercises: { select: { name: true }, take: 3 },
            },
          }),
          prisma.hike.findMany({
            where: { status: "completed", date: { lte: endOfDay(now) } },
            orderBy: { date: "desc" },
            take: 5,
            select: { id: true, date: true, route: true, distanceMi: true, elevationFt: true, durationMin: true },
          }),
          prisma.note.findFirst({
            where: { type: "review" },
            orderBy: { date: "desc" },
            select: { body: true, date: true, targetDate: true },
          }),
          fetchOpenItems(),
          prisma.measurement.findMany({
            where: { date: { gte: cutoff30 }, weightLb: { not: null } },
            orderBy: { date: "asc" },
            select: { date: true, weightLb: true },
          }),
        ]);

        // --- goal ---
        let goal: {
          id: string;
          objective: string;
          targetDate: string | null;
          daysToGo: number | null;
          kind: string | null;
        } | null = null;
        if (activeGoal) {
          const daysToGo = activeGoal.targetDate
            ? Math.round(
                (startOfDay(activeGoal.targetDate).getTime() - startOfDay(now).getTime()) /
                  MS_PER_DAY,
              )
            : null;
          goal = {
            id: activeGoal.id,
            objective: activeGoal.objective,
            targetDate: activeGoal.targetDate ? toDateKey(activeGoal.targetDate) : null,
            daysToGo,
            kind: activeGoal.kind,
          };
        }

        // --- plan ---
        let plan: {
          name: string;
          week: number;
          totalWeeks: number;
          phase: { index: number; name: string } | null;
        } | null = null;
        if (resolved.isInPlan && program && resolved.weekIndex !== null) {
          const weekIndex = resolved.weekIndex;
          const matchedPhase = program.template.phases?.find(
            (p) => Array.isArray(p?.weeks) && p.weeks.includes(weekIndex),
          );
          plan = {
            name: program.name,
            week: weekIndex,
            totalWeeks: program.template.totalWeeks,
            phase: matchedPhase
              ? { index: matchedPhase.index, name: matchedPhase.name }
              : null,
          };
        }

        // --- recentSessions: blend workouts + hikes, newest-first, take 5 ---
        type Session = { date: string; kind: "workout" | "hike"; title: string; summary: string };
        const sessions: Session[] = [
          ...recentWorkouts.map((w) => ({
            date: toDateKey(w.startedAt),
            kind: "workout" as const,
            title: w.title ?? "Workout",
            summary:
              w.exercises.length > 0
                ? w.exercises
                    .slice(0, 3)
                    .map((e) => e.name)
                    .join(", ") + (w.exercises.length > 3 ? ` +${w.exercises.length - 3} more` : "")
                : w.notes ?? "",
          })),
          ...recentHikes.map((h) => ({
            date: toDateKey(h.date),
            kind: "hike" as const,
            title: h.route,
            summary: `${h.distanceMi} mi, ${h.elevationFt} ft gain, ${h.durationMin} min`,
          })),
        ]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5);

        // --- weightTrend ---
        const latest = measurements.at(-1) ?? null;
        const target7d = addDays(startOfDay(now), -7);
        const target30d = addDays(startOfDay(now), -30);

        function nearestMeasurement(
          mList: { date: Date; weightLb: number | null }[],
          target: Date,
        ): { date: Date; weightLb: number } | null {
          let best: { date: Date; weightLb: number } | null = null;
          let bestDist = Infinity;
          for (const m of mList) {
            if (m.weightLb === null) continue;
            const weightLb = m.weightLb;
            const dist = Math.abs(m.date.getTime() - target.getTime());
            if (dist < bestDist) { best = { date: m.date, weightLb }; bestDist = dist; }
          }
          return best;
        }

        const m7d = nearestMeasurement(measurements, target7d);
        const m30d = nearestMeasurement(measurements, target30d);
        const weightTrend = {
          latest: latest
            ? { date: toDateKey(latest.date), weightLb: latest.weightLb }
            : null,
          delta7d:
            m7d && latest && latest.weightLb !== null
              ? Math.round((latest.weightLb - m7d.weightLb) * 10) / 10
              : null,
          delta30d:
            m30d && latest && latest.weightLb !== null
              ? Math.round((latest.weightLb - m30d.weightLb) * 10) / 10
              : null,
        };

        // --- standingRules (headers, NOT bodies) ---
        const standingRulesOut = standingRules.map((r) => ({
          id: r.id,
          header: noteHeader(r.body),
          lastAcknowledgedAt: r.lastAcknowledgedAt?.toISOString() ?? null,
        }));

        // --- latestReview ---
        const latestReview = latestReviewNote
          ? {
              body: latestReviewNote.body,
              date: toDateKey(latestReviewNote.date),
              weekOf: latestReviewNote.targetDate
                ? toDateKey(latestReviewNote.targetDate)
                : null,
            }
          : null;

        return {
          today: toDateKey(now),
          goal,
          plan,
          recentSessions: sessions,
          weightTrend,
          standingRules: standingRulesOut,
          latestReview,
          openItems,
        };
      }),
  );

  server.registerTool(
    "get_exercise_history",
    {
      title: "Exercise progress / trend over time (best set per session)",
      description:
        "Best-set-per-session over time for one specific exercise — shows progression / trend / progress on that lift or movement. " +
        "Use for questions like 'how has my push-up max changed', 'bench press over the last month', 'am I progressing on RDLs'. " +
        "For all-time peaks (just the PR row), use get_records_summary instead.",
      inputSchema: {
        name: z.string(),
        equipment: z.string().optional(),
      },
    },
    async ({ name, equipment }) =>
      safe(() => getExerciseHistory(name, equipment ?? null)),
  );

  server.registerTool(
    "get_nutrition_history",
    {
      title: "Logged meals / nutrition over a date window (compact, grouped by day)",
      description:
        "Every logged meal (NutritionLog) over the last N days, grouped by day with per-day macro totals. " +
        "Use this for ANY question about what the user has actually eaten — 'my nutrition this week', 'meals over the last month', 'how has my protein been'. " +
        "Prefer this over recent_history for nutrition questions: recent_history bundles workouts + every other log type and can be large enough that the client truncates it and drops the trailing nutrition. This tool is nutrition-only and stays compact. " +
        "Default look-back 14 days (max 180). Optional mealType filter. Days are newest-first.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(180)
          .default(14)
          .describe("Look-back window in days (default 14, max 180)"),
        mealType: z
          .enum(["preworkout", "postworkout", "breakfast", "lunch", "dinner", "snack"])
          .optional()
          .describe("Optional: restrict to a single meal slot"),
      },
    },
    async ({ days, mealType }) =>
      safe(async () => {
        const since = startOfDay(addDays(new Date(), -days));
        const rows = await prisma.nutritionLog.findMany({
          where: { date: { gte: since }, ...(mealType ? { mealType } : {}) },
          orderBy: { date: "desc" },
          select: {
            date: true,
            mealType: true,
            items: true,
            notes: true,
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
            fiberG: true,
            sodiumMg: true,
          },
        });

        const MACROS = ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sodiumMg"] as const;
        type MacroKey = (typeof MACROS)[number];
        // Group by USER_TZ date key (a 00:30Z meal is the prior evening in MT —
        // toDateKey buckets it on the correct local day, never raw UTC date).
        const byDayMap = new Map<
          string,
          { dateKey: string; totals: Partial<Record<MacroKey, number>>; meals: Array<Record<string, unknown>> }
        >();

        for (const r of rows) {
          const key = toDateKey(r.date);
          let day = byDayMap.get(key);
          if (!day) {
            day = { dateKey: key, totals: {}, meals: [] };
            byDayMap.set(key, day);
          }
          day.meals.push({
            mealType: r.mealType,
            items: r.items,
            notes: r.notes,
            calories: r.calories,
            proteinG: r.proteinG,
            carbsG: r.carbsG,
            fatG: r.fatG,
            fiberG: r.fiberG,
            sodiumMg: r.sodiumMg,
          });
          for (const m of MACROS) {
            const v = r[m];
            if (typeof v === "number") day.totals[m] = (day.totals[m] ?? 0) + v;
          }
        }

        // Map preserves insertion order; rows are date-desc, so byDay is newest-first.
        const byDay = Array.from(byDayMap.values());
        return { since, days, mealType: mealType ?? null, entryCount: rows.length, byDay };
      }),
  );

  server.registerTool(
    "find_exercise_in_plan",
    {
      title: "Where + when is this exercise prescribed? (override-aware lookup)",
      description:
        "Walk the next N days (default 14) and return every date where the named exercise is prescribed, with its FULLY RESOLVED prescription — template-or-override. " +
        "Answers: 'what's Hollow Body Hold prescribed at this week', 'when's the next Push-up day', 'is the bumped RDL weight applied to upcoming sessions'. " +
        "Use this instead of reading planJson directly — planJson is the rotation template and silently misses per-date overrides. " +
        "Match is case-insensitive substring on exercise name. Each occurrence includes the source (template vs override), the parent block, and the prescription fields (sets, reps, durationSec, weightHint, notes).",
      inputSchema: {
        exerciseName: z
          .string()
          .min(1)
          .describe("Case-insensitive substring; e.g. 'hollow', 'pull-up', 'RDL'"),
        windowDays: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(14)
          .describe("How many days forward to scan, starting at fromDate. Default 14, max 90."),
        fromDate: DateKeyShape.optional().describe(
          "Start of the window (yyyy-mm-dd). Default = today in the user's local TZ.",
        ),
      },
    },
    async ({ exerciseName, windowDays, fromDate }) =>
      safe(async () => {
        const start = fromDate ? startOfDay(parseDateKey(fromDate)) : startOfDay(new Date());
        const needle = exerciseName.toLowerCase();
        const occurrences: Array<{
          date: Date;
          dateKey: string;
          source: "template" | "override";
          blockTitle: string | null;
          blockType: string | null;
          exercise: Record<string, unknown>;
        }> = [];

        for (let i = 0; i < windowDays; i++) {
          const day = addDays(start, i);
          const resolved = await resolveDay(day);
          const tmpl = resolved.workoutTemplate;
          if (!tmpl || !Array.isArray(tmpl.blocks)) continue;
          for (const block of tmpl.blocks) {
            for (const ex of block.exercises ?? []) {
              if (typeof ex.name === "string" && ex.name.toLowerCase().includes(needle)) {
                occurrences.push({
                  date: resolved.date,
                  dateKey: resolved.dateKey,
                  source: resolved.isOverride ? "override" : "template",
                  blockTitle: (block as { label?: string }).label ?? null,
                  blockType: (block as { type?: string }).type ?? null,
                  exercise: ex as unknown as Record<string, unknown>,
                });
              }
            }
          }
        }

        return {
          exerciseName,
          fromDate: toDateKey(start),
          windowDays,
          occurrenceCount: occurrences.length,
          occurrences,
        };
      }),
  );

  server.registerTool(
    "list_planned_hikes",
    {
      title: "List planned / scheduled / upcoming hikes (to review, move, or reschedule)",
      description:
        "Return every Hike row with status='planned' — the upcoming hikes on the calendar (the faded boot icons): training hikes, the Mt. Elbert build-up, backpacking trips. " +
        "This is THE tool to call when you need to see or move planned hikes — 'what hikes are scheduled', 'list all planned hikes', 'which Saturdays have a hike between now and date X', 'reschedule/shift the planned hikes'. " +
        "Do NOT poll get_day per Saturday and do NOT read planJson — planned hikes are Hike rows, returned here directly with their ids so you can then finalize (log_hike.replacesPlannedHikeId), delete (delete_hike), or reschedule them. " +
        "Defaults to all future planned hikes (today onward); pass from/to (yyyy-mm-dd) to bound the window, or includePast=true to also surface stale/overdue planned rows. " +
        "Note: one-off special days inserted as day OVERRIDES (races, vacation, sick swaps) are not Hike rows — those show up in get_goal.upcomingOverrides instead.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe("yyyy-mm-dd lower bound (inclusive). Default = today (USER_TZ)."),
        to: z
          .string()
          .optional()
          .describe("yyyy-mm-dd upper bound (inclusive). Default = no upper bound (all future)."),
        includePast: z
          .boolean()
          .optional()
          .describe("Also include planned hikes dated before the lower bound (default false) — useful to catch overdue/stale planned rows."),
      },
    },
    async ({ from, to, includePast }) =>
      safe(async () => {
        const lower = from ? parseDateInput(from) : startOfDay(new Date());
        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (!includePast) dateFilter.gte = lower;
        if (to) dateFilter.lte = endOfDay(parseDateInput(to));
        const rows = await prisma.hike.findMany({
          where: {
            status: "planned",
            ...(dateFilter.gte || dateFilter.lte ? { date: dateFilter } : {}),
          },
          orderBy: { date: "asc" },
        });
        return {
          count: rows.length,
          hikes: rows.map((h) => ({
            id: h.id,
            date: toDateKey(h.date),
            route: h.route,
            distanceMi: h.distanceMi,
            elevationFt: h.elevationFt,
            packWeightLb: h.packWeightLb,
            durationMin: h.durationMin,
            notes: h.notes,
          })),
          message:
            rows.length === 0
              ? "No planned hikes in range."
              : `${rows.length} planned hike${rows.length === 1 ? "" : "s"}.`,
        };
      }),
  );

  server.registerTool(
    "lint_plan",
    {
      title: "Lint the active plan for scheduling / data-integrity problems",
      description:
        "Run structural + data-integrity checks over the active plan and surface findings before they bite. " +
        "Call this when reviewing a long plan, before proposing a revision, or when something on the calendar looks off. " +
        "Checks: unanchored retests (a retest with no initial collected), retest/initial weeks past the plan horizon, a retest at or before its initial week, phase weeks that don't tile 1..totalWeeks, " +
        "metadata drift (Plan.weeks/endsOn or Goal.targetDate out of sync with the template), " +
        "phantom baseline values (≤0), day overrides outside the plan range, and duplicate planned hikes on a date. " +
        "Each finding has severity 'error' (a structural invariant is broken — apply_plan_revision will refuse to write it) or 'warning' (worth fixing, non-blocking). " +
        "Read-only — fix findings via apply_plan_revision (template), update_plan_metadata (drift), update_baseline/delete_baseline (phantoms), or delete_hike (dup hikes).",
      inputSchema: {},
    },
    async () =>
      safe(async () => {
        const { planId, findings } = await lintActivePlan();
        if (planId === null) {
          return { ok: true, findings: [], message: "No active plan to lint." };
        }
        const errors = findings.filter((f) => f.severity === "error");
        const warnings = findings.filter((f) => f.severity === "warning");
        return {
          ok: errors.length === 0,
          planId,
          errorCount: errors.length,
          warningCount: warnings.length,
          findings,
          message:
            findings.length === 0
              ? "Plan is clean — no lint findings."
              : `${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
        };
      }),
  );

  server.registerTool(
    "export_workout",
    {
      title: "Export / share / copy / print a logged workout",
      description:
        "Format a stored workout for sharing or copying — Strong-app txt, Markdown, plain text, or JSON. " +
        "Use when the user asks to share, copy, print, or export a workout, or wants a paste-friendly summary. " +
        "Default 'strong' format round-trips the import — paste it back into Strong or log_workout and you get the same session.",
      inputSchema: {
        workoutId: z.string(),
        format: z.enum(["strong", "markdown", "plain", "json"]).default("strong"),
      },
    },
    async ({ workoutId, format }) =>
      safe(async () => {
        const w = await prisma.workout.findUniqueOrThrow({
          where: { id: workoutId },
          include: {
            exercises: {
              orderBy: { orderIndex: "asc" },
              include: { sets: { orderBy: { setIndex: "asc" } } },
            },
          },
        });
        const text = formatWorkout(
          {
            id: w.id,
            title: w.title,
            startedAt: w.startedAt,
            source: w.source,
            sourceUrl: w.sourceUrl,
            notes: w.notes,
            exercises: w.exercises.map((ex) => ({
              name: ex.name,
              equipment: ex.equipment,
              orderIndex: ex.orderIndex,
              notes: ex.notes,
              sets: ex.sets.map((s) => ({
                setIndex: s.setIndex,
                reps: s.reps,
                weightLb: s.weightLb,
                durationSec: s.durationSec,
                distanceMi: s.distanceMi,
              })),
            })),
          },
          format as ExportFormat,
        );
        return { workoutId, format, text };
      }),
  );
}

// ----------------------------------------------------------------------------
// Write tools — Claude takes action on behalf of the user
// ----------------------------------------------------------------------------

const SetInputShape = z.object({
  setIndex: z.number().int().min(1),
  reps: z.number().int().min(0).optional(),
  weightLb: z.number().min(0).optional(),
  durationSec: z.number().min(0).optional(),
  distanceMi: z.number().min(0).optional(),
  rpe: z.number().min(0).max(10).optional(),
  notes: z.string().optional(),
});

const ExerciseInputShape = z.object({
  name: z.string(),
  equipment: z.string().optional(),
  orderIndex: z.number().int().min(0),
  notes: z.string().optional(),
  sets: z.array(SetInputShape),
});

function registerWriteTools(server: McpServer) {
  server.registerTool(
    "log_workout",
    {
      title: "Log a completed workout",
      description:
        "Persist a completed session with structured exercises and sets. Accepts the same shape produced by parsing a Strong-app txt — pass the data Claude reasoned out from a paste.",
      inputSchema: {
        title: z.string().optional(),
        startedAt: z
          .string()
          .describe("ISO datetime, e.g. 2026-05-02T15:59:00-06:00"),
        source: z.string().default("claude"),
        sourceUrl: z.string().optional(),
        notes: z.string().optional(),
        exercises: z.array(ExerciseInputShape),
      },
    },
    async (input) =>
      safe(async () => {
        const created = await prisma.workout.create({
          data: {
            title: input.title,
            startedAt: new Date(input.startedAt),
            status: "completed",
            source: input.source,
            sourceUrl: input.sourceUrl,
            notes: input.notes,
            exercises: {
              create: input.exercises.map((ex) => ({
                name: ex.name,
                equipment: ex.equipment,
                orderIndex: ex.orderIndex,
                notes: ex.notes,
                sets: {
                  create: ex.sets.map((s) => ({
                    setIndex: s.setIndex,
                    reps: s.reps ?? null,
                    weightLb: s.weightLb ?? null,
                    durationSec: s.durationSec ?? null,
                    distanceMi: s.distanceMi ?? null,
                    rpe: s.rpe ?? null,
                    notes: s.notes ?? null,
                  })),
                },
              })),
            },
          },
        });
        const recordsSet = await recordsSetInWorkout(created.id);
        return { id: created.id, message: "Workout logged", recordsSet };
      }),
  );

  server.registerTool(
    "log_measurement",
    {
      title: "Log body weight, resting heart rate, body fat, or other body metric",
      description:
        "Record a daily weigh-in, resting HR (RHR), body fat %, or other body-composition metric. " +
        "Use for any body-state tracking that isn't a workout, baseline test, or hike. " +
        "Pass only the fields measured; omit the rest. Drives the weight trend on the dashboard and feeds weekly summaries.",
      inputSchema: {
        weightLb: z.number().min(0).optional(),
        restingHr: z.number().int().min(0).optional(),
        bodyFatPct: z.number().min(0).max(100).optional(),
        notes: z.string().optional(),
        date: z.string().optional().describe("ISO datetime; default = now"),
      },
    },
    async (input) =>
      safe(async () => {
        const m = await prisma.measurement.create({
          data: {
            date: input.date ? parseDateInput(input.date) : new Date(),
            weightLb: input.weightLb ?? null,
            restingHr: input.restingHr ?? null,
            bodyFatPct: input.bodyFatPct ?? null,
            notes: input.notes ?? null,
          },
        });
        return { id: m.id, message: "Measurement logged" };
      }),
  );

  server.registerTool(
    "log_baseline",
    {
      title: "Log a fitness test / benchmark / baseline result",
      description:
        "Record the result of a fitness test or benchmark — initial collection (week 1) or retest. " +
        "Examples: 1.5-mile run time, max pull-ups, deep-squat hold seconds, 8-rep DB press max, vertical jump. " +
        "Use a testName from the program template's baseline week when applicable so the result joins the existing test schedule; " +
        "use a custom name only for one-off measurements. Each result drives the trend on /baselines/test/[testName] and " +
        "feeds get_baseline_history / get_baseline_schedule. " +
        "Idempotent per day: logging the same testName again on the same calendar date updates that result in place rather than creating a duplicate row. " +
        "value must be > 0 — a 0/blank result is rejected as a phantom completion; to deliberately document a DNF / skipped / substituted test, pass allowZero=true (recorded with no workout mirror).",
      inputSchema: {
        testName: z.string(),
        value: z.number(),
        units: z.string(),
        date: z.string().optional(),
        notes: z.string().optional(),
        allowZero: z
          .boolean()
          .optional()
          .describe(
            "Permit value=0 to document a DNF / skipped / substituted test. Without this, value<=0 is rejected as a phantom completion.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        // Reject phantom completions: a bare 0 reads as "logged but no real
        // effort" and produces no workout mirror (see appendBaselineToDayWorkout).
        // Negatives are NOT blocked — signed metrics are real (e.g. a sit-and-
        // reach 6.5 cm short of the toes is -6.5). The linter surfaces value<=0
        // as a non-blocking warning so signed/legacy values still get a look.
        if (input.value === 0 && !input.allowZero) {
          throw new Error(
            `value=0 for "${input.testName}" looks like a phantom completion. Pass the real measured value, ` +
              `or set allowZero=true to deliberately record a DNF / skipped / substituted test.`,
          );
        }

        const date = input.date ? parseDateInput(input.date) : new Date();

        // Idempotency: one result per testName per calendar day. A repeat call
        // updates the existing row in place (mirrors apply_day_override's upsert
        // and log_hike's finalize-in-place) instead of stacking duplicates.
        const existing = await prisma.baseline.findFirst({
          where: {
            testName: input.testName,
            date: { gte: startOfDay(date), lte: endOfDay(date) },
          },
          orderBy: { date: "asc" },
        });

        if (existing) {
          const updated = await prisma.baseline.update({
            where: { id: existing.id },
            data: {
              value: input.value,
              units: input.units,
              date,
              notes: input.notes ?? null,
            },
          });
          await syncBaselineUpdateToWorkout({
            testName: input.testName,
            oldDate: existing.date,
            oldValue: existing.value,
            newDate: date,
            newValue: input.value,
            newUnits: input.units,
            newNotes: input.notes ?? null,
          });
          return {
            id: updated.id,
            deduped: true,
            message: `Existing ${input.testName} result on this date updated in place (no duplicate created).`,
          };
        }

        const b = await prisma.baseline.create({
          data: {
            testName: input.testName,
            value: input.value,
            units: input.units,
            date,
            notes: input.notes ?? null,
          },
        });
        await appendBaselineToDayWorkout({
          testName: input.testName,
          value: input.value,
          units: input.units,
          date,
          notes: input.notes ?? null,
        });
        return { id: b.id, deduped: false, message: "Baseline logged (and appended to day's baseline workout)" };
      }),
  );

  server.registerTool(
    "log_hike",
    {
      title: "Record a completed hike, schedule a planned hike, or finalize a planned hike",
      description:
        "Log an out-of-gym training day: completed hike, training hike, scheduled future hike, or backpacking trip. " +
        "Captures route, distance (mi), elevation gain (ft), optional pack weight (lb), duration (min), and post-hike RPE. " +
        "Use status='completed' (default) when the user finished the hike, or status='planned' to put an upcoming hike on the calendar " +
        "(planned hikes render as faded boot icons). For the Mt. Elbert hero goal especially, planned hikes anchor the progression. " +
        "Scheduling is idempotent per day: calling with status='planned' for a date that already has a planned hike updates that row in place (no duplicate). " +
        "To finalize a previously-planned hike (the user did the hike that was on the calendar), pass replacesPlannedHikeId — the existing planned row " +
        "is updated in place with the actual route/distance/elevation/duration/pack/rpe/notes and status flips to 'completed' (or 'skipped' if you pass that). " +
        "The original Hike id is preserved, so any downstream references stay intact. Avoids the duplicate-row trap where you'd otherwise have a " +
        "planned hike AND a completed hike on the calendar for the same trip. If the actual date differs from the planned date (planned for Saturday, " +
        "happened Sunday), pass the actual date and the row's date is updated too. Errors if the named row isn't found or isn't status='planned'.",
      inputSchema: {
        date: z.string(),
        route: z.string(),
        distanceMi: z.number().min(0),
        elevationFt: z.number().int().min(0),
        durationMin: z.number().int().min(0),
        packWeightLb: z.number().min(0).optional(),
        rpe: z.number().min(0).max(10).optional(),
        status: z.enum(["completed", "planned", "skipped"]).default("completed"),
        notes: z.string().optional(),
        replacesPlannedHikeId: z
          .string()
          .optional()
          .describe(
            "Hike id of a previously-planned hike (status='planned') to finalize in place instead of creating a new row. The row's date, route, distance, etc. are all updated to the values passed in this call. Errors if the id doesn't exist or the row isn't status='planned'.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        if (input.replacesPlannedHikeId !== undefined) {
          // Finalize-in-place path. Verify the named row exists and is still
          // in 'planned' state before updating — protects against accidental
          // double-finalize and against replacing a completed-but-stale row.
          const existing = await prisma.hike.findUnique({
            where: { id: input.replacesPlannedHikeId },
          });
          if (!existing) {
            throw new Error(
              `replacesPlannedHikeId="${input.replacesPlannedHikeId}" not found. Drop the field to log a new hike, or fix the id.`,
            );
          }
          if (existing.status !== "planned") {
            throw new Error(
              `Hike ${input.replacesPlannedHikeId} has status='${existing.status}', not 'planned'. ` +
                `Finalize-in-place only works on planned rows. To amend a finalized hike, delete_hike + log_hike (a new row).`,
            );
          }
          const updated = await prisma.hike.update({
            where: { id: input.replacesPlannedHikeId },
            data: {
              date: parseDateInput(input.date),
              route: input.route,
              distanceMi: input.distanceMi,
              elevationFt: input.elevationFt,
              durationMin: input.durationMin,
              packWeightLb: input.packWeightLb ?? null,
              rpe: input.rpe ?? null,
              status: input.status,
              notes: input.notes ?? null,
            },
          });
          return {
            id: updated.id,
            finalized: true,
            previousStatus: existing.status,
            dateMoved:
              existing.date.getTime() !== updated.date.getTime()
                ? { from: existing.date, to: updated.date }
                : null,
            message: `Planned hike finalized in place (status: planned → ${updated.status}).`,
          };
        }

        const hikeDate = parseDateInput(input.date);

        // Idempotent scheduling: at most one *planned* hike per calendar day.
        // A repeat schedule call for the same day updates the existing planned
        // row in place instead of stacking a duplicate boot icon (the two-hikes-
        // same-Saturday bug). Completed/skipped hikes can legitimately repeat on
        // a date, so this only applies to status='planned'.
        if (input.status === "planned") {
          const existingPlanned = await prisma.hike.findFirst({
            where: {
              status: "planned",
              date: { gte: startOfDay(hikeDate), lte: endOfDay(hikeDate) },
            },
            orderBy: { date: "asc" },
          });
          if (existingPlanned) {
            const updated = await prisma.hike.update({
              where: { id: existingPlanned.id },
              data: {
                date: hikeDate,
                route: input.route,
                distanceMi: input.distanceMi,
                elevationFt: input.elevationFt,
                durationMin: input.durationMin,
                packWeightLb: input.packWeightLb ?? null,
                rpe: input.rpe ?? null,
                status: "planned",
                notes: input.notes ?? null,
              },
            });
            return {
              id: updated.id,
              finalized: false,
              deduped: true,
              message:
                "Existing planned hike on this date updated in place (no duplicate planned row created). " +
                "To finalize a planned hike to completed, pass replacesPlannedHikeId.",
            };
          }
        }

        // Default path: create a new hike row.
        const h = await prisma.hike.create({
          data: {
            date: hikeDate,
            route: input.route,
            distanceMi: input.distanceMi,
            elevationFt: input.elevationFt,
            durationMin: input.durationMin,
            packWeightLb: input.packWeightLb ?? null,
            rpe: input.rpe ?? null,
            status: input.status,
            notes: input.notes ?? null,
          },
        });
        return { id: h.id, finalized: false, deduped: false, message: "Hike logged" };
      }),
  );

  server.registerTool(
    "log_note",
    {
      title: "Log a note",
      description:
        "Audible / journal / feedback / standing_rule / review. Set targetDate (yyyy-mm-dd) when the note is *about* a specific future day. When type='standing_rule', lastAcknowledgedAt is stamped to NOW so the rule starts fresh in get_today_plan's freshness ordering. For bulk note creation (e.g. promoting many rules at once), use batch_log_note. For a structured first-class weekly review (surfaced by get_latest_review) use log_review.",
      inputSchema: LogNoteShape,
    },
    async (input) => safe(() => logNoteCore(prisma, input)),
  );

  server.registerTool(
    "log_open_item",
    {
      title: "Log a resolvable open item (action thread)",
      description:
        "Create a resolvable open item — an unresolved decision, pending action, or thread to track across sessions. " +
        "NOT for plan-change coaching notes (use log_note type:'audible'). " +
        "NOT for week recaps (use log_review). " +
        "Resolve via resolve_open_item; list via list_open_items or get_session_brief.",
      inputSchema: {
        body: z
          .string()
          .min(1)
          .describe("The unresolved thread, e.g. 'Pick the Longs Peak date' or 'Test Bierstadt fueling strategy'"),
        targetDate: DateKeyShape.optional().describe(
          "Optional due/decide-by date (yyyy-mm-dd, USER_TZ). Surfaces as overdue in list_open_items / get_session_brief once past.",
        ),
        priority: z
          .enum(["high", "normal", "low"])
          .optional()
          .describe("Optional priority. Default: normal when omitted."),
      },
    },
    async (input) =>
      safe(async () => {
        const n = await prisma.note.create({
          data: {
            body: input.body,
            type: "open_item",
            targetDate: input.targetDate ? parseDateInput(input.targetDate) : null,
            priority: input.priority ?? null,
          },
        });
        return { id: n.id, message: "Open item logged" };
      }),
  );

  server.registerTool(
    "resolve_open_item",
    {
      title: "Resolve an open item",
      description:
        "Mark an open item as resolved with a reason. " +
        "Removes it from list_open_items and get_session_brief.openItems. " +
        "Errors if the note is not type:'open_item'. " +
        "Use list_open_items to find the id.",
      inputSchema: {
        id: z.string().describe("The open item's Note.id"),
        reason: z
          .string()
          .min(1)
          .describe("Brief resolution note, e.g. 'Decided on July 12 for Longs'"),
      },
    },
    async ({ id, reason }) =>
      safe(async () => {
        const note = await prisma.note.findUniqueOrThrow({ where: { id } });
        if (note.type !== "open_item") {
          throw new Error(`Note ${id} is type '${note.type}', not 'open_item'.`);
        }
        const updated = await prisma.note.update({
          where: { id },
          data: { resolvedAt: new Date(), resolvedReason: reason },
        });
        return { id: updated.id, message: "Open item resolved" };
      }),
  );

  server.registerTool(
    "log_review",
    {
      title: "Log a weekly review / Sunday recap",
      description:
        "Log a weekly review or Sunday recap as a first-class review object (NOT a plain journal note). " +
        "Surfaced by get_latest_review and get_session_brief.latestReview. " +
        "For day-to-day observations use log_note; " +
        "for trackable action items pulled out of the review use log_open_item.",
      inputSchema: {
        body: z
          .string()
          .min(1)
          .describe("The week review / Sunday recap prose."),
        weekOf: DateKeyShape.optional().describe(
          "Week-ending date the review covers (yyyy-mm-dd). Stored so get_latest_review can report it.",
        ),
      },
    },
    async (input) =>
      safe(async () => {
        const n = await prisma.note.create({
          data: {
            body: input.body,
            type: "review",
            targetDate: input.weekOf ? parseDateInput(input.weekOf) : null,
          },
        });
        return { id: n.id, message: "Review logged" };
      }),
  );

  server.registerTool(
    "log_nutrition",
    {
      title: "Log a meal",
      description:
        "Record what the user ate for one meal. Items are food groups/brands (e.g. '97% beef', 'Kroger hamburger buns', 'cheddar cheese', 'frozen vegetables') with optional free-form qty. Pass your best estimated `macros` (calories/proteinG/carbsG/fatG/fiberG/sodiumMg) so the dashboard can total the day's intake vs. target — omit any field you can't estimate. Use apply_day_override(nutritionText=…) for one-off adjustments or apply_plan_revision (Phase.nutrition.habits) for systemic changes. For logging many meals at once (e.g. a HelloFresh week), use batch_log_nutrition.",
      inputSchema: LogNutritionShape,
    },
    async (input) => safe(() => logNutritionCore(prisma, input)),
  );

  server.registerTool(
    "update_nutrition",
    {
      title: "Update a nutrition log",
      description: "Edit a logged meal's mealType / items / notes / macros / date. Pass only the fields to change. For macros, pass a number to set it or null to clear it; omitted macro fields are left unchanged.",
      inputSchema: {
        id: z.string(),
        mealType: MealTypeShape.optional(),
        items: z.array(NutritionItemShape).min(1).optional(),
        notes: z.string().nullable().optional(),
        macros: PlannedMealMacrosShape.partial()
          .extend({
            calories: z.number().nonnegative().nullable().optional(),
            proteinG: z.number().nonnegative().nullable().optional(),
            carbsG: z.number().nonnegative().nullable().optional(),
            fatG: z.number().nonnegative().nullable().optional(),
            fiberG: z.number().nonnegative().nullable().optional(),
            sodiumMg: z.number().nonnegative().nullable().optional(),
          })
          .optional()
          .describe("Macro fields to set (number) or clear (null); omit a field to leave it unchanged."),
        date: z.string().optional().describe("ISO datetime"),
      },
    },
    async (input) =>
      safe(async () => {
        const data: Record<string, unknown> = {};
        if (input.mealType !== undefined) data.mealType = input.mealType;
        if (input.items !== undefined) data.items = input.items as Prisma.InputJsonValue;
        if (input.notes !== undefined) data.notes = input.notes;
        if (input.date !== undefined) data.date = parseDateInput(input.date);
        if (input.macros !== undefined) {
          for (const k of MACRO_KEYS) {
            if (input.macros[k] !== undefined) data[k] = input.macros[k];
          }
        }
        const updated = await prisma.nutritionLog.update({ where: { id: input.id }, data });
        return { id: updated.id, message: "Nutrition updated" };
      }),
  );

  server.registerTool(
    "nutrition_log_ops",
    {
      title: "Surgical edits to a logged meal's items list",
      description:
        "Apply a sequence of addItem / updateItem / removeItem operations to a single NutritionLog's items array, without re-emitting the whole list. " +
        "Mirrors workout_ops on the nutrition side. Use when you want to fix one item on a meal — bump a qty, correct a name, add a forgotten side, drop a wrongly-logged item — without sending the full items array via update_nutrition. " +
        "Ops are applied sequentially against a working copy; any op that fails (no match, out-of-range index, ambiguous substring) aborts the batch and nothing is written. " +
        "Op types: " +
        "{op:'addItem', item:{name, qty?, notes?}, at?:'end'|'start'|number} — defaults to 'end'. " +
        "{op:'updateItem', match:string|number, patch:{name?, qty?, notes?}} — match is a 0-based index OR a case-insensitive name substring; must match exactly one item. " +
        "{op:'removeItem', match:string|number} — same match rules. " +
        "Look up the NutritionLog id and current items via recent_history. To edit which mealType a meal sits in, or its top-level notes/date, use update_nutrition.",
      inputSchema: {
        id: z.string().describe("NutritionLog.id"),
        ops: z.array(NutritionLogOpSchema).min(1).describe("Operations applied in order to the log's items array."),
      },
    },
    async ({ id, ops }) =>
      safe(async () => {
        const log = await prisma.nutritionLog.findUniqueOrThrow({ where: { id } });
        const items = parseStoredItems(log.items);
        let next: ReturnType<typeof applyNutritionLogOps>;
        try {
          next = applyNutritionLogOps(items, ops);
        } catch (e) {
          throw new Error(
            `nutrition_log_ops failed: ${e instanceof Error ? e.message : String(e)}. Nothing was written.`,
          );
        }
        await prisma.nutritionLog.update({
          where: { id },
          data: { items: next as unknown as Prisma.InputJsonValue },
        });
        return {
          id,
          itemCount: next.length,
          opsApplied: ops.length,
          items: next,
          message: `Applied ${ops.length} op${ops.length === 1 ? "" : "s"}; log now has ${next.length} item${next.length === 1 ? "" : "s"}.`,
        };
      }),
  );

  server.registerTool(
    "delete_nutrition",
    {
      title: "Delete / remove a logged meal or nutrition entry",
      description:
        "Remove a logged meal (NutritionLog row) by id. Use when a meal was logged in error, duplicated, or needs to be re-entered. " +
        "To edit instead of delete, use update_nutrition.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.nutritionLog.delete({ where: { id } });
        return { id, message: "Nutrition deleted" };
      }),
  );

  server.registerTool(
    "apply_plan_revision",
    {
      title: "Apply a plan revision",
      description:
        "Atomically write a PlanRevision and update Plan.planJson to the new full snapshot. Use after reasoning over a note + recent state. snapshotJson is the *complete* plan template after the change (cascades included). Pass resolvedNoteIds for every note this revision folds in — they'll be marked resolved in the same transaction so they drop from pending. " +
        "The snapshot is linted before it's written: structural errors (phase weeks that don't tile 1..totalWeeks, a retest week past totalWeeks) REJECT the write; non-blocking warnings (metadata drift, baseline-on-heavy-day) are returned in the response. " +
        "Plan.weeks/endsOn drift: by default this tool rewrites only the template snapshot, so if totalWeeks changed you must follow up with update_plan_metadata — OR pass cascadeMetadata=true to sync Plan.weeks and Plan.endsOn in the same transaction. Either way, when totalWeeks ≠ Plan.weeks the response carries a metadataDrift block. Goal.targetDate is never auto-changed (event date may intentionally differ from plan end) — use update_plan_metadata for that. " +
        "It also does NOT anchor anything to a specific calendar date — events (races, inserted hikes, vacation days, sick swaps) need apply_day_override on each date. If the user asked to shift, extend, insert, or skip days, your proposal must list those follow-up calls explicitly.",
      inputSchema: {
        planId: z.string(),
        summary: z.string().min(1).max(200),
        reasoning: z.string().min(1),
        snapshotJson: z.unknown().describe("Full ProgramTemplate after the revision"),
        triggerNoteId: z.string().optional(),
        triggerSource: z.enum(["note", "claude", "manual"]).default("claude"),
        resolvedNoteIds: z
          .array(z.string())
          .optional()
          .describe(
            "Notes addressed by this revision. They'll be marked resolved with a reference to the new revision id.",
          ),
        cascadeMetadata: z
          .boolean()
          .optional()
          .describe(
            "When true and the snapshot's totalWeeks differs from Plan.weeks, also update Plan.weeks and Plan.endsOn (= startedOn + totalWeeks*7) in the same transaction, so the calendar's week counter and plan range stay in sync. Does not touch Goal.targetDate.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        // Common mistake: Claude passes snapshotJson as a JSON-encoded string.
        // Auto-recover then validate structural shape.
        let snapshot: unknown = input.snapshotJson;
        if (typeof snapshot === "string") {
          try {
            snapshot = JSON.parse(snapshot);
          } catch {
            throw new Error(
              "snapshotJson was passed as a string but isn't valid JSON. Pass the ProgramTemplate as a plain object.",
            );
          }
        }
        assertValidProgramTemplate(snapshot);

        const plan = await prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
        const template = snapshot as ProgramTemplate;

        // Lint the proposed snapshot before writing. Structural errors block;
        // warnings ride along in the response. goalTargetDate isn't used by the
        // template-only rules, so the plan end stands in here.
        const lintFindings: LintFinding[] = lintTemplate(template, {
          weeks: plan.weeks,
          endsOn: plan.endsOn,
          startedOn: plan.startedOn,
          goalTargetDate: plan.endsOn,
        });
        const lintErrors = lintFindings.filter((f) => f.severity === "error");
        if (lintErrors.length > 0) {
          throw new Error(
            `Refusing to apply: the snapshot has ${lintErrors.length} structural error(s). ` +
              lintErrors.map((f) => `[${f.rule}] ${f.message}`).join(" ") +
              " Fix the template and retry.",
          );
        }
        const lintWarnings = lintFindings.filter((f) => f.severity === "warning");

        // Metadata drift / Phase-5 cascade.
        const totalWeeks = template.totalWeeks;
        const weeksChanged = totalWeeks !== plan.weeks;
        const expectedEndsOn = startOfDay(addDays(plan.startedOn, totalWeeks * 7));
        const willCascade = weeksChanged && input.cascadeMetadata === true;

        const resolveIds = [
          ...new Set([
            ...(input.resolvedNoteIds ?? []),
            ...(input.triggerNoteId ? [input.triggerNoteId] : []),
          ]),
        ];
        const { rev, resolvedCount } = await prisma.$transaction(async (tx) => {
          const r = await tx.planRevision.create({
            data: {
              planId: plan.id,
              triggerNoteId: input.triggerNoteId ?? null,
              triggerSource: input.triggerSource,
              summary: input.summary,
              reasoning: input.reasoning,
              snapshotJson: snapshot as Prisma.InputJsonValue,
            },
          });
          await tx.plan.update({
            where: { id: plan.id },
            data: {
              planJson: snapshot as Prisma.InputJsonValue,
              ...(willCascade ? { weeks: totalWeeks, endsOn: expectedEndsOn } : {}),
            },
          });
          let resolvedCount = 0;
          if (resolveIds.length > 0) {
            const update = await tx.note.updateMany({
              where: { id: { in: resolveIds }, resolvedAt: null },
              data: {
                resolvedAt: r.createdAt,
                resolvedReason: `applied via revision ${r.id}`,
              },
            });
            resolvedCount = update.count;
          }
          return { rev: r, resolvedCount };
        });

        // Surface drift so the two can't silently diverge even when the coach
        // didn't opt into the cascade.
        const metadataDrift = weeksChanged
          ? {
              planWeeks: plan.weeks,
              snapshotTotalWeeks: totalWeeks,
              currentEndsOn: toDateKey(plan.endsOn),
              expectedEndsOn: toDateKey(expectedEndsOn),
              cascaded: willCascade,
              ...(willCascade
                ? {}
                : { fix: "Call update_plan_metadata to sync Plan.weeks/endsOn (and Goal.targetDate if the goal date moved)." }),
            }
          : null;

        return {
          revisionId: rev.id,
          resolvedNoteCount: resolvedCount,
          warnings: lintWarnings,
          metadataDrift,
          message:
            `Plan revision applied${resolvedCount > 0 ? ` (resolved ${resolvedCount} note(s))` : ""}` +
            (willCascade ? ` — Plan.weeks/endsOn synced to ${totalWeeks}w.` : "") +
            (metadataDrift && !willCascade ? " — metadata drift detected (see metadataDrift); follow up with update_plan_metadata." : "") +
            (lintWarnings.length > 0 ? ` ${lintWarnings.length} lint warning(s).` : ""),
        };
      }),
  );

  server.registerTool(
    "update_plan_metadata",
    {
      title: "Extend / shorten / rename plan; shift goal date",
      description:
        "Use this to extend or shorten the plan duration, change the plan end date, rename the plan, or shift the goal target date / race day / event day. " +
        "Patches the active Plan's metadata fields (name, endsOn, weeks) and optionally the parent Goal's targetDate atomically. " +
        "Use this when a plan revision shifted the schedule — apply_plan_revision only rewrites planJson, not the Plan/Goal columns " +
        "that PlanOverview, the calendar's isInPlan range, baseline retest scheduling, and the goal-date pin all read. " +
        "All four fields are optional but at least one must be set. Dates are yyyy-mm-dd in USER_TZ. Keep planJson.totalWeeks in sync " +
        "with `weeks` yourself — this tool does not touch the snapshot.",
      inputSchema: {
        planId: z.string(),
        name: z.string().min(1).max(200).optional(),
        endsOn: DateKeyShape.optional(),
        weeks: z.number().int().min(1).max(104).optional(),
        goalTargetDate: DateKeyShape.optional().describe(
          "If set, also updates the parent Goal.targetDate in the same transaction.",
        ),
      },
    },
    async (input) =>
      safe(async () => {
        if (
          input.name === undefined &&
          input.endsOn === undefined &&
          input.weeks === undefined &&
          input.goalTargetDate === undefined
        ) {
          throw new Error(
            "Nothing to update — pass at least one of name, endsOn, weeks, or goalTargetDate.",
          );
        }
        const plan = await prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
        const planData: Record<string, unknown> = {};
        if (input.name !== undefined) planData.name = input.name;
        if (input.endsOn !== undefined) planData.endsOn = startOfDay(parseDateKey(input.endsOn));
        if (input.weeks !== undefined) planData.weeks = input.weeks;

        await prisma.$transaction(async (tx) => {
          if (Object.keys(planData).length > 0) {
            await tx.plan.update({ where: { id: plan.id }, data: planData });
          }
          if (input.goalTargetDate !== undefined) {
            await tx.goal.update({
              where: { id: plan.goalId },
              data: { targetDate: startOfDay(parseDateKey(input.goalTargetDate)) },
            });
          }
        });

        const changed: string[] = [];
        if (input.name !== undefined) changed.push("name");
        if (input.endsOn !== undefined) changed.push("endsOn");
        if (input.weeks !== undefined) changed.push("weeks");
        if (input.goalTargetDate !== undefined) changed.push("goalTargetDate");
        return {
          planId: plan.id,
          goalId: plan.goalId,
          updated: changed,
          message: `Plan metadata updated (${changed.join(", ")})`,
        };
      }),
  );

  server.registerTool(
    "apply_day_override",
    {
      title: "Override a single day",
      description:
        "PATCH-style partial update for a single date's override on the active plan. " +
        "Only fields you pass are touched: omit a field to leave its current value alone; pass null to clear a previously-set field. " +
        "Pass workoutJson as a full DayTemplate (object, not stringified) to swap the regular blocks; null clears the workout swap. " +
        "workoutJson is validated: must be an object with title (string) and blocks (array of { exercises: [{ name, … }] }); " +
        `dayOfWeek (1..7) and category (upper|lower|zone2-mobility|calisthenics|lower-power|long-endurance|rest) checked when present. ` +
        `Stringified payload must be ≤ ${MAX_DAY_TEMPLATE_BYTES.toLocaleString()} bytes (real DayTemplates are 2–8KB; oversized usually means a full plan snapshot was pasted by mistake). ` +
        "Validation errors name the specific field — read them and fix the named field, don't guess. " +
        "Alternative to workoutJson: pass workoutJsonOps for surgical edits — an array of {op: addExercise|updateExercise|removeExercise, …}. Ops apply to the existing override's workoutJson if one exists, else to the rotation-day template, so you can add/edit/remove one exercise without re-emitting the whole DayTemplate. Mutually exclusive with workoutJson. Examples: " +
        "[{op:'addExercise', block:'Mobility', exercise:{name:'Calf Stretch', durationSec:30}}] adds to the end of the Mobility block. " +
        "[{op:'updateExercise', exerciseName:'Hollow Body Hold', patch:{durationSec:60}}] bumps the duration. " +
        "[{op:'removeExercise', exerciseName:'Bird-Dog'}] drops it. " +
        "If an exerciseName matches in multiple blocks, pass `block` (substring or index) to disambiguate. After ops apply, the result is validated like a full workoutJson — same field-level errors. " +
        "Pass baselineTestNames as an array of testName strings (any test from the program's baselineWeek) to override which baseline tests appear today — " +
        "empty array = no tests; null = revert to rotation default; omit to leave unchanged. " +
        "When you pass workoutJson on a date that has rotation-default baselines AND no prior baseline decision exists on this override, " +
        "you MUST also pass baselineTestNames explicitly (re-list to keep, [] to suppress, swap to replace). Once a baseline decision is on file, " +
        "subsequent calls that only update other fields (e.g. nutritionText) will preserve it. Don't tell the user to ignore the baseline form — own the decision. " +
        "Day-level nutrition has two shapes: nutritionText is free-form prose (e.g. 'hydrate heavily today'); nutritionPlan is structured per-slot meal planning (preworkout/breakfast/lunch/snack/postworkout/dinner) rendered alongside logged meals. " +
        "nutritionPlan is PATCH-merged slot-by-slot against the existing plan: omit a slot to keep it, pass null to clear that slot, pass an object to replace it. Pass null on the whole nutritionPlan field to clear every slot at once. " +
        "Prefer nutritionPlan when prescribing specific meals — it renders structured and shows planned-vs-eaten adherence. " +
        "Returns the list of fields actually changed by this call. " +
        "For applying many overrides atomically (e.g. a 12-day meal-planning batch), use batch_apply_day_overrides — all-or-nothing transaction.",
      inputSchema: ApplyDayOverrideShape,
    },
    async (input) =>
      safe(async () => {
        const program = await getActiveProgram();
        if (!program) throw new Error("No active plan");
        return applyDayOverrideCore(prisma, program, input);
      }),
  );

  server.registerTool(
    "clear_day_override",
    {
      title: "Clear a single-day override",
      inputSchema: { date: DateKeyShape },
    },
    async ({ date }) =>
      safe(async () => {
        const program = await getActiveProgram();
        if (!program) throw new Error("No active plan");
        const d = startOfDay(parseDateKey(date));
        const r = await prisma.planDayOverride.deleteMany({
          where: { planId: program.id, date: d },
        });
        return { removed: r.count };
      }),
  );

  server.registerTool(
    "update_goal_targets",
    {
      title: "Update a goal's readiness scoring (targets / rubric / weighted metrics)",
      description:
        "Replace the readiness-targets array — the weighted metrics that define 'ready for the goal' (e.g. body weight ≤ 155 lb, 1.5-mi run ≤ 11:30, max pull-ups ≥ 12). " +
        "Use when adjusting the success criteria / rubric / scoring weights for the goal. " +
        "Each target = { metric, label, target, weight, units, direction, rationale? }. Weights should sum near 1. " +
        "Read the current targets via get_goal first; this is a full-replace, not a patch.",
      inputSchema: {
        goalId: z.string(),
        targets: z.array(z.unknown()),
      },
    },
    async ({ goalId, targets }) =>
      safe(async () => {
        await prisma.goal.update({
          where: { id: goalId },
          data: { targets: targets as Prisma.InputJsonValue },
        });
        return { message: "Targets updated" };
      }),
  );

  server.registerTool(
    "update_note",
    {
      title: "Edit a note (body, type, target date, resolve)",
      description:
        "Edit an existing note's body, type, or targetDate without losing the note id. " +
        "Common uses: fix a typo, retarget a note to a different date, change a journal entry to a feedback note, or mark a pending audible 'resolved' by rewriting the body. " +
        "Pass only the fields to change; omit the rest. To change type to standing_rule, prefer promote_note (it stamps lastAcknowledgedAt). To delete entirely, use delete_note. " +
        "Note types: journal / audible / feedback / standing_rule / review. Note: open_item is not a retargetable type here — create open items via log_open_item.",
      inputSchema: {
        id: z.string(),
        body: z.string().optional(),
        type: NoteTypeShape.optional(),
        targetDate: DateKeyShape.nullable().optional().describe(
          "Pass an ISO date to retarget; pass null to clear; omit to leave unchanged",
        ),
      },
    },
    async (input) =>
      safe(async () => {
        const data: Record<string, unknown> = {};
        if (input.body !== undefined) data.body = input.body;
        if (input.type !== undefined) data.type = input.type;
        if (input.targetDate !== undefined) {
          data.targetDate = input.targetDate ? startOfDay(parseDateKey(input.targetDate)) : null;
        }
        const updated = await prisma.note.update({
          where: { id: input.id },
          data,
        });
        return { id: updated.id, message: "Note updated" };
      }),
  );

  server.registerTool(
    "update_baseline",
    {
      title: "Update a logged baseline result",
      description:
        "Fix a baseline value/units/date/notes after the fact. Common when the user logs a misinterpreted score (e.g. total weight instead of per-DB).",
      inputSchema: {
        id: z.string(),
        value: z.number().optional(),
        units: z.string().optional(),
        date: z.string().optional().describe("ISO datetime"),
        notes: z.string().nullable().optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const data: Record<string, unknown> = {};
        if (input.value !== undefined) data.value = input.value;
        if (input.units !== undefined) data.units = input.units;
        if (input.date !== undefined) data.date = parseDateInput(input.date);
        if (input.notes !== undefined) data.notes = input.notes;
        const before = await prisma.baseline.findUniqueOrThrow({ where: { id: input.id } });
        const updated = await prisma.baseline.update({ where: { id: input.id }, data });
        await syncBaselineUpdateToWorkout({
          testName: updated.testName,
          oldDate: before.date,
          oldValue: before.value,
          newDate: updated.date,
          newValue: updated.value,
          newUnits: updated.units,
          newNotes: updated.notes,
        });
        return { id: updated.id, message: "Baseline updated (workout synced)" };
      }),
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete / remove a note (journal, audible, feedback, standing rule)",
      description:
        "Permanently remove a note by id — any type (journal, audible, feedback, standing_rule, review, open_item). " +
        "PlanRevision.triggerNoteId references are set to null (the audit entry stays but loses the link). " +
        "To resolve a note without deleting (preserves history), use acknowledge_notes. To edit, use update_note.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.note.delete({ where: { id } });
        return { id, message: "Note deleted" };
      }),
  );

  server.registerTool(
    "promote_note",
    {
      title: "Change a note's type (e.g. promote feedback → standing_rule)",
      description:
        "Change the type of an existing note. The intended use is promoting a feedback-type note that captures a persistent coaching rule into the standing_rule type so it auto-surfaces in get_today_plan. Also accepts type:'review' to promote a note to a first-class review. When promoting to 'standing_rule', lastAcknowledgedAt is stamped to now (override with stampAcknowledged=false to preserve any existing timestamp). Propose before applying — show the user the note text and the target type before calling. Use list_promotable_notes to discover candidates. Note: open_item is not a retargetable type here — create open items via log_open_item.",
      inputSchema: {
        id: z.string().describe("Note id (from list_promotable_notes or get_pending_notes)"),
        type: NoteTypeShape.describe("Target type — usually 'standing_rule'"),
        stampAcknowledged: z
          .boolean()
          .default(true)
          .describe(
            "When promoting to standing_rule, stamp lastAcknowledgedAt = NOW (default true). Pass false to keep any existing timestamp untouched.",
          ),
      },
    },
    async ({ id, type, stampAcknowledged }) =>
      safe(async () => {
        const existing = await prisma.note.findUniqueOrThrow({ where: { id } });
        const updated = await prisma.note.update({
          where: { id },
          data: {
            type,
            lastAcknowledgedAt:
              type === "standing_rule" && stampAcknowledged
                ? new Date()
                : existing.lastAcknowledgedAt,
          },
        });
        return {
          id: updated.id,
          fromType: existing.type,
          toType: updated.type,
          lastAcknowledgedAt: updated.lastAcknowledgedAt,
          message: `Note promoted: ${existing.type} → ${updated.type}`,
        };
      }),
  );

  server.registerTool(
    "acknowledge_standing_rule",
    {
      title: "Refresh a standing rule's lastAcknowledgedAt",
      description:
        "Stamp lastAcknowledgedAt = NOW on a standing_rule note. Call when you reference a rule in a coaching turn so its freshness signal reflects continued relevance — stale-looking rules are easier to flag for review. No-op for non-rule notes (returns an error). This is bookkeeping, not a side-effect on the user's plan; no propose-before-apply gate.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        const existing = await prisma.note.findUniqueOrThrow({ where: { id } });
        if (existing.type !== "standing_rule") {
          throw new Error(
            `Note ${id} is type='${existing.type}', not 'standing_rule'. Use promote_note first if you want to make it a standing rule.`,
          );
        }
        const updated = await prisma.note.update({
          where: { id },
          data: { lastAcknowledgedAt: new Date() },
        });
        return { id: updated.id, lastAcknowledgedAt: updated.lastAcknowledgedAt };
      }),
  );

  server.registerTool(
    "delete_measurement",
    {
      title: "Delete / remove a body weight / HR / body-fat measurement",
      description:
        "Remove a body measurement (weight, resting HR, body fat %, etc.) by id. " +
        "Use when a measurement was logged in error or with the wrong value. To correct rather than delete, log a new measurement with the right value.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.measurement.delete({ where: { id } });
        return { id, message: "Measurement deleted" };
      }),
  );

  server.registerTool(
    "delete_baseline",
    {
      title: "Delete / remove a fitness test / baseline result",
      description:
        "Remove a baseline test result (1.5-mi run, max pull-ups, etc.) by id. " +
        "Use when the result was logged with the wrong value or for the wrong test. " +
        "Also removes the mirrored exercise from that day's baseline workout (and deletes the workout if it has no exercises left). " +
        "To correct rather than delete, use update_baseline.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        const row = await prisma.baseline.findUniqueOrThrow({ where: { id } });
        await prisma.baseline.delete({ where: { id } });
        await removeBaselineFromDayWorkout({ testName: row.testName, date: row.date });
        return { id, message: "Baseline deleted (workout synced)" };
      }),
  );

  server.registerTool(
    "delete_hike",
    {
      title: "Delete / remove / cancel a hike (completed or planned)",
      description:
        "Remove a hike (completed or planned) by id. Use to delete a hike logged in error, or cancel a planned/scheduled hike that's no longer happening. " +
        "Planned hikes that drop off the calendar this way leave no marker; if you want to record that it was skipped, log a journal note instead before deleting.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.hike.delete({ where: { id } });
        return { id, message: "Hike deleted" };
      }),
  );

  server.registerTool(
    "update_workout",
    {
      title: "Edit a logged workout's header fields",
      description:
        "PATCH-style partial update for an already-logged Workout. " +
        "Only fields you pass are touched: omit a field to leave it unchanged; pass null on a nullable field (title, notes, source, sourceUrl) to clear it. " +
        "Use for fixing a wrong title, rewording the session notes (e.g. correcting framing on a cycling note), changing source attribution, or correcting startedAt drift. " +
        "Does NOT touch exercises or sets — use update_workout_exercise / update_workout_set for those. " +
        "status accepts planned | completed | skipped. Returns the list of fields actually changed.",
      inputSchema: {
        id: z.string(),
        title: z.string().nullish().describe("null clears; omit to leave unchanged."),
        notes: z.string().nullish().describe("null clears; omit to leave unchanged."),
        source: z.string().nullish().describe("e.g. 'manual', 'strong.app', 'claude', 'imported'. null clears."),
        sourceUrl: z.string().nullish(),
        startedAt: z.string().optional().describe("ISO datetime, e.g. 2026-05-02T15:59:00-06:00. Omit to leave unchanged."),
        status: z.enum(["planned", "completed", "skipped"]).optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const data: Prisma.WorkoutUpdateInput = {};
        const updatedFields: string[] = [];
        if (input.title !== undefined) { data.title = input.title; updatedFields.push("title"); }
        if (input.notes !== undefined) { data.notes = input.notes; updatedFields.push("notes"); }
        if (input.source !== undefined) { data.source = input.source; updatedFields.push("source"); }
        if (input.sourceUrl !== undefined) { data.sourceUrl = input.sourceUrl; updatedFields.push("sourceUrl"); }
        if (input.startedAt !== undefined) {
          const d = new Date(input.startedAt);
          if (Number.isNaN(d.getTime())) throw new Error(`startedAt is not a valid ISO datetime: ${input.startedAt}`);
          data.startedAt = d;
          updatedFields.push("startedAt");
        }
        if (input.status !== undefined) { data.status = input.status; updatedFields.push("status"); }
        if (updatedFields.length === 0) {
          return { id: input.id, updatedFields, message: "No fields provided — nothing changed." };
        }
        await prisma.workout.update({ where: { id: input.id }, data });
        return {
          id: input.id,
          updatedFields,
          message: `Workout updated (changed: ${updatedFields.join(", ")}). Other fields preserved.`,
        };
      }),
  );

  server.registerTool(
    "update_workout_exercise",
    {
      title: "Edit one exercise on a logged workout",
      description:
        "PATCH-style update for a single WorkoutExercise row (one exercise within a logged session). " +
        "Pass the exercise's id (look it up via export_workout). Edits name, equipment, notes, or orderIndex. " +
        "Does NOT add or remove exercises and does NOT touch sets — use update_workout_set for set-level edits. " +
        "null clears nullable fields (equipment, notes). Returns the list of fields actually changed.",
      inputSchema: {
        id: z.string(),
        name: z.string().min(1).optional(),
        equipment: z.string().nullish(),
        notes: z.string().nullish(),
        orderIndex: z.number().int().min(0).optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const data: Prisma.WorkoutExerciseUpdateInput = {};
        const updatedFields: string[] = [];
        if (input.name !== undefined) { data.name = input.name; updatedFields.push("name"); }
        if (input.equipment !== undefined) { data.equipment = input.equipment; updatedFields.push("equipment"); }
        if (input.notes !== undefined) { data.notes = input.notes; updatedFields.push("notes"); }
        if (input.orderIndex !== undefined) { data.orderIndex = input.orderIndex; updatedFields.push("orderIndex"); }
        if (updatedFields.length === 0) {
          return { id: input.id, updatedFields, message: "No fields provided — nothing changed." };
        }
        await prisma.workoutExercise.update({ where: { id: input.id }, data });
        return {
          id: input.id,
          updatedFields,
          message: `Exercise updated (changed: ${updatedFields.join(", ")}). Other fields preserved.`,
        };
      }),
  );

  server.registerTool(
    "update_workout_set",
    {
      title: "Edit one set on a logged workout",
      description:
        "PATCH-style update for a single Set row (one set within a logged exercise). " +
        "Pass the set's id (look it up via export_workout). Edits setIndex, reps, weightLb, durationSec, distanceMi, rpe, or notes. " +
        "Use to correct a mis-logged rep count, weight, RPE, or annotation without re-logging the whole workout. " +
        "null clears nullable fields (all metric fields and notes). Returns the list of fields actually changed.",
      inputSchema: {
        id: z.string(),
        setIndex: z.number().int().min(0).optional(),
        reps: z.number().int().min(0).nullish(),
        weightLb: z.number().min(0).nullish(),
        durationSec: z.number().min(0).nullish(),
        distanceMi: z.number().min(0).nullish(),
        rpe: z.number().min(0).max(10).nullish(),
        notes: z.string().nullish(),
      },
    },
    async (input) =>
      safe(async () => {
        const data: Prisma.SetUpdateInput = {};
        const updatedFields: string[] = [];
        if (input.setIndex !== undefined) { data.setIndex = input.setIndex; updatedFields.push("setIndex"); }
        if (input.reps !== undefined) { data.reps = input.reps; updatedFields.push("reps"); }
        if (input.weightLb !== undefined) { data.weightLb = input.weightLb; updatedFields.push("weightLb"); }
        if (input.durationSec !== undefined) { data.durationSec = input.durationSec; updatedFields.push("durationSec"); }
        if (input.distanceMi !== undefined) { data.distanceMi = input.distanceMi; updatedFields.push("distanceMi"); }
        if (input.rpe !== undefined) { data.rpe = input.rpe; updatedFields.push("rpe"); }
        if (input.notes !== undefined) { data.notes = input.notes; updatedFields.push("notes"); }
        if (updatedFields.length === 0) {
          return { id: input.id, updatedFields, message: "No fields provided — nothing changed." };
        }
        await prisma.set.update({ where: { id: input.id }, data });
        return {
          id: input.id,
          updatedFields,
          message: `Set updated (changed: ${updatedFields.join(", ")}). Other fields preserved.`,
        };
      }),
  );

  server.registerTool(
    "workout_ops",
    {
      title: "Atomic structural edits to a logged workout",
      description:
        "Apply a sequence of add/remove operations on a logged Workout in one all-or-nothing transaction. " +
        "Use when you need to fix a logged session by adding a forgotten exercise/set or removing a wrongly-logged one — covers the structural gap left by update_workout / update_workout_exercise / update_workout_set, which only edit existing rows. " +
        "Ops are applied sequentially; any failure rolls the whole batch back, so you never end up with an orphaned exercise that has no sets. " +
        "Op types: " +
        "{op:'addExercise', workoutId, exercise:{name, equipment?, notes?, orderIndex?, sets?:[{setIndex, reps?, weightLb?, durationSec?, distanceMi?, rpe?, notes?}]}} — appends an exercise (orderIndex defaults to max+1) with optional initial sets. " +
        "{op:'removeExercise', exerciseId} — drops one WorkoutExercise (cascade-deletes its sets). " +
        "{op:'addSet', workoutExerciseId, set:{setIndex?, reps?, weightLb?, durationSec?, distanceMi?, rpe?, notes?}} — adds a set (setIndex defaults to max+1). " +
        "{op:'removeSet', setId} — drops one set. " +
        "Look up IDs via export_workout. For pure metric edits (changing a rep count, fixing a title), prefer update_workout / update_workout_set — they're simpler and don't need the transaction.",
      inputSchema: {
        ops: z.array(WorkoutOpSchema).min(1).describe("Operations applied in order, atomically."),
      },
    },
    async ({ ops }) =>
      safe(async () => {
        const applied: string[] = [];
        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < ops.length; i++) {
            const op = ops[i]!;
            try {
              if (op.op === "addExercise") {
                const orderIndex =
                  op.exercise.orderIndex ??
                  ((await tx.workoutExercise.aggregate({
                    where: { workoutId: op.workoutId },
                    _max: { orderIndex: true },
                  }))._max.orderIndex ?? -1) + 1;
                const created = await tx.workoutExercise.create({
                  data: {
                    workoutId: op.workoutId,
                    name: op.exercise.name,
                    equipment: op.exercise.equipment ?? null,
                    notes: op.exercise.notes ?? null,
                    orderIndex,
                    sets: op.exercise.sets
                      ? {
                          create: op.exercise.sets.map((s, idx) => ({
                            setIndex: s.setIndex ?? idx + 1,
                            reps: s.reps ?? null,
                            weightLb: s.weightLb ?? null,
                            durationSec: s.durationSec ?? null,
                            distanceMi: s.distanceMi ?? null,
                            rpe: s.rpe ?? null,
                            notes: s.notes ?? null,
                          })),
                        }
                      : undefined,
                  },
                });
                applied.push(
                  `addExercise → ${created.id} (${op.exercise.sets?.length ?? 0} set${op.exercise.sets?.length === 1 ? "" : "s"})`,
                );
              } else if (op.op === "removeExercise") {
                await tx.workoutExercise.delete({ where: { id: op.exerciseId } });
                applied.push(`removeExercise → ${op.exerciseId}`);
              } else if (op.op === "addSet") {
                const setIndex =
                  op.set.setIndex ??
                  ((await tx.set.aggregate({
                    where: { workoutExerciseId: op.workoutExerciseId },
                    _max: { setIndex: true },
                  }))._max.setIndex ?? 0) + 1;
                const created = await tx.set.create({
                  data: {
                    workoutExerciseId: op.workoutExerciseId,
                    setIndex,
                    reps: op.set.reps ?? null,
                    weightLb: op.set.weightLb ?? null,
                    durationSec: op.set.durationSec ?? null,
                    distanceMi: op.set.distanceMi ?? null,
                    rpe: op.set.rpe ?? null,
                    notes: op.set.notes ?? null,
                  },
                });
                applied.push(`addSet → ${created.id} (setIndex=${setIndex})`);
              } else if (op.op === "removeSet") {
                await tx.set.delete({ where: { id: op.setId } });
                applied.push(`removeSet → ${op.setId}`);
              }
            } catch (e) {
              throw new Error(
                `workout_ops failed at ops[${i}] (op=${op.op}): ${e instanceof Error ? e.message : String(e)}. Whole batch rolled back; nothing was written.`,
              );
            }
          }
        });
        return { count: applied.length, applied, message: `Applied ${applied.length} op${applied.length === 1 ? "" : "s"} atomically.` };
      }),
  );

  server.registerTool(
    "delete_workout",
    {
      title: "Delete / remove a logged workout / session",
      description:
        "Permanently remove a Workout row by id. Cascade-deletes its exercises and sets — irreversible, use carefully. " +
        "Common reasons: duplicate import from a Strong paste, accidental log, or a test-data row. " +
        "Records (PRs) recompute from remaining workouts on next read; the deleted session no longer contributes.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.workout.delete({ where: { id } });
        return { id, message: "Workout deleted" };
      }),
  );

  server.registerTool(
    "add_goal_reference",
    {
      title: "Attach a URL / link / reference document to a goal",
      description:
        "Append a reference (URL, trail report, route guide, article, pasted doc snippet) to a goal so it persists across coaching turns. " +
        "Use when the user shares a link about their goal — Mt. Elbert trail conditions, a training article, a race course PDF, equipment guides. " +
        "Optional claudeSummary captures the key takeaway from the reference so future turns don't have to re-fetch. " +
        "Read existing references via get_goal.",
      inputSchema: {
        goalId: z.string(),
        kind: z.enum(["url", "doc"]),
        value: z.string().min(1),
        label: z.string().optional(),
        claudeSummary: z.string().optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const goal = await prisma.goal.findUniqueOrThrow({ where: { id: input.goalId } });
        const refs = (Array.isArray(goal.references) ? goal.references : []) as Array<Record<string, unknown>>;
        const next = [
          ...refs,
          {
            id: crypto.randomUUID(),
            kind: input.kind,
            value: input.value,
            label: input.label,
            claudeSummary: input.claudeSummary,
            addedAt: new Date().toISOString(),
          },
        ];
        await prisma.goal.update({
          where: { id: input.goalId },
          data: { references: next as unknown as Prisma.InputJsonValue },
        });
        return { count: next.length, message: "Reference added" };
      }),
  );

  server.registerTool(
    "update_goal_legend",
    {
      title: "Set or clear a goal's calendar legend",
      description:
        "Replace the goal's legend array (drives the calendar legend AND which icons render in cells). Pass empty array OR omit `legend` to reset to the built-in default. Each entry = { icon, label, kind } where kind ∈ {trained, hike-completed, hike-planned, override, goal-date, baseline}: trained=days a workout exists, hike-completed=logged outdoor day, hike-planned=upcoming hike, override=custom day-level marker, goal-date=the goal's target date pin, baseline=days a baseline test is scheduled (◎N marker). Closed enum; passing a `kind` outside this set fails Zod validation and returns an error envelope — new render conditions need a code change. `icon` is a free-form string (any emoji or character); only `kind` is enumerated.\n\nPreset legends (single-line JSON, pick + adapt to the goal's flavor):\nhike: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🥾\",\"label\":\"Outdoor day\",\"kind\":\"hike-completed\"},{\"icon\":\"🥾\",\"label\":\"Hike planned\",\"kind\":\"hike-planned\"},{\"icon\":\"⛏️\",\"label\":\"Custom day\",\"kind\":\"override\"},{\"icon\":\"🏔️\",\"label\":\"Goal date\",\"kind\":\"goal-date\"},{\"icon\":\"◎\",\"label\":\"Baseline due\",\"kind\":\"baseline\"}]\nstrength: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏋️\",\"label\":\"Heavy day\",\"kind\":\"override\"},{\"icon\":\"🏆\",\"label\":\"Meet day\",\"kind\":\"goal-date\"},{\"icon\":\"◎\",\"label\":\"Baseline due\",\"kind\":\"baseline\"}]\nrunning: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏃\",\"label\":\"Long run\",\"kind\":\"override\"},{\"icon\":\"🥇\",\"label\":\"Race day\",\"kind\":\"goal-date\"},{\"icon\":\"◎\",\"label\":\"Baseline due\",\"kind\":\"baseline\"}]\nsnowboard: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏂\",\"label\":\"Ride day\",\"kind\":\"override\"},{\"icon\":\"🎿\",\"label\":\"Season opener\",\"kind\":\"goal-date\"},{\"icon\":\"◎\",\"label\":\"Baseline due\",\"kind\":\"baseline\"}]\n\nWhen you create or activate a non-hike goal, propose a goal-appropriate legend immediately. Follow 'Propose before applying' — show the proposed legend, get approval, then call this tool (or pass `legend` directly to create_goal). If the user names a flavor ('use the strength legend'), apply the matching preset without further prompting.",
      inputSchema: {
        goalId: z.string(),
        legend: LegendSchema.optional().describe(
          "Full legend array. Pass empty array or omit to reset to the default legend.",
        ),
      },
    },
    async ({ goalId, legend }) =>
      safe(async () => {
        const next =
          legend && legend.length > 0
            ? (legend as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull;
        await prisma.goal.update({
          where: { id: goalId },
          data: { legend: next },
        });
        return {
          message:
            legend && legend.length > 0
              ? `Legend updated (${legend.length} entries)`
              : "Legend reset to default",
        };
      }),
  );

  server.registerTool(
    "create_goal",
    {
      title: "Create a new goal (with optional legend)",
      description:
        "Create a new Goal and scaffold its Plan + initial PlanRevision in one nested write. Use when the user names a new training goal that should drive coaching going forward. Pass `legend` inline to set goal-flavor iconography in the same call (otherwise the calendar uses the default hike-flavored legend until you call update_goal_legend separately). Empty array OR omitting `legend` are equivalent — both leave the goal on the default legend. `targetDate` must be a yyyy-mm-dd string (USER_TZ midnight); resolve relative dates ('tomorrow', 'next Friday') yourself before calling. `copyFromGoalId` copies the targets array from any existing goal regardless of status. If you receive an unclear response, call list_goals BEFORE retrying — duplicates are not auto-prevented.",
      inputSchema: {
        objective: z.string().min(1).max(200),
        targetDate: DateKeyShape,
        notes: z.string().optional(),
        kind: z.enum(["fitness", "project"]).default("fitness").describe(
          "Goal domain; determines which tool pack Claude uses. fitness = workout/hike/baseline tools; project = schedule_item/log_metric/GitHub tools.",
        ),
        copyFromGoalId: z
          .string()
          .optional()
          .describe("Copy targets array from this existing goal (any status)"),
        legend: LegendSchema.optional().describe(
          "Calendar legend; see update_goal_legend description for preset examples by goal flavor",
        ),
      },
    },
    async ({ objective, targetDate, notes, kind, copyFromGoalId, legend }) =>
      safe(async () => {
        const parsedDate = parseDateInput(targetDate);
        const { goal, planId } = await createGoalCore({
          objective,
          targetDate: parsedDate,
          notes,
          kind,
          copyFromGoalId,
          legend,
        });
        return {
          goalId: goal.id,
          planId,
          message: `Goal created: ${objective}${legend && legend.length > 0 ? " (with custom legend)" : ""}`,
        };
      }),
  );

  // --------------------------------------------------------------------------
  // Batch tools. Each wraps N operations in a single Prisma $transaction so
  // the whole batch either commits or rolls back together. Operations run
  // sequentially within the txn, so an op that establishes a precondition
  // (e.g. a baseline decision via apply_day_override) is visible to later ops
  // in the same batch — the audible-with-baselines guard won't re-fire.
  // On any op throwing, the txn rolls back and the response names the index
  // of the failing op plus the underlying error.
  // --------------------------------------------------------------------------

  const MAX_BATCH_SIZE = 50;

  server.registerTool(
    "batch_apply_day_overrides",
    {
      title: "Apply many day overrides atomically (batch / bulk / transactional)",
      description:
        "Apply multiple apply_day_override operations in one all-or-nothing transaction. " +
        "Use for multi-day plans (HelloFresh-style 12-day meal layout, vacation cascade, week-long rest block) where partial application would leave the calendar half-updated. " +
        "Each operation has the same shape as a single apply_day_override call. Operations run sequentially within the transaction: an earlier op's baselineTestNames decision is visible to a later op on the same date, so the audible-with-baselines guard doesn't re-fire mid-batch. " +
        `Max ${MAX_BATCH_SIZE} operations per call. On any failure the entire batch rolls back; the response names the failing index, the date being processed, and the underlying error so you can fix and retry.`,
      inputSchema: {
        operations: z
          .array(ApplyDayOverrideSchema)
          .min(1)
          .max(MAX_BATCH_SIZE)
          .describe("Array of apply_day_override inputs, applied sequentially in one txn."),
      },
    },
    async ({ operations }) =>
      safe(async () => {
        const program = await getActiveProgram();
        if (!program) throw new Error("No active plan");
        const results = await prisma.$transaction(async (tx) => {
          const out: ApplyDayOverrideResult[] = [];
          for (let i = 0; i < operations.length; i++) {
            try {
              out.push(await applyDayOverrideCore(tx, program, operations[i]!));
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              throw new Error(
                `batch_apply_day_overrides failed at operation [${i}] (date=${operations[i]!.date}): ${msg}. ` +
                  `Transaction rolled back; no operations applied. Fix this op and retry the batch.`,
              );
            }
          }
          return out;
        });
        return {
          applied: results.length,
          results,
          message: `Batch applied ${results.length} override${results.length === 1 ? "" : "s"} atomically.`,
        };
      }),
  );

  server.registerTool(
    "batch_log_nutrition",
    {
      title: "Log many meals atomically (batch / bulk nutrition entry)",
      description:
        "Log multiple meals in one all-or-nothing transaction. " +
        "Use for bulk meal entry — a full HelloFresh week, prepped meal-prep schedule, or replaying meals from a paper log. " +
        "Each operation has the same shape as a single log_nutrition call (mealType, items[], notes?, macros?, date?). " +
        `Max ${MAX_BATCH_SIZE} operations per call. On any failure the entire batch rolls back; the response names the failing index and the underlying error.`,
      inputSchema: {
        operations: z
          .array(LogNutritionSchema)
          .min(1)
          .max(MAX_BATCH_SIZE)
          .describe("Array of log_nutrition inputs, applied sequentially in one txn."),
      },
    },
    async ({ operations }) =>
      safe(async () => {
        const results = await prisma.$transaction(async (tx) => {
          const out: { id: string; message: string }[] = [];
          for (let i = 0; i < operations.length; i++) {
            try {
              out.push(await logNutritionCore(tx, operations[i]!));
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              throw new Error(
                `batch_log_nutrition failed at operation [${i}]: ${msg}. ` +
                  `Transaction rolled back; no meals were logged. Fix this op and retry.`,
              );
            }
          }
          return out;
        });
        return {
          applied: results.length,
          results,
          message: `Batch logged ${results.length} meal${results.length === 1 ? "" : "s"} atomically.`,
        };
      }),
  );

  server.registerTool(
    "batch_log_note",
    {
      title: "Log many notes atomically (batch / bulk note entry)",
      description:
        "Log multiple notes in one all-or-nothing transaction. " +
        "Use for bulk note creation — importing a backlog of standing rules, attaching journal entries across many dates, or seeding feedback for a planning session. " +
        "Each operation has the same shape as a single log_note call (body, type?, targetDate?). Types: journal / audible / feedback / standing_rule / review. type='standing_rule' stamps lastAcknowledgedAt for each, same as the single-op tool. " +
        `Max ${MAX_BATCH_SIZE} operations per call. On any failure the entire batch rolls back; the response names the failing index and the underlying error.`,
      inputSchema: {
        operations: z
          .array(LogNoteSchema)
          .min(1)
          .max(MAX_BATCH_SIZE)
          .describe("Array of log_note inputs, applied sequentially in one txn."),
      },
    },
    async ({ operations }) =>
      safe(async () => {
        const results = await prisma.$transaction(async (tx) => {
          const out: { id: string; message: string }[] = [];
          for (let i = 0; i < operations.length; i++) {
            try {
              out.push(await logNoteCore(tx, operations[i]!));
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              throw new Error(
                `batch_log_note failed at operation [${i}]: ${msg}. ` +
                  `Transaction rolled back; no notes were logged. Fix this op and retry.`,
              );
            }
          }
          return out;
        });
        return {
          applied: results.length,
          results,
          message: `Batch logged ${results.length} note${results.length === 1 ? "" : "s"} atomically.`,
        };
      }),
  );
}
