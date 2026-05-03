import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    include: {
      revisions: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!plan) {
    console.log("no active plan");
    return;
  }

  const cur = plan.planJson as Record<string, unknown> | null;
  const keys = cur ? Object.keys(cur) : [];
  console.log("plan.id:", plan.id);
  console.log("Plan.planJson top-level keys:", keys);
  console.log(
    "  phases:",
    Array.isArray((cur as { phases?: unknown }).phases)
      ? `${((cur as { phases: unknown[] }).phases).length} entries`
      : "MISSING/INVALID",
  );
  console.log(
    "  weeklySplit:",
    Array.isArray((cur as { weeklySplit?: unknown }).weeklySplit)
      ? `${((cur as { weeklySplit: unknown[] }).weeklySplit).length} entries`
      : "MISSING/INVALID",
  );
  console.log(
    "  baselineWeek:",
    Array.isArray((cur as { baselineWeek?: unknown }).baselineWeek)
      ? `${((cur as { baselineWeek: unknown[] }).baselineWeek).length} entries`
      : "MISSING/INVALID",
  );
  console.log(
    "  dailyMobility:",
    (cur as { dailyMobility?: unknown }).dailyMobility ? "present" : "MISSING",
  );

  console.log("\nlatest 5 revisions:");
  for (const r of plan.revisions) {
    const snap = r.snapshotJson as Record<string, unknown> | null;
    const sk = snap ? Object.keys(snap) : [];
    console.log(`  ${r.createdAt.toISOString()} [${r.triggerSource}] ${r.summary}`);
    console.log(`    snapshot keys: ${sk.join(", ")}`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
