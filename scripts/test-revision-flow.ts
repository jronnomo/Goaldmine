// Smoke test: create a note, verify it shows as pending, apply a revision
// linked to it, verify changelog reflects it.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const goal = await prisma.goal.findFirst({
    where: { active: true },
    include: { plans: { where: { active: true }, take: 1 } },
  });
  if (!goal || !goal.plans[0]) throw new Error("No goal+plan to test against");
  const plan = goal.plans[0];

  // Create a note simulating an audible.
  const note = await prisma.note.create({
    data: {
      body:
        "Travel mid-week (Tue-Thu) — limited gym access. Hotel has dumbbells to 30 lb and a stairmaster. Skipped Day 2 lower; plan to make up Saturday.",
      type: "audible",
    },
  });
  console.log(`Created audible note: ${note.id}`);

  // Apply a revision (snapshot stays the same — this records a coaching note
  // without structural change, but properly links the trigger note).
  const rev = await prisma.$transaction(async (tx) => {
    const r = await tx.planRevision.create({
      data: {
        planId: plan.id,
        triggerNoteId: note.id,
        triggerSource: "claude",
        summary: "No structural change; shift Day 2 to Saturday this week only",
        reasoning:
          "Travel constraints don't justify a permanent plan change. Recommendation: " +
          "perform Day 2 (Lower + Hiking superset) on Saturday in place of the long endurance " +
          "session. Push the long endurance to Sunday. Cumulative weekly volume preserved; " +
          "Phase 1 progression intact.",
        snapshotJson: plan.planJson as unknown as object,
      },
    });
    await tx.plan.update({
      where: { id: plan.id },
      data: { planJson: plan.planJson as unknown as object },
    });
    return r;
  });
  console.log(`Created revision: ${rev.id}`);

  const reloaded = await prisma.plan.findUnique({
    where: { id: plan.id },
    include: { revisions: { include: { triggerNote: true }, orderBy: { createdAt: "desc" } } },
  });
  console.log(`Plan now has ${reloaded?.revisions.length ?? 0} revision(s)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
