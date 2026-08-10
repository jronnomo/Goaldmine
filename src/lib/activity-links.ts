// ActivityGoalLink shared conventions (M2 #272/#273).
//
// ActivityGoalLink is POLYMORPHIC: (activityType, activityId) with NO foreign
// key to the underlying activity table. Referential integrity is compensated
// by two mechanisms, both anchored on the canonical type strings below:
//
//   1. Delete hooks (#272) — every activity delete core removes the activity's
//      links with `activityGoalLink.deleteMany({ where: { activityType,
//      activityId } })` in the SAME `$transaction` as the row delete, as
//      sequential top-level calls on the tx client (never nested writes —
//      nested writes bypass the getDb() tenant-scoping extension).
//   2. scripts/verify-activity-links.ts (#273) — orphan verifier
//      (`npm run db:verify-links`) that re-checks every link against its
//      activity table. `computeOrphanLinks` below is its pure core.
//
// Adding a new link-bearing activity type? Add its string here, hook its
// delete core(s), and add the table probe in scripts/verify-activity-links.ts.
//
// This module is pure and client-safe — no Prisma imports.

/** Canonical ActivityGoalLink.activityType values, keyed by domain. */
export const ACTIVITY_LINK_TYPE = {
  /** Workout rows (links attach to the workout id only — exercises/sets never carry links). */
  workout: "workout",
  hike: "hike",
  /** NutritionLog rows. */
  nutrition: "nutrition",
  measurement: "measurement",
  baseline: "baseline",
  /** LogEntry rows (project-goal metric readings — log_metric / delete_metric). */
  logEntry: "log_entry",
} as const;

export type ActivityLinkType =
  (typeof ACTIVITY_LINK_TYPE)[keyof typeof ACTIVITY_LINK_TYPE];

/** All known activityType strings, for iteration / membership checks. */
export const ACTIVITY_LINK_TYPES: readonly ActivityLinkType[] =
  Object.values(ACTIVITY_LINK_TYPE);

// ---------------------------------------------------------------------------
// Orphan computation (pure core of scripts/verify-activity-links.ts)
// ---------------------------------------------------------------------------

/** The link fields the orphan check needs (subset of the ActivityGoalLink row). */
export interface ActivityLinkRecord {
  id: string;
  activityType: string;
  activityId: string;
  goalId: string;
  /** auto | explicit | removed. Carried for REPORTING only — orphan
   *  classification deliberately ignores it (see computeOrphanLinks). */
  source: string;
  userId: string | null;
  activityDate: Date;
  createdAt: Date;
}

export interface OrphanLinkReport {
  /** Links of a known type whose activity row no longer exists. */
  orphans: ActivityLinkRecord[];
  /** Links whose activityType is not one of ACTIVITY_LINK_TYPES — cannot be
   *  verified against any table; always a finding (likely a typo'd writer). */
  unknownType: ActivityLinkRecord[];
}

/**
 * Classify links against the set of activity ids that actually exist.
 *
 * `existingIdsByType` maps an activityType to the Set of activity row ids that
 * exist for the ids referenced by `links` (the caller batch-probes each table).
 * A missing map entry is treated as "no rows exist for this type".
 *
 * SOURCE-BLIND by design (UXR-PV-89): a source='removed' TOMBSTONE whose
 * activity row is gone is still an orphan. The tombstone's only job is to
 * block re-linking of an activity that EXISTS; once the activity row is
 * deleted there is nothing left to block and the row is garbage — the
 * delete-hooks should already have hard-deleted it, so a surviving tombstone
 * orphan is exactly the drift this verifier exists to catch.
 */
export function computeOrphanLinks(
  links: readonly ActivityLinkRecord[],
  existingIdsByType: ReadonlyMap<string, ReadonlySet<string>>,
): OrphanLinkReport {
  const known = new Set<string>(ACTIVITY_LINK_TYPES);
  const orphans: ActivityLinkRecord[] = [];
  const unknownType: ActivityLinkRecord[] = [];
  for (const link of links) {
    if (!known.has(link.activityType)) {
      unknownType.push(link);
      continue;
    }
    const existing = existingIdsByType.get(link.activityType);
    if (!existing || !existing.has(link.activityId)) orphans.push(link);
  }
  return { orphans, unknownType };
}
