// Ensure every existing Plan has an "initial" PlanRevision so revision detail
// pages have a previous snapshot to diff against.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const plans = await prisma.plan.findMany({
    include: { revisions: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  for (const plan of plans) {
    const earliest = plan.revisions[0];
    if (earliest && earliest.summary === "Initial plan from program template") {
      console.log(`Plan ${plan.id} already has initial revision.`);
      continue;
    }

    // Insert an initial revision dated 1 ms before the earliest existing one
    // (or now if there are none) so it sorts first.
    const createdAt = earliest ? new Date(earliest.createdAt.getTime() - 1) : new Date();

    await prisma.planRevision.create({
      data: {
        planId: plan.id,
        triggerSource: "manual",
        summary: "Initial plan from program template",
        reasoning: `Scaffolded from the program template, scaled to ${plan.weeks} weeks. Backfilled retroactively so subsequent revisions have a clean predecessor for diffs.`,
        snapshotJson: plan.planJson as unknown as object,
        createdAt,
      },
    });
    console.log(`Plan ${plan.id}: backfilled initial revision (createdAt=${createdAt.toISOString()}).`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
