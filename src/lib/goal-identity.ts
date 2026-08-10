// src/lib/goal-identity.ts
//
// Per-goal visual identity for the Program surfaces (Unified Today, /program,
// cross-goal calendar) — the "Marked Lane" direction of
// docs/ux-research/program-views.md (§7.0, UXR-PV-02/03/04).
//
// Identity is a MONOCHROME GEOMETRIC MARK derived from a slot, never a schema
// column and never a hue alone: the palette is iso-luminant (research F1 — every
// chromatic token pair lands 1.00–1.35:1 in grayscale), so SHAPE carries the
// identity and the hue token is reinforcement only. `▲` (not `◆`) because `◆`
// is already the hardcoded scheduled-item marker (UXR-PV-03).
//
// Slot sort (UXR-PV-04, binding): isFocus DESC, (kind === "project") ASC,
// createdAt ASC, id ASC. The final `id` tiebreak is NOT optional — without a
// total order, two goals seeded in the same second would swap ● and ■ between
// renders. Callers that only have `ResolvedDay.program.memberGoals` (no
// isFocus/createdAt) still get a deterministic order: missing isFocus compares
// as false, missing createdAt compares as equal, and `id` settles it.
//
// ⚠ Identity-stability hazard (UXR-PV-08): a NEW fitness member goal sorts
// ahead of an existing project member goal, pushing the project goal's mark
// down a slot (e.g. AWS ▲ → the +N bucket at 4+ fitness goals). Adding a
// project goal is safe (projects sort last). Slot re-flow on archive is
// accepted (UXR-PV-93) rather than persisting a slot column.
//
// Pure + client-safe: no Prisma imports, no IO.

import { resolveLegend, findLegendEntry } from "@/lib/legend";

export type GoalIdentityShape = "circle" | "square" | "triangle";

export type GoalIdentity = {
  goalId: string;
  /** 0-based slot after the identity sort. Slots ≥ GOAL_MARK_SLOT_CAP have no
   *  shape of their own and render inside the lane's `+N` bucket. */
  slot: number;
  /** null → overflow (+N bucket); the goal has no dedicated glyph. */
  shape: GoalIdentityShape | null;
  /** Filled glyph — logged/completed state (● ■ ▲). Empty string on overflow. */
  glyphFilled: string;
  /** Hollow glyph — claimed-but-not-yet-logged state (○ □ △). */
  glyphHollow: string;
  /** CSS custom-property reference, e.g. "var(--target)". Decoration only —
   *  identity must survive a grayscale screenshot (UXR-PV-05). */
  hue: string;
  /** Short human label for legend strips / aria text. */
  label: string;
};

/** Marks per lane before the `+N` bucket (research R3: "3 slots + +N"). */
export const GOAL_MARK_SLOT_CAP = 3;

/** Slot ladder: slot 0 ●/--target · slot 1 ■/--success · slot 2 ▲/--accent.
 *  Overflow renders as `+N` in --muted (see MarkLane). */
const SLOT_GLYPHS: readonly {
  shape: GoalIdentityShape;
  filled: string;
  hollow: string;
  hue: string;
}[] = [
  { shape: "circle", filled: "●", hollow: "○", hue: "var(--target)" },
  { shape: "square", filled: "■", hollow: "□", hue: "var(--success)" },
  { shape: "triangle", filled: "▲", hollow: "△", hue: "var(--accent)" },
];

/**
 * Geometric-shapes range (U+25A0–U+25FF) plus ★ (U+2605) — glyphs that a CSS
 * `color:` actually tints. Emoji legends are COLR glyphs where `color:` is a
 * silent no-op (research F3), so anything outside this set must DEGRADE
 * (fall back) rather than fail invisibly (UXR-PV-07).
 */
export const MONOCHROME_SAFE = /^[■-◿★]$/u;

export function isMonochromeSafe(icon: string): boolean {
  return MONOCHROME_SAFE.test(icon);
}

/** Fallback short-label truncation length (research ⚠[14–22], default 18). */
const SHORT_LABEL_MAX = 18;

export type GoalIdentityMember = {
  id: string;
  objective: string;
  kind: string;
  status: string;
  /** Optional fidelity fields — pass when available (one member-detail
   *  findMany); absent values degrade to the documented defaults. */
  isFocus?: boolean;
  createdAt?: Date | string | null;
  /** Raw Goal.legend Json — used only for the short label (see below). */
  legend?: unknown;
};

/**
 * Short label for legend strips: the goal's own `goal-date` legend label WHEN
 * the coach has migrated that entry to a monochrome-safe glyph (the E6
 * `update_goal_legend` migration — icon "●", label "Handstand"). Pre-migration
 * legends carry stock labels ("Goal date") behind emoji icons, which are
 * useless as goal names — the isMonochromeSafe(icon) guard makes those degrade
 * to the objective-derived fallback instead of rendering "Goal date" ×3.
 */
function shortLabel(member: GoalIdentityMember): string {
  if (member.legend != null) {
    const entry = findLegendEntry(
      resolveLegend({ legend: member.legend, kind: member.kind }),
      "goal-date",
    );
    if (entry && entry.label.trim() !== "" && isMonochromeSafe(entry.icon)) {
      return entry.label;
    }
  }
  // Objective fallback: first clause before a separator, truncated.
  // "Pass the AWS Solutions Architect Associate exam" has no separator and
  // truncates — that is the accepted degradation until E6 runs.
  const clause = member.objective.split(/[—–,:(]/)[0]?.trim() ?? member.objective;
  if (clause.length <= SHORT_LABEL_MAX) return clause;
  return `${clause.slice(0, SHORT_LABEL_MAX).trimEnd()}…`;
}

function createdAtMs(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Assign identities to the ACTIVE member goals of a Program.
 *
 * Non-active members (paused/achieved/abandoned) get no identity — their
 * day-level claims are already [] (see ResolvedDay.goalMarks), so nothing in
 * a mark lane can reference them. Input order is preserved as the sort's
 * stable base (getActiveProgramMembership returns createdAt ASC, id ASC).
 */
export function assignGoalIdentities(
  members: readonly GoalIdentityMember[],
): GoalIdentity[] {
  const active = members.filter((m) => m.status === "active");

  const sorted = active
    .map((m, index) => ({ m, index }))
    .sort((a, b) => {
      // isFocus DESC (missing → false)
      const focus = Number(b.m.isFocus ?? false) - Number(a.m.isFocus ?? false);
      if (focus !== 0) return focus;
      // (kind === "project") ASC — fitness (and any non-project kind) first
      const kind =
        Number(a.m.kind === "project") - Number(b.m.kind === "project");
      if (kind !== 0) return kind;
      // createdAt ASC when both known
      const aMs = createdAtMs(a.m.createdAt);
      const bMs = createdAtMs(b.m.createdAt);
      if (aMs !== null && bMs !== null && aMs !== bMs) return aMs - bMs;
      // id ASC — the mandatory total-order tiebreak
      if (a.m.id !== b.m.id) return a.m.id < b.m.id ? -1 : 1;
      return a.index - b.index;
    });

  return sorted.map(({ m }, slot) => {
    const glyph = slot < GOAL_MARK_SLOT_CAP ? SLOT_GLYPHS[slot] : null;
    return {
      goalId: m.id,
      slot,
      shape: glyph?.shape ?? null,
      glyphFilled: glyph?.filled ?? "",
      glyphHollow: glyph?.hollow ?? "",
      hue: glyph?.hue ?? "var(--muted)",
      label: shortLabel(m),
    };
  });
}
