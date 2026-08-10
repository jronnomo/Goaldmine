// src/app/program/page.tsx — the Program dashboard (#290, Sprint 19 / M4b).
//
// Design source (binding): docs/ux-research/program-views.md §7.2 + the
// ledger sign-offs — UXR-PV-90 REJECTED by the founder (sparklines SHIP, as a
// plain awaited server component: NO <Suspense>, no streaming — the
// force-dynamic × ALS-`_userScope` × streaming interaction is deliberately
// not exercised), UXR-PV-92 (CeilingRule as divs), UXR-PV-93 (slot re-flow on
// archive accepted; identity slots stay derived, never persisted).
//
// Server component, zero client JS on the page (the target breakdown uses
// native <details>/<summary>). Protected by the default deny-by-default
// middleware — /program is not in isPublicPath, so no route-access change.
//
// Date math: calendar-core primitives ONLY (startOfDay / parseDateKey are the
// USER_TZ-safe primitives). src/lib/calendar.ts is under concurrent rework on
// sibling branches, so the weekIndex is computed inline here with resolveDay's
// exact formula (floor(daysDelta / 7) + 1 inside the plan window) instead of
// importing the day-resolver.
//
// Query budget (UXR-PV-51/52/53): the readiness series is domain-clamped to
// max(goal.createdAt, program.startedOn) — pre-Program arcs are noise — and
// computed SEQUENTIALLY per goal with batchSize 3, so aggregate concurrency
// never thrashes the connection pool. maxPoints 26 bounds a full 20-week
// window (≤21 weekly cursors) without sampling.
//
// Empty states (§8, binding): no active Program → quiet explainer pointing at
// the coach (HTTP 200, never a redirect, never an error); zero member goals →
// window card + honest empty row; a member with zero targets renders NO
// number at all (never a 0).
//
// MarkLegendStrip is deliberately omitted on this surface: every identity
// mark here sits directly beside its goal's full objective on the same row —
// the cards ARE the legend. The strip earns its ~20px on surfaces where marks
// appear without names (Today lane, calendar cells).

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { MemberGoalCard } from "@/components/program/MemberGoalCard";
import {
  ProgramBlockBand,
  type ProgramBlockSegment,
} from "@/components/program/ProgramBlockBand";
import { assignGoalIdentities, type GoalIdentity } from "@/lib/goal-identity";
import { startOfDay, USER_TZ } from "@/lib/calendar-core";
import { getDb } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import {
  getActiveProgram,
  getActiveProgramMembership,
  phaseForWeekIndex,
  type ActiveProgramSnapshot,
} from "@/lib/program";
import {
  computeReadiness,
  computeReadinessSeriesSampled,
  type ReadinessSnapshot,
} from "@/lib/readiness";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

/** Whole days between two USER_TZ midnights — resolveDay's formula, inlined
 *  on calendar-core primitives (see the file header for why). */
function daysBetweenMidnights(a: Date, b: Date): number {
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});
const dayYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: USER_TZ,
});

type MemberCardData = {
  identity: GoalIdentity;
  goal: {
    id: string;
    objective: string;
    kind: string;
    status: string;
    targetDate: Date | null;
  };
  snapshot: ReadinessSnapshot | null;
  series: number[] | null;
};

export default async function ProgramPage() {
  const membership = await getActiveProgramMembership();

  if (!membership) {
    // Invited-user default, not an error path: a new tenant has no Program
    // until the coach creates one over MCP. HTTP 200, quiet copy, and a
    // Month-view escape hatch so this tab is never a dead end (UXR-PV-57).
    return (
      <div className="max-w-md mx-auto p-4 space-y-4" data-testid="program-page">
        <h1 className="text-2xl font-bold tracking-tight">Program</h1>
        <Card>
          <EmptyState
            data-testid="program-empty"
            title="No program yet"
            body={
              <>
                Your coach builds programs in Claude — connect one to see it here. Set up the
                connection in{" "}
                <Link
                  href="/settings"
                  className="text-[var(--accent)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
                >
                  Settings
                </Link>
                .
              </>
            }
            action={
              <Link
                href="/calendar"
                className="inline-block rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
              >
                Month view →
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const db = await getDb();
  const memberRows = await db.goal.findMany({
    where: { programId: membership.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      objective: true,
      kind: true,
      status: true,
      isFocus: true,
      createdAt: true,
      targetDate: true,
      targets: true,
      legend: true,
    },
  });

  // Rotation snapshot — null is a normal state (a pure-scheduling Program).
  const plan = await getActiveProgram();
  const now = new Date();

  // ── Program window (from Program.startedOn / endsOn) ─────────────────────
  const dayNumber = daysBetweenMidnights(membership.startedOn, now) + 1;
  const totalDays = membership.endsOn
    ? daysBetweenMidnights(membership.startedOn, membership.endsOn) + 1
    : null;
  const windowLine = buildWindowLine(membership.startedOn, membership.endsOn, dayNumber, totalDays);

  // ── Rotation week / phase (inline weekIndex — see file header) ───────────
  let weekIndex: number | null = null;
  let dayInPlan: number | null = null;
  if (plan) {
    dayInPlan = daysBetweenMidnights(plan.startedOn, now);
    const totalWeeks = plan.template?.totalWeeks ?? 0;
    if (dayInPlan >= 0 && dayInPlan < totalWeeks * 7) {
      weekIndex = Math.floor(dayInPlan / 7) + 1;
    }
  }
  const phase = plan ? phaseForWeekIndex(plan.template, weekIndex) : null;
  const blocks = plan ? buildBlockSegments(plan, weekIndex, dayInPlan ?? 0) : [];
  const bandCaption = plan
    ? phase && weekIndex !== null
      ? `${phase.name} · Week ${weekIndex} of ${plan.template.totalWeeks}`
      : (dayInPlan ?? 0) < 0
        ? `Rotation starts ${dayYearFmt.format(plan.startedOn)}`
        : "Rotation window complete"
    : null;

  // ── Per-goal readiness — sequential, bounded concurrency ─────────────────
  const identities = assignGoalIdentities(memberRows);
  const cards: MemberCardData[] = [];
  for (const identity of identities) {
    const g = memberRows.find((r) => r.id === identity.goalId)!;
    const goal = {
      id: g.id,
      objective: g.objective,
      kind: g.kind,
      status: g.status,
      targetDate: g.targetDate,
    };
    const targets = (g.targets as unknown as GoalTarget[] | null) ?? [];
    if (targets.length === 0) {
      cards.push({ identity, goal, snapshot: null, series: null });
      continue;
    }
    const snapshot = await computeReadiness(targets, now, g.id);
    let series: number[] | null = null;
    if (snapshot.coverage.tested > 0) {
      // UXR-PV-51: clamp the series domain to the Program window — the
      // pre-Program arc of an older goal is noise here.
      const domainStart =
        g.createdAt.getTime() > membership.startedOn.getTime()
          ? g.createdAt
          : membership.startedOn;
      const points = await computeReadinessSeriesSampled(domainStart, targets, now, g.id, {
        maxPoints: 26,
        batchSize: 3,
      });
      series = points.map((p) => p.score);
    }
    cards.push({ identity, goal, snapshot, series });
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4" data-testid="program-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight truncate">{membership.name}</h1>
            <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {membership.status}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{windowLine}</p>
        </div>
        <Link
          href="/calendar"
          data-testid="program-to-calendar"
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Month →
        </Link>
      </header>

      {/* ── Window card: proportional block band ───────────────────────── */}
      <Card data-testid="program-window-card">
        {plan && blocks.length > 0 ? (
          <ProgramBlockBand blocks={blocks} caption={bandCaption} />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No training rotation attached — this program runs on scheduled items and logged
            metrics.
          </p>
        )}
      </Card>

      {/* ── One card per member goal ────────────────────────────────────── */}
      {cards.length === 0 ? (
        <Card>
          <EmptyState
            data-testid="program-no-members"
            title="No goals in this program yet"
            body="Ask your coach in Claude to add member goals — each one gets its own readiness card here."
          />
        </Card>
      ) : (
        cards.map((c) => (
          <MemberGoalCard
            key={c.goal.id}
            identity={c.identity}
            goal={c.goal}
            snapshot={c.snapshot}
            series={c.series}
          />
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header + band helpers (module-scope so the render body stays declarative)
// ─────────────────────────────────────────────────────────────────────────

function buildWindowLine(
  startedOn: Date,
  endsOn: Date | null,
  dayNumber: number,
  totalDays: number | null,
): string {
  const sameYear =
    endsOn !== null &&
    dayYearFmt.format(startedOn).slice(-4) === dayYearFmt.format(endsOn).slice(-4);
  const range = endsOn
    ? `${(sameYear ? dayFmt : dayYearFmt).format(startedOn)} – ${dayYearFmt.format(endsOn)}`
    : `Since ${dayYearFmt.format(startedOn)}`;

  if (dayNumber <= 0) {
    const startsIn = 1 - dayNumber;
    return `${range} · starts in ${startsIn} day${startsIn === 1 ? "" : "s"}`;
  }
  if (totalDays === null) return `${range} · day ${dayNumber}`;
  if (dayNumber > totalDays) return `${range} · ended`;
  return `${range} · day ${dayNumber} of ${totalDays} · ${totalDays - dayNumber} remaining`;
}

/** Proportional block segments from the plan's own phases (UXR-PV-29/31). */
function buildBlockSegments(
  plan: ActiveProgramSnapshot,
  weekIndex: number | null,
  dayInPlan: number,
): ProgramBlockSegment[] {
  const phases = Array.isArray(plan.template?.phases) ? plan.template.phases : [];
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return phases
    .filter((p) => Array.isArray(p?.weeks) && p.weeks.length > 0)
    .map((p) => {
      const minWeek = Math.min(...p.weeks);
      const startDay = (minWeek - 1) * 7;
      const days = p.weeks.length * 7;
      return {
        key: `${p.index}-${minWeek}`,
        label: p.name || `Block ${p.index}`,
        weight: days,
        fill: clamp01((dayInPlan + 1 - startDay) / days),
        current: weekIndex !== null && p.weeks.includes(weekIndex),
      };
    });
}
