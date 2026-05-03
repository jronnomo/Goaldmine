// One-off correction:
// - Original weight should be 159 (replaces the synthetic 170/169 measurements)
// - Goal weight target stays 155 (verify on the active goal)

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { GoalTarget } from "../src/lib/goal-targets";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  // Wipe seeded synthetic measurements and insert a real start at 159.
  const deleted = await prisma.measurement.deleteMany({});
  console.log(`Deleted ${deleted.count} measurement(s).`);

  await prisma.measurement.create({
    data: {
      date: new Date(),
      weightLb: 159,
      notes: "Corrected starting weight for the 90-day program.",
    },
  });
  console.log("Inserted starting measurement: 159 lb today.");

  // Verify the active goal's weight target.
  const goal = await prisma.goal.findFirst({ where: { active: true } });
  if (!goal) {
    console.log("No active goal found.");
    return;
  }

  const targets = (goal.targets as unknown as GoalTarget[] | null) ?? [];
  const updated = targets.map((t) =>
    t.metric === "weightLb" ? { ...t, target: 155 } : t,
  );

  const before = targets.find((t) => t.metric === "weightLb")?.target;
  const after = updated.find((t) => t.metric === "weightLb")?.target;

  if (before === after) {
    console.log(`Goal "${goal.objective}" weight target already ${after} lb. No change.`);
  } else {
    await prisma.goal.update({ where: { id: goal.id }, data: { targets: updated } });
    console.log(`Goal "${goal.objective}" weight target ${before} -> ${after} lb.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
