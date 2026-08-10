import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const founder = await prisma.user.upsert({
    where: { id: FOUNDER_USER_ID },
    update: {},
    create: { id: FOUNDER_USER_ID, name: "Founder" },
  });
  console.log(`Founder user ready (id=${founder.id}). Set FOUNDER_USER_ID=${founder.id} in .env`);

  // M1 (#268): the legacy Program seed write was deleted with the
  // Program → LegacyProgram rename. Plans are created per-goal via the app /
  // MCP tools — new environments no longer get a legacy row.
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
