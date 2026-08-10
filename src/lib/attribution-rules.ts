// Program.attributionRules — parse/validate the coach-authored per-Program
// auto-link rules (design amendment 1, docs/program-redesign/03-run-amendments.md).
//
// Documented Json shape (prisma/schema.prisma, Program.attributionRules):
//   Array<{
//     match: { titleContains?: string[]; exerciseContains?: string[]; source?: string },
//     goalIds: string[],
//     note?: string
//   }>
//
// This module is the single trust boundary for that Json column: everything
// downstream (getActiveProgramMembership today; the auto-link engine next)
// consumes the PARSED form, never the raw Json. Client-safe (zod only — no
// Prisma, no Node built-ins), mirroring metrics-registry.ts's constraint.

import { z } from "zod";

/**
 * One attribution rule. All matchers are optional per the documented shape —
 * an empty `match: {}` is a syntactically valid rule (whether it matches
 * everything or nothing is the auto-link engine's decision, not the parser's).
 * `goalIds` may be empty (a no-op rule) — the parser validates shape, not
 * usefulness: rejecting one degenerate rule would nullify the whole ruleset,
 * which is worse than letting the engine skip it.
 */
export const AttributionRuleSchema = z.object({
  match: z.object({
    titleContains: z.array(z.string()).optional(),
    exerciseContains: z.array(z.string()).optional(),
    source: z.string().optional(),
  }),
  goalIds: z.array(z.string()),
  note: z.string().optional(),
});

export const AttributionRulesSchema = z.array(AttributionRuleSchema);

export type AttributionRule = z.infer<typeof AttributionRuleSchema>;

/**
 * Safe parser for the raw `Program.attributionRules` Json column.
 *
 * - `null` / `undefined` (column never set) → null.
 * - Malformed in any way (not an array, missing `match`/`goalIds`, wrong
 *   element types) → null — NEVER throws. A coach-authored Json blob must not
 *   be able to take down getActiveProgramMembership or the link engine; a
 *   malformed ruleset simply behaves as "no rules".
 * - Valid empty array → [] (a real, intentionally-empty ruleset — distinct
 *   from null's "unset/unusable").
 * - Unknown extra keys on rules/match are stripped (Zod default), so a
 *   forward-compatible writer doesn't invalidate the whole ruleset.
 */
export function parseAttributionRules(raw: unknown): AttributionRule[] | null {
  if (raw == null) return null;
  const result = AttributionRulesSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Authoring schema (#307 consolidation — moved here from program-core.ts's
// local copy, guards intact). WRITE-side validation for update_program /
// updateProgramCore: stricter than the read-side trust boundary above.
//
// Two schemas on purpose:
//   - AttributionRulesSchema (above)          — READ boundary. Lenient: an
//     empty `match: {}` or empty `goalIds` is shape-valid (the engine treats
//     both as no-ops); rejecting one degenerate rule would nullify a whole
//     stored ruleset, which is worse.
//   - AttributionRulesAuthoringSchema (below) — WRITE boundary. Refuses to
//     STORE those degenerate rules in the first place: each rule needs at
//     least one match criterion (an empty match would otherwise read as
//     "match every activity" to a human even though the engine matches
//     nothing) and at least one goalId (a rule that links nothing is an
//     authoring mistake, not intent).
// ---------------------------------------------------------------------------

export const AttributionRuleAuthoringSchema = z.object({
  match: z
    .object({
      titleContains: z.array(z.string().min(1)).optional(),
      exerciseContains: z.array(z.string().min(1)).optional(),
      source: z.string().min(1).optional(),
    })
    .refine(
      (m) =>
        (m.titleContains?.length ?? 0) > 0 ||
        (m.exerciseContains?.length ?? 0) > 0 ||
        !!m.source,
      {
        message:
          "each rule's match needs at least one of titleContains, exerciseContains, source — an empty match would match every activity",
      },
    ),
  goalIds: z.array(z.string().min(1)).min(1, "each rule needs at least one goalId"),
  note: z.string().optional(),
});

export const AttributionRulesAuthoringSchema = z.array(AttributionRuleAuthoringSchema);
