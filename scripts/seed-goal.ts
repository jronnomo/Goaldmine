// Smoke test: insert the Mt. Elbert goal with default targets, plus a couple
// measurements + baselines so readiness has signal.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { MT_ELBERT_DEFAULT_TARGETS } from "../src/lib/goal-targets";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const existing = await prisma.goal.findFirst({ where: { active: true } });
  if (existing) {
    console.log(`Goal already exists: ${existing.objective} (${existing.id})`);
    return;
  }

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 90);

  const goal = await prisma.goal.create({
    data: {
      userId: FOUNDER_USER_ID,
      objective: "Summit Mt. Elbert via Black Cloud Trail",
      targetDate,
      notes:
        "Hero objective. ~11-12 mi RT, ~5,200 ft gain, 14,440 ft summit. " +
        "Need leg endurance + aerobic base. Pacing matters more than raw strength.",
      targets: MT_ELBERT_DEFAULT_TARGETS,
    },
  });

  // Seed a couple weight measurements so readiness has start + current.
  await prisma.measurement.create({
    data: { userId: FOUNDER_USER_ID, date: new Date(Date.now() - 7 * 86400000), weightLb: 170 },
  });
  await prisma.measurement.create({
    data: { userId: FOUNDER_USER_ID, date: new Date(), weightLb: 169 },
  });

  console.log(`Created goal: ${goal.objective} (${goal.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
