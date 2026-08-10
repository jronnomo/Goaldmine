// Use the options-based quiet form (not `process.env.DOTENV_CONFIG_QUIET = "1"` before
// `import "dotenv/config"`) — ESM hoists import evaluation ahead of other top-level
// statements in this module, so a plain env-var-then-import would set the flag too late.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ quiet: true });

/**
 * check-migration-status.ts — build-time migration-status gate (#263).
 *
 * Purpose: refuse to let `next build` proceed when DATABASE_URL's schema is
 * behind prisma/migrations (the completedAt-incident failure mode — a
 * schema-changing deploy shipped a freshly-generated Prisma client ahead of
 * the prod database's actual columns, breaking every Goal read until a
 * manual `prisma migrate deploy`). Read-only: this script never runs
 * `migrate deploy`, `migrate dev`, `db push`, or any other write/guarded
 * command — it only calls `prisma migrate status`.
 *
 * Why inlined in the `build` npm script (not an npm `prebuild` hook):
 * Vercel's build-command setting may invoke `next build` (or whatever the
 * dashboard's build command is) directly, bypassing npm lifecycle hooks —
 * `prebuild` is not guaranteed to fire. Wiring this into `build` itself
 * (`tsx scripts/check-migration-status.ts && next build`) is the only place
 * guaranteed to run before the Next.js build starts, on every environment.
 *
 * Fail-closed policy: any state we cannot positively confirm as "up to
 * date" is treated as a failure (exit 1) — including DATABASE_URL being
 * unset, `prisma migrate status` failing to spawn, a connection error, or
 * unexpected CLI output we can't classify. We would rather block a deploy
 * than let a schema mismatch ship silently.
 *
 * Bypass is run-then-warn, never skip-then-warn: SKIP_MIGRATION_GATE=1 does
 * NOT skip the check — the check always runs. The flag only downgrades a
 * would-be failure (pending/failed migrations, or cannot-verify) to exit 0,
 * printed with a loud ⚠ warning. If the flag is set but the check would
 * have passed anyway, we say so at a lower volume ("not needed — remove
 * it"). Rationale: a forgotten bypass flag must never silently disable the
 * gate — if it's set, you find out every single build, whether or not it
 * was actually needed this time.
 *
 * Pooled-URL fallback design (not built in v1): if `prisma migrate status`
 * ever misbehaves talking through Neon's pooled connection on Vercel (e.g.
 * PgBouncer transaction-pooling interfering with advisory locks Prisma uses
 * internally), the fallback is a direct read-only query:
 *   SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
 * diffed against the directory names under prisma/migrations/* — any
 * directory without a corresponding finished_at-set, non-rolled-back row is
 * "pending". This avoids relying on the Prisma CLI's own status detection
 * at the cost of re-implementing a slice of its logic; deferred until we
 * actually observe `migrate status` misbehave through pooling.
 */

import { spawnSync } from "node:child_process";

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

const BYPASS_HINT =
  "To bypass in an emergency: SKIP_MIGRATION_GATE=1 (loud warning, use consciously).";

function printBypassWarning(reason: string): void {
  process.stderr.write(
    `\n⚠  SKIP_MIGRATION_GATE=1 — bypassing migration gate: ${reason}\n` +
      "   Deploy may ship a client ahead of the DB schema. Proceed with extreme caution.\n\n",
  );
}

function main(): void {
  const host = maskedHost();
  const bypassSet = process.env.SKIP_MIGRATION_GATE === "1";

  if (!process.env.DATABASE_URL) {
    if (bypassSet) {
      printBypassWarning(`could not verify migration status: DATABASE_URL is not set (host: ${host}).`);
      process.exit(0);
    }
    process.stderr.write(
      `\ncould not verify migration status: DATABASE_URL is not set (host: ${host}).\n` +
        `${BYPASS_HINT}\n\n`,
    );
    process.exit(1);
  }

  const r = spawnSync("node_modules/.bin/prisma", ["migrate", "status"], {
    encoding: "utf8",
  });

  if (r.error || r.status === null) {
    if (bypassSet) {
      printBypassWarning(
        `failed to spawn 'prisma migrate status' (host: ${host}): ${r.error?.message ?? "unknown spawn error"}.`,
      );
      process.exit(0);
    }
    process.stderr.write(
      `\ncould not verify migration status (fail-closed): failed to spawn 'prisma migrate status' ` +
        `(host: ${host}).\n${r.error?.message ?? "unknown spawn error"}\n\n${BYPASS_HINT}\n\n`,
    );
    process.exit(1);
  }

  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  if (r.status === 0) {
    if (bypassSet) {
      process.stderr.write(
        "\nSKIP_MIGRATION_GATE is set but was not needed — remove it from the environment.\n\n",
      );
    }
    console.log(`✓ migration gate: database schema is up to date (host: ${host})`);
    process.exit(0);
  }

  const looksLikePendingOrFailed =
    /have not yet been applied/i.test(out) || /have failed/i.test(out);

  if (looksLikePendingOrFailed) {
    const relevantLines = out
      .split("\n")
      .filter((line) => /have not yet been applied/i.test(line) || /have failed/i.test(line) || /^\s*-?\s*\d{14}/.test(line))
      .join("\n");

    if (bypassSet) {
      printBypassWarning(`pending/failed migrations detected (host: ${host}).`);
      process.exit(0);
    }

    process.stderr.write(
      `\npending/failed migrations detected (host: ${host}):\n\n${relevantLines}\n\n` +
        "Apply with `prisma migrate deploy` against this DB before deploying " +
        "(see docs/project-gotchas.md prod-migration runbook).\n\n" +
        `${BYPASS_HINT}\n\n` +
        `--- full prisma output ---\n${out}\n`,
    );
    process.exit(1);
  }

  if (bypassSet) {
    printBypassWarning(`could not verify migration status (host: ${host}).`);
    process.exit(0);
  }

  process.stderr.write(
    `\ncould not verify migration status (fail-closed) (host: ${host}).\n\n` +
      `${BYPASS_HINT}\n\n` +
      `--- full prisma output ---\n${out}\n`,
  );
  process.exit(1);
}

main();
