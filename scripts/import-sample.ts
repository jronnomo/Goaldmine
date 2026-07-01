import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseStrongWorkout } from "../src/lib/parsers/strong";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const raw = readFileSync("./examples/sample-completed-workout.txt", "utf8");
  const parsed = parseStrongWorkout(raw);

  const created = await prisma.workout.create({
    data: {
      userId: FOUNDER_USER_ID,
      title: parsed.title,
      startedAt: parsed.startedAt,
      status: "completed",
      source: "strong.app",
      sourceUrl: parsed.sourceUrl,
      exercises: {
        create: parsed.exercises.map((ex) => ({
          name: ex.name,
          equipment: ex.equipment,
          orderIndex: ex.orderIndex,
          sets: {
            create: ex.sets.map((s) => ({
              setIndex: s.setIndex,
              reps: s.reps ?? null,
              weightLb: s.weightLb ?? null,
              durationSec: s.durationSec ?? null,
            })),
          },
        })),
      },
    },
  });

  console.log(`Imported sample workout: id=${created.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
