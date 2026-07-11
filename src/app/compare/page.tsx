// src/app/compare/page.tsx
//
// /compare — "Glance back, forge ahead" two-date snapshot comparison.
// Server component, zero client JS (the date form is a plain GET form).
// Composition per blueprint v2 UX amendment (order: HeroSpan → StrikeBand →
// preset chips → date form → hasAnyDataA banner → section Cards) with v3
// fixes. Section order: goals (focus first) → Baseline tests → Strength PRs
// → Body & wearables → The work between → Nutrition (7-day avg).

import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import { Card } from "@/components/Card";
import { StatTile } from "@/components/StatTile";
import { DeltaRow } from "@/components/compare/DeltaRow";
import { HeroSpan, formatHeroDate } from "@/components/compare/HeroSpan";
import { StrikeBand } from "@/components/compare/StrikeBand";
import { computeComparison } from "@/lib/compare";
import {
  formatDelta,
  formatValue,
  type CompareEntry,
  type ComparisonResult,
  type GoalCompareSection,
} from "@/lib/compare-core";
import { addDays, dateKey } from "@/lib/calendar-core";
import { getDb } from "@/lib/db";
import { getActiveProgram } from "@/lib/program";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Win-first headline ordering (UX amendment §5): entries with
 *  `improved === true` or `newSinceA` first, then the rest — a STABLE
 *  partition, so each group keeps its incoming order (label-sorted for
 *  strength/baselines, registry-first for body). Front-loads wins without
 *  hiding regressions. Goal cards do NOT use this (targets stay in
 *  Goal.targets order). */
function winFirst(entries: CompareEntry[]): CompareEntry[] {
  const isWin = (e: CompareEntry) => e.improved === true || e.newSinceA;
  return [...entries.filter(isWin), ...entries.filter((e) => !isWin(e))];
}

/** ≤4 headline rows; overflow inside a native <details> (server-safe, no JS). */
function DeltaRowList({ entries }: { entries: CompareEntry[] }) {
  const headline = entries.slice(0, 4);
  const overflow = entries.slice(4);
  return (
    <div>
      {headline.map((e) => (
        <DeltaRow key={e.key} entry={e} />
      ))}
      {overflow.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-sm text-[var(--muted)]">
            Show all {entries.length}
          </summary>
          {overflow.map((e) => (
            <DeltaRow key={e.key} entry={e} />
          ))}
        </details>
      )}
    </div>
  );
}

/** v3 Fix 1 applies here too: readiness 0–100 → Bullseye progress 0–1. */
function readinessProgress(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}

/** Small A→B readiness pair for a goal Card's action slot (pixel mockup
 *  card-head mini-pair): 16px Bullseyes, A muted/receded, B full weight. */
function ReadinessMiniPair({ readiness }: { readiness: CompareEntry }) {
  return (
    <span
      className="flex items-center gap-1.5 text-sm"
      aria-label={`Readiness ${readiness.formattedA} to ${readiness.formattedB}`}
    >
      <span className="flex items-center gap-1 text-[var(--muted)] opacity-50">
        {readiness.valueA !== null && (
          <Bullseye size={16} progress={readinessProgress(readiness.valueA)} aria-hidden />
        )}
        <span className="font-mono tabular-nums">{readiness.formattedA}</span>
      </span>
      <span aria-hidden className="text-[var(--muted)]">
        →
      </span>
      <span className="flex items-center gap-1 font-semibold">
        {readiness.valueB !== null && (
          <Bullseye size={16} progress={readinessProgress(readiness.valueB)} aria-hidden />
        )}
        <span className="font-mono tabular-nums">{readiness.formattedB}</span>
      </span>
    </span>
  );
}

/** Muted "N improved" summary for a family Card's action slot (pixel mockup). */
function improvedSummary(entries: CompareEntry[]): React.ReactNode {
  const n = entries.filter((e) => e.improved === true).length;
  if (n === 0) return undefined;
  return (
    <span className="whitespace-nowrap text-xs text-[var(--muted)]">{n} improved</span>
  );
}

function GoalCard({ section, dateA }: { section: GoalCompareSection; dateA: string }) {
  // v3 Fix 2: zero-target goals render as a compact one-line row, not a full
  // empty Card (6 active goals exist — scroll length matters).
  if (section.targets.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted)]">
        {section.objective} — no measurable targets
      </div>
    );
  }

  const r = section.readiness;
  return (
    <Card title={section.objective} action={r ? <ReadinessMiniPair readiness={r} /> : undefined}>
      <div
        aria-label={`Readiness for ${section.objective}, ${r?.formattedA ?? "—"} to ${r?.formattedB ?? "—"}`}
      >
        {section.createdAfterA && (
          <p className="mb-1 text-xs text-[var(--muted)]">
            Didn&apos;t exist yet on {formatHeroDate(dateA)}.
          </p>
        )}
        {/* Goal targets keep Goal.targets order (no win-first re-ordering). */}
        <DeltaRowList entries={section.targets} />
      </div>
    </Card>
  );
}

const chipClass =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--card)] px-4 text-[13px] font-medium";

/** Date-range GET form — shared by the happy path and the error-recovery
 *  Card so the two never drift (architecture-critique C3). Plain GET, no
 *  server action (PRD §4.3); `max` bounds both inputs to today (PRD §3.1.2). */
function CompareDateForm({
  dateA,
  dateB,
  todayKey,
}: {
  dateA: string;
  dateB: string;
  todayKey: string;
}) {
  return (
    <form method="get" className="flex items-end gap-2">
      <label className="flex-1 text-xs text-[var(--muted)]">
        From
        <input
          type="date"
          name="a"
          defaultValue={dateA}
          max={todayKey}
          className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-2 text-sm tabular-nums"
        />
      </label>
      <label className="flex-1 text-xs text-[var(--muted)]">
        To
        <input
          type="date"
          name="b"
          defaultValue={dateB}
          max={todayKey}
          className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-2 text-sm tabular-nums"
        />
      </label>
      <button
        type="submit"
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
      >
        Go
      </button>
    </form>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const todayKey = dateKey(new Date());
  const last30Key = dateKey(addDays(new Date(), -30));

  // Malformed-params rule (blueprint §5): if `a` is missing/invalid OR `b` is
  // present but invalid, fall back to BOTH defaults — never a partial mix.
  const paramsValid =
    params.a !== undefined &&
    DATE_KEY_RE.test(params.a) &&
    (params.b === undefined || DATE_KEY_RE.test(params.b));
  const rawA = paramsValid ? params.a! : last30Key;
  const rawB = paramsValid ? (params.b ?? todayKey) : todayKey;

  const db = await getDb();

  // Architecture-critique C1: the comparison fetch is the only one wrapped in
  // try/catch. `focusGoal`/`activeProgram` stay outside it — they're
  // unrelated Prisma calls, and bundling them under the same catch would let
  // an infra hiccup in either one produce a false "comparison failed"
  // message while a healthy computeComparison result gets discarded. All
  // three promises still start together (no waterfall regression); only the
  // await/catch placement differs.
  const focusGoalPromise = db.goal
    .findFirst({ where: { active: true, isFocus: true }, orderBy: { createdAt: "asc" } })
    .then(
      async (fg) =>
        fg ?? (await db.goal.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } })),
    );
  const activeProgramPromise = getActiveProgram();

  let result: ComparisonResult | null = null;
  let comparisonFailed = false;
  try {
    result = await computeComparison(rawA, rawB);
  } catch (err) {
    console.error("compare: computeComparison failed", err);
    comparisonFailed = true;
  }

  const [focusGoal, activeProgram] = await Promise.all([focusGoalPromise, activeProgramPromise]);

  if (comparisonFailed || result === null) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        <Card title="Couldn't build this comparison.">
          <p className="text-sm text-[var(--muted)]">Try again, or pick different dates.</p>
          <div className="mt-3">
            <CompareDateForm dateA={rawA} dateB={rawB} todayKey={todayKey} />
          </div>
        </Card>
      </div>
    );
  }

  // Hero focus goal = first goals[] entry with targets (UX amendment §5);
  // null-safe when absent → HeroSpan renders the date span only.
  const focusSection = result.goals.find((g) => g.targets.length > 0) ?? null;

  const { between, cumulative } = result.counters;
  const showNutrition = result.nutrition.daysLoggedA > 0 || result.nutrition.daysLoggedB > 0;

  const baselineEntries = winFirst(result.baselines);
  const strengthEntries = winFirst(result.strength);
  const bodyEntries = winFirst(result.body);

  // #229: fitness-framed tiles/rows in "The work between" (workouts, hikes,
  // baseline tests, ft climbed, mi hiked, and the whole cumulative[] block —
  // 100% fitness-domain per compare.ts:397-401) render only when at least
  // one compared goal is kind==="fitness". Notes/XP/Level stay kind-neutral
  // and always render. For any fitness-present compare this is a pure
  // superset-wrap of the existing JSX — no reordering — so the rendered
  // output stays byte-identical (architecture-critique S2).
  const hasFitnessGoal = result.goals.some((g) => g.kind === "fitness");

  // aria-label for "The work between" must enumerate exactly what's
  // rendered (architecture-critique S4/C1) — built as a clause array so the
  // fitness-gate and the Level-tile gate (2 independent booleans, 4 combos)
  // can't drift out of sync with the rendered tile set via string-concat
  // comma bugs.
  const workBetweenClauses: string[] = [];
  if (hasFitnessGoal) {
    workBetweenClauses.push(
      `${between.workoutsCompleted} workouts`,
      `${between.hikesCompleted} hikes`,
      `${between.baselineTestsLogged} baseline tests logged`,
    );
  }
  workBetweenClauses.push(`${between.notesLogged} notes logged`);
  if (hasFitnessGoal) {
    workBetweenClauses.push(
      `${between.hikeElevationFt} feet climbed`,
      `${between.hikeDistanceMi} miles hiked`,
    );
  }
  workBetweenClauses.push(`${between.xpEarned} XP earned`);
  if (between.levelA !== null && between.levelB !== null) {
    workBetweenClauses.push(`level ${between.levelA} to ${between.levelB}`);
  }
  const workBetweenLabel =
    `The work between ${formatHeroDate(result.dateA)} and ${formatHeroDate(result.dateB)}: ` +
    workBetweenClauses.join(", ");

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <Link
        href="/progress"
        className="inline-flex items-center min-h-11 text-sm text-[var(--accent)]"
      >
        ← Progress
      </Link>

      <HeroSpan
        dateA={result.dateA}
        dateB={result.dateB}
        spanDays={result.spanDays}
        readinessA={focusSection?.readiness?.valueA ?? null}
        readinessB={focusSection?.readiness?.valueB ?? null}
        focusObjective={focusSection?.objective ?? null}
        swapped={result.swapped}
        sameDay={result.sameDay}
        clampedToToday={result.clampedToToday}
      />

      <StrikeBand levelA={between.levelA} levelB={between.levelB} />

      {/* Preset chips — anchors omitted when absent (PRD §4.4c). */}
      <div className="flex flex-wrap gap-2">
        <Link href={`/compare?a=${last30Key}&b=${todayKey}`} className={chipClass}>
          Last 30 days
        </Link>
        {focusGoal && (
          <Link
            href={`/compare?a=${dateKey(focusGoal.createdAt)}&b=${todayKey}`}
            className={chipClass}
          >
            Goal created
          </Link>
        )}
        {activeProgram && (
          <Link
            href={`/compare?a=${dateKey(activeProgram.startedOn)}&b=${todayKey}`}
            className={chipClass}
          >
            Program start
          </Link>
        )}
      </div>

      {/* Date form — plain GET, no server action (PRD §4.3). */}
      <CompareDateForm dateA={result.dateA} dateB={result.dateB} todayKey={todayKey} />

      {/* #229 architecture-critique C3: hasAnyDataA is computed compare.ts-side
          from raw workout/hike counts regardless of goal kind, independent of
          the page-level hasFitnessGoal gate below. A project-only-goals user
          who nonetheless has historical workout data could see this banner
          reference data that's now hidden by the fitness-tile gate. Accepted
          scope boundary (PRD explicitly forbids touching compare.ts's
          hasAnyDataA logic here) — do not "fix" hasAnyDataA into a regression. */}
      {!result.hasAnyDataA && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-3 text-sm">
          Nothing was logged as of {formatHeroDate(result.dateA)} — everything below is new
          since then.
        </div>
      )}

      {/* Per-goal Cards, focus first (compare.ts orders isFocus desc). */}
      {result.goals.map((g) => (
        <GoalCard key={g.goalId} section={g} dateA={result.dateA} />
      ))}

      {result.baselines.length > 0 && (
        <Card title="Baseline tests" action={improvedSummary(result.baselines)}>
          <div aria-label={`Baseline tests, ${result.baselines.length} compared`}>
            <DeltaRowList entries={baselineEntries} />
          </div>
        </Card>
      )}

      {result.strength.length > 0 && (
        <Card title="Strength PRs" action={improvedSummary(result.strength)}>
          <div aria-label={`Strength PRs, ${result.strength.length} exercises compared`}>
            <DeltaRowList entries={strengthEntries} />
          </div>
        </Card>
      )}

      {result.body.length > 0 && (
        <Card title="Body & wearables" action={improvedSummary(result.body)}>
          <div aria-label={`Body and wearables, ${result.body.length} metrics compared`}>
            <DeltaRowList entries={bodyEntries} />
          </div>
        </Card>
      )}

      <Card title="The work between">
        <div aria-label={workBetweenLabel}>
          <div className="grid grid-cols-3 gap-2">
            {hasFitnessGoal && (
              <>
                <StatTile label="workouts" value={formatValue(between.workoutsCompleted, "")} />
                <StatTile label="hikes" value={formatValue(between.hikesCompleted, "")} />
                <StatTile
                  label="baseline tests"
                  value={formatValue(between.baselineTestsLogged, "")}
                />
              </>
            )}
            <StatTile label="notes" value={formatValue(between.notesLogged, "")} />
            {hasFitnessGoal && (
              <>
                <StatTile label="ft climbed" value={formatValue(between.hikeElevationFt, "ft")} />
                <StatTile label="mi hiked" value={formatValue(between.hikeDistanceMi, "mi")} />
              </>
            )}
            <StatTile label="XP" value={formatDelta(between.xpEarned, "")} />
            {between.levelA !== null && between.levelB !== null && (
              <StatTile label="Level" value={`${between.levelA} → ${between.levelB}`} />
            )}
          </div>
          {hasFitnessGoal && (
            <div className="mt-3">
              {cumulative.map((e) => (
                <DeltaRow key={e.key} entry={e} />
              ))}
            </div>
          )}
        </div>
      </Card>

      {showNutrition && (
        <Card
          title="Nutrition"
          action={<span className="whitespace-nowrap text-xs text-[var(--muted)]">7-day avg</span>}
        >
          <div
            aria-label={`Nutrition, trailing 7-day averages, logged ${result.nutrition.daysLoggedA} of 7 days to ${result.nutrition.daysLoggedB} of 7 days`}
          >
            {result.nutrition.entries.map((e) => (
              <DeltaRow key={e.key} entry={e} />
            ))}
            <p className="flex min-h-11 items-center border-t border-[var(--border)] text-sm text-[var(--muted)]">
              <span className="flex-1">Logged</span>
              <span className="font-mono text-[13px] tabular-nums">
                {result.nutrition.daysLoggedA}/7 → {result.nutrition.daysLoggedB}/7
              </span>
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
