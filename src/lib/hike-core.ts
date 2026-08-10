// Plain async helpers for Hike mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/day-log-actions.ts) AND MCP route handlers / tool
// registrations (src/lib/mcp/tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Dual-caller contract:
//   - Server actions call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed.

import { Prisma } from "@/generated/prisma/client";
import { prisma, getDb } from "@/lib/db";
import { startOfDay, endOfDay } from "@/lib/calendar";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";
import { mirrorActivityGoalLink, swallowAutoLinkError } from "@/lib/attribution-hooks";
import { getRotationOwnerGoal, getActiveProgramMembership } from "@/lib/program";
import { getFocusGoal } from "@/lib/goal-focus";

// ---------------------------------------------------------------------------
// logHikeCore — verbatim lift of tools.ts:2404-2549 handler logic
// ---------------------------------------------------------------------------

export interface LogHikeCoreInput {
  date: Date;
  route: string;
  distanceMi: number;
  elevationFt: number;
  durationMin: number;
  packWeightLb?: number | null;
  rpe?: number | null;
  status?: string; // default "completed"
  notes?: string | null;
  // null/omitted = the DEFAULT goal: the rotation-owning goal under a
  // Program (see logHikeCore's resolution block); the focus goal for
  // zero-Program tenants (legacy behavior, byte-identical).
  goalId?: string | null;
  replacesPlannedHikeId?: string;
}

export interface LogHikeCoreResult {
  id: string;
  finalized: boolean;
  deduped?: boolean;
  previousStatus?: string;
  dateMoved?: { from: Date; to: Date } | null;
  message: string;
}

export async function logHikeCore(input: LogHikeCoreInput): Promise<LogHikeCoreResult> {
  const db = await getDb();
  const status = input.status ?? "completed";

  // Resolve the DEFAULT attribution goal — what a null/omitted goalId means,
  // at write time AND at read time (legacy rows with goalId=null read through
  // this same default, so the two can never diverge — issue #298 AC).
  //
  // #298: under a Program the default is the ROTATION-OWNING goal (the goal
  // whose prescription drives today) when it is fitness. A Program without a
  // fitness rotation owner falls back to the single active fitness member if
  // exactly ONE exists; with MULTIPLE fitness members the default is
  // AMBIGUOUS — new attribution writes are rejected below (asking for an
  // explicit goalId) rather than silently misattributed. A Program with no
  // fitness members at all (pure-project shape) keeps the legacy focus
  // fallback — nothing Program-side can own a hike. Zero-Program tenants are
  // byte-identical to the pre-sweep behavior: null means "focus goal at read
  // time" (resolved inside getRotationOwnerGoal's legacy branch).
  //
  // defaultGoalId is fetched once so the attribution paths, the idempotency
  // check, and the link mirrors below all share one interpretation of null.
  const resolution = await getRotationOwnerGoal();
  let defaultGoalId: string | null = null;
  let defaultIsAmbiguous = false;
  if (resolution.mode === "program") {
    if (resolution.goalId !== null && resolution.goalKind === "fitness") {
      defaultGoalId = resolution.goalId;
    } else {
      const membership = await getActiveProgramMembership();
      const fitnessMembers = (membership?.memberGoals ?? []).filter(
        (g) => g.kind === "fitness" && g.status === "active",
      );
      if (fitnessMembers.length === 1) {
        defaultGoalId = fitnessMembers[0].id;
      } else if (fitnessMembers.length > 1) {
        // Resolved to an error only when the default is actually NEEDED (a
        // new attribution write with no explicit goalId) — see the gate
        // below. Finalize-in-place keeps working: the row's stored goalId
        // stays authoritative and the mirror degrades to null.
        defaultIsAmbiguous = true;
      } else {
        // Zero fitness members (pure-project Program): nothing Program-side
        // can own a hike — keep the legacy focus fallback (goal-focus.ts's
        // deterministic winner), the pre-sweep interpretation of null.
        const focusGoal = await getFocusGoal();
        defaultGoalId = focusGoal?.id ?? null;
      }
    }
  } else {
    defaultGoalId = resolution.goalId;
  }

  let resolvedGoalId: string | null = null;
  if (input.goalId) {
    const targetGoal = await db.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true, active: true },
    });
    if (!targetGoal) throw new Error(`Goal "${input.goalId}" not found.`);
    if (!targetGoal.active) {
      throw new Error(
        `Goal "${input.goalId}" is not tracked (active=false). Activate it before logging hikes against it.`,
      );
    }
    resolvedGoalId = input.goalId;
  } else {
    resolvedGoalId = defaultGoalId;
  }

  if (input.replacesPlannedHikeId !== undefined) {
    // Finalize-in-place path. Verify the named row exists and is still
    // in 'planned' state before updating — protects against accidental
    // double-finalize and against replacing a completed-but-stale row.
    const existing = await db.hike.findUnique({
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
    const updated = await db.hike.update({
      where: { id: input.replacesPlannedHikeId },
      data: {
        date: input.date,
        route: input.route,
        distanceMi: input.distanceMi,
        elevationFt: input.elevationFt,
        durationMin: input.durationMin,
        packWeightLb: input.packWeightLb ?? null,
        rpe: input.rpe ?? null,
        status,
        notes: input.notes ?? null,
      },
    });
    // #308 v1b: mirror the row's authoritative goalId into the link table
    // (null goalId = legacy default-at-read-time attribution → the resolved
    // default id; null again when the default is ambiguous — the mirror
    // no-ops rather than guessing). No-op without an active Program /
    // non-member goal; idempotent; best-effort (the hike row is already
    // written).
    await mirrorActivityGoalLink(db, {
      activityType: ACTIVITY_LINK_TYPE.hike,
      activityId: updated.id,
      goalId: updated.goalId ?? defaultGoalId,
      date: updated.date,
    }).catch(swallowAutoLinkError("logHikeCore:finalize"));
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

  // Ambiguity gate — only for paths that would PERSIST the default as this
  // hike's attribution (the create/dedup paths below). Deliberately after the
  // finalize-in-place branch above: finalizing a planned row never needs the
  // default (the row's stored goalId stays authoritative), so ambiguity must
  // not block it.
  if (!input.goalId && defaultIsAmbiguous) {
    throw new Error(
      "This Program has multiple fitness member goals and no rotation owner to default to — " +
        "pass goalId explicitly so the hike is attributed to the right goal (list_goals shows ids).",
    );
  }

  const hikeDate = input.date;

  // Idempotent scheduling: at most one *planned* hike per calendar day PER GOAL.
  // A repeat schedule call for the same day + goal updates the existing planned
  // row in place instead of stacking a duplicate boot icon. Two different goals
  // CAN each plan a hike on the same day (intentional multi-goal support).
  // Completed/skipped hikes can legitimately repeat on a date, so this only
  // applies to status='planned'.
  //
  // Legacy rows may have goalId=null (default-goal attribution at read time —
  // rotation owner under a Program, focus goal for zero-Program tenants).
  // When the resolved goal IS that default, also match null-attributed rows
  // so a re-schedule deduplicates instead of creating a duplicate day entry.
  if (status === "planned") {
    // matchesNullAttribution: resolvedGoalId is non-null and equals the
    // default goal, so null-goalId rows are the same logical hike as this one.
    const matchesNullAttribution =
      resolvedGoalId !== null && resolvedGoalId === defaultGoalId;
    const existingPlanned = await db.hike.findFirst({
      where: {
        status: "planned",
        date: { gte: startOfDay(hikeDate), lte: endOfDay(hikeDate) },
        // Scope idempotency to the resolved goalId so two goals can each plan
        // a hike on the same day. Also catch legacy null-attributed rows when
        // the resolved goal is the current default goal.
        ...(matchesNullAttribution
          ? { OR: [{ goalId: resolvedGoalId }, { goalId: null }] }
          : { goalId: resolvedGoalId }),
      },
      orderBy: { date: "asc" },
    });
    if (existingPlanned) {
      const updated = await db.hike.update({
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
      // #308 v1b mirror — the row keeps its stored goalId (the update never
      // touches it); a legacy null-attributed row falls back to the resolved
      // goal (== the default goal in the branch that matched it).
      await mirrorActivityGoalLink(db, {
        activityType: ACTIVITY_LINK_TYPE.hike,
        activityId: updated.id,
        goalId: updated.goalId ?? resolvedGoalId,
        date: updated.date,
      }).catch(swallowAutoLinkError("logHikeCore:dedup"));
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
  const h = await db.hike.create({
    data: {
      date: hikeDate,
      route: input.route,
      distanceMi: input.distanceMi,
      elevationFt: input.elevationFt,
      durationMin: input.durationMin,
      packWeightLb: input.packWeightLb ?? null,
      rpe: input.rpe ?? null,
      status,
      notes: input.notes ?? null,
      // null = default-goal attribution at read time (Hike.goalId nullable
      // FK): rotation owner under a Program, focus goal for zero-Program
      // tenants — see the resolution block at the top of this function.
      goalId: resolvedGoalId,
    },
  });
  // #308 v1b mirror — Hike.goalId stays authoritative; the link is a
  // read-model copy written only when the goal is an active Program member.
  await mirrorActivityGoalLink(db, {
    activityType: ACTIVITY_LINK_TYPE.hike,
    activityId: h.id,
    goalId: h.goalId ?? null,
    date: h.date,
  }).catch(swallowAutoLinkError("logHikeCore:create"));
  return { id: h.id, finalized: false, deduped: false, message: "Hike logged" };
}

// ---------------------------------------------------------------------------
// updateHikeCore — PATCH any existing hike row in place.
//
// Mirrors apply_day_override's PATCH envelope ({ updatedFields, preservedFields }).
// Distinct from logHikeCore's replacesPlannedHikeId, which finalizes a *planned*
// row into completed — update_hike edits a row in place WITHOUT changing what it
// represents (fix attribution / backfill summitFt / correct fields without
// losing splits, rpe, or notes via delete-and-relog).
// ---------------------------------------------------------------------------

// Columns update_hike can patch, in stable display order (drives the envelope).
const HIKE_PATCH_FIELDS = [
  "date",
  "route",
  "distanceMi",
  "elevationFt",
  "summitFt",
  "packWeightLb",
  "durationMin",
  "status",
  "rpe",
  "notes",
  "goalId",
] as const;
type HikePatchField = (typeof HIKE_PATCH_FIELDS)[number];

export interface UpdateHikeCoreInput {
  id: string;
  date?: string;
  route?: string;
  distanceMi?: number;
  elevationFt?: number;
  summitFt?: number | null;
  packWeightLb?: number | null;
  durationMin?: number;
  status?: string;
  rpe?: number | null;
  notes?: string | null;
  goalId?: string | null;
}

export type UpdateHikeCoreResult =
  | { ok: false; error: "hike_not_found"; id: string }
  | { ok: false; error: "goal_not_found"; goalId: string }
  | {
      ok: true;
      id: string;
      updatedFields: string[];
      preservedFields: string[];
      hike: Awaited<ReturnType<typeof prisma.hike.update>>;
    };

export async function updateHikeCore(
  input: UpdateHikeCoreInput,
  parseDate: (s: string) => Date,
): Promise<UpdateHikeCoreResult> {
  const db = await getDb();
  // THE correctness detail: a key is "present" if it was supplied in the
  // payload — INCLUDING an explicit null (= clear a nullable field). Absent OR
  // undefined means preserve. Because null !== undefined, summitFt:null and
  // rpe:0 both count as present and round-trip correctly. We test presence,
  // never truthiness.
  const present = (k: HikePatchField) => k in input && input[k] !== undefined;

  const existing = await db.hike.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, error: "hike_not_found", id: input.id };

  // Validate goalId BEFORE writing so a bad ref never leaves a partial update.
  // `!= null` is exactly "present and non-null" — null (clear) and absent
  // (preserve) both legitimately skip the existence check.
  if (input.goalId != null) {
    const goal = await db.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true },
    });
    if (!goal) return { ok: false, error: "goal_not_found", goalId: input.goalId };
  }

  // Unchecked update lets us assign the goalId scalar (incl. null = clear)
  // directly instead of relation connect/disconnect.
  const data: Prisma.HikeUncheckedUpdateInput = {};
  const updatedFields: string[] = [];

  for (const f of HIKE_PATCH_FIELDS) {
    if (!present(f)) continue;
    if (f === "date") {
      data.date = parseDate(input.date!);
    } else {
      // Non-nullable columns already had null rejected by Zod; nullable ones
      // pass null through to clear. Scalar assignment via unchecked input.
      (data as Record<string, unknown>)[f] = input[f];
    }
    updatedFields.push(f);
  }

  const hike = await db.hike.update({ where: { id: input.id }, data });
  const preservedFields = HIKE_PATCH_FIELDS.filter(
    (f) => !updatedFields.includes(f),
  );
  return { ok: true, id: hike.id, updatedFields, preservedFields, hike };
}

// ---------------------------------------------------------------------------
// deleteHikeCore (#272 delete-hook consolidation)
// ---------------------------------------------------------------------------

export interface DeleteHikeCoreResult {
  id: string;
  /** The deleted hike's date, captured before deletion so callers can check
   *  for a mirror override the delete would strand (tools.ts pairs this with
   *  orphanedOverrideWarning — object rows and their mirror overrides aren't
   *  linked; see override-integrity.ts). Null only in the unreachable case
   *  where the row vanished between the read and the delete. */
  date: Date | null;
}

/**
 * Delete one Hike row AND its ActivityGoalLink rows in the same transaction.
 * A missing id throws P2025 from hike.delete, exactly as the previous inline
 * delete did. Sequential top-level tx calls (never nested writes) so the
 * getDb() tenant-scoping extension fires for both deletes.
 */
export async function deleteHikeCore(id: string): Promise<DeleteHikeCoreResult> {
  const db = await getDb();
  const existing = await db.hike.findUnique({
    where: { id },
    select: { date: true },
  });
  await db.$transaction(async (tx) => {
    await tx.hike.delete({ where: { id } });
    await tx.activityGoalLink.deleteMany({
      where: { activityType: ACTIVITY_LINK_TYPE.hike, activityId: id },
    });
  });
  return { id, date: existing?.date ?? null };
}
