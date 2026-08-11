// src/app/progress/page.tsx
//
// "Frequency Stack, Ruled" (docs/ux-research/progress-overhaul.md §2, the
// BINDING blueprint; the ledger wins ties). A flat manifest ordered strictly
// by read frequency: exactly ONE Tier-1 Card in the 737px fold (the Seam
// Strip — the leading indicator outranks the lagging composite, F-A),
// Tier-2 strips for everything read at session frequency, two G1 section
// rules carrying the honesty prose, SeamLine instead of Recharts for
// readiness trends (ONE Recharts max on the page; ZERO on day 1), and the
// recap CTA moved from position 2 to last (A14).
//
// The 18-key manifest renders in LITERAL SOURCE ORDER below (UXR-PROG-47 —
// stable string keys, no priority field, no runtime sort; the order is
// unit-tested against manifestKeys()). Deleted outright: the Totals card and
// its three count() queries (A26/UXR-PROG-48) and the top-of-page share pill.
//
// Zero-Program tenants get the SAME stack minus Program-only keys — nothing
// structural is lost, nothing orphaned, no rule label points at emptiness
// (report §4.2, the direction's central claim). Zero-row tenants get the
// EmptyState with a coach pointer — never 0/0/0 (A28/UXR-PROG-77).
//
// R22: no <Suspense>, no "use cache" — the tenant scope lives in ALS and is
// not part of any cache key; one HTML flush, every scan bounded.

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { HistoryChart } from "@/components/HistoryChart";
import { MilestoneBurnDown } from "@/components/MilestoneBurnDown";
import { ProgramBlockBand } from "@/components/program/ProgramBlockBand";
import { BaselinesCard } from "@/components/progress/BaselinesCard";
import { BodyCompositionCard } from "@/components/progress/BodyCompositionCard";
import { BodyMetricsLid } from "@/components/progress/BodyMetricsLid";
import { EffortCard } from "@/components/progress/EffortCard";
import { GoalStrip } from "@/components/progress/GoalStrip";
import { JumpChips, type JumpChip } from "@/components/progress/JumpChips";
import { MetricsLid } from "@/components/progress/MetricsLid";
import { MilestoneCard } from "@/components/progress/MilestoneCard";
import { NextReadings } from "@/components/progress/NextReadings";
import { RecordsFeed } from "@/components/progress/RecordsFeed";
import { SeamStrip } from "@/components/progress/SeamStrip";
import { SectionRule } from "@/components/progress/SectionRule";
import { getProgressPageData, manifestKeys } from "@/lib/progress-data";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const data = await getProgressPageData();
  const keys = new Set(manifestKeys(data));

  // Anchor chips for the sections that actually render (44px targets —
  // ⚑ UXR-PROG-55; non-sticky, scrolls away — UXR-PROG-54).
  const chips: JumpChip[] = [];
  if (keys.has("repeatability")) chips.push({ href: "#repeatability", label: "Repeatability" });
  if (data.goalStrips.length > 0) chips.push({ href: "#goals", label: "Goals" });
  chips.push({ href: "#records", label: "Records" });
  if (keys.has("effort")) chips.push({ href: "#effort", label: "Effort" });
  if (keys.has("baselines")) chips.push({ href: "#baselines", label: "Baselines" });
  if (keys.has("body-composition")) chips.push({ href: "#body", label: "Body" });

  return (
    <div className="max-w-md mx-auto p-4 space-y-4" data-progress-page="">
      {/* 1 · hero — h1 stays `Progress` (R19: the BottomNav tab label). */}
      <header className="pt-2" data-testid="progress-hero">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
          {data.hero.showProgramPill && (
            <Link
              href="/program"
              className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Program →
            </Link>
          )}
        </div>
        {data.hero.contextLine && (
          <p className="mt-0.5 text-xs text-[var(--muted)]">{data.hero.contextLine}</p>
        )}
      </header>

      {/* 2 · jump — ≥5 sections present. */}
      {keys.has("jump") && <JumpChips chips={chips} />}

      {/* 3 · program-band — the encoding-specificity frame (~78px). */}
      {data.band && (
        <div
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
          data-testid="program-band"
        >
          <div className="flex items-baseline justify-between gap-2">
            <ProgramBlockBand blocks={data.band.blocks} caption={data.band.caption} />
          </div>
          {data.band.dayNumber !== null && (
            <p className="mt-1 text-right text-sm font-semibold tabular-nums">
              {data.band.dayNumber}
            </p>
          )}
          {/* UXR-PROG-101: sr-only MAY say Block N of M (visible copy never does). */}
          {data.band.srBlockLine && <span className="sr-only">{data.band.srBlockLine}</span>}
        </div>
      )}

      {/* 4+5 · REPEATABILITY rule + the Seam Strip (the ONLY Tier-1 in the fold). */}
      {data.seamStrip && (
        <>
          <SectionRule
            id="repeatability"
            label="Repeatability"
            line="Is the skill reliable yet? Six sessions, three depths."
            data-testid="section-rule-repeatability"
          />
          <SeamStrip
            goalId={data.seamStrip.goalId}
            exercise={data.seamStrip.exercise}
            window={data.seamStrip.window}
            slots={data.seamStrip.slots}
            tracks={data.seamStrip.tracks}
            untimedSessionCount={data.seamStrip.untimedSessionCount}
            retestWeeks={data.seamStrip.retestWeeks}
          />
        </>
      )}

      {/* 6 · goal-strips ×N — one readiness grammar (UXR-PROG-22). */}
      {data.goalStrips.length > 0 && (
        <div id="goals" className="space-y-4 scroll-mt-16">
          {data.goalStrips.map((s) => (
            <GoalStrip key={s.model.goal.id} identity={s.identity} model={s.model} />
          ))}
        </div>
      )}

      {/* 7 · next-readings — ScheduledCheckpoint data, finally read. */}
      <NextReadings readings={data.nextReadings} now={data.now} />

      {/* 8 · records — mixed-kind, always renders (the zero-state is honest;
          the Z shape claims NO count — the R11 carve-out). */}
      <RecordsFeed items={data.recordsFeed} now={data.now} countKnown={data.shape !== "zero"} />

      {/* 9+10 · EFFORT rule + the one admissible game number (gated, R7/R8). */}
      {data.effort && (
        <>
          <SectionRule
            id="effort"
            label="Effort"
            line="Where the logged work went — effort, not outcome."
            data-testid="section-rule-effort"
          />
          <EffortCard model={data.effort} />
        </>
      )}

      {/* 11 · baselines — G2: the Pillar-1 payload, OPEN, never a lid. */}
      {data.baselines && (
        <div id="baselines" className="scroll-mt-16">
          <BaselinesCard rows={data.baselines.rows} totalScheduled={data.baselines.totalScheduled} />
        </div>
      )}

      {/* 12 · body-composition — the page's ONLY Recharts (G3, per-goal owner). */}
      {data.bodyComposition && <BodyCompositionCard model={data.bodyComposition} />}

      {/* 13 · metrics lid — measured count digest, text-only body (R21). */}
      <MetricsLid metrics={data.metrics} />

      {/* 14 · body-metrics lid — SeamLine, never Recharts-in-a-lid (UXR-PROG-53). */}
      <BodyMetricsLid rows={data.bodyMetrics} />

      {/* 15 · burn-down / mrr — project-primary tenants only. */}
      {data.project && (
        <>
          <MilestoneBurnDown goalId={data.project.goalId} />
          {data.project.mrr !== null &&
            (data.project.mrr.length > 0 ? (
              <Card title="MRR Trend">
                <HistoryChart data={data.project.mrr} units="$" ariaLabel="MRR trend chart" />
              </Card>
            ) : (
              <Card title="MRR Trend">
                <p className="text-sm text-[var(--muted)]">
                  No MRR logged yet — log MRR to see your trend.
                </p>
              </Card>
            ))}
        </>
      )}

      {/* 16 · milestone — FootageMarker highlight; self-nulls (R13/R27). */}
      <MilestoneCard milestone={data.milestone} />

      {/* 17 · recap-cta — moved from position 2 to LAST (A14, UXR-PROG-49). */}
      {keys.has("recap-cta") && (
        <Link
          href="/recap"
          data-testid="recap-cta"
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span>Share weekly recap</span>
          <span aria-hidden className="text-[var(--accent)]">→</span>
        </Link>
      )}

      {/* 18 · empty — the zero-row invited user (UXR-PV-81; never 0/0/0). */}
      {keys.has("empty") && (
        <Card data-testid="progress-empty-state">
          <EmptyState
            title="Nothing measured yet"
            body={
              <>
                Ask your coach in Claude to add a goal with targets. This page fills in as you
                log.
              </>
            }
            action={
              <Link href="/coach" className="text-sm text-[var(--accent)]">
                Open coach setup →
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
