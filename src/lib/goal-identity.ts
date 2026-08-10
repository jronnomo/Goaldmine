// src/lib/goal-identity.ts
//
// Derived per-goal identity marks for the Program surfaces (#290, UX research
// docs/ux-research/program-views.md §7.0 / rules R1–R4).
//
// Identity is carried by SHAPE, never hue: the palette is iso-luminant (every
// chromatic token pair measures 1.00–1.35:1 against each other — research
// finding F1), so hue is a recognition accelerator layered on top, and a
// grayscale screenshot must lose nothing. The triad is ● ■ ▲ (hollow ○ □ △) —
// deliberately NOT ◆, which MarkerIcon hardcodes as the scheduled-item marker
// (F3 / UXR-PV-03).
//
// The slot is DERIVED, never a schema column (UXR-PV-04): sort key
// `isFocus DESC, (kind === 'project') ASC, createdAt ASC, id ASC`. The final
// `id` tiebreak is not optional — without a total order, two goals seeded in
// the same second could swap ● and ■ between renders. Known accepted hazards:
// a new FITNESS member goal sorts ahead of an existing PROJECT member and can
// push it into the overflow bucket (UXR-PV-08), and archiving a member
// re-flows the remaining slots (UXR-PV-93 — signed off: rare, user-initiated,
// not worth a persisted slot column).
//
// Pure + client-safe: no Prisma, no IO.

import { LegendSchema } from "@/lib/legend";

/** Slots 0–2 carry the triad; 3+ overflow into a muted dot (`+N` on lanes). */
export type GoalIdentityShape = "circle" | "square" | "triangle" | "overflow";

export type GoalIdentity = {
  goalId: string;
  /** 0-based derived slot in the sorted member list. */
  slot: number;
  shape: GoalIdentityShape;
  /** Filled mark — logged/identity glyph (● ■ ▲, overflow ·). */
  glyphFilled: string;
  /** Hollow mark — claimed-not-logged glyph (○ □ △, overflow ·). */
  glyphHollow: string;
  /** CSS custom-property reference. Reinforcement only — never the channel. */
  hue: string;
  /** Short display label — legend `goal-date` entry, else truncated objective. */
  label: string;
};

/** The minimal member-goal shape identity derivation needs. */
export type GoalIdentityMember = {
  id: string;
  objective: string;
  kind: string;
  isFocus: boolean;
  createdAt: Date;
  /** Goal.legend Json — passed through resolveLegend for the short label. */
  legend?: unknown;
};

/**
 * Monochrome-safe glyph test (research §7.0): the Geometric Shapes block
 * (■ U+25A0 … ◿ U+25FF — includes ● ○ □ △ ▲ ◎) plus ★. Emoji legend glyphs
 * (🥾 ⛏️ 🏔️ …) are COLR/CBDT color fonts on which CSS `color:` is a silent
 * no-op — they must never be hue-tinted or used as identity marks.
 */
export const MONOCHROME_SAFE = /^[■-◿★]$/u;

export function isMonochromeSafe(icon: string): boolean {
  return MONOCHROME_SAFE.test(icon);
}

const SLOT_MARKS: ReadonlyArray<{
  shape: GoalIdentityShape;
  glyphFilled: string;
  glyphHollow: string;
  hue: string;
}> = [
  { shape: "circle", glyphFilled: "●", glyphHollow: "○", hue: "var(--target)" },
  { shape: "square", glyphFilled: "■", glyphHollow: "□", hue: "var(--success)" },
  { shape: "triangle", glyphFilled: "▲", glyphHollow: "△", hue: "var(--accent)" },
];

const OVERFLOW_MARK = {
  shape: "overflow" as const,
  glyphFilled: "·",
  glyphHollow: "·",
  hue: "var(--muted)",
};

/** Short-label truncation cap (research ⚠[14–22], chosen 18). */
const LABEL_MAX = 18;

/**
 * Short label resolution (research §7.0): the goal's OWN `goal-date` legend
 * entry label when one exists — that is what the `update_goal_legend`
 * migration buys — else the objective's first clause (`—`, `–`, `,`, `:`,
 * `(` separators), truncated to LABEL_MAX with an ellipsis.
 *
 * Deliberately does NOT route through resolveLegend: its default-legend
 * fallback carries a generic "Goal date" entry that would hijack the label
 * for every legendless goal. Only a stored, valid legend counts here.
 */
export function shortGoalLabel(member: Pick<GoalIdentityMember, "objective" | "legend">): string {
  if (member.legend != null) {
    const parsed = LegendSchema.safeParse(member.legend);
    const fromLegend = parsed.success
      ? parsed.data.find((e) => e.kind === "goal-date")?.label?.trim()
      : undefined;
    if (fromLegend) return fromLegend;
  }
  const clause = (member.objective.split(/[—–,:(]/)[0] ?? member.objective).trim();
  if (clause.length <= LABEL_MAX) return clause;
  return `${clause.slice(0, LABEL_MAX).trimEnd()}…`;
}

/**
 * Assign derived identity marks to a Program's member goals. Returns one
 * GoalIdentity per member, in slot order (the stable, learnable order every
 * Program surface renders in).
 */
export function assignGoalIdentities(members: readonly GoalIdentityMember[]): GoalIdentity[] {
  const sorted = [...members].sort((a, b) => {
    if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
    const aProject = a.kind === "project";
    const bProject = b.kind === "project";
    if (aProject !== bProject) return aProject ? 1 : -1;
    const dt = a.createdAt.getTime() - b.createdAt.getTime();
    if (dt !== 0) return dt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted.map((m, slot) => {
    const mark = SLOT_MARKS[slot] ?? OVERFLOW_MARK;
    return {
      goalId: m.id,
      slot,
      shape: mark.shape,
      glyphFilled: mark.glyphFilled,
      glyphHollow: mark.glyphHollow,
      hue: mark.hue,
      label: shortGoalLabel(m),
    };
  });
}
