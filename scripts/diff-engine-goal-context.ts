// scripts/diff-engine-goal-context.ts
//
// #299 (isFocus sweep, game-engine site) — the mandatory pre/post equivalence
// snapshot for swapping engine.ts's focus-goal lookup onto the rotation-owner
// resolution. Extends the diff-xp-ledger.ts approach: dump the founder's FULL
// computed game state (the DB path — computeGameStateFresh, i.e. the exact
// lookup being changed) as deterministic JSON; run once at the pre-change
// commit and once post-change, then `diff` the two files. Zero delta required
// for the zero-Program founder shape.
//
// Read-only — safe against any DB_ENV. "now" is frozen so both runs bucket
// "today" identically even across a midnight boundary.
//
// Usage: npx tsx scripts/diff-engine-goal-context.ts <out.json> [--user <id>]

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma, runWithUser } from "../src/lib/db";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";
import { computeGameStateFresh } from "../src/lib/game/engine";

const FIXED_NOW = new Date("2026-08-10T12:00:00.000Z");
const RealDate = Date;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Date = class extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(FIXED_NOW.getTime());
    } else {
      // @ts-expect-error variadic passthrough to the real Date
      super(...args);
    }
  }
  static now() {
    return FIXED_NOW.getTime();
  }
} as DateConstructor;

async function main() {
  const argv = process.argv.slice(2);
  const out = argv[0];
  if (!out || out.startsWith("--")) {
    throw new Error("usage: npx tsx scripts/diff-engine-goal-context.ts <out.json> [--user <id>]");
  }
  const userFlagIdx = argv.indexOf("--user");
  const userId = userFlagIdx >= 0 ? argv[userFlagIdx + 1]! : FOUNDER_USER_ID;

  // Tenant shape readout for the report (the #299 coverage set: active
  // Program / zero-Program-rows / Program with no active Plan).
  const shape = {
    programRows: await prisma.program.count({ where: { userId } }),
    activeProgramId:
      (
        await prisma.program.findFirst({
          where: { userId, status: "active" },
          select: { id: true },
        })
      )?.id ?? null,
    focusGoal:
      (await prisma.goal.findFirst({
        where: { userId, isFocus: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, kind: true },
      })) ?? null,
  };

  const state = await runWithUser(userId, () => computeGameStateFresh());

  writeFileSync(out, JSON.stringify({ shape, state }, null, 2));
  console.log(
    `tenant shape: programRows=${shape.programRows} activeProgram=${shape.activeProgramId ?? "none"} ` +
      `focusGoal=${shape.focusGoal?.id ?? "none"} (${shape.focusGoal?.kind ?? "-"})`,
  );
  console.log(
    `goalKind=${state.goalKind} level=${state.level} xp=${state.xp} ` +
      `events=${state.events.length} attributes=[${state.attributes.map((a) => `${a.id}:${a.xp}`).join(" ")}]`,
  );
  console.log(`wrote ${out}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
