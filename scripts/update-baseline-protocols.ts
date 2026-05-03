// Apply the updated baseline protocols (clarified per-DB vs total weights,
// Farmer Carry fixed at 65 lb DBs, etc.) to the existing active plan.
// Writes a PlanRevision so the change shows up in the changelog.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PROGRAM_TEMPLATE } from "../src/lib/program-template";
import type { ProgramTemplate } from "../src/lib/program-template";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!plan) throw new Error("no active plan");

  const current = plan.planJson as unknown as ProgramTemplate;

  // Replace baselineWeek with the updated source-of-truth from program-template.
  const next: ProgramTemplate = {
    ...current,
    baselineWeek: PROGRAM_TEMPLATE.baselineWeek,
  };

  await prisma.$transaction(async (tx) => {
    await tx.planRevision.create({
      data: {
        planId: plan.id,
        triggerSource: "manual",
        summary: "Clarify baseline protocols (per-DB weights, fixed Farmer Carry load)",
        reasoning:
          "User feedback: 'lb' was ambiguous (total vs per-DB). All DB-based tests now state 'PER DB' explicitly. " +
          "Farmer Carry switched from 'heaviest DBs' to a fixed 65 lb-per-hand load with time as the single variable — " +
          "65 lb felt right after today's session. Protocol strings rewritten across all four baseline days for clarity. " +
          "Test values already logged remain valid; reinterpret per the new protocol on retests.",
        snapshotJson: next as unknown as object,
      },
    });
    await tx.plan.update({
      where: { id: plan.id },
      data: { planJson: next as unknown as object },
    });
  });

  console.log("Baseline protocols updated on plan", plan.id);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
