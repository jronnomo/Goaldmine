// src/components/goal-assay/AssayMonument.tsx
//
// Server component — the full permanent "Assay" composition (PRD 3.1.3,
// report §2.1's 11-item stack): hero → objective → subline → mono fact line
// → hairline → WHAT MOVED evidence rows → readiness → static Reach → badge
// medals/level crossing → permanence line → CTAs. This is the orchestrator;
// it composes GoalAssayHero + AssayTargetRows and inlines everything else.
//
// Props are plain serializable scalars/objects — snapshot, goalId,
// evidenceDensity — NEVER a Prisma type (report §7: "Client leafs receive
// plain scalars only"; this file is a server component but the same
// discipline keeps it trivially testable and decoupled from the DB layer).
// `evidenceDensity` (hikes/baselines/checkpoints count, report §4.1 S4)
// can't be computed here — goal-assay-core.ts is Prisma-free by design — so
// the caller (Stage 3, REQ-005's page assembly) must count and pass it.
//
// Tier scaling is EMERGENT, never branched on in markup: the evidence block
// naturally collapses to one sentence when `targets.length === 0`
// (AssayTargetRows' own logic), badges/level-crossing naturally omit when
// `snapshot.ceremony` is absent, and Reach naturally omits when unrated —
// all data-driven. `ceremonyTier` IS still computed and consumed here (per
// this component's data-API contract), but ONLY to stamp a non-visual
// `data-assay-tier` attribute on the root — useful for QA/debugging, never
// an `if (tier)` branch in the JSX (Rule C, globals.css contract header).
//
// Rule A: no `.assay-fade`/`.assay-rise` primitive class is baked into this
// SSR output — every animatable line instead carries a `data-assay="<name>"`
// marker (+ a pre-set `--assay-delay` where the report's gantt specifies
// one) that AssayFlourish's playFlourish arms post-hydration. See
// AssayFlourish.tsx's header for the full contract. The one exception,
// `.assay-annulus`, lives inside GoalAssayHero (see its own header for why).
//
// Badge medals: `snapshot.ceremony.badgesUnlocked` is deliberately minimal
// (`{id, name}[]` — REQ-008/V5) with no monogram/glyph data, so medals here
// render as plain gold discs + the real badge name text below (decorative
// disc aria-hidden, name text real) rather than BadgeWall's full monogram
// treatment, which needs the fuller `UnlockedBadge` shape this snapshot
// field intentionally does not carry.
//
// testIDs: goal-assay-objective · goal-assay-fact-line · goal-assay-reach ·
// goal-assay-badges · goal-assay-permanence · goal-assay-share (report §7.2;
// goal-assay-hero/annulus/what-moved/row-{n}/flourish-ring come from the
// sub-components this file composes).

import Link from "next/link";
import { GoalAssayHero } from "@/components/goal-assay/GoalAssayHero";
import { AssayTargetRows } from "@/components/goal-assay/AssayTargetRows";
import { ReachMeter } from "@/components/ReachMeter";
import { RARITY_TIERS, type RarityTier } from "@/lib/rarity-core";
import {
  ceremonyTier,
  heroStatPrecedence,
  READINESS_FRAMING,
} from "@/lib/goal-assay-core";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

export type AssayMonumentProps = {
  snapshot: GoalCompletionSnapshot;
  goalId: string;
  /** Evidence-density tier signal (report §4.1 S4) — see header comment. */
  evidenceDensity: number;
};

// yyyy-mm-dd -> "Aug 9, 2026". Pure string-split — NEVER `new Date(dateKey)`
// (report §8.3, BadgeWall.tsx:19-33's idiom; USER_TZ-safe by construction
// since it never touches Date/TZ math at all).
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function formatCompletedDateKey(key: string): string {
  const parts = key.split("-");
  if (parts.length !== 3) return key;
  const [y, m, d] = parts as [string, string, string];
  const monthIdx = Number(m) - 1;
  const month = monthIdx >= 0 && monthIdx < 12 ? MONTH_NAMES[monthIdx] : m;
  return `${month} ${Number(d)}, ${y}`;
}

const RARITY_TIER_SET: ReadonlySet<string> = new Set(RARITY_TIERS);

export function AssayMonument({ snapshot, goalId, evidenceDensity }: AssayMonumentProps) {
  const tier = ceremonyTier({
    feasibilityTierAtCompletion: snapshot.feasibilityTierAtCompletion,
    xpBasisWeeks: snapshot.xpBasis.weeks,
    targetsMet: snapshot.targetsMet,
    evidenceDensity,
  });

  const heroStat = heroStatPrecedence(snapshot);
  const readinessStart =
    snapshot.readinessSeries && snapshot.readinessSeries.length > 0
      ? snapshot.readinessSeries[0]!.score
      : null;

  const reachTier =
    snapshot.feasibilityTierAtCompletion !== null &&
    RARITY_TIER_SET.has(snapshot.feasibilityTierAtCompletion)
      ? (snapshot.feasibilityTierAtCompletion as RarityTier)
      : null;

  const shareHref = `/recap/completion?goalId=${encodeURIComponent(goalId)}`;

  return (
    <div className="flex flex-col gap-6" data-assay-tier={tier}>
      <GoalAssayHero />

      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1
          data-testid="goal-assay-objective"
          data-assay="objective"
          className="font-[family-name:var(--font-display)] text-4xl leading-[1.1] text-balance line-clamp-3"
          style={{ color: "var(--foreground)" }}
        >
          {snapshot.objective}
        </h1>
        <p data-assay="subline" className="text-[13px]" style={{ color: "var(--muted)" }}>
          Completed {formatCompletedDateKey(snapshot.completedDateKey)} · {snapshot.daysElapsed} days
          {snapshot.backdated ? " · backdated" : ""}
        </p>
      </div>

      <p
        data-testid="goal-assay-fact-line"
        data-assay="fact-line"
        className="text-center font-mono text-sm uppercase"
        style={{ color: "var(--foreground)", fontVariantNumeric: "tabular-nums" }}
      >
        {snapshot.daysElapsed} DAYS · {snapshot.targetsMet}/{snapshot.targetsTotal} TARGETS · +
        {snapshot.xpAwardedAtCompletion} XP
      </p>

      <hr data-assay="hairline" style={{ border: "none", borderTop: "1px solid var(--border)" }} />

      <AssayTargetRows targets={snapshot.targets} />

      {heroStat.kind === "readiness" && (
        <div className="flex flex-col gap-1" data-assay="readiness-row">
          <p
            className="font-mono text-2xl"
            style={{ color: "var(--foreground)", fontVariantNumeric: "tabular-nums" }}
          >
            {readinessStart !== null ? `${readinessStart} → ` : ""}
            {heroStat.score}
            {heroStat.showDenominator
              ? `, across ${heroStat.coverage.tested} of ${heroStat.coverage.total} tested`
              : ""}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {READINESS_FRAMING}
          </p>
        </div>
      )}

      {reachTier && (
        <div data-testid="goal-assay-reach" data-assay="reach-row">
          <ReachMeter tier={reachTier} label />
        </div>
      )}

      {snapshot.ceremony && (
        <div data-testid="goal-assay-badges" data-assay="badges" className="flex flex-col gap-3">
          {snapshot.ceremony.badgesUnlocked.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {snapshot.ceremony.badgesUnlocked.map((badge) => (
                <div key={badge.id} className="flex flex-col items-center gap-1" style={{ width: 52 }}>
                  <div
                    aria-hidden
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: "9999px",
                      background: "var(--accent)",
                      border: "2px solid var(--accent)",
                    }}
                  />
                  <span
                    className="text-[10px] text-center leading-tight max-w-[56px]"
                    style={{ color: "var(--foreground)" }}
                  >
                    {badge.name}
                  </span>
                </div>
              ))}
            </div>
          )}
          {snapshot.ceremony.levelBefore < snapshot.ceremony.levelAfter && (
            <p className="text-sm" style={{ color: "var(--foreground)" }}>
              Level {snapshot.ceremony.levelBefore} → {snapshot.ceremony.levelAfter}
            </p>
          )}
        </div>
      )}

      <p
        data-testid="goal-assay-permanence"
        data-assay="permanence"
        className="text-center text-xs"
        style={{ color: "var(--muted)" }}
      >
        Frozen at completion. This never recomputes.
      </p>

      <div className="flex flex-col gap-2" data-assay="cta">
        {/* prefetch=false: /recap/completion is force-dynamic + renders via
            Satori on every hit (report §4.4) — Link's default hover/viewport
            prefetch would burn a full image render on every view of an
            achieved goal, most of which are never tapped. Tap is the only
            trigger. */}
        <Link
          data-testid="goal-assay-share"
          href={shareHref}
          prefetch={false}
          className="flex min-h-[44px] items-center justify-center rounded-xl text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          Make a share card
        </Link>
        <Link
          href="/goals"
          className="flex min-h-[44px] items-center justify-center rounded-xl border text-sm font-medium transition-colors hover:bg-[var(--accent)]/10 active:bg-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        >
          Back to goals
        </Link>
      </div>
    </div>
  );
}
