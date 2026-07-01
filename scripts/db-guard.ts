import "dotenv/config";

/**
 * db-guard.ts — Safety rail for destructive Prisma commands.
 *
 * Fail-closed: refuses to let migrate/seed/push run unless DB_ENV=development.
 * Escape hatch: ALLOW_PROD_DB_WRITE=1 overrides (with a loud warning).
 *
 * Usage:
 *   tsx scripts/db-guard.ts           # print status, always exit 0
 *   tsx scripts/db-guard.ts --assert  # print status, exit non-zero if not dev
 */

function maskedHost(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "unset";
  try {
    const u = new URL(raw);
    return u.host;
  } catch {
    return "<malformed URL>";
  }
}

export function assertDevDb(): void {
  const dbEnv = process.env.DB_ENV;
  const host = maskedHost();

  if (process.env.ALLOW_PROD_DB_WRITE === "1") {
    process.stderr.write(
      `\n⚠  ALLOW_PROD_DB_WRITE=1 — bypassing dev-DB guard (host: ${host}). ` +
        "Writes will target the labelled database. Proceed with extreme caution.\n\n",
    );
    return;
  }

  if (dbEnv !== "development") {
    throw new Error(
      `Refusing: DB_ENV is not 'development' (host: ${host}). ` +
        "Point .env at your Neon dev branch and set DB_ENV=development, " +
        "or set ALLOW_PROD_DB_WRITE=1 to override.",
    );
  }
}

function main(): void {
  const host = maskedHost();
  const dbEnv = process.env.DB_ENV ?? "unset";
  const isAssert = process.argv.includes("--assert");

  // Always print status — host only, never credentials.
  console.log(`DATABASE_URL host: ${host}`);
  console.log(`DB_ENV: ${dbEnv}`);

  if (dbEnv === "development") {
    console.log("[dev — safe ✓]");
  } else {
    console.log("⚠ not labeled development — migrate/seed will refuse");
  }

  if (isAssert) {
    assertDevDb();
    // If assertDevDb() returned (escape hatch), exit cleanly.
    process.exit(0);
  }

  // Without --assert, always exit 0 (status-only mode).
  process.exit(0);
}

main();
