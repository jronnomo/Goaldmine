/**
 * One-off maintenance script: find (and optionally fix) text fields that
 * contain a literal unicode escape like `—` instead of the real character.
 *
 *   npx tsx scripts/scan-escapes.ts          # read-only report
 *   npx tsx scripts/scan-escapes.ts --apply  # decode + write back
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// Matches a JS-style \uXXXX escape sequence sitting as literal text.
const ESCAPE_RE = /\\u[0-9a-fA-F]{4}/;

function decode(s: string): string {
  // Single-pass left-to-right unescape so that `\\u2014` correctly becomes the
  // literal text `—` (the `\\` is consumed first) rather than an em-dash.
  // Only runs on rows already known to contain a \uXXXX escape (see guard).
  return s.replace(
    /\\(u[0-9a-fA-F]{4}|n|t|r|b|f|"|\\|\/)/g,
    (_, g: string) => {
      if (g[0] === "u") return String.fromCodePoint(parseInt(g.slice(1), 16));
      switch (g) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case "b": return "\b";
        case "f": return "\f";
        case '"': return '"';
        case "\\": return "\\";
        case "/": return "/";
        default: return g;
      }
    },
  );
}

type Target = {
  model: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (args: any) => Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: (args: any) => Promise<any>;
  fields: string[];
};

const targets: Target[] = [
  { model: "workout", findMany: prisma.workout.findMany, update: prisma.workout.update, fields: ["title", "notes"] },
  { model: "workoutExercise", findMany: prisma.workoutExercise.findMany, update: prisma.workoutExercise.update, fields: ["name", "equipment", "notes"] },
  { model: "set", findMany: prisma.set.findMany, update: prisma.set.update, fields: ["notes"] },
  { model: "note", findMany: prisma.note.findMany, update: prisma.note.update, fields: ["body", "resolvedReason"] },
  { model: "nutritionLog", findMany: prisma.nutritionLog.findMany, update: prisma.nutritionLog.update, fields: ["notes"] },
  { model: "hike", findMany: prisma.hike.findMany, update: prisma.hike.update, fields: ["route", "notes"] },
  { model: "baseline", findMany: prisma.baseline.findMany, update: prisma.baseline.update, fields: ["testName", "notes"] },
  { model: "measurement", findMany: prisma.measurement.findMany, update: prisma.measurement.update, fields: ["notes"] },
];

async function main() {
  let hits = 0;
  for (const t of targets) {
    const rows = await t.findMany({});
    for (const row of rows) {
      const patch: Record<string, string> = {};
      for (const f of t.fields) {
        const v = row[f];
        if (typeof v === "string" && ESCAPE_RE.test(v)) {
          const fixed = decode(v);
          hits++;
          console.log(`\n[${t.model}.${f}] id=${row.id}`);
          console.log(`  before: ${JSON.stringify(v)}`);
          console.log(`  after : ${JSON.stringify(fixed)}`);
          patch[f] = fixed;
        }
      }
      if (APPLY && Object.keys(patch).length > 0) {
        await t.update({ where: { id: row.id }, data: patch });
      }
    }
  }
  console.log(`\n${hits} field(s) with literal escapes${APPLY ? " — FIXED" : " (read-only; re-run with --apply to fix)"}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
