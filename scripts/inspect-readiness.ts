import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const goal = await prisma.goal.findFirst({ where: { active: true } });
  if (!goal) throw new Error("no active goal");

  const targets = (goal.targets as Array<Record<string, unknown>> | null) ?? [];
  console.log("Goal targets metrics:");
  for (const t of targets) {
    console.log(`  metric=${JSON.stringify(t.metric)} target=${t.target} units=${t.units}`);
  }

  const baselines = await prisma.baseline.findMany({ orderBy: { date: "asc" } });
  console.log("\nLogged baseline rows:");
  for (const b of baselines) {
    console.log(
      `  testName=${JSON.stringify(b.testName)} value=${b.value} units=${b.units} date=${b.date.toISOString().slice(0, 10)}`,
    );
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
