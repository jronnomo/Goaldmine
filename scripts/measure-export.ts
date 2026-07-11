// scripts/measure-export.ts
//
// #246 — read-only size watchdog for the /api/export payload. Kept
// permanently (not a one-off spike script) per the architecture critique's
// escalation rule:
//
//   If a future run of this script measures >2.5 MB (60% of the 4 MB cap,
//   see src/app/api/export/route.ts) for any user, that's the trigger to
//   either (a) cap PlanRevision history in the export to the most recent N
//   revisions, or (b) implement NDJSON/chunked streaming. Don't build either
//   speculatively before that trigger fires.
//
// Read-only: only ever calls findMany via the founder's scoped client, no
// writes, no db:guard write-gate needed. Still refuses to run against a
// non-development DB_ENV as a blanket safety rail (Neon is shared with prod).
//
// Usage:
//   npx tsx scripts/measure-export.ts

import "dotenv/config";

// ---------------------------------------------------------------------------
// Dev-DB guard — must run first, before any DB import
// ---------------------------------------------------------------------------
if (process.env.DB_ENV !== "development") {
  console.error(
    "[ABORT] DB_ENV is not 'development'. Refusing to run against non-dev DB.\n" +
      `       Got: DB_ENV=${process.env.DB_ENV ?? "(unset)"}`,
  );
  process.exit(1);
}

import { prisma, runWithUser, getDb } from "../src/lib/db";
import { buildExportPayload } from "../src/lib/export-data";

async function main() {
  const founder = await prisma.user.findFirst();
  if (!founder) {
    console.error("[ABORT] No user found in the dev DB — seed one first (npm run db:seed).");
    process.exit(1);
  }

  console.log(`Measuring export payload for user ${founder.id} (${founder.email ?? "no email"})\n`);

  const payload = await runWithUser(founder.id, async () => buildExportPayload(await getDb()));

  const rows: Array<{ model: string; count: number; bytes: number }> = [];
  for (const [model, value] of Object.entries(payload.models)) {
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    rows.push({ model, count: (value as unknown[]).length, bytes });
  }
  rows.sort((a, b) => b.bytes - a.bytes);

  const totalJson = JSON.stringify(payload);
  const totalBytes = Buffer.byteLength(totalJson, "utf8");

  const modelCol = Math.max(...rows.map((r) => r.model.length), "Model".length);
  console.log(`${"Model".padEnd(modelCol)}  ${"Rows".padStart(6)}  ${"Bytes".padStart(10)}`);
  console.log(`${"-".repeat(modelCol)}  ${"-".repeat(6)}  ${"-".repeat(10)}`);
  for (const r of rows) {
    console.log(`${r.model.padEnd(modelCol)}  ${String(r.count).padStart(6)}  ${String(r.bytes).padStart(10)}`);
  }
  console.log(`${"-".repeat(modelCol)}  ${"-".repeat(6)}  ${"-".repeat(10)}`);
  console.log(
    `${"TOTAL (incl. envelope)".padEnd(modelCol)}  ${"".padStart(6)}  ${String(totalBytes).padStart(10)}`,
  );

  const mb = (totalBytes / (1024 * 1024)).toFixed(3);
  console.log(`\nTotal: ${totalBytes} bytes (${mb} MB) against the 4,000,000-byte cap.`);

  if (totalBytes > 2_500_000) {
    console.warn(
      "\n⚠  Exceeds the 2.5 MB escalation trigger — see this script's header comment for next steps.",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
