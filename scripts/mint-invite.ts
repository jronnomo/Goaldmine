// scripts/mint-invite.ts
//
// A-3: Mint a new invite code and persist it to the database.
//
// Usage:
//   npx tsx scripts/mint-invite.ts [--email a@b.com] [--max-uses 5] [--expires-days 30] [--note "for X"]
//
// No DB_ENV hard-refuse — minting invites on prod is legitimate.
// Prints the target host so the operator knows which DB is being written.

import "dotenv/config";
import crypto from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };

  return {
    email: get("--email"),
    maxUses: get("--max-uses") ? parseInt(get("--max-uses")!, 10) : 1,
    expiresDays: get("--expires-days") ? parseInt(get("--expires-days")!, 10) : undefined,
    note: get("--note"),
  };
}

const { email, maxUses, expiresDays, note } = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Bootstrap Prisma (same pattern as other scripts)
// ---------------------------------------------------------------------------
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗  DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// ---------------------------------------------------------------------------
// Print target host (no credentials) — like db-guard
// ---------------------------------------------------------------------------
function targetHost(): string {
  try {
    return new URL(connectionString!).hostname;
  } catch {
    return "<malformed URL>";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const dbEnv = process.env.DB_ENV ?? "(not set)";
  const host = targetHost();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  console.log(`\nDB_ENV: ${dbEnv}  host: ${host}`);

  // Generate a crypto-random URL-safe code (12 chars base64url ≈ 72 bits entropy)
  const code = crypto.randomBytes(9).toString("base64url");

  const expiresAt = expiresDays
    ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000)
    : null;

  const invite = await prisma.invite.create({
    data: {
      code,
      email: email ?? null,
      maxUses,
      note: note ?? null,
      expiresAt,
    },
  });

  const inviteLink = `${appUrl}/signin?invite=${code}`;

  console.log("\n✓  Invite created:");
  console.log(`   id          : ${invite.id}`);
  console.log(`   code        : ${code}`);
  console.log(`   email       : ${email ?? "(any)"}`);
  console.log(`   maxUses     : ${maxUses}`);
  console.log(`   expires     : ${expiresAt ? expiresAt.toISOString() : "never"}`);
  console.log(`   note        : ${note ?? "(none)"}`);
  console.log(`\n   Invite link : ${inviteLink}\n`);
}

main()
  .catch((e) => {
    console.error("\n✗  Unhandled error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
