// One-off: backfill a Plan for any existing Goal that doesn't have one yet.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { scaffoldPlanFromTemplate, weeksBetween } from "../src/lib/plan";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const goals = await prisma.goal.findMany({ include: { plans: true } });
  for (const goal of goals) {
    if (goal.plans.length > 0) {
      console.log(`Goal "${goal.objective}" already has ${goal.plans.length} plan(s); skipping.`);
      continue;
    }
    const now = new Date();
    const weeks = weeksBetween(now, goal.targetDate);
    const planTemplate = scaffoldPlanFromTemplate(weeks);
    await prisma.plan.create({
      data: {
        goalId: goal.id,
        name: `${goal.objective} — ${weeks}-week plan`,
        startedOn: now,
        endsOn: goal.targetDate,
        weeks,
        active: true,
        planJson: planTemplate as unknown as object,
      },
    });
    console.log(`Created plan for "${goal.objective}" (${weeks} weeks).`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
