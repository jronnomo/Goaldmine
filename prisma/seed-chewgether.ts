// prisma/seed-chewgether.ts
//
// #305 (Sprint 17 — Seam flip): idempotent DEV FIXTURE for the pure-project
// Program scenario (DA Critical #1) — a status='active' Program with ZERO
// Plan rows whose only member is the Chewgether project goal. Makes
// "vertical #2 drives a plan-less Program" a live, hand-checkable dev-DB
// state instead of a unit-test-only fixture.
//
// TENANT: everything here belongs to a DEDICATED fixture user
// (CHEWGETHER_USER_ID env, default "usr_chewgether") — NOT the founder.
// That is what makes this seed safe to run alongside the founder's Phase 2A
// backfill: the one-active-Program constraint is the PARTIAL UNIQUE INDEX
// program_one_active_per_user ON "Program"("userId") WHERE status='active',
// i.e. per-user — two active Programs under two userIds never conflict.
// The founder's own goals/Programs (including any founder-owned Chewgether
// goal from the pre-#305 version of this seed) are never read or written.
//
// isFocus note (stale comment block corrected per #305): isFocus is LEGACY /
// display-only since the #277 seam flip — with an active Program, day
// resolution is Program-first (the Program's attached Plan or null) and
// ignores isFocus entirely; isFocus still routes the get_today_plan payload
// shape (activeGoal.kind). Non-interference with other tenants is guaranteed
// by tenant scoping plus Program membership (this user's own active Program)
// or, for Program-less tenants, the zero-Program-rows legacy fallback — NOT
// by keeping isFocus false here. The fixture goal takes isFocus=true (it is
// this tenant's only goal).
//
// GitHub-first milestones (PRD §2.1 amendment, unchanged): the 7 launch
// milestones live on jronnomo/Chewgether GitHub and are mirrored via
// sync_github_milestones. Do NOT seed ScheduledItems here — that would
// create a duplicate source of truth.
//
// GUARD: refuses unless DB_ENV=development (ALLOW_PROD_DB_WRITE=1 escape
// hatch with a loud warning). This seed creates a synthetic user — it must
// never run against prod by accident. (The pre-#305 version was unguarded;
// it seeded the founder's real goal, which was a legitimate prod write.)
//
// MANUAL TEST (run after seeding — the seed also self-asserts step 3):
//   1. npm run db:which            → dev branch + DB_ENV=development
//   2. npx tsx prisma/seed-chewgether.ts
//      → prints created/skipped per step, then the seam assertion:
//        "chewgether program active, rotation=null as expected"
//   3. The assertion runs the REAL resolution path (runWithUser +
//      getActiveProgram/getActiveProgramMembership): membership must show
//      the active Program with exactly the Chewgether goal; getActiveProgram
//      must return null (Program with no rotation) — which is precisely what
//      renders "no rotation today" on Today/get_today_plan for this user,
//      with no error and no leak of another tenant's plan.
//   4. Re-run the script — every step must print "skipping"/no-op (idempotent).
//   5. Optional cleanup: delete the fixture user row (User onDelete: Cascade
//      removes the goal + Program; Program FKs are SetNull anyway).
//
// Usage:
//   npx tsx prisma/seed-chewgether.ts
//   (DATABASE_URL / DB_ENV are loaded from .env via the dotenv import below.)

import "dotenv/config";
import { prisma, runWithUser } from "../src/lib/db";
import { getActiveProgram, getActiveProgramMembership } from "../src/lib/program";
import { parseDateKey } from "../src/lib/calendar";
import type { Prisma } from "../src/generated/prisma/client";

const CHEW_USER_ID = process.env.CHEWGETHER_USER_ID ?? "usr_chewgether";
const CHEW_PROGRAM_NAME = "Chewgether — Ship & Monetize";

function assertDevDb(): void {
  if (process.env.ALLOW_PROD_DB_WRITE === "1") {
    process.stderr.write(
      "\n⚠  ALLOW_PROD_DB_WRITE=1 — bypassing dev-DB guard. This seed creates a SYNTHETIC fixture user; " +
        "running it against prod is almost certainly a mistake.\n\n",
    );
    return;
  }
  if (process.env.DB_ENV !== "development") {
    throw new Error(
      "Refusing: DB_ENV is not 'development'. seed-chewgether provisions a dev fixture tenant " +
        "(synthetic user + active Program) and must not run against prod. " +
        "Point .env at the Neon dev branch, or set ALLOW_PROD_DB_WRITE=1 if you truly mean it.",
    );
  }
}

async function main() {
  assertDevDb();

  // ── 1. Fixture user (upsert by id — re-run safe) ──────────────────────────
  const user = await prisma.user.upsert({
    where: { id: CHEW_USER_ID },
    update: {},
    create: {
      id: CHEW_USER_ID,
      email: "chewgether-fixture@goaldmine.dev",
      name: "Chewgether Fixture (pure-project Program)",
    },
    select: { id: true },
  });
  console.log(`user: ${user.id} (upserted)`);

  // ── 2. Chewgether project goal for THIS tenant ─────────────────────────────
  // Idempotency guard — kind + objective substring, scoped to the fixture
  // user. Postgres LIKE is case-sensitive: do NOT lowercase the brand name in
  // the objective string or the guard misses it and duplicates the goal.
  let goal = await prisma.goal.findFirst({
    where: { userId: CHEW_USER_ID, kind: "project", objective: { contains: "Chewgether" } },
    select: { id: true, objective: true, programId: true },
  });

  if (goal) {
    console.log(`goal: already exists (id=${goal.id}) — skipping create`);
  } else {
    // Targets satisfy GoalTargetSchema (metrics-registry.ts):
    //   required: metric, label, units, direction, target, weight
    //   weights: 0.6 + 0.4 = 1.0 ✓ · metric keys use the "log:" prefix.
    const targets: Prisma.InputJsonValue = [
      {
        metric: "log:mrr",
        label: "Monthly recurring revenue",
        units: "$",
        direction: "increase",
        target: 1000,
        weight: 0.6,
        rationale:
          "Primary success metric — $1k/mo MRR validates product-market fit and self-sustainability.",
      },
      {
        metric: "log:milestones_done",
        label: "Launch milestones completed",
        units: "milestones",
        direction: "increase",
        target: 7,
        weight: 0.4,
        rationale:
          "7 gated milestones (Apple Dev ownership, monetization build, TestFlight, store metadata, " +
          "submit, launch, growth to $1k) — completion rate is the leading indicator of shipping.",
      },
    ];

    const created = await prisma.goal.create({
      data: {
        userId: CHEW_USER_ID,
        objective: "Ship Chewgether to the App Store + reach $1,000/mo MRR",
        kind: "project", // explicitly 'project' — schema default is 'fitness'
        status: "active",
        active: true,
        // Legacy/display-only (see the header note): fine to focus — this is
        // the tenant's only goal, and kind-routing reads it for the payload
        // shape. Day resolution is Program-first and ignores isFocus.
        isFocus: true,
        githubRepo: "jronnomo/Chewgether",
        githubProjectNumber: null, // no GitHub Projects v2 board; sync via gh: externalRef
        targetDate: parseDateKey("2026-09-30"),
        targets,
        // Intentionally null / at-default: notes, references, legend,
        // coachFeasibility, attributionHints (project goal — no workout
        // attribution hints).
      },
      select: { id: true, objective: true, programId: true },
    });
    goal = created;
    console.log(`goal: created (id=${goal.id}, targetDate=2026-09-30)`);
  }

  // ── 3. Pure-project Program (status='active', ZERO plans) ─────────────────
  let program = await prisma.program.findFirst({
    where: { userId: CHEW_USER_ID, name: CHEW_PROGRAM_NAME },
    select: { id: true, status: true },
  });

  if (!program) {
    // Direct create as 'active' is safe HERE (and only here): the fixture
    // tenant has no other Program, and the partial unique index is per-user —
    // the founder's own active Phase 2A Program (different userId) cannot
    // conflict. App-path creation still goes draft → set_program_status.
    program = await prisma.program.create({
      data: {
        userId: CHEW_USER_ID,
        name: CHEW_PROGRAM_NAME,
        status: "active",
        startedOn: parseDateKey("2026-08-10"),
        endsOn: parseDateKey("2026-09-30"),
        notes:
          "Pure-project Program fixture (#305): zero plans by design — Today must render " +
          "'no rotation today', never an error or another tenant's plan.",
      },
      select: { id: true, status: true },
    });
    console.log(`program: created ACTIVE (id=${program.id}, zero plans by design)`);
  } else if (program.status !== "active") {
    // A previous run left it non-active (manual archiving?) — reactivate.
    // P2002 here would mean this tenant somehow has ANOTHER active Program;
    // let it throw loudly rather than paper over it.
    program = await prisma.program.update({
      where: { id: program.id },
      data: { status: "active" },
      select: { id: true, status: true },
    });
    console.log(`program: reactivated (id=${program.id})`);
  } else {
    console.log(`program: already active (id=${program.id}) — skipping`);
  }

  // ── 4. Attach the goal via Goal.programId (idempotent) ────────────────────
  if (goal.programId === program.id) {
    console.log("membership: goal already attached — skipping");
  } else {
    await prisma.goal.update({
      where: { id: goal.id },
      data: { programId: program.id },
      select: { id: true },
    });
    console.log(`membership: goal ${goal.id} attached to program ${program.id}`);
  }

  // ── 5. Zero-plan invariant ─────────────────────────────────────────────────
  const planCount = await prisma.plan.count({
    where: { OR: [{ programId: program.id }, { goalId: goal.id }] },
  });
  if (planCount > 0) {
    throw new Error(
      `Fixture polluted: ${planCount} Plan row(s) exist for the Chewgether fixture (program ${program.id} / ` +
        `goal ${goal.id}) — the pure-project scenario requires ZERO plans. Delete them and re-run.`,
    );
  }
  console.log("plans: 0 (pure-project invariant holds)");

  // ── 6. Seam assertion — the REAL resolution path for this tenant ──────────
  // getActiveProgram(): active Program exists but no Plan is attached →
  // null ("Program with no rotation") — exactly what renders 'no rotation
  // today'. getActiveProgramMembership(): the Program row + the one member.
  await runWithUser(CHEW_USER_ID, async () => {
    const membership = await getActiveProgramMembership();
    if (!membership || membership.id !== program!.id) {
      throw new Error(
        `ASSERTION FAILED: getActiveProgramMembership resolved ${membership?.id ?? "null"}, expected ${program!.id}.`,
      );
    }
    if (membership.memberGoals.length !== 1 || membership.memberGoals[0]!.id !== goal!.id) {
      throw new Error(
        `ASSERTION FAILED: expected exactly the Chewgether goal as member, got ` +
          `[${membership.memberGoals.map((g) => g.id).join(", ")}].`,
      );
    }
    const rotation = await getActiveProgram();
    if (rotation !== null) {
      throw new Error(
        `ASSERTION FAILED: getActiveProgram resolved plan ${rotation.id} ("${rotation.name}") — ` +
          `a pure-project Program must resolve NULL rotation.`,
      );
    }
    console.log("chewgether program active, rotation=null as expected");
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
