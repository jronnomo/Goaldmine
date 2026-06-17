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
};

export const DEFAULT_PRESENTATION: GoalPresentation = {
  ...FITNESS_PRESENTATION,
  kind: "__default__",
  restCopy: null, // recovery tip is fitness-specific; unknown kinds get no tip
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
