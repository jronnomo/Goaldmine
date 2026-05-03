import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PROGRAM_TEMPLATE } from "../src/lib/program-template";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const existing = await prisma.program.findFirst({ where: { active: true } });
  if (existing) {
    console.log(`Active program already exists (id=${existing.id}, name="${existing.name}"). Skipping seed.`);
    return;
  }

  const startedOn = new Date();
  startedOn.setHours(0, 0, 0, 0);

  const program = await prisma.program.create({
    data: {
      name: PROGRAM_TEMPLATE.name,
      startedOn,
      phase: 1,
      week: 1,
      day: 1,
      version: 1,
      active: true,
      planJson: PROGRAM_TEMPLATE as unknown as object,
    },
  });

  console.log(`Seeded program "${program.name}" (id=${program.id}). Started ${startedOn.toISOString().slice(0, 10)}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
