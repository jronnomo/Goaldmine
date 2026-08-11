// src/lib/workout-exercise-scope.guard.test.ts
//
// Static tripwire for the 2026-08 cross-tenant WorkoutExercise leak class.
//
// WorkoutExercise and Set have no userId FK — they are pass-through models in
// the ScopedClient (src/lib/db.ts SCOPED_MODELS), so NOTHING injects a tenant
// filter into their queries. Any `workoutExercise.findMany` (or `set.findMany`)
// that does not hand-scope through the owning Workout aggregates EVERY
// tenant's training history (the bug behind the /progress + records +
// readiness leak).
//
// This test scans src/ (excluding src/generated and test files) and fails if
// any such call site lacks a `workout: { ... userId ... }` scope in its
// argument object.
//
// Legitimately-global sites (there are none today) must carry an inline
//   // tenant-scope-exempt: <justification>
// comment on one of the 3 lines above the call — the justification is
// mandatory and shows up in this test's failure output for review.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");
const EXCLUDED_DIRS = new Set(["generated", "node_modules", ".next"]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      collectSourceFiles(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.test\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Extract the balanced-paren argument text starting at the given `(` index. */
function extractCallArgs(source: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParenIdx + 1, i);
    }
  }
  return source.slice(openParenIdx + 1); // unbalanced — return the tail, let the assertion judge
}

/** Does the args text contain a `workout:` object scope that carries userId?
 *  Tolerates one level of nesting inside the workout object, e.g.
 *  `workout: { id: { not: workoutId }, userId }`. */
function hasWorkoutUserIdScope(argsText: string): boolean {
  return /workout\s*:\s*\{(?:[^{}]|\{[^{}]*\})*?\buserId\b/.test(argsText);
}

/** Is the call site explicitly exempted with a justification comment? */
function isExempted(source: string, matchIdx: number): { exempt: boolean; justification?: string } {
  const before = source.slice(0, matchIdx);
  const lines = before.split("\n").slice(-4, -1); // up to 3 lines above the call
  for (const line of lines) {
    const m = line.match(/\/\/\s*tenant-scope-exempt:\s*(.+)/);
    if (m && m[1].trim().length > 0) return { exempt: true, justification: m[1].trim() };
  }
  return { exempt: false };
}

type Violation = { file: string; line: number; snippet: string };

function scan(pattern: RegExp): { violations: Violation[]; exemptions: string[]; sites: number } {
  const violations: Violation[] = [];
  const exemptions: string[] = [];
  let sites = 0;

  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, "utf8");
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(source)) !== null) {
      sites++;
      const openParen = source.indexOf("(", m.index + m[0].length - 1);
      const args = extractCallArgs(source, openParen);
      if (hasWorkoutUserIdScope(args)) continue;

      const line = source.slice(0, m.index).split("\n").length;
      const { exempt, justification } = isExempted(source, m.index);
      if (exempt) {
        exemptions.push(`${file}:${line} — ${justification}`);
        continue;
      }
      violations.push({
        file: file.replace(process.cwd() + "/", ""),
        line,
        snippet: args.replace(/\s+/g, " ").slice(0, 160),
      });
    }
  }
  return { violations, exemptions, sites };
}

describe("WorkoutExercise/Set tenant-scope guard", () => {
  it("every workoutExercise.findMany in src/ scopes through workout.userId", () => {
    const { violations, sites } = scan(/\bworkoutExercise\s*\.\s*findMany\s*\(/g);

    // Sanity: the scan actually sees the known call sites (records.ts x4,
    // goal-attribution.ts, compare.ts). If this drops to 0 the walker broke —
    // a silently-green guard is worse than none.
    expect(sites).toBeGreaterThanOrEqual(6);

    const report = violations
      .map((v) => `  ${v.file}:${v.line}\n    findMany(${v.snippet}…)`)
      .join("\n");
    expect(
      violations,
      `Unscoped workoutExercise.findMany — WorkoutExercise has no userId FK and the ` +
        `ScopedClient does NOT inject one. Add \`workout: { userId }\` (resolve via ` +
        `getScopedUserId() from @/lib/db) or, for a legitimately-global site, add a ` +
        `\`// tenant-scope-exempt: <why>\` comment above the call:\n${report}`,
    ).toEqual([]);
  });

  it("every set.findMany in src/ scopes through workout.userId", () => {
    // No set.findMany sites exist today — this arms the tripwire for the first
    // one added. Set's tenant path is set → workoutExercise → workout.userId,
    // e.g. `where: { workoutExercise: { workout: { userId } } }`.
    const { violations } = scan(/[.\s]set\s*\.\s*findMany\s*\(/g);
    const report = violations
      .map((v) => `  ${v.file}:${v.line}\n    findMany(${v.snippet}…)`)
      .join("\n");
    expect(
      violations,
      `Unscoped set.findMany — Set has no userId FK; scope through the owning ` +
        `workout (\`workoutExercise: { workout: { userId } }\`) or add a ` +
        `\`// tenant-scope-exempt: <why>\` justification:\n${report}`,
    ).toEqual([]);
  });
});
