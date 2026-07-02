// scripts/founder-cutover.ts
//
// A-5: Re-point the founder's Google identity (Account + Session) from the
// throwaway user created on first sign-in to the `usr_founder` row that owns
// all real data. This unblocks A-2 (getCurrentUserId seam flip): after this
// script runs, the founder's session resolves to usr_founder, not the empty
// throwaway.
//
// IDEMPOTENT — safe to re-run; prints "already cutover" and exits 0 if done.
// GUARDED — refuses to run against prod unless ALLOW_PROD_DB_WRITE=1.
//
// Usage (dev):
//   npx tsx scripts/founder-cutover.ts
//
// Usage (prod runbook — F-2 only, after founder has signed in once on prod):
//   ALLOW_PROD_DB_WRITE=1 FOUNDER_GOOGLE_EMAIL=ggronnii@gmail.com \
//     npx tsx scripts/founder-cutover.ts
//
// See: docs/roadmap/founder-cutover-runbook.md

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// ---------------------------------------------------------------------------
// 1. Guard: refuse to run against prod unless explicitly permitted
// ---------------------------------------------------------------------------
const dbEnv = process.env.DB_ENV;
const allowProd = process.env.ALLOW_PROD_DB_WRITE === "1";

if (dbEnv !== "development" && !allowProd) {
  console.error(
    `\n✗  REFUSED: DB_ENV="${dbEnv ?? "(not set)"}" — this script mutates data.` +
      `\n   Only run against the dev Neon branch (DB_ENV=development), OR` +
      `\n   set ALLOW_PROD_DB_WRITE=1 for the documented F-2 prod runbook.\n`,
  );
  process.exit(1);
}

if (allowProd && dbEnv !== "development") {
  console.warn(
    `\n⚠️  ALLOW_PROD_DB_WRITE=1 — running against production (DB_ENV=${dbEnv ?? "(not set)"})\n`,
  );
}

// ---------------------------------------------------------------------------
// 2. Bootstrap Prisma (same pattern as prisma/seed.ts)
// ---------------------------------------------------------------------------
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗  DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// ---------------------------------------------------------------------------
// 3. Constants
// ---------------------------------------------------------------------------
const FOUNDER = process.env.FOUNDER_USER_ID ?? "usr_founder";

// Per-throwaway-user check — count owned rows for a specific userId
// across all 16 scoped models (mirrors SCOPED_MODELS in src/lib/db.ts).
async function countTenantRows(userId: string): Promise<number> {
  const counts = await Promise.all([
    prisma.workout.count({ where: { userId } }),
    prisma.measurement.count({ where: { userId } }),
    prisma.footageMarker.count({ where: { userId } }),
    prisma.baseline.count({ where: { userId } }),
    prisma.note.count({ where: { userId } }),
    prisma.hike.count({ where: { userId } }),
    prisma.nutritionLog.count({ where: { userId } }),
    prisma.mobilityCheckin.count({ where: { userId } }),
    prisma.goal.count({ where: { userId } }),
    prisma.program.count({ where: { userId } }),
    prisma.gameBonusXp.count({ where: { userId } }),
    prisma.bodyMetric.count({ where: { userId } }),
    prisma.scheduledItem.count({ where: { userId } }),
    prisma.logEntry.count({ where: { userId } }),
    prisma.plan.count({ where: { userId } }),
    prisma.dayRenderJob.count({ where: { userId } }),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// 4. Main logic
// ---------------------------------------------------------------------------
async function main() {
  const host = new URL(connectionString!).hostname;
  console.log(`\nDB_ENV: ${dbEnv ?? "(not set)"}  host: ${host}`);
  console.log(`FOUNDER user id: ${FOUNDER}\n`);

  // --- Read founder's current state ---
  const founder = await prisma.user.findUnique({
    where: { id: FOUNDER },
    include: {
      accounts: { select: { id: true, provider: true, providerAccountId: true } },
      sessions: { select: { id: true, expires: true } },
    },
  });

  if (!founder) {
    console.error(`✗  Founder row not found (id=${FOUNDER}). Run \`npx prisma db seed\` first.`);
    process.exit(1);
  }

  const founderAccountsBefore = founder.accounts.length;
  const founderSessionsBefore = founder.sessions.length;
  console.log("BEFORE:");
  console.log(`  usr_founder.email       : ${founder.email ?? "NULL"}`);
  console.log(`  usr_founder.name        : ${founder.name ?? "NULL"}`);
  console.log(`  usr_founder account count: ${founderAccountsBefore}`);
  console.log(`  usr_founder session count: ${founderSessionsBefore}`);

  // Count founder's real data rows
  const founderWorkouts = await prisma.workout.count({ where: { userId: FOUNDER } });
  const founderGoals = await prisma.goal.count({ where: { userId: FOUNDER } });
  console.log(`  usr_founder workouts    : ${founderWorkouts}`);
  console.log(`  usr_founder goals       : ${founderGoals}`);

  // --- Determine the founder's google email ---
  const founderGoogleEmail = process.env.FOUNDER_GOOGLE_EMAIL;

  // --- Idempotency check: already cutover? ---
  // If usr_founder already has an email AND a google Account, we're done.
  if (!founderGoogleEmail) {
    // No env override — check if already cutover by the presence of email + google account
    if (founder.email && founder.accounts.some((a) => a.provider === "google")) {
      console.log(
        `\n✓  Already cutover: usr_founder.email="${founder.email}" and has a google Account.` +
          `\n   No-op. Exit 0.\n`,
      );
      return;
    }
  }

  // --- Find the throwaway candidate ---
  // A throwaway is: a User where id !== FOUNDER, has a google Account,
  // and owns 0 tenant rows across the 16 scoped models.
  // Its email is the founder's google email.
  const candidateFilter = founderGoogleEmail
    ? { email: founderGoogleEmail, id: { not: FOUNDER } }
    : { id: { not: FOUNDER } };

  const candidates = await prisma.user.findMany({
    where: candidateFilter,
    include: {
      accounts: { select: { id: true, provider: true, providerAccountId: true } },
      sessions: { select: { id: true } },
    },
  });

  // Filter to those that have a google account
  const googleCandidates = candidates.filter((u) =>
    u.accounts.some((a) => a.provider === "google"),
  );

  if (googleCandidates.length === 0) {
    // No throwaway with a google account found
    if (
      founder.email &&
      founder.accounts.some((a) => a.provider === "google")
    ) {
      console.log(
        `\n✓  Already cutover: usr_founder.email="${founder.email}" and has a google Account.` +
          `\n   No-op. Exit 0.\n`,
      );
      return;
    }
    console.log(
      `\n⚠  No throwaway found (no other user with a google Account).` +
        `\n   If running on prod: the founder must sign in with Google once first, then re-run.` +
        `\n   If running on dev: check that the A-1 test sign-in created a throwaway user.\n`,
    );
    return;
  }

  if (googleCandidates.length > 1) {
    console.error(
      `\n✗  REFUSED: found ${googleCandidates.length} candidate throwaway users with google accounts:`,
    );
    for (const c of googleCandidates) {
      console.error(`   id=${c.id}  email=${c.email ?? "NULL"}`);
    }
    console.error(
      `\n   Cannot determine which is the founder's throwaway.` +
        `\n   Set FOUNDER_GOOGLE_EMAIL=<email> to narrow the candidate.\n`,
    );
    process.exit(1);
  }

  const throwaway = googleCandidates[0];

  // --- Safety: throwaway must own 0 tenant rows ---
  const throwawayRowCount = await countTenantRows(throwaway.id);
  if (throwawayRowCount > 0) {
    console.error(
      `\n✗  REFUSED: throwaway user (id=${throwaway.id}, email=${throwaway.email ?? "NULL"})` +
        `\n   owns ${throwawayRowCount} tenant row(s). That's not a throwaway — aborting to` +
        `\n   avoid deleting a real user's data.\n`,
    );
    process.exit(1);
  }

  // --- If founderGoogleEmail is set as env, cross-check it matches the candidate ---
  if (founderGoogleEmail && throwaway.email !== founderGoogleEmail) {
    console.error(
      `\n✗  REFUSED: FOUNDER_GOOGLE_EMAIL="${founderGoogleEmail}" but throwaway.email="${throwaway.email ?? "NULL"}".` +
        `\n   These must match. Check your env vars.\n`,
    );
    process.exit(1);
  }

  // The email we'll give to usr_founder
  const googleEmail = throwaway.email ?? founderGoogleEmail ?? null;
  if (!googleEmail) {
    console.error(
      `\n✗  REFUSED: throwaway user (id=${throwaway.id}) has no email and FOUNDER_GOOGLE_EMAIL is not set.` +
        `\n   Cannot determine the Google email to assign to usr_founder.\n`,
    );
    process.exit(1);
  }

  console.log(`\nThrowaway candidate: id=${throwaway.id}  email=${googleEmail}`);
  console.log(
    `  google accounts : ${throwaway.accounts.filter((a) => a.provider === "google").length}`,
  );
  console.log(`  sessions        : ${throwaway.sessions.length}`);
  console.log(`  tenant rows     : ${throwawayRowCount} (OK — safe to delete)\n`);

  // Capture throwaway profile fields to set on founder
  const capturedName = throwaway.name;
  const capturedImage = throwaway.image;
  const capturedEmailVerified = throwaway.emailVerified;

  // --- Execute the 4-step re-point in a single transaction ---
  console.log("Executing 4-step re-point transaction...");

  await prisma.$transaction(async (tx) => {
    // Step 1: Move google Account(s) to usr_founder
    const accountsUpdated = await tx.account.updateMany({
      where: { userId: throwaway.id },
      data: { userId: FOUNDER },
    });
    console.log(`  [1] account.updateMany → ${accountsUpdated.count} row(s) moved to usr_founder`);

    // Step 2: Move Session(s) to usr_founder (current login now resolves to founder)
    const sessionsUpdated = await tx.session.updateMany({
      where: { userId: throwaway.id },
      data: { userId: FOUNDER },
    });
    console.log(`  [2] session.updateMany → ${sessionsUpdated.count} row(s) moved to usr_founder`);

    // Step 3: Delete the throwaway (now account-less + session-less + owns 0 tenant rows)
    await tx.user.delete({ where: { id: throwaway.id } });
    console.log(`  [3] user.delete → throwaway id=${throwaway.id} deleted`);

    // Step 4: Set founder's email, emailVerified, name, image from google identity
    await tx.user.update({
      where: { id: FOUNDER },
      data: {
        email: googleEmail,
        emailVerified: capturedEmailVerified,
        name: capturedName ?? founder.name, // keep existing name if google name is null
        image: capturedImage ?? founder.image,
      },
    });
    console.log(`  [4] user.update → usr_founder.email set to "${googleEmail}"`);
  });

  // --- Verify after transaction ---
  const founderAfter = await prisma.user.findUnique({
    where: { id: FOUNDER },
    include: {
      accounts: { select: { id: true, provider: true } },
      sessions: { select: { id: true } },
    },
  });

  const founderWorkoutsAfter = await prisma.workout.count({ where: { userId: FOUNDER } });
  const founderGoalsAfter = await prisma.goal.count({ where: { userId: FOUNDER } });

  // Confirm throwaway is gone
  const throwawayGone = await prisma.user.findUnique({ where: { id: throwaway.id } });

  console.log("\nAFTER:");
  console.log(`  usr_founder.email       : ${founderAfter?.email ?? "NULL"}`);
  console.log(`  usr_founder.name        : ${founderAfter?.name ?? "NULL"}`);
  console.log(
    `  usr_founder account count: ${founderAfter?.accounts.length ?? 0} (providers: ${founderAfter?.accounts.map((a) => a.provider).join(", ") || "none"})`,
  );
  console.log(`  usr_founder session count: ${founderAfter?.sessions.length ?? 0}`);
  console.log(`  usr_founder workouts    : ${founderWorkoutsAfter} (was ${founderWorkouts})`);
  console.log(`  usr_founder goals       : ${founderGoalsAfter} (was ${founderGoals})`);
  console.log(`  throwaway gone          : ${throwawayGone === null ? "YES ✓" : "NO — check DB"}`);

  // Integrity assertions
  const errors: string[] = [];
  if (founderAfter?.email !== googleEmail)
    errors.push(`  ✗ founder.email mismatch: got "${founderAfter?.email}"`);
  if (!founderAfter?.accounts.some((a) => a.provider === "google"))
    errors.push("  ✗ founder has no google account");
  if ((founderAfter?.sessions.length ?? 0) === 0)
    errors.push("  ✗ founder has 0 sessions (may be normal if prior session expired)");
  if (throwawayGone !== null) errors.push(`  ✗ throwaway user still exists`);
  if (founderWorkoutsAfter !== founderWorkouts)
    errors.push(
      `  ✗ workout count changed: ${founderWorkouts} → ${founderWorkoutsAfter}`,
    );
  if (founderGoalsAfter !== founderGoals)
    errors.push(`  ✗ goal count changed: ${founderGoals} → ${founderGoalsAfter}`);

  if (errors.length > 0) {
    console.error("\n✗  Post-transaction integrity check FAILED:");
    for (const e of errors) console.error(e);
    process.exit(1);
  }

  console.log(
    "\n✓  Founder cutover complete. usr_founder is now linked to the Google identity." +
      "\n   The next login with Google will resolve to usr_founder (no re-login needed" +
      "\n   if the session was active — it was moved, not invalidated).\n",
  );
}

main()
  .catch((e) => {
    console.error("\n✗  Unhandled error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
