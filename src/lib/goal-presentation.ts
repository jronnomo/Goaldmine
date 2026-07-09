// src/lib/goal-presentation.ts
// Pure, client-safe goal-presentation registry.
// Purity contract: no DB, no calendar, no Prisma client, no Node built-ins
// ("fs", "path"), no server-only modules. Intl.* is allowed. Safe to import
// from Satori JSX files (recap-card.tsx) and server components.

// ─── Number formatting helpers (hoisted verbatim from recap-card.tsx) ─────────

export function fmtComma(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function fmtVolume(v: number | null): string {
  return v === null ? "—" : `${fmtComma(v)} lb`;
}

export function fmtElevation(v: number | null): string {
  return v === null ? "—" : `${fmtComma(v)} ft`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatFormat =
  | "int"
  | "volumeLb"
  | "elevationFt"
  | "currency"
  | "ratioOfTotal"
  | "percent";

export type StatSource =
  | { from: "recapField"; field: "workoutsCompleted" | "volumeLb" | "prCount" | "hikeElevationFt" }
  | { from: "logLatest"; metricKey: string }
  | { from: "scheduledItem"; itemType: string; agg: "doneOverTotal" | "doneCount" | "openCount" }
  | { from: "targetCurrent"; metric: string };

export type StatSlot = {
  key: string;
  label: string;
  source: StatSource;
  format: StatFormat;
};

export type HeaderStyle = "program-week" | "weeks-to-target" | "none";

export type GoalPresentation = {
  kind: string;
  ringLabel: string;
  headerStyle: HeaderStyle;
  statSlots: StatSlot[];
  restCopy: string | null;
  legendDefault: "fitness" | "project";
  classLabel: string;
};

// ─── Entries ──────────────────────────────────────────────────────────────────

export const FITNESS_PRESENTATION: GoalPresentation = {
  kind: "fitness",
  ringLabel: "READINESS",
  headerStyle: "program-week",
  statSlots: [
    {
      key: "workouts",
      label: "WORKOUTS",
      source: { from: "recapField", field: "workoutsCompleted" },
      format: "int",
    },
    {
      key: "volume",
      label: "VOLUME",
      source: { from: "recapField", field: "volumeLb" },
      format: "volumeLb",
    },
    {
      key: "prs",
      label: "NEW PRs",
      source: { from: "recapField", field: "prCount" },
      format: "int",
    },
    {
      key: "elevation",
      label: "ELEVATION",
      source: { from: "recapField", field: "hikeElevationFt" },
      format: "elevationFt",
    },
  ],
  restCopy:
    "A short walk or light stretch today builds the aerobic base and joint resilience your goal needs — treat recovery as training, not a day off.",
  legendDefault: "fitness",
  classLabel: "Adventurer",
};

export const PROJECT_PRESENTATION: GoalPresentation = {
  kind: "project",
  ringLabel: "PROGRESS",
  headerStyle: "weeks-to-target",
  statSlots: [
    {
      key: "mrr",
      label: "MRR",
      source: { from: "logLatest", metricKey: "mrr" },
      format: "currency",
    },
    {
      key: "milestones",
      label: "MILESTONES",
      source: { from: "scheduledItem", itemType: "milestone", agg: "doneOverTotal" },
      format: "ratioOfTotal",
    },
  ],
  restCopy: null,
  legendDefault: "project",
  classLabel: "Builder",
};

export const DEFAULT_PRESENTATION: GoalPresentation = {
  ...FITNESS_PRESENTATION,
  kind: "__default__",
  restCopy: null, // recovery tip is fitness-specific; unknown kinds get no tip
  // classLabel deliberately NOT overridden — unknown kinds inherit "Adventurer" from the spread (documented AC choice, see PRD §6).
};

// ─── Registry + resolver ──────────────────────────────────────────────────────

const REGISTRY: Record<string, GoalPresentation> = {
  fitness: FITNESS_PRESENTATION,
  project: PROJECT_PRESENTATION,
};

export function presentationForGoal(
  goal: { kind?: string | null } | null | undefined,
): GoalPresentation {
  const k = goal?.kind ?? null;
  return k && REGISTRY[k] ? REGISTRY[k] : DEFAULT_PRESENTATION;
}

// ─── statSlotsForGoal ─────────────────────────────────────────────────────────

/**
 * Structural, unknown-safe shape for the subset of a Goal row statSlotsForGoal
 * needs. `targets` arrives as `unknown` because it's a Prisma Json column at
 * every real call site — this function does its own defensive parsing so it
 * never needs (and must never import) Prisma types, preserving the file's
 * purity contract.
 */
type MinimalTarget = { metric: unknown; label: unknown; weight: unknown };

function isTargetArray(value: unknown): value is MinimalTarget[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (t) =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as { metric?: unknown }).metric === "string",
    )
  );
}

// Real goals store "log:mrr" (see PROJECT_PRESENTATION's mrr slot and the
// career template pack). The bare "mrr" spelling is included only as
// defense-in-depth against a hand-edited or legacy targets array that dropped
// the log: prefix — it is not a spelling this codebase itself emits.
const MRR_METRICS = new Set<string>(["log:mrr", "mrr"]);

/**
 * Derives up to 2 recap stat slots directly from a project goal's own
 * top-weighted targets, when that goal has no `mrr` target (the mrr-bearing
 * shape keeps using the static PROJECT_PRESENTATION.statSlots — mrr-guard).
 *
 * Every other case (fitness, unknown kind, no targets, malformed Json,
 * mrr-bearing project goal) falls back to `presentationForGoal(goal).statSlots`
 * unchanged. Never throws — malformed `targets` Json must not crash the recap
 * page.
 */
export function statSlotsForGoal(
  goal: { kind?: string | null; targets?: unknown } | null | undefined,
): StatSlot[] {
  const fallback = () => presentationForGoal(goal).statSlots;

  if (!goal || goal.kind !== "project") return fallback();
  if (!isTargetArray(goal.targets)) return fallback();
  if (goal.targets.some((t) => MRR_METRICS.has(t.metric as string))) return fallback();

  const ranked = [...goal.targets]
    .filter((t) => typeof t.weight === "number")
    .sort((a, b) => (b.weight as number) - (a.weight as number))
    .slice(0, 2);

  if (ranked.length === 0) return fallback();

  return ranked.map((t) => {
    const metric = t.metric as string;
    const rawLabel = typeof t.label === "string" && t.label.length > 0 ? t.label : metric;
    const upper = rawLabel.toUpperCase();
    // Ellipsis truncation: labels ≤14 chars pass through unchanged; longer
    // labels keep 13 chars plus a single "…" (14 total).
    const label = upper.length > 14 ? upper.slice(0, 13) + "…" : upper;
    return {
      key: metric.startsWith("log:") ? metric.slice(4) : metric,
      label,
      source: { from: "targetCurrent" as const, metric },
      format: "int" as const,
    };
  });
}
