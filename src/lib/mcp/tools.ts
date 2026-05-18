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
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { formatWorkout, type ExportFormat } from "@/lib/formatters";
import { createGoalCore } from "@/lib/goal-core";
import { LegendSchema } from "@/lib/legend";
import { getActiveProgram } from "@/lib/program";
import { assertValidProgramTemplate } from "@/lib/program-validation";
import {
  getBaselineHistory,
  getBaselineSchedule,
  getBaselineSummaries,
  getExerciseHistory,
  getExerciseSummaries,
} from "@/lib/records";

const DateKeyShape = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
  .describe("ISO date yyyy-mm-dd in the user's local time zone");

const NoteTypeShape = z.enum(["journal", "audible", "feedback"]);

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

export function registerAll(server: McpServer) {
  registerReadTools(server);
  registerWriteTools(server);
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
        "Resolve today's workout, nutrition phase, mobility, baselines due, and any logged workouts. Combines the user's active plan rotation with per-day overrides. Returns full DayTemplate plus context.",
    },
    async () =>
      safe(async () => {
        const r = await resolveDay(new Date());
        return r;
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
      title: "Recent activity history",
      description:
        "Pull recent workouts, measurements, notes, baselines, and hikes. Use before proposing a plan revision so the audible reflects the user's actual recent state.",
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
            where: { date: { gte: since } },
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
      title: "List goals",
      description: "Every goal with active flag, target date, status, and target count.",
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
          targetCount: Array.isArray(g.targets) ? (g.targets as unknown[]).length : 0,
          activePlanId: g.plans[0]?.id ?? null,
        }));
      }),
  );

  server.registerTool(
    "get_goal",
    {
      title: "Get goal detail",
      description:
        "Full goal with targets, references, the active plan (with planJson), and the most recent plan revisions. Use to gather everything before proposing a revision.",
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
        return goal;
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
      title: "Weekly summary data",
      description:
        "Bundle one week's data (workouts, measurements, notes, baselines, hikes) for a coaching review. weekOffset=0 is the current week, -1 is last week.",
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
      title: "Baseline schedule + status",
      description:
        "All scheduled baseline tests for the active plan with per-checkpoint status (initial week 1 + each retest week). Includes overdue/due flags.",
    },
    async () => safe(() => getBaselineSchedule()),
  );

  server.registerTool(
    "get_baseline_history",
    {
      title: "Baseline history for a test",
      description: "All results for one baseline test, oldest first.",
      inputSchema: { testName: z.string() },
    },
    async ({ testName }) => safe(() => getBaselineHistory(testName)),
  );

  server.registerTool(
    "get_records_summary",
    {
      title: "Records summary (PRs + baselines)",
      description: "Per-exercise PRs (1RM/reps/duration) plus baseline summaries.",
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
    "get_exercise_history",
    {
      title: "History for one exercise",
      description: "Best-set-per-session over time for a specific exercise.",
      inputSchema: {
        name: z.string(),
        equipment: z.string().optional(),
      },
    },
    async ({ name, equipment }) =>
      safe(() => getExerciseHistory(name, equipment ?? null)),
  );

  server.registerTool(
    "export_workout",
    {
      title: "Export a workout",
      description:
        "Format a stored workout as Strong/Markdown/Plain/JSON for sharing. Default 'strong' round-trips the import format.",
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
        return { id: created.id, message: "Workout logged" };
      }),
  );

  server.registerTool(
    "log_measurement",
    {
      title: "Log a body measurement",
      description: "Daily weigh-in / resting HR / body fat / etc.",
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
      title: "Log a baseline test result",
      description:
        "Initial collection or retest. Use a testName from the program template's baseline week if applicable, or a custom name.",
      inputSchema: {
        testName: z.string(),
        value: z.number(),
        units: z.string(),
        date: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const date = input.date ? parseDateInput(input.date) : new Date();
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
        return { id: b.id, message: "Baseline logged (and appended to day's baseline workout)" };
      }),
  );

  server.registerTool(
    "log_hike",
    {
      title: "Log a hike",
      description: "Use status='completed' (default) or 'planned' for upcoming hikes.",
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
      },
    },
    async (input) =>
      safe(async () => {
        const h = await prisma.hike.create({
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
        return { id: h.id, message: "Hike logged" };
      }),
  );

  server.registerTool(
    "log_note",
    {
      title: "Log a note",
      description:
        "Audible / journal / feedback. Set targetDate (yyyy-mm-dd) when the note is *about* a specific future day.",
      inputSchema: {
        body: z.string(),
        type: NoteTypeShape.default("journal"),
        targetDate: DateKeyShape.optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const n = await prisma.note.create({
          data: {
            body: input.body,
            type: input.type,
            targetDate: input.targetDate ? startOfDay(parseDateKey(input.targetDate)) : null,
          },
        });
        return { id: n.id, message: "Note logged" };
      }),
  );

  server.registerTool(
    "log_nutrition",
    {
      title: "Log a meal",
      description:
        "Record what the user ate for one meal. Items are food groups/brands (e.g. '97% beef', 'Kroger hamburger buns', 'cheddar cheese', 'frozen vegetables') with optional free-form qty. Estimate macros from item names + qty when reasoning — there are no macro fields. Use apply_day_override(nutritionText=…) for one-off adjustments or apply_plan_revision (Phase.nutrition.habits) for systemic changes.",
      inputSchema: {
        mealType: MealTypeShape,
        items: z.array(NutritionItemShape).min(1),
        notes: z.string().optional(),
        date: z.string().optional().describe("ISO datetime; default = now"),
      },
    },
    async (input) =>
      safe(async () => {
        const n = await prisma.nutritionLog.create({
          data: {
            date: input.date ? parseDateInput(input.date) : new Date(),
            mealType: input.mealType,
            items: input.items as Prisma.InputJsonValue,
            notes: input.notes ?? null,
          },
        });
        return { id: n.id, message: "Nutrition logged" };
      }),
  );

  server.registerTool(
    "update_nutrition",
    {
      title: "Update a nutrition log",
      description: "Edit a logged meal's mealType / items / notes / date. Pass only the fields to change.",
      inputSchema: {
        id: z.string(),
        mealType: MealTypeShape.optional(),
        items: z.array(NutritionItemShape).min(1).optional(),
        notes: z.string().nullable().optional(),
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
        const updated = await prisma.nutritionLog.update({ where: { id: input.id }, data });
        return { id: updated.id, message: "Nutrition updated" };
      }),
  );

  server.registerTool(
    "delete_nutrition",
    {
      title: "Delete a nutrition log",
      description: "Remove a logged meal by id.",
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
        "Atomically write a PlanRevision and update Plan.planJson to the new full snapshot. Use after reasoning over a note + recent state. snapshotJson is the *complete* plan template after the change (cascades included). Pass resolvedNoteIds for every note this revision folds in — they'll be marked resolved in the same transaction so they drop from pending.",
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
            data: { planJson: snapshot as Prisma.InputJsonValue },
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
        return {
          revisionId: rev.id,
          resolvedNoteCount: resolvedCount,
          message: `Plan revision applied${resolvedCount > 0 ? ` (resolved ${resolvedCount} note(s))` : ""}`,
        };
      }),
  );

  server.registerTool(
    "update_plan_metadata",
    {
      title: "Update plan dates / name and the parent goal's target date",
      description:
        "Patch the active Plan's metadata fields (name, endsOn, weeks) and optionally the parent Goal's targetDate atomically. " +
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
        "Replace one date's workout / baseline tests / nutrition / mobility for the active plan. " +
        "Pass workoutJson as a full DayTemplate (object, not stringified) to swap the regular blocks. " +
        "Pass baselineTestNames as an array of testName strings (any test from the program's baselineWeek) " +
        "to override which baseline tests appear today — empty array = no tests; omit to keep rotation default. " +
        "When you pass workoutJson on a date that has rotation-default baselines, you MUST also pass " +
        "baselineTestNames explicitly (re-list to keep, [] to suppress, swap to replace). Don't tell the user " +
        "to ignore the baseline form — own the decision.",
      inputSchema: {
        date: DateKeyShape,
        workoutJson: z.unknown().optional(),
        baselineTestNames: z
          .array(z.string())
          .optional()
          .describe(
            "Override which baseline tests show today. Empty array suppresses tests entirely; omit to keep rotation default. Required when workoutJson is set on a date with rotation-default baselines.",
          ),
        nutritionText: z.string().optional(),
        mobilityText: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) =>
      safe(async () => {
        const program = await getActiveProgram();
        if (!program) throw new Error("No active plan");
        const date = startOfDay(parseDateKey(input.date));

        // Audible-with-baselines guard: if Claude is swapping the workout on a
        // date where baselines would normally appear by rotation, force an
        // explicit baselineTestNames decision. Three valid choices: keep
        // (re-list the same names), suppress ([]), or swap (different names).
        if (input.workoutJson !== undefined && input.baselineTestNames === undefined) {
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

        // Auto-recover: Claude sometimes passes workoutJson as a JSON-encoded
        // string. Parse it back to an object before storing so resolveDay can
        // read it as a DayTemplate.
        let workoutValue: unknown = input.workoutJson;
        if (typeof workoutValue === "string") {
          try {
            workoutValue = JSON.parse(workoutValue);
          } catch {
            throw new Error(
              "workoutJson was passed as a string but isn't valid JSON. Pass the DayTemplate as a plain object.",
            );
          }
        }

        const workoutWrite =
          workoutValue === undefined
            ? Prisma.JsonNull
            : (workoutValue as Prisma.InputJsonValue);
        const baselinesWrite =
          input.baselineTestNames === undefined
            ? Prisma.JsonNull
            : (input.baselineTestNames as Prisma.InputJsonValue);

        const created = await prisma.planDayOverride.upsert({
          where: { planId_date: { planId: program.id, date } },
          create: {
            planId: program.id,
            date,
            workoutJson: workoutWrite,
            baselineTestNames: baselinesWrite,
            nutritionText: input.nutritionText ?? null,
            mobilityText: input.mobilityText ?? null,
            notes: input.notes ?? null,
          },
          update: {
            workoutJson: workoutWrite,
            baselineTestNames: baselinesWrite,
            nutritionText: input.nutritionText ?? null,
            mobilityText: input.mobilityText ?? null,
            notes: input.notes ?? null,
          },
        });
        return { overrideId: created.id, dateKey: toDateKey(date), message: "Override applied" };
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
      title: "Update a goal's readiness targets",
      description:
        "Replace the targets array. Each target = { metric, label, target, weight, units, direction, rationale? }. Weights should sum near 1.",
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
      title: "Update or resolve a note",
      description:
        "Edit a note's body / type / targetDate. Useful for marking a pending audible 'resolved' (rewrite the body) or fixing a typo without losing the note id.",
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
      title: "Delete a note",
      description:
        "Remove a Note row by id. PlanRevision.triggerNoteId references are set to null (the audit entry stays but loses the link).",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.note.delete({ where: { id } });
        return { id, message: "Note deleted" };
      }),
  );

  server.registerTool(
    "delete_measurement",
    {
      title: "Delete a measurement",
      description: "Remove a body weight / HR / body-fat row by id.",
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
      title: "Delete a baseline result",
      description: "Remove a baseline test result by id. Also removes the mirrored exercise from that day's baseline workout (and deletes the workout if it has no exercises left).",
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
      title: "Delete a hike",
      description: "Remove a hike row by id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      safe(async () => {
        await prisma.hike.delete({ where: { id } });
        return { id, message: "Hike deleted" };
      }),
  );

  server.registerTool(
    "delete_workout",
    {
      title: "Delete a workout",
      description:
        "Remove a Workout row by id. Cascade-deletes its exercises and sets. Use carefully.",
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
      title: "Attach a reference to a goal",
      description:
        "Append a URL or pasted-doc reference. Optional claudeSummary documents what you took away from it.",
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
        "Replace the goal's legend array (drives the calendar legend AND which icons render in cells). Pass empty array OR omit `legend` to reset to the built-in default. Each entry = { icon, label, kind } where kind ∈ {trained, hike-completed, hike-planned, override, goal-date}: trained=days a workout exists, hike-completed=logged outdoor day, hike-planned=upcoming hike, override=custom day-level marker, goal-date=the goal's target date pin. Closed enum; passing a `kind` outside this set fails Zod validation and returns an error envelope — new render conditions need a code change. `icon` is a free-form string (any emoji or character); only `kind` is enumerated.\n\nPreset legends (single-line JSON, pick + adapt to the goal's flavor):\nhike: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🥾\",\"label\":\"Outdoor day\",\"kind\":\"hike-completed\"},{\"icon\":\"🥾\",\"label\":\"Hike planned\",\"kind\":\"hike-planned\"},{\"icon\":\"★\",\"label\":\"Custom day\",\"kind\":\"override\"},{\"icon\":\"🏔️\",\"label\":\"Goal date\",\"kind\":\"goal-date\"}]\nstrength: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏋️\",\"label\":\"Heavy day\",\"kind\":\"override\"},{\"icon\":\"🏆\",\"label\":\"Meet day\",\"kind\":\"goal-date\"}]\nrunning: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏃\",\"label\":\"Long run\",\"kind\":\"override\"},{\"icon\":\"🥇\",\"label\":\"Race day\",\"kind\":\"goal-date\"}]\nsnowboard: [{\"icon\":\"●\",\"label\":\"Trained\",\"kind\":\"trained\"},{\"icon\":\"🏂\",\"label\":\"Ride day\",\"kind\":\"override\"},{\"icon\":\"🎿\",\"label\":\"Season opener\",\"kind\":\"goal-date\"}]\n\nWhen you create or activate a non-hike goal, propose a goal-appropriate legend immediately. Follow 'Propose before applying' — show the proposed legend, get approval, then call this tool (or pass `legend` directly to create_goal). If the user names a flavor ('use the strength legend'), apply the matching preset without further prompting.",
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
        copyFromGoalId: z
          .string()
          .optional()
          .describe("Copy targets array from this existing goal (any status)"),
        legend: LegendSchema.optional().describe(
          "Calendar legend; see update_goal_legend description for preset examples by goal flavor",
        ),
      },
    },
    async ({ objective, targetDate, notes, copyFromGoalId, legend }) =>
      safe(async () => {
        const parsedDate = parseDateInput(targetDate);
        const { goal, planId } = await createGoalCore({
          objective,
          targetDate: parsedDate,
          notes,
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
}
