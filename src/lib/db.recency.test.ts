/**
 * Audit A2 guard — "a bounded read that keeps the wrong end of the series".
 *
 * `orderBy: { date: "asc" }` combined with `take: N` returns the N OLDEST
 * rows. On any table that grows, the newest rows fall off the end the moment
 * the row count passes N, and the surface reading it FREEZES — silently, with
 * no error, showing stale data that looks like "nothing was recorded since".
 *
 * This has now bitten three times on three different models:
 *
 *   1. BodyCompositionCard / progress-data — fixed (UXR-PROG-80): the weight
 *      series is a bounded-DESC scan reversed, never `take:180` asc.
 *   2. /history's Weight trend — `orderBy: date asc, take: 90` pinned the
 *      chart to the 90th-OLDEST weigh-in. It had stopped at Aug 27 while
 *      readings landed daily through Aug 30. The range chips could not mask
 *      it: they window client-side over rows the server already sent.
 *   3. progress-data's body-metrics lid — `take: 400` asc inside a window,
 *      latent until a user logs >400 readings in it.
 *
 * Each fix is the same shape: order DESC, take the bound, `.reverse()`. That
 * puts the bound on the end of the series nobody is looking at.
 *
 * So this is a source-level gate rather than another after-the-fact fix. It
 * runs in `npm run test`, which the launch gate already runs before every
 * deploy to main.
 *
 * Deliberately taking the oldest rows is legitimate — a worker queue drains
 * oldest-first. Those go in ALLOWLIST with a reason, and a stale entry fails
 * too, so the list can't rot into a rubber stamp.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Ordering keys where "newest" is what a reader means. */
const RECENCY_KEYS = [
  "date",
  "startedAt",
  "createdAt",
  "completedAt",
  "loggedAt",
  "occurredAt",
];

type Allow = { file: string; reason: string };

/**
 * Reads that intentionally keep the OLDEST rows. Every entry needs a reason a
 * reviewer can check — "it's fine" is not one.
 */
const ALLOWLIST: Allow[] = [
  {
    file: "src/lib/mcp/tools/render-tools.ts",
    reason:
      "Worker queue drain (list_render_jobs): jobs are claimed oldest-first on purpose — FIFO is the point, and the caller passes its own limit.",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Top-level keys of a `{...}` argument object, as raw source text.
 *
 * Depth matters: a nested relation include carries its own `take`/`orderBy`
 * (`plans: { where: {...}, take: 1 }`), and counting those produced a false
 * positive on program-core's goal read. Only depth-1 keys are the query's own.
 * String contents are skipped so a brace in a literal can't shift the depth.
 */
function topLevelKeys(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < block.length; i++) {
    const c = block[i]!;
    if (quote) {
      if (c === quote && block[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      continue;
    }
    if (depth !== 1) continue;

    const m = /^(\w+)\s*:/.exec(block.slice(i));
    if (!m || (i > 0 && !/[\s{,]/.test(block[i - 1]!))) continue;

    const vStart = i + m[0].length;
    let d = 0;
    let q: string | null = null;
    let j = vStart;
    for (; j < block.length; j++) {
      const cc = block[j]!;
      if (q) {
        if (cc === q && block[j - 1] !== "\\") q = null;
        continue;
      }
      if (cc === '"' || cc === "'" || cc === "`") q = cc;
      else if (cc === "{" || cc === "[") d++;
      else if (cc === "}" || cc === "]") {
        if (d === 0) break;
        d--;
      } else if (cc === "," && d === 0) break;
    }
    out[m[1]!] = block.slice(vStart, j).trim();
    i = vStart - 1;
  }
  return out;
}

/** Balanced-brace argument of every `.findMany(` call in a file. */
function findManyBlocks(src: string): { block: string; line: number }[] {
  const out: { block: string; line: number }[] = [];
  let i = 0;
  while ((i = src.indexOf(".findMany(", i)) !== -1) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    out.push({ block: src.slice(open, j), line: src.slice(0, i).split("\n").length });
    i = j;
  }
  return out;
}

type Violation = { file: string; line: number; keys: string[] };

function scan(): Violation[] {
  const found: Violation[] = [];
  for (const file of walk("src")) {
    const src = readFileSync(file, "utf8");
    for (const { block, line } of findManyBlocks(src)) {
      const keys = topLevelKeys(block);
      const take = keys.take;
      const orderBy = keys.orderBy;
      if (!take || !orderBy) continue;
      // `take: 1` ascending is a deliberate "earliest row" lookup, the
      // findFirst spelling — it cannot go stale.
      if (take === "1") continue;
      const asc = RECENCY_KEYS.filter((k) => new RegExp(`\\b${k}\\s*:\\s*"asc"`).test(orderBy));
      if (asc.length > 0) found.push({ file, line, keys: asc });
    }
  }
  return found;
}

describe("audit A2 — bounded reads must keep the NEWEST rows", () => {
  const violations = scan();
  const allowed = (v: Violation) => ALLOWLIST.some((a) => a.file === v.file);

  it("no bounded findMany orders a recency key ascending", () => {
    const offenders = violations.filter((v) => !allowed(v));
    expect(
      offenders.map((v) => `${v.file}:${v.line} (orderBy ${v.keys.join(", ")} asc + take)`),
      [
        "",
        "A `take` bound with an ASCENDING date order keeps the OLDEST rows, so this",
        "read freezes as soon as the table outgrows the bound — the surface then shows",
        "stale data that looks like 'nothing was recorded since'.",
        "",
        "Fix it the way /progress and /history were fixed:",
        "",
        "  const rows = (await db.model.findMany({",
        '    orderBy: [{ date: "desc" }, { id: "desc" }],',
        "    take: N,",
        "  })).reverse();",
        "",
        "If keeping the oldest rows is genuinely intended (a FIFO queue drain), add the",
        "file to ALLOWLIST in this test with a reason a reviewer can check.",
        "",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every allowlist entry still matches a real read — no stale exemptions", () => {
    const stale = ALLOWLIST.filter((a) => !violations.some((v) => v.file === a.file));
    expect(
      stale.map((a) => a.file),
      "\nThese files no longer contain the pattern they were exempted for. Drop them from ALLOWLIST so it stays an audited list rather than a rubber stamp.\n",
    ).toEqual([]);
  });

  it("every allowlist entry carries a reason", () => {
    for (const a of ALLOWLIST) expect(a.reason.length, `${a.file} needs a reason`).toBeGreaterThan(30);
  });

  it("the scanner reads top-level query keys only, not nested relation options", () => {
    // Regression: program-core's goal read has `plans: { ..., take: 1 }` nested
    // inside `select`, which a naive scan counted as the query's own bound and
    // flagged an ordering that was never bounded.
    const keys = topLevelKeys(`{
      where: { programId: p.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, plans: { where: { active: true }, take: 1 } },
    }`);
    expect(keys.take).toBeUndefined();
    expect(keys.orderBy).toBe('{ createdAt: "asc" }');
  });

  it("the scanner does catch a genuinely bounded ascending read", () => {
    const keys = topLevelKeys(`{
      orderBy: { date: "asc" },
      take: 90,
    }`);
    expect(keys.take).toBe("90");
    expect(/\bdate\s*:\s*"asc"/.test(keys.orderBy!)).toBe(true);
  });
});
