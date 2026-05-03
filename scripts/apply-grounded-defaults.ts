// One-off: rewrite the active Mt. Elbert goal's targets to the new grounded defaults.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { MT_ELBERT_DEFAULT_TARGETS } from "../src/lib/goal-targets";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const goal = await prisma.goal.findFirst({
    where: { active: true, objective: { contains: "Elbert" } },
  });
  if (!goal) {
    console.log("No active Mt. Elbert goal found.");
    return;
  }
  await prisma.goal.update({
    where: { id: goal.id },
    data: { targets: MT_ELBERT_DEFAULT_TARGETS },
  });
  console.log(`Reset targets on goal "${goal.objective}" (${goal.id}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
