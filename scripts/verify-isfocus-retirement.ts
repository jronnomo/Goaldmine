// scripts/verify-isfocus-retirement.ts
//
// #303 — automated isFocus-retirement audit. Goal.isFocus is LEGACY: outside
// the documented compat surface, nothing may read it (Prisma filter/orderBy)
// or grow new consumption. This script is the grep audit from the #303
// verification, made permanent: it walks src/ + scripts/ + prisma/, finds
// every NON-COMMENT occurrence of the `isFocus` identifier (the derived
// `isFocusGoal` payload flag is a different, engine-owned field and is NOT
// matched), and fails when
//
//   (1) a file outside ALLOWED_FILES carries any code occurrence, or
//   (2) a file outside QUERY_ALLOWED_FILES carries a QUERY-SHAPED occurrence
//       (a `where:`/`orderBy` filter or a goal-relation filter) — the tighter
//       tripwire, so a new `where: { isFocus: true }` sneaking into an
//       allowlisted display file still fails.
//
// Comments mentioning isFocus are always fine (docs are how the compat
// surface stays understood). *.test.ts fixtures are exempt wholesale (the
// #303 allowlist covers test fixtures). This is a line-local tripwire, not a
// proof system: a multi-line `where: {\n isFocus: true }` would only trip
// rule (1) — which still catches every new FILE, and new query shapes in the
// files below should be caught in review by the gotchas entry (§F).
//
// Run: npm run verify:isfocus     (exit 0 = clean, exit 1 = unexpected sites)
//
// When the column is finally dropped (Backlog: "Drop Goal.isFocus column"),
// this script and every ALLOWED_FILES entry must go with it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// npm scripts run from the repo root (same convention as render-icons.ts).
const ROOT = process.cwd();
const SELF = "scripts/verify-isfocus-retirement.ts";

// ── The documented compat surface (#297–#303) ───────────────────────────────
// file → why it may mention isFocus in code.
const ALLOWED_FILES: Record<string, string> = {
  // The compat home: legacy zero-Program branches + getFocusGoal + display
  // ordering + the superset select.
  "src/lib/goal-focus.ts": "compat home — legacy branches, getFocusGoal, display ordering",
  // The seam's zero-Program legacy branch (goal.isFocus desc plan tiebreak).
  "src/lib/program.ts": "getActiveProgram legacy branch (zero-Program tenants)",
  // Flag lifecycle: setFocusGoalCore/shim, createGoalCore's first-goal count
  // guard, untrack/pause guards that keep the single-focus invariant.
  "src/lib/goal-core.ts": "focus lifecycle — setFocusGoalCore, count guard, invariant guards",
  // Completion clears the flag and snapshots focusReleased.
  "src/lib/goal-completion.ts": "focus lifecycle — completion clears flag, snapshots focusReleased",
  // Derives the isFocusGoal payload flag + the legacy other-goals partition
  // from getActiveGoalsWithPlans rows.
  "src/lib/goal-events.ts": "legacy payload partition + isFocusGoal derivation",
  // Pure display slot sort (UXR-PV-04) over a caller-provided isFocus field.
  "src/lib/goal-identity.ts": "display — slot sort input field",
  // resolveProgressPrimaryGoals' legacy (zero-Program) branch.
  "src/lib/progress-program.ts": "legacy branch — resolveProgressPrimaryGoals",
  // Pass-through select/mapping feeding the identity slot sort.
  "src/lib/calendar.ts": "display — pass-through select for identity sort",
  // #299 tracked exception: rotation owner ?? legacy focus for the XP pack.
  "src/lib/game/engine.ts": "#299 tracked exception — legacy fallback composition",
  // list_goals display ordering + pass-through field + #300 tracked
  // exception (grant_bonus_xp fallback) + coach-facing descriptions.
  "src/lib/mcp/tools.ts": "display ordering + pass-through + #300 fallback + tool docs",
  // Dashboard pages: legacy-branch orderBy / legacy highlight / display
  // gating / pass-through selects / synthetic identity flag.
  "src/app/page.tsx": "display — legacy-branch ordering, pass-through, synthetic identity flag",
  "src/app/progress/page.tsx": "display — legacy-branch ordering",
  "src/app/goals/page.tsx": "display — legacy-branch ordering + legacy highlight",
  "src/app/goals/[id]/page.tsx": "display — pause/resume gating on the legacy flag",
  "src/app/program/page.tsx": "display — pass-through select for identity sort",
  "src/components/BetweenGoalsToday.tsx": "display — prop type (pass-through row data)",
  // Ops / verification scripts that exercise or replay the legacy path on
  // purpose (tenant-isolation fixtures, #299 equivalence checkers,
  // historical backfills, founder cutover tooling).
  "scripts/verify-tenant-isolation.ts": "harness fixtures — exercises the focus shim",
  "scripts/verify-tenant-isolation-full.ts": "harness fixtures",
  "scripts/diff-engine-goal-context.ts": "#299 pre/post equivalence checker (legacy path on purpose)",
  "scripts/diff-xp-ledger.ts": "ledger equivalence checker (legacy path on purpose)",
  "scripts/backfill-attribution.ts": "historical backfill — replays the legacy hike fallback",
  "scripts/founder-program-backfill.ts": "founder cutover tooling — legacy-path verification/rollback copy",
  "scripts/import-phase2a.ts": "ops import — maintains the single-focus invariant",
  // Schema (the column + its indexes) and the seed's legacy branch.
  "prisma/schema.prisma": "the column + indexes (drop tracked in Backlog)",
  "prisma/seed-chewgether.ts": "seed legacy branch",
};

// Subset of ALLOWED_FILES that may carry QUERY-SHAPED occurrences
// (where/orderBy filters). Display-only files are deliberately absent.
const QUERY_ALLOWED_FILES = new Set<string>([
  "src/lib/goal-focus.ts",
  "src/lib/program.ts",
  "src/lib/goal-core.ts",
  "src/lib/game/engine.ts",
  "src/lib/mcp/tools.ts",
  "src/app/page.tsx",
  "src/app/progress/page.tsx",
  "src/app/goals/page.tsx",
  "scripts/verify-tenant-isolation.ts",
  "scripts/verify-tenant-isolation-full.ts",
  "scripts/diff-engine-goal-context.ts",
  "scripts/diff-xp-ledger.ts",
  "scripts/backfill-attribution.ts",
  "scripts/import-phase2a.ts",
]);

// isFocus as a standalone identifier — excludes the derived isFocusGoal flag.
const IDENT = /isFocus(?![A-Za-z0-9_])/;
// Query-shaped, line-local: single-line where containing isFocus, an
// orderBy direction on it, a goal-relation filter, or an orderBy mention.
const QUERY_PATTERNS: RegExp[] = [
  /where:\s*\{[^}]*isFocus(?![A-Za-z0-9_])/,
  /isFocus:\s*["'](desc|asc)["']/,
  /goal:\s*\{\s*isFocus(?![A-Za-z0-9_])/,
  /orderBy[^;]*isFocus(?![A-Za-z0-9_])/,
];

const SCAN_DIRS = ["src", "scripts", "prisma"];
const SKIP_DIRS = new Set(["node_modules", ".next", "generated"]);
const EXTENSIONS = [".ts", ".tsx", ".prisma"];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(full);
    } else if (EXTENSIONS.some((e) => entry.endsWith(e))) {
      yield full;
    }
  }
}

/** True when the isFocus mention on this line sits inside a comment. */
function isCommentOccurrence(line: string, inBlockComment: boolean): boolean {
  const idx = line.search(IDENT);
  if (idx === -1) return true; // no standalone occurrence at all
  if (inBlockComment) return true;
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  const lineCommentAt = line.indexOf("//");
  if (lineCommentAt !== -1 && lineCommentAt < idx) return true;
  const blockOpenAt = line.indexOf("/*");
  if (blockOpenAt !== -1 && blockOpenAt < idx && line.indexOf("*/", blockOpenAt) > idx) return true;
  return false;
}

type Violation = { file: string; line: number; text: string; rule: string };
const violations: Violation[] = [];
let codeFiles = 0;
let codeOccurrences = 0;

for (const dir of SCAN_DIRS) {
  for (const path of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, path);
    if (rel === SELF) continue;
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue; // fixtures exempt
    const content = readFileSync(path, "utf8");
    if (!IDENT.test(content)) continue;

    let inBlock = false;
    let fileHasCode = false;
    content.split("\n").forEach((line, i) => {
      const wasInBlock = inBlock;
      // Track block-comment state (line-local heuristic, good enough for
      // this repo's comment style).
      if (inBlock && line.includes("*/")) inBlock = false;
      else if (!inBlock && line.includes("/*") && !line.includes("*/")) inBlock = true;

      if (!IDENT.test(line)) return;
      if (isCommentOccurrence(line, wasInBlock)) return;

      fileHasCode = true;
      codeOccurrences += 1;
      const allowed = rel in ALLOWED_FILES;
      if (!allowed) {
        violations.push({ file: rel, line: i + 1, text: line.trim(), rule: "unexpected file" });
        return;
      }
      const queryShaped = QUERY_PATTERNS.some((p) => p.test(line));
      if (queryShaped && !QUERY_ALLOWED_FILES.has(rel)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: line.trim(),
          rule: "query-shaped read in display-only file",
        });
      }
    });
    if (fileHasCode) codeFiles += 1;
  }
}

console.log(
  `verify:isfocus — ${codeOccurrences} code occurrence(s) across ${codeFiles} file(s) ` +
    `(${Object.keys(ALLOWED_FILES).length} allowlisted).`,
);

if (violations.length > 0) {
  console.error("\nUNEXPECTED isFocus sites (fix, or add to the documented compat allowlist):\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.text}`);
  }
  console.error(
    "\nGoal.isFocus is legacy/display-only outside goal-focus.ts's compat branches — " +
      "resolve 'the current goal' through getRotationOwnerGoal() instead " +
      "(see docs/project-gotchas.md §F).",
  );
  process.exit(1);
}

// Stale-allowlist hygiene: report (but don't fail on) allowlisted files that
// no longer carry any code occurrence — candidates for removal.
const stale = Object.keys(ALLOWED_FILES).filter((f) => {
  try {
    const content = readFileSync(join(ROOT, f), "utf8");
    let inBlock = false;
    return !content.split("\n").some((line) => {
      const wasInBlock = inBlock;
      if (inBlock && line.includes("*/")) inBlock = false;
      else if (!inBlock && line.includes("/*") && !line.includes("*/")) inBlock = true;
      return IDENT.test(line) && !isCommentOccurrence(line, wasInBlock);
    });
  } catch {
    return true; // file deleted — definitely stale
  }
});
if (stale.length > 0) {
  console.log("\nAllowlist entries with no remaining code occurrences (prune when convenient):");
  for (const f of stale) console.log(`  ${f}`);
}

console.log("\nOK — every isFocus code occurrence sits inside the documented compat surface.");
