// scripts/verify-invite-race.ts
//
// #247 — permanent, real-Postgres atomicity proof for claimInvite. Kept
// permanently (not a one-off spike script), same rationale as
// scripts/measure-export.ts: unit tests can only prove claimInvite's
// affected-row-count interpretation is correct (see the mock-based
// "claimInvite" describe block in invite-gate.test.ts) — they CANNOT prove
// the atomic-conditional-UPDATE guard actually holds under concurrency,
// because that guarantee lives in Postgres, not in mocked JS. This script is
// the real proof, run against the dev DB.
//
// Two scenarios:
//   1. maxUses:1 race — two concurrent claims against one slot. Exactly one
//      must win (per the architecture critique's Attack 5: the assertion is
//      framed around final state — one winner, useCount===1 — not around
//      actual wall-clock overlap of the two calls, which holds regardless of
//      whether Postgres/the pool happens to serialize them).
//   2. maxUses:3 sequence — three claims succeed, a fourth is rejected,
//      final useCount===3. Proves the guard generalizes past the maxUses:1
//      case (not an off-by-one on the comparison).
//
// Self-cleaning: both temp invites are deleted in a `finally` block
// regardless of pass/fail, so repeat runs never accumulate junk rows.
//
// Usage:
//   npx tsx scripts/verify-invite-race.ts

import "dotenv/config";

// ---------------------------------------------------------------------------
// Dev-DB guard — must run first, before any DB import (measure-export.ts idiom)
// ---------------------------------------------------------------------------
if (process.env.DB_ENV !== "development") {
  console.error(
    "[ABORT] DB_ENV is not 'development'. Refusing to run against non-dev DB.\n" +
      `       Got: DB_ENV=${process.env.DB_ENV ?? "(unset)"}`,
  );
  process.exit(1);
}

import crypto from "node:crypto";
import { prisma } from "../src/lib/db";
import { claimInvite } from "../src/lib/auth/invite-gate";

function randomSuffix(): string {
  return crypto.randomBytes(6).toString("hex");
}

type CheckResult = { name: string; pass: boolean; detail: string };

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const icon = pass ? "✓" : "✗";
  console.log(`  ${icon}  ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// Scenario 1: maxUses:1 race — exactly one winner
// ---------------------------------------------------------------------------
async function runMaxUsesOneRace(): Promise<void> {
  console.log("\n[1] maxUses:1 race — two concurrent claims against one slot");

  const invite = await prisma.invite.create({
    data: {
      code: `race-test-${randomSuffix()}`,
      maxUses: 1,
      useCount: 0,
    },
  });

  try {
    const [claimA, claimB] = await Promise.all([
      claimInvite(invite.id),
      claimInvite(invite.id),
    ]);

    const winners = [claimA, claimB].filter((c) => c === true).length;
    const losers = [claimA, claimB].filter((c) => c === false).length;

    record(
      "exactly one claim wins",
      winners === 1 && losers === 1,
      `claimA=${claimA} claimB=${claimB} (winners=${winners}, losers=${losers})`,
    );

    const reread = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    record(
      "useCount === 1 after the race",
      reread.useCount === 1,
      `useCount=${reread.useCount}`,
    );
    record(
      "redeemedAt stamped exactly once",
      reread.redeemedAt !== null,
      `redeemedAt=${reread.redeemedAt?.toISOString() ?? "null"}`,
    );
  } finally {
    await prisma.invite.delete({ where: { id: invite.id } });
  }
}

// ---------------------------------------------------------------------------
// Scenario 2: maxUses:3 sequence — three succeed, fourth fails
// ---------------------------------------------------------------------------
async function runMaxUsesThreeSequence(): Promise<void> {
  console.log("\n[2] maxUses:3 sequence — 3 claims succeed, 4th fails");

  const invite = await prisma.invite.create({
    data: {
      code: `race-test-${randomSuffix()}`,
      maxUses: 3,
      useCount: 0,
    },
  });

  try {
    const claim1 = await claimInvite(invite.id);
    const claim2 = await claimInvite(invite.id);
    const claim3 = await claimInvite(invite.id);
    const claim4 = await claimInvite(invite.id);

    record(
      "first three claims succeed",
      claim1 === true && claim2 === true && claim3 === true,
      `claim1=${claim1} claim2=${claim2} claim3=${claim3}`,
    );
    record("fourth claim is rejected", claim4 === false, `claim4=${claim4}`);

    const reread = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    record(
      "useCount === 3 after the sequence",
      reread.useCount === 3,
      `useCount=${reread.useCount}`,
    );
  } finally {
    await prisma.invite.delete({ where: { id: invite.id } });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("verify-invite-race — real-Postgres atomicity proof for claimInvite (#247)");
  console.log(`DB_ENV: ${process.env.DB_ENV}`);

  await runMaxUsesOneRace();
  await runMaxUsesThreeSequence();

  const failed = results.filter((r) => !r.pass);

  console.log("\n" + "=".repeat(70));
  if (failed.length === 0) {
    console.log(`PASS — all ${results.length} checks passed. Atomic claim holds.`);
  } else {
    console.log(`FAIL — ${failed.length}/${results.length} checks failed:`);
    for (const f of failed) {
      console.log(`  ✗  ${f.name} — ${f.detail}`);
    }
  }
  console.log("=".repeat(70));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("\n[ABORT] Unhandled error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
