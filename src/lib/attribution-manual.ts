// src/lib/attribution-manual.ts — attribute_activity / list_activity_links cores
// (the coach's MANUAL attribution valve). Split from src/lib/attribution.ts at
// merge time: that module owns the PURE auto-link evaluators (hint/rule matching);
// this one owns the explicit add/remove/list core functions the MCP tools call.
// src/lib/attribution.ts
//
// #278 (Sprint 17 — Seam flip): the MANUAL attribution valve on top of the
// auto-link engine — plain async cores for the attribute_activity and
// list_activity_links MCP tools (src/lib/mcp/tools/program-tools.ts). Same
// dual-caller contract as program-core.ts: no server-action directive, so a
// future /program dashboard can call these directly.
//
// ActivityGoalLink is POLYMORPHIC — (activityType, activityId) with no FK to
// the activity table (see src/lib/activity-links.ts for the canonical type
// strings and the delete-hook/orphan-verifier compensation story).
//
// Semantics (issue #278 ACs, remove re-specced by UXR-PV-89):
//   add    → create a source='explicit' link, or UPGRADE an existing 'auto'
//            row to 'explicit' IN PLACE (explicit-beats-auto; the unique
//            constraint on (activityType, activityId, goalId) is never asked
//            to absorb a duplicate). Adding over a source='removed' TOMBSTONE
//            REVIVES it to 'explicit' — the same in-place update path, so
//            "the coach changed their mind" needs no delete+recreate.
//            activityDate is denormalized from the ACTIVITY row's own date
//            column at write time — never "now" — so retroactive attribution
//            of an old activity lands on the day the activity happened.
//   remove → TOMBSTONE, not delete (UXR-PV-89): the row is UPDATED to
//            source='removed' and kept, so the unique key keeps occupying the
//            (activityType, activityId, goalId) slot and the auto-link
//            engine's `createMany({ skipDuplicates: true })` (ON CONFLICT DO
//            NOTHING) can never resurrect the link — not at log time, not
//            from scripts/backfill-attribution.ts. 'Remove always wins' is
//            now DURABLE, which a hard delete never was: delete the row,
//            re-run the rules over that activity (a backfill, say) and the
//            link returned. Removing a link that does not exist — or one
//            already tombstoned — is an idempotent no-op success, and remove
//            deliberately does NOT require the underlying activity to still
//            exist. Tombstones whose activity row is later deleted are still
//            garbage: the activity delete-hooks hard-delete ALL of the
//            activity's link rows including tombstones (the tombstone's job
//            is done — nothing can re-link a nonexistent activity), and the
//            orphan verifier (scripts/verify-activity-links.ts) still flags
//            any tombstone that outlives its activity row.
//            Default reads exclude tombstones: listActivityLinksCore filters
//            source='removed' out unless includeRemoved is passed (audit).
//
// Scoping: every DB access goes through getDb() (ActivityGoalLink, Goal and
// all six activity models are SCOPED_MODELS) — userId is injected into reads
// and writes automatically. No nested relation WRITES anywhere (gotcha
// §B.10: nested writes bypass the $extends injection); every mutation is a
// sequential top-level call on the transaction client. Read projections use
// explicit selects and never include userId (leaky-reads discipline —
// coverage in src/lib/mcp/leaky-reads.test.ts).

import { getDb, type ScopedClient } from "@/lib/db";
import { startOfDay } from "@/lib/calendar-core";
import {
  ACTIVITY_LINK_TYPES,
  type ActivityLinkType,
} from "@/lib/activity-links";

// The stripped client visible inside a ScopedClient.$transaction callback —
// same derivation as src/lib/mcp/idempotency.ts's ScopedTx.
type ScopedTx = Parameters<Parameters<ScopedClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Shared link projection (never selects userId)
// ---------------------------------------------------------------------------

const LINK_SELECT = {
  id: true,
  activityType: true,
  activityId: true,
  goalId: true,
  source: true,
  note: true,
  activityDate: true,
  createdAt: true,
} as const;

export interface ActivityLinkRow {
  id: string;
  activityType: string;
  activityId: string;
  goalId: string;
  source: string;
  note: string | null;
  activityDate: Date;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Per-type activity lookup
// ---------------------------------------------------------------------------
// Resolves the activity row's OWN date column (schema comment on
// ActivityGoalLink.activityDate: USER_TZ midnight). Workouts date by
// startedAt (DateTime — Strong exports carry time-of-day); every other type
// has a `date` column. Returns null when the row does not exist for this
// user (the scoped client injects userId into findUnique's where).
// ---------------------------------------------------------------------------

async function findActivityRawDate(
  tx: ScopedTx,
  activityType: ActivityLinkType,
  activityId: string,
): Promise<Date | null> {
  switch (activityType) {
    case "workout": {
      const row = await tx.workout.findUnique({
        where: { id: activityId },
        select: { startedAt: true },
      });
      return row?.startedAt ?? null;
    }
    case "hike": {
      const row = await tx.hike.findUnique({
        where: { id: activityId },
        select: { date: true },
      });
      return row?.date ?? null;
    }
    case "nutrition": {
      const row = await tx.nutritionLog.findUnique({
        where: { id: activityId },
        select: { date: true },
      });
      return row?.date ?? null;
    }
    case "measurement": {
      const row = await tx.measurement.findUnique({
        where: { id: activityId },
        select: { date: true },
      });
      return row?.date ?? null;
    }
    case "baseline": {
      const row = await tx.baseline.findUnique({
        where: { id: activityId },
        select: { date: true },
      });
      return row?.date ?? null;
    }
    case "log_entry": {
      const row = await tx.logEntry.findUnique({
        where: { id: activityId },
        select: { date: true },
      });
      return row?.date ?? null;
    }
  }
}

// ---------------------------------------------------------------------------
// attributeActivityCore
// ---------------------------------------------------------------------------

export interface AttributeActivityCoreInput {
  activityType: ActivityLinkType;
  activityId: string;
  goalId: string;
  action: "add" | "remove";
  /** add only. Provided ⇒ replaces the stored note; omitted ⇒ existing note
   *  is kept on upgrade. Blank strings normalize to null. */
  note?: string | null;
}

export interface AttributeActivityCoreResult {
  action: "add" | "remove";
  /** false = idempotent no-op (link already explicit and identical / nothing
   *  to remove / already tombstoned). */
  changed: boolean;
  /** add only: an existing source='auto' row was upgraded to 'explicit' in
   *  place (no second row was created). */
  upgraded: boolean;
  /** add only: an existing source='removed' TOMBSTONE was revived to
   *  'explicit' in place (UXR-PV-89 — the coach changed their mind). */
  revived: boolean;
  /** add only. */
  goalObjective: string | null;
  /** add only: the resulting link row. */
  link: ActivityLinkRow | null;
  /** remove only: the source of the link that was tombstoned (null when
   *  there was nothing to remove, or it was already a tombstone). Remove
   *  always wins regardless of this value. */
  removedSource: string | null;
}

export async function attributeActivityCore(
  input: AttributeActivityCoreInput,
): Promise<AttributeActivityCoreResult> {
  // Defensive contract check — the MCP tool boundary Zod-enums this already.
  if (!(ACTIVITY_LINK_TYPES as readonly string[]).includes(input.activityType)) {
    throw new Error(
      `Unknown activityType "${input.activityType}" — expected one of: ${ACTIVITY_LINK_TYPES.join(" | ")}.`,
    );
  }

  const db = await getDb();

  if (input.action === "remove") {
    return db.$transaction(async (tx) => {
      const existing = await tx.activityGoalLink.findUnique({
        where: {
          activityType_activityId_goalId: {
            activityType: input.activityType,
            activityId: input.activityId,
            goalId: input.goalId,
          },
        },
        select: { id: true, source: true },
      });
      if (!existing || existing.source === "removed") {
        // Nothing to remove, or already tombstoned — idempotent no-op.
        return {
          action: "remove" as const,
          changed: false,
          upgraded: false,
          revived: false,
          goalObjective: null,
          link: null,
          removedSource: null,
        };
      }
      // Remove always wins — explicit and auto links tombstone identically,
      // and the underlying activity is NOT required to still exist. The row
      // is UPDATED to source='removed', never deleted (UXR-PV-89): the kept
      // row's unique key is what blocks the auto-engine/backfill upsert from
      // resurrecting the link.
      await tx.activityGoalLink.update({
        where: {
          activityType_activityId_goalId: {
            activityType: input.activityType,
            activityId: input.activityId,
            goalId: input.goalId,
          },
        },
        data: { source: "removed" },
        select: { id: true },
      });
      return {
        action: "remove" as const,
        changed: true,
        upgraded: false,
        revived: false,
        goalObjective: null,
        link: null,
        removedSource: existing.source,
      };
    });
  }

  // action === "add"
  return db.$transaction(async (tx) => {
    const goal = await tx.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true, objective: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

    const rawDate = await findActivityRawDate(tx, input.activityType, input.activityId);
    if (!rawDate) {
      throw new Error(
        `No ${input.activityType} activity found with id ${input.activityId} — ` +
          `check the id, and that activityType matches the table the id came from.`,
      );
    }
    // Denormalize to USER_TZ midnight of the activity's own day (never "now").
    const activityDate = startOfDay(rawDate);

    const existing = await tx.activityGoalLink.findUnique({
      where: {
        activityType_activityId_goalId: {
          activityType: input.activityType,
          activityId: input.activityId,
          goalId: input.goalId,
        },
      },
      select: LINK_SELECT,
    });

    const normalizedNote =
      input.note === undefined ? undefined : input.note?.trim() || null;

    if (!existing) {
      const link = await tx.activityGoalLink.create({
        data: {
          activityType: input.activityType,
          activityId: input.activityId,
          goalId: input.goalId,
          source: "explicit",
          note: normalizedNote ?? null,
          activityDate,
        },
        select: LINK_SELECT,
      });
      return {
        action: "add" as const,
        changed: true,
        upgraded: false,
        revived: false,
        goalObjective: goal.objective,
        link,
        removedSource: null,
      };
    }

    // Existing row: upgrade auto → explicit (explicit-beats-auto) or REVIVE
    // a removed tombstone → explicit (UXR-PV-89) — both IN PLACE, never a
    // second row. Refresh the denormalized activityDate if the activity's
    // own date drifted, and replace the note only when one was provided.
    const sourceChanges = existing.source !== "explicit";
    const dateChanges = existing.activityDate.getTime() !== activityDate.getTime();
    const noteChanges =
      normalizedNote !== undefined && normalizedNote !== existing.note;

    if (!sourceChanges && !dateChanges && !noteChanges) {
      return {
        action: "add" as const,
        changed: false,
        upgraded: false,
        revived: false,
        goalObjective: goal.objective,
        link: existing,
        removedSource: null,
      };
    }

    const link = await tx.activityGoalLink.update({
      where: {
        activityType_activityId_goalId: {
          activityType: input.activityType,
          activityId: input.activityId,
          goalId: input.goalId,
        },
      },
      data: {
        source: "explicit",
        activityDate,
        ...(noteChanges ? { note: normalizedNote } : {}),
      },
      select: LINK_SELECT,
    });
    return {
      action: "add" as const,
      changed: true,
      upgraded: existing.source === "auto",
      revived: existing.source === "removed",
      goalObjective: goal.objective,
      link,
      removedSource: null,
    };
  });
}

// ---------------------------------------------------------------------------
// listActivityLinksCore
// ---------------------------------------------------------------------------
// Range filters run on the link's denormalized activityDate — NEVER on
// createdAt (plan critique #9: links can be backfilled long after the
// activity happened; filtering on createdAt would hide retroactive explicit
// attribution of an old activity from date-bounded reads).
//
// goalId omitted ⇒ the scope defaults to ALL member goals of the caller's
// ACTIVE Program (the "what got attributed this block" read). No active
// Program and no goalId is a friendly error, not an empty success — an
// ambiguous scope should be visible, not silently zero.
//
// UXR-PV-89: source='removed' TOMBSTONES are excluded by default — a removed
// link must read as removed everywhere counts/marks/lists are derived. Pass
// includeRemoved: true for the audit view ("what did I remove?").
// ---------------------------------------------------------------------------

export const LIST_ACTIVITY_LINKS_DEFAULT_LIMIT = 100;
export const LIST_ACTIVITY_LINKS_MAX_LIMIT = 500;

export interface ListActivityLinksCoreInput {
  goalId?: string;
  activityType?: ActivityLinkType;
  /** Inclusive bounds on activityDate (USER_TZ midnights — callers parse
   *  yyyy-mm-dd via parseDateInput). */
  from?: Date;
  to?: Date;
  limit?: number;
  /** Include source='removed' tombstones (default false — removed links are
   *  hidden from every default read; this is the audit valve). */
  includeRemoved?: boolean;
}

export interface ListActivityLinksCoreResult {
  scope: {
    /** "goal" when goalId was passed; "active-program" when the member-goal
     *  default kicked in. */
    resolvedFrom: "goal" | "active-program";
    goalIds: string[];
    programId?: string;
    programName?: string;
  };
  links: Array<ActivityLinkRow & { goalObjective: string }>;
  /** true ⇒ more rows exist beyond `limit` — narrow the window or raise it. */
  truncated: boolean;
}

export async function listActivityLinksCore(
  input: ListActivityLinksCoreInput,
): Promise<ListActivityLinksCoreResult> {
  const db = await getDb();

  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? LIST_ACTIVITY_LINKS_DEFAULT_LIMIT), 1),
    LIST_ACTIVITY_LINKS_MAX_LIMIT,
  );

  let scope: ListActivityLinksCoreResult["scope"];
  if (input.goalId) {
    const goal = await db.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
    scope = { resolvedFrom: "goal", goalIds: [goal.id] };
  } else {
    const program = await db.program.findFirst({
      where: { status: "active" },
      select: { id: true, name: true },
    });
    if (!program) {
      throw new Error(
        "No goalId given and no ACTIVE Program to default to — pass goalId explicitly, " +
          "or activate a Program first (list_activity_links defaults to the active Program's member goals).",
      );
    }
    const members = await db.goal.findMany({
      where: { programId: program.id },
      select: { id: true },
    });
    scope = {
      resolvedFrom: "active-program",
      goalIds: members.map((m) => m.id),
      programId: program.id,
      programName: program.name,
    };
  }

  if (scope.goalIds.length === 0) {
    return { scope, links: [], truncated: false };
  }

  const activityDate: { gte?: Date; lte?: Date } = {};
  if (input.from) activityDate.gte = startOfDay(input.from);
  if (input.to) activityDate.lte = startOfDay(input.to);

  const rows = await db.activityGoalLink.findMany({
    where: {
      goalId: scope.goalIds.length === 1 ? scope.goalIds[0] : { in: scope.goalIds },
      ...(input.activityType ? { activityType: input.activityType } : {}),
      ...(activityDate.gte || activityDate.lte ? { activityDate } : {}),
      // UXR-PV-89: tombstones stay out of the default read.
      ...(input.includeRemoved ? {} : { source: { not: "removed" } }),
    },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    take: limit + 1, // one extra row = cheap truncation signal
    select: {
      ...LINK_SELECT,
      goal: { select: { objective: true } },
    },
  });

  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  return {
    scope,
    links: page.map((r) => ({
      id: r.id,
      activityType: r.activityType,
      activityId: r.activityId,
      goalId: r.goalId,
      goalObjective: r.goal.objective,
      source: r.source,
      note: r.note,
      activityDate: r.activityDate,
      createdAt: r.createdAt,
    })),
    truncated,
  };
}
