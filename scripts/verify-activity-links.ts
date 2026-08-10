// verify-activity-links.ts
//
// M2 (#273): ActivityGoalLink orphan verifier — the safety net for the
// polymorphic, FK-less link table. ActivityGoalLink references activity rows
// by (activityType, activityId) with NO foreign key, so referential integrity
// rests on the delete-hook consolidation (#272). This script catches drift the
// hooks can't: rows removed outside the app, edge cases in the consolidation,
// future code that forgets the hook.
//
// Default: READ-ONLY report (same convention as verify-no-null-userid.ts).
//   exit 0 — every link's activity row exists
//   exit 1 — orphans found, or links with an unknown activityType
// --fix: additionally deletes the orphan LINK rows it found (never touches
//   activity rows). Links with an unknown activityType are NEVER auto-deleted
//   — they can't be verified against any table, so they always demand a human.
//
// Scan pattern: per-activityType batched link fetches (covered by the
// @@index([activityType, activityId]) prefix) + primary-key `id IN (...)`
// existence probes per batch. Nothing filters on activityDate, so the
// standalone [activityDate] index the schema story skipped is NOT needed here.
//
// Orphan classification is pure and unit-tested: computeOrphanLinks in
// src/lib/activity-links.ts (src/lib/activity-links.test.ts).
//
// Usage:
//   npm run db:verify-links                          # report-only
//   npx tsx scripts/verify-activity-links.ts --fix   # delete orphan links
//
// Nightly cron scheduling is a Sprint 4+ concern — this ships the verifier.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  ACTIVITY_LINK_TYPE,
  ACTIVITY_LINK_TYPES,
  computeOrphanLinks,
  type ActivityLinkRecord,
  type ActivityLinkType,
} from "../src/lib/activity-links";

const BATCH = 500;

const LINK_SELECT = {
  id: true,
  activityType: true,
  activityId: true,
  goalId: true,
  userId: true,
  activityDate: true,
  createdAt: true,
} as const;

// activityType → existence probe on the referenced table (id-only PK lookup).
const EXISTENCE_PROBES: Record<ActivityLinkType, (ids: string[]) => Promise<{ id: string }[]>> = {
  [ACTIVITY_LINK_TYPE.workout]: (ids) =>
    prisma.workout.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  [ACTIVITY_LINK_TYPE.hike]: (ids) =>
    prisma.hike.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  [ACTIVITY_LINK_TYPE.nutrition]: (ids) =>
    prisma.nutritionLog.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  [ACTIVITY_LINK_TYPE.measurement]: (ids) =>
    prisma.measurement.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  [ACTIVITY_LINK_TYPE.baseline]: (ids) =>
    prisma.baseline.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  [ACTIVITY_LINK_TYPE.logEntry]: (ids) =>
    prisma.logEntry.findMany({ where: { id: { in: ids } }, select: { id: true } }),
};

/** Cursor-paginated fetch of all links for one activityType. */
async function fetchLinksOfType(activityType: string): Promise<ActivityLinkRecord[]> {
  const rows: ActivityLinkRecord[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.activityGoalLink.findMany({
      where: { activityType },
      select: LINK_SELECT,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...batch);
    if (batch.length < BATCH) return rows;
    cursor = batch[batch.length - 1]!.id;
  }
}

/** Batched existence probe: which of these activity ids exist for this type? */
async function probeExisting(type: ActivityLinkType, activityIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  const distinct = [...new Set(activityIds)];
  for (let i = 0; i < distinct.length; i += BATCH) {
    const found = await EXISTENCE_PROBES[type](distinct.slice(i, i + BATCH));
    for (const row of found) existing.add(row.id);
  }
  return existing;
}

function ageDays(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / 86_400_000);
}

function printFinding(label: string, link: ActivityLinkRecord, now: Date): void {
  console.log(
    `  ${label}  link=${link.id}  type=${link.activityType}  activityId=${link.activityId}  ` +
      `goalId=${link.goalId}  userId=${link.userId ?? "(null)"}  ` +
      `activityDate=${link.activityDate.toISOString().slice(0, 10)}  ` +
      `age=${ageDays(link.createdAt, now)}d`,
  );
}

async function main() {
  const host = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "(no DATABASE_URL)";
  const dbEnv = process.env.DB_ENV ?? "(not set)";
  const fix = process.argv.includes("--fix");
  console.log(`DB_ENV: ${dbEnv}  host: ${host}`);
  console.log(
    `Verifying ActivityGoalLink rows against their activity tables (${
      fix ? "--fix: orphan links WILL be deleted" : "report-only"
    })...\n`,
  );

  const now = new Date();
  let totalLinks = 0;
  const allOrphans: ActivityLinkRecord[] = [];
  const allUnknown: ActivityLinkRecord[] = [];

  // Known types: per-type batched scan + existence probe.
  for (const type of ACTIVITY_LINK_TYPES) {
    const links = await fetchLinksOfType(type);
    totalLinks += links.length;
    const existing = await probeExisting(type, links.map((l) => l.activityId));
    const { orphans } = computeOrphanLinks(links, new Map([[type, existing]]));
    console.log(
      `  ${type.padEnd(12)} links=${String(links.length).padStart(4)}  orphans=${orphans.length}${
        orphans.length > 0 ? " ← ORPHANED" : ""
      }`,
    );
    allOrphans.push(...orphans);
  }

  // Unknown types: anything a future writer stored outside the registry.
  const unknownLinks = await prisma.activityGoalLink.findMany({
    where: { activityType: { notIn: [...ACTIVITY_LINK_TYPES] } },
    select: LINK_SELECT,
    orderBy: { id: "asc" },
  });
  totalLinks += unknownLinks.length;
  const { unknownType } = computeOrphanLinks(unknownLinks, new Map());
  allUnknown.push(...unknownType);
  if (unknownLinks.length > 0) {
    console.log(`  ${"(unknown)".padEnd(12)} links=${String(unknownLinks.length).padStart(4)}  ← UNKNOWN activityType`);
  }

  console.log();
  if (allOrphans.length > 0) {
    console.log(`Orphaned links (activity row no longer exists):`);
    for (const link of allOrphans) printFinding("ORPHAN ", link, now);
    console.log();
  }
  if (allUnknown.length > 0) {
    console.log(`Links with unknown activityType (not in the ACTIVITY_LINK_TYPE registry — never auto-fixed):`);
    for (const link of allUnknown) printFinding("UNKNOWN", link, now);
    console.log();
  }

  if (fix && allOrphans.length > 0) {
    const ids = allOrphans.map((l) => l.id);
    let deleted = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const res = await prisma.activityGoalLink.deleteMany({
        where: { id: { in: ids.slice(i, i + BATCH) } },
      });
      deleted += res.count;
    }
    console.log(`--fix: deleted ${deleted} orphan link row(s). Activity tables untouched.`);
  }

  const unresolved = (fix ? 0 : allOrphans.length) + allUnknown.length;
  if (unresolved === 0) {
    console.log(
      allOrphans.length > 0
        ? `✓ ${totalLinks} link(s) scanned — ${allOrphans.length} orphan(s) fixed, now clean. Exit 0.`
        : `✓ ${totalLinks} link(s) scanned — every link's activity row exists. Exit 0.`,
    );
  } else {
    console.error(
      `✗ ${totalLinks} link(s) scanned — ${allOrphans.length} orphan(s), ${allUnknown.length} unknown-type link(s). Exit 1.` +
        (fix ? "" : " Re-run with --fix to delete orphan links (unknown-type links always need a human)."),
    );
  }
  process.exit(unresolved > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
