// src/lib/goal-assay-core.ts
//
// Pure, client-safe core for "The Assay" goal-completion ceremony
// (docs/prds/PRD-goal-assay-celebration.md, REQ-001). NO Prisma imports —
// mirrors the goal-completion-core.ts / readiness.ts / rarity-core.ts split
// of "pure math here, IO/JSX done by the caller." Consumed by (Stage 2+,
// out of this file's scope): GoalAssayHero.tsx, AssayTargetRows.tsx,
// SummitSheet.tsx.
//
// Four exports:
//   ceremonyTier          — modal-not-max tier routing (report §2.2 Rule C)
//   heroStatPrecedence    — which number gets to be the hero stat (§8.5 guards)
//   buildEvidenceRows     — met-first evidence rows, ported from
//                           completion-card.tsx:99-147, + Rule B's
//                           reserve-last-slot-for-first-miss corollary
//   shouldBurnToken       — pure predicate for the one-shot ceremony token
// Plus the honest-copy helpers (§8.5): READINESS_FRAMING and
// readinessSeriesHint (resolves the readinessSeries===null ambiguity).

import { fmtComma } from "@/lib/goal-presentation";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

// ─────────────────────────────────────────────────────────
// ceremonyTier — report §2.2 Rule C ("scale by beat count, never loudness")
// ─────────────────────────────────────────────────────────

export type CeremonyTier = "marker" | "ascent" | "summit";

export type CeremonyTierInputs = {
  feasibilityTierAtCompletion: string | null;
  /** GoalCompletionSnapshot.xpBasis.weeks — duration actually lived, never raw daysElapsed/7 pre-cap. */
  xpBasisWeeks: number;
  /** GoalCompletionSnapshot.targetsMet. */
  targetsMet: number;
  /**
   * Count of corroborating evidence (hikes/baselines/checkpoints per report
   * §4.1 S4) — NOT computed here (this module is Prisma-free and has no
   * access to those tables); the caller (goal-completion.ts / page assembly)
   * must count and pass this in.
   */
  evidenceDensity: number;
};

// ⚠ Provisional thresholds — report §9.15: "re-fit against the real
// distribution of completed goals before hardening." Do not treat as final.
const WEEKS_TIER_THRESHOLDS = { markerMax: 3, ascentMax: 11 } as const; // 0-3 / 4-11 / 12+

// ⚠ Provisional — report §9.16: "0-2 / 3-19 / 20+."
const EVIDENCE_DENSITY_TIER_THRESHOLDS = { markerMax: 2, ascentMax: 19 } as const;

// ⚠ Not specified anywhere in the research report (the report's own tier
// table only calls out "0 targets" for Marker, with no explicit Ascent/Summit
// boundary for targetsMet). Chosen to mirror goalAchievedXp's own targetsMet
// saturation point (game/rules.ts: `min(targetsMet, 5) * 50` — the formula
// itself treats 5 as "as good as it gets"). Re-verify against real
// completions alongside §9.15-16 before hardening.
const TARGETS_MET_TIER_THRESHOLDS = { markerMax: 1, ascentMax: 4 } as const; // 0-1 / 2-4 / 5+

// Marker: common/null. Ascent: uncommon-rare. Summit: epic-legendary (§2.2).
// An unrecognized/future tier string fails closed to "marker" — never
// overclaim on a tier this code doesn't understand.
const FEASIBILITY_TIER_TO_CEREMONY_TIER: Record<string, CeremonyTier> = {
  common: "marker",
  uncommon: "ascent",
  rare: "ascent",
  epic: "summit",
  legendary: "summit",
};

function feasibilityToCeremonyTier(tier: string | null): CeremonyTier {
  if (tier === null) return "marker";
  return FEASIBILITY_TIER_TO_CEREMONY_TIER[tier] ?? "marker";
}

function bucketToCeremonyTier(value: number, markerMax: number, ascentMax: number): CeremonyTier {
  if (value <= markerMax) return "marker";
  if (value <= ascentMax) return "ascent";
  return "summit";
}

const CEREMONY_TIER_ORDER: readonly CeremonyTier[] = ["marker", "ascent", "summit"];

/**
 * Modal (most-frequent) vote across the four independent tier signals — never
 * the max, and never derived from XP (report §1.5: `goalAchievedXp` saturates
 * at 700, so it can't distinguish a 3-month Summit from a 6-month one).
 *
 * Ties resolve to the MIDDLE tier ("ascent") — e.g. a 2-2 split between
 * marker and summit (0 votes for ascent) still lands on ascent, per REQ-001's
 * explicit tie rule. This is deliberately NOT "middle of the tied set" —
 * it's the fixed middle tier, regardless of which two tiers tied.
 */
export function ceremonyTier(inputs: CeremonyTierInputs): CeremonyTier {
  const votes: CeremonyTier[] = [
    feasibilityToCeremonyTier(inputs.feasibilityTierAtCompletion),
    bucketToCeremonyTier(inputs.xpBasisWeeks, WEEKS_TIER_THRESHOLDS.markerMax, WEEKS_TIER_THRESHOLDS.ascentMax),
    bucketToCeremonyTier(
      inputs.targetsMet,
      TARGETS_MET_TIER_THRESHOLDS.markerMax,
      TARGETS_MET_TIER_THRESHOLDS.ascentMax,
    ),
    bucketToCeremonyTier(
      inputs.evidenceDensity,
      EVIDENCE_DENSITY_TIER_THRESHOLDS.markerMax,
      EVIDENCE_DENSITY_TIER_THRESHOLDS.ascentMax,
    ),
  ];

  const counts = new Map<CeremonyTier, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const winners = CEREMONY_TIER_ORDER.filter((t) => counts.get(t) === maxCount);

  return winners.length === 1 ? winners[0]! : "ascent";
}

// ─────────────────────────────────────────────────────────
// heroStatPrecedence — report §8.5 honesty guards
// ─────────────────────────────────────────────────────────

export type HeroStat =
  | {
      kind: "readiness";
      score: number;
      /** Coverage guard: whenever true, the score must render WITH its denominator ("89, across 3 of 9 tested"), never bare. */
      showDenominator: boolean;
      coverage: { tested: number; total: number };
    }
  | { kind: "targets"; targetsMet: number; targetsTotal: number }
  | { kind: "days"; daysElapsed: number };

export type HeroStatSnapshotInputs = Pick<
  GoalCompletionSnapshot,
  "readiness" | "targetsMet" | "targetsTotal" | "daysElapsed"
>;

/**
 * Decides which single number gets to be the ceremony's hero stat, honoring
 * both honesty guards from report §8.5:
 *
 * - Ceiling guard: if `readiness.score === readiness.ceiling && ceiling < 100`
 *   (and a gate is actually open), the score is a CAP, not a measurement —
 *   it must never be the hero number. Falls through to the next candidate.
 * - Coverage guard: whenever readiness IS used, `tested < total` forces
 *   `showDenominator: true` — "89" and "89, across 3 of 9 tested" are
 *   different claims, and this flag is how the caller knows which one is true.
 *
 * Precedence when readiness is disqualified or absent: targets met/total
 * (if the goal had any), else days elapsed (the zero-target floor — always
 * true, never fails closed to nothing).
 */
export function heroStatPrecedence(snapshot: HeroStatSnapshotInputs): HeroStat {
  const readiness = snapshot.readiness;
  if (readiness !== null) {
    const isCeilingCapped =
      readiness.score === readiness.ceiling && readiness.ceiling < 100 && readiness.openGateCount > 0;
    if (!isCeilingCapped) {
      return {
        kind: "readiness",
        score: readiness.score,
        showDenominator: readiness.coverage.tested < readiness.coverage.total,
        coverage: readiness.coverage,
      };
    }
  }
  if (snapshot.targetsTotal > 0) {
    return { kind: "targets", targetsMet: snapshot.targetsMet, targetsTotal: snapshot.targetsTotal };
  }
  return { kind: "days", daysElapsed: snapshot.daysElapsed };
}

// ─────────────────────────────────────────────────────────
// Honest-copy helpers (§8.5)
// ─────────────────────────────────────────────────────────

/** §8.5 framing: the on-screen noun for the readiness hero stat. Untested
 *  targets count as 0 at full weight — never write copy implying fitness. */
export const READINESS_FRAMING = "weighted progress across your targets";

const ZERO_TARGET_ARC_HINT =
  "This goal had no numeric targets to track — there's nothing to plot.";
const LEGACY_ARC_HINT = "Reopen and re-complete this goal to capture its arc.";

/**
 * `readinessSeries === null` is ambiguous (§8.5): it means EITHER a
 * zero-target goal OR a legacy pre-freeze completion. The existing
 * "reopen and re-complete to record it" copy is misleading for the
 * zero-target case — there is nothing to record. Callers must pass
 * `targetsTotal` to pick the honest variant instead of assuming "legacy."
 */
export function readinessSeriesHint(targetsTotal: number): string {
  return targetsTotal === 0 ? ZERO_TARGET_ARC_HINT : LEGACY_ARC_HINT;
}

// ─────────────────────────────────────────────────────────
// buildEvidenceRows — ports completion-card.tsx:99-147 (TargetRow) +
// Rule B's reserve-last-slot-for-first-miss corollary
// ─────────────────────────────────────────────────────────

export type EvidenceRow = {
  target: GoalCompletionSnapshot["targets"][number];
  /** "5 → 15 reps" — ported verbatim from completion-card.tsx's TargetRow formatting. */
  formattedRange: string;
};

export type EvidenceRowsResult = {
  rows: EvidenceRow[];
  /** Count of targets NOT shown — rendered as "+N more". */
  hiddenCount: number;
};

function fmtTargetValue(v: number | null, units: string): string {
  if (v === null) return "—";
  const n = fmtComma(v);
  return units ? `${n} ${units}` : n;
}

function toEvidenceRow(target: GoalCompletionSnapshot["targets"][number]): EvidenceRow {
  return {
    target,
    formattedRange: `${fmtTargetValue(target.start, "")} → ${fmtTargetValue(target.final, target.units)}`,
  };
}

/**
 * Met-first evidence rows, capped at `cap`, with Rule B's corollary
 * (report §2.2): "the 6-row cap must reserve its last slot for the first
 * unmet target — naive met-first ordering with 7/9 met hides every miss
 * behind '+3 more'." A ceremony that structurally cannot say something
 * unflattering is saccharine by construction.
 *
 * The reserve only kicks in when it's NEEDED — i.e. when misses exist but
 * none of them survived the naive met-first cap. If a miss already made the
 * cut naturally (met count < cap), the ordering is left alone.
 *
 * hiddenCount is unaffected by the swap: exactly `cap` rows are shown either
 * way (when total > cap) — the reserve changes WHICH targets are visible,
 * never how many.
 */
export function buildEvidenceRows(
  targets: GoalCompletionSnapshot["targets"],
  cap: number,
): EvidenceRowsResult {
  if (cap <= 0 || targets.length === 0) {
    return { rows: [], hiddenCount: targets.length };
  }

  const met = targets.filter((t) => t.met);
  const missed = targets.filter((t) => !t.met);
  const ordered = [...met, ...missed];

  let visible = ordered.slice(0, cap);
  if (missed.length > 0 && !visible.some((t) => !t.met)) {
    // Every miss fell past the cap — bump the last slot for the first miss
    // (by original target order), displacing the (cap+1)-th met row instead.
    visible = [...visible.slice(0, cap - 1), missed[0]!];
  }

  return {
    rows: visible.map(toEvidenceRow),
    hiddenCount: targets.length - visible.length,
  };
}

// ─────────────────────────────────────────────────────────
// shouldBurnToken — pure predicate for the one-shot ceremony token
// ─────────────────────────────────────────────────────────

/**
 * The ceremony token (a versioned localStorage key — NOT
 * GoalCompletedCelebration's legacy namespace, per architecture-critique.md
 * C1) should be burned exactly when the page is visible and hasn't already
 * been burned. Pure — the caller (the single-authority ceremony controller,
 * V2/V3) owns the actual storage read/write and the try/catch around a
 * `showModal()` failure; this is just the yes/no decision.
 */
export function shouldBurnToken(visibilityState: string, alreadyBurned: boolean): boolean {
  return !alreadyBurned && visibilityState === "visible";
}
