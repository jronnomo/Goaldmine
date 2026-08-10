// verify-legacy-program-coverage.ts
//
// Sprint 15 / #267 — founder-history coverage audit for the legacy Program
// fallback. REQUIRED pre-check gate for #269 ("Delete legacy Program fallback
// branch from getActiveProgram/getMostRecentProgram"): do NOT run that story
// unless this script reports PASS immediately beforehand.
//
// Walks every USER_TZ calendar date from the founder's earliest data
// (earliest Workout.startedAt / Hike.date / Plan.startedOn) through today and
// resolves each through the REAL production path — getActiveProgram() +
// getPlanWindowCandidates() feeding pickProgramForDate() (the pure core that
// getProgramForDate() wraps) — flagging any date currently served by the
// legacy Program table (winner id absent from the Plan candidates, the same
// id-membership signal pickProgramForDate's SMOKE-1 doc comment describes)
// and any date whose resolution would CHANGE once the fallback is deleted
// (simulated by re-running the same pure picker with a legacy-sourced
// activeProgram nulled out, which is what post-#269 getActiveProgram returns).
//
// Safe to run on any DB — read-only, no writes. Prints DB_ENV + host first.
//
// Usage:
//   npx tsx scripts/verify-legacy-program-coverage.ts [--verbose]
//
// Exit codes: 0 = PASS (zero legacy hits, zero regressions); 1 = FAIL.

import "dotenv/config";
import { prisma, runWithUser } from "../src/lib/db";
import { getActiveProgram, getPlanWindowCandidates } from "../src/lib/program";
import { dateKey } from "../src/lib/calendar-core";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";
import {
  auditLegacyProgramCoverage,
  buildDateKeyRange,
  type DateFinding,
} from "../src/lib/legacy-program-coverage";

const VERBOSE = process.argv.includes("--verbose");

function fmt(o: DateFinding["before"]): string {
  return o ? `${o.id} (${o.source})` : "null";
}

async function main() {
  const host = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "(no DATABASE_URL)";
  const dbEnv = process.env.DB_ENV ?? "(not set)";
  console.log(`DB_ENV: ${dbEnv}  host: ${host}`);
  console.log(`Founder: ${FOUNDER_USER_ID}`);
  console.log("Legacy-Program fallback coverage audit (read-only)\n");

  // ── Earliest founder data (USER_TZ dateKeys) ──────────────────────────────
  const [firstWorkout, firstHike, firstPlan] = await Promise.all([
    prisma.workout.findFirst({
      where: { userId: FOUNDER_USER_ID },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    }),
    prisma.hike.findFirst({
      where: { userId: FOUNDER_USER_ID },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.plan.findFirst({
      where: { userId: FOUNDER_USER_ID },
      orderBy: { startedOn: "asc" },
      select: { startedOn: true },
    }),
  ]);

  const startKeys = [
    firstWorkout ? dateKey(firstWorkout.startedAt) : null,
    firstHike ? dateKey(firstHike.date) : null,
    firstPlan ? dateKey(firstPlan.startedOn) : null,
  ].filter((k): k is string => k !== null);

  if (startKeys.length === 0) {
    console.log("No founder Workout/Hike/Plan rows found — nothing to audit. PASS (trivially).");
    return 0;
  }

  const startKey = startKeys.reduce((a, b) => (a < b ? a : b));
  const todayKey = dateKey(new Date());
  const dateKeys = buildDateKeyRange(startKey, todayKey);
  console.log(
    `Range: ${startKey} .. ${todayKey} (${dateKeys.length} dates)  ` +
      `[earliest workout: ${startKeys[0] ?? "-"} | hike: ${firstHike ? dateKey(firstHike.date) : "-"} | plan: ${firstPlan ? dateKey(firstPlan.startedOn) : "-"}]`,
  );

  // ── Real resolution inputs, founder-scoped exactly like production ────────
  const { activeProgram, candidates } = await runWithUser(FOUNDER_USER_ID, async () => ({
    activeProgram: await getActiveProgram(),
    candidates: await getPlanWindowCandidates(),
  }));

  const audit = auditLegacyProgramCoverage({ dateKeys, todayKey, candidates, activeProgram });

  console.log(`Plan candidates: ${audit.planIdCount}`);
  if (activeProgram === null) {
    console.log("getActiveProgram(): null (no active Plan, no active legacy row — fallback found nothing)");
  } else if (audit.legacyFallbackActive) {
    console.log(
      `getActiveProgram(): ${activeProgram.id} ("${activeProgram.name}") — ` +
        `*** LEGACY Program-table fallback (id absent from Plan candidates) ***`,
    );
  } else {
    console.log(`getActiveProgram(): ${activeProgram.id} ("${activeProgram.name}") — real Plan`);
  }
  console.log("");

  // ── Per-date findings ──────────────────────────────────────────────────────
  if (VERBOSE) {
    for (const f of audit.findings) {
      const flag = f.viaLegacy ? "LEGACY" : f.regresses ? "REGRESS" : "ok";
      console.log(`${f.dateKey}  ${flag.padEnd(7)}  before: ${fmt(f.before)}  after: ${fmt(f.after)}`);
    }
    console.log("");
  } else {
    // Monthly rollup keeps the clean case readable; flagged dates always print in full below.
    const byMonth = new Map<string, { total: number; flagged: number }>();
    for (const f of audit.findings) {
      const m = f.dateKey.slice(0, 7);
      const row = byMonth.get(m) ?? { total: 0, flagged: 0 };
      row.total += 1;
      if (f.viaLegacy || f.regresses) row.flagged += 1;
      byMonth.set(m, row);
    }
    for (const [m, row] of byMonth) {
      console.log(
        `${m}: ${row.total - row.flagged}/${row.total} via Plan candidates` +
          (row.flagged > 0 ? `  (${row.flagged} FLAGGED)` : ""),
      );
    }
    console.log("");
  }

  const flagged = audit.findings.filter((f) => f.viaLegacy || f.regresses);
  for (const f of flagged) {
    console.log(
      `FLAGGED ${f.dateKey}: currently → ${fmt(f.before)}; after fallback removal → ${fmt(f.after)}` +
        (f.viaLegacy ? "  [served by legacy Program table]" : ""),
    );
  }
  if (flagged.length > 0) console.log("");

  // ── Verdict ────────────────────────────────────────────────────────────────
  if (audit.clean) {
    console.log(
      `PASS — ${audit.findings.length}/${audit.findings.length} dates resolve via Plan candidates, zero legacy fallback hits.`,
    );
    console.log("Safe to proceed with #269 (fallback-branch deletion).");
    return 0;
  }

  console.log(
    `FAIL — ${audit.legacyDates.length} date(s) served by the legacy Program table, ` +
      `${audit.regressingDates.length} date(s) would regress after fallback removal` +
      (audit.legacyFallbackActive
        ? "; getActiveProgram() is CURRENTLY legacy-sourced (Today itself depends on the fallback)"
        : ""),
  );
  console.log("Do NOT delete the fallback branch (#269) until this is clean (covering-Plan backfill first).");
  return 1;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exitCode = code;
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
