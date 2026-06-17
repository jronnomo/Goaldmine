// src/components/FeasibilityReadout.tsx
// Pure server component — synchronous, prop-driven, no hooks, no temporal side-effects.
// Renders honest goal feasibility from a single serialized GoalFeasibility value.
// Placement on Today/goal pages is #78/#79; this is the component + render proof only.

import type { GoalFeasibility, TargetFeasibility, RarityTier } from "@/lib/rarity-core";
import { fmtComma } from "@/lib/goal-presentation";
import { Card } from "@/components/Card";

// ── Tier label map (local, server-safe) ───────────────────────────────────────
// Decision: not imported from ReachMeter.tsx. See architecture-blueprint.md §4.
const TIER_LABEL: Record<RarityTier, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

type TargetVerdict = TargetFeasibility["verdict"];

function fmtVerdict(v: TargetVerdict): string {
  if (v === "met") return "met";
  if (v === "unknown") return "no data";
  return TIER_LABEL[v];
}

function basisLabel(basis: "observed" | "norms" | "mixed"): string {
  if (basis === "observed") return "your pace";
  if (basis === "norms") return "typical norms";
  return "mixed";
}

// ── Per-target rows (shared between NO_DATA_1_2_LOG and TIER_SET states) ─────
// C-1 fix: rate segments are joined with " · " only when both sides have content.
// A target with requiredRate===null AND observedRate===null never renders "— · —".
function PerTargetRows({
  perTarget,
  targetDateLabel,
}: {
  perTarget: TargetFeasibility[];
  targetDateLabel: string | null;
}) {
  return (
    <ul className="space-y-3">
      {perTarget.map((t) => {
        // Build rate segments as plain strings; filter nulls before joining.
        const dateSuffix =
          targetDateLabel != null ? " by " + targetDateLabel : "";
        const leftSeg =
          t.requiredRate !== null
            ? "needs ~" + fmtComma(t.requiredRate) + "/wk" + dateSuffix
            : null;
        const rightSeg =
          t.observedRate !== null
            ? fmtComma(t.observedRate) + "/wk observed"
            : t.requiredRate !== null
              ? "— not yet estimable"
              : null;
        const rateSegs = [leftSeg, rightSeg].filter(
          (s): s is string => s !== null,
        );
        const rateLine = rateSegs.join(" · ");
        const basisSuffix =
          t.rateBasis !== "none"
            ? " · " +
              (t.rateBasis === "observed" ? "observed pace" : "typical pace")
            : "";

        return (
          <li key={t.metric}>
            <div className="flex justify-between text-sm mb-0.5 gap-2">
              <span className="font-medium truncate pr-2">{t.label}</span>
              <span className="text-[var(--muted)] shrink-0 text-xs tabular-nums">
                {fmtVerdict(t.verdict)}
              </span>
            </div>
            {t.verdict === "met" ? (
              <p className="text-xs text-[var(--muted)]">Target met</p>
            ) : rateLine || basisSuffix ? (
              <p className="text-xs text-[var(--muted)]">
                {rateLine}
                {basisSuffix}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function FeasibilityReadout({
  feasibility,
  targetDateLabel,
}: {
  feasibility: GoalFeasibility;
  targetDateLabel?: string | null;
}) {
  const { unratedReason, tier, perTarget, basis, weeksRemaining } = feasibility;

  // State 1 — SOMEDAY
  if (unratedReason === "someday") {
    return (
      <div data-testid="feasibility-readout">
        <Card title="Reach">
          <p className="text-sm text-[var(--muted)]">
            No deadline set — Reach unrated.
          </p>
        </Card>
      </div>
    );
  }

  // State 2 — NO_TARGETS
  if (unratedReason === "no-targets") {
    return (
      <div data-testid="feasibility-readout">
        <Card title="Reach">
          <p className="text-sm text-[var(--muted)]">
            Add targets to rate Reach.
          </p>
        </Card>
      </div>
    );
  }

  // State 3 — NO_DATA
  if (unratedReason === "no-data") {
    const anyRequired = perTarget.some((t) => t.requiredRate !== null);

    // Sub-state 3a — 0 logs: requiredRate null for all targets
    // Copy makes NO per-week promise (requiredRate is null — cannot cite a number).
    if (!anyRequired) {
      return (
        <div data-testid="feasibility-readout">
          <Card title="Reach">
            <p className="text-sm text-[var(--muted)]">
              Not enough logged data to rate yet — log the metric a few times to
              see the pace you need.
            </p>
          </Card>
        </div>
      );
    }

    // Sub-state 3b — 1–2 logs: requiredRate computable, observed not yet estimable
    return (
      <div data-testid="feasibility-readout">
        <Card title="Reach">
          <p className="text-xs text-[var(--muted)] mb-3">
            Need more data to rate — pace needed to reach your target:
          </p>
          <PerTargetRows
            perTarget={perTarget}
            targetDateLabel={targetDateLabel ?? null}
          />
        </Card>
      </div>
    );
  }

  // State 4 — TIER_SET (tier !== null, unratedReason === null)
  // Fallback "—" handles the impossible { tier:null, unratedReason:null } data anomaly.
  return (
    <div data-testid="feasibility-readout">
      <Card title="Reach">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-lg font-semibold">
            {tier != null ? TIER_LABEL[tier] : "—"}
          </span>
          <span className="text-xs text-[var(--muted)] tabular-nums">
            {weeksRemaining != null
              ? Math.round(weeksRemaining) + " wk remaining"
              : ""}
            {basis != null ? " · " + basisLabel(basis) : ""}
          </span>
        </div>
        {perTarget.length > 0 && (
          <PerTargetRows
            perTarget={perTarget}
            targetDateLabel={targetDateLabel ?? null}
          />
        )}
      </Card>
    </div>
  );
}
