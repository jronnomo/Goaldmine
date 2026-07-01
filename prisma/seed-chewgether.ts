// prisma/seed-chewgether.ts
//
// Idempotent seed: creates the Chewgether project goal.
//
// Focus-split context:
//   active=true  → the goal is tracked (appears in list_goals, readiness panel).
//   isFocus=false → Mt. Elbert retains isFocus=true and keeps driving the daily
//                   prescription on the Today page. Do NOT flip isFocus here.
//
// GitHub-first milestones (PRD §2.1 amendment):
//   The 7 launch milestones live on jronnomo/Chewgether GitHub as real milestones
//   and are mirrored via sync_github_milestones (gh: externalRefs on ScheduledItem).
//   Do NOT seed ScheduledItems here — that would create a duplicate source of truth.
//
// Idempotency guard note:
//   The guard uses objective: { contains: "Chewgether" }. Postgres LIKE is
//   case-sensitive (ILP collation). Do NOT lowercase the brand name in the
//   objective string — the guard would miss it and create a duplicate goal.
//
// Usage:
//   npx tsx prisma/seed-chewgether.ts
//   (DATABASE_URL is loaded from .env via the in-file dotenv import below.)

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseDateKey } from "../src/lib/calendar";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";
import type { Prisma } from "../src/generated/prisma/client";

async function main() {
  // Idempotency guard — match on kind + objective substring so a re-run is safe
  // even if the goal was manually renamed slightly.
  const existing = await prisma.goal.findFirst({
    where: { kind: "project", objective: { contains: "Chewgether" } },
    select: { id: true, objective: true },
  });

  if (existing) {
    console.log(
      `Chewgether goal already exists (id=${existing.id}, objective="${existing.objective}"). Skipping.`,
    );
    return;
  }

  // Targets satisfy GoalTargetSchema (metrics-registry.ts):
  //   required: metric, label, units, direction, target, weight
  //   optional: start (absent — auto-captured at goal creation), rationale (present)
  //   weights: 0.6 + 0.4 = 1.0 ✓
  // metric keys use the "log:" prefix (LogEntry-backed metric family).
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

  const goal = await prisma.goal.create({
    data: {
      userId: FOUNDER_USER_ID,
      objective: "Ship Chewgether to the App Store + reach $1,000/mo MRR",
      kind: "project",           // explicitly 'project' — schema default is 'fitness'
      status: "active",          // explicit (matches default, but stated for clarity)
      active: true,              // explicit (matches default, but stated for clarity)
      isFocus: false,            // explicit per PRD §2.3 — Mt. Elbert keeps focus
      githubRepo: "jronnomo/Chewgether",
      githubProjectNumber: null, // no GitHub Projects v2 board yet; sync via gh: externalRef
      targetDate: parseDateKey("2026-09-30"),
      targets,
      // Intentionally null / at-default:
      //   notes          — null (no free-form notes needed at seed time)
      //   references     — null (added later via add_goal_reference)
      //   legend         — null (set later via update_goal_legend with a project preset)
      //   coachFeasibility — null (coach assesses after first review)
      //   attributionHints — null (project goals have no workout attribution)
    },
  });

  console.log(
    `Created Chewgether goal (id=${goal.id}, targetDate=2026-09-30).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
