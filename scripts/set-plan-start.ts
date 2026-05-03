// Reset the active plan's startedOn so Day 1 lands on the day the user
// actually started training.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const startedOn = new Date("2026-05-02T00:00:00.000-06:00"); // user's first workout, MDT

  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!plan) {
    console.log("No active plan found.");
    return;
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: { startedOn },
  });
  console.log(`Plan "${plan.name}" startedOn → ${startedOn.toISOString().slice(0, 10)}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
