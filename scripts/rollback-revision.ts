// Roll the active plan back to the previous revision's snapshot.
// Marks the most recent revision as rolled-back in its summary.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    include: { revisions: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!plan) throw new Error("no active plan");

  const [latest, previous] = plan.revisions;
  if (!latest || !previous) throw new Error("need at least 2 revisions to roll back");

  console.log(`Rolling back ${plan.id} from "${latest.summary}" to "${previous.summary}".`);

  await prisma.$transaction(async (tx) => {
    await tx.plan.update({
      where: { id: plan.id },
      data: { planJson: previous.snapshotJson as object },
    });
    // Insert a new revision documenting the rollback so the changelog is honest.
    await tx.planRevision.create({
      data: {
        planId: plan.id,
        triggerSource: "manual",
        summary: `Rollback of "${latest.summary}"`,
        reasoning:
          `Auto-rollback: the previous Claude revision wrote a malformed snapshot ` +
          `(serialized as a string instead of an object) which crashed the Today page. ` +
          `Restored the snapshot from "${previous.summary}" and added validation ` +
          `to apply_plan_revision so this cannot happen again.`,
        snapshotJson: previous.snapshotJson as object,
      },
    });
  });

  console.log("Rolled back. Confirm at /goals/<id>/revisions to see the audit entry.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
