// src/lib/day-rhythm.ts
//
// The Unified Today timeline's ordering + row derivation — the "fixed rhythm
// ladder" of docs/ux-research/program-views.md (§7.0/§7.1, UXR-PV-09/10/15).
//
// There is NO time-of-day field anywhere in the schema, so a timeline needs a
// code-side rhythm. Slots are a property of the row's SOURCE, not a string
// parse of user data — with one documented exception: template blocks. A
// DayTemplate block has no slot field, so the coach-authored label convention
// ("Fasted AM — …" / "PM Skill — …", see phase2a-spec.ts) is matched as a
// PREFIX to split the AM block and the PM skill block out of the main session.
// An unmatched block is simply part of the training session — the heuristic
// can only ever regroup rows, never drop one.
//
// Ladder (binding order — the founder's Monday must read
// [AM walk+AWS, session, PM skill, weigh-in, nutrition], research §7.8 #7):
//   fasted-am → am → training → skill → anytime → due → fuel → evening
//
// HARD CONSTRAINT (RFC §7 / UXR-PV-09): ONE timeline. Every entry carries
// EVERY goal claim it serves (goalIds); a shared activity is ONE entry with
// multiple marks — never per-goal sections, never a repeated row.
//
// Claim derivation reuses the PRODUCTION link matcher (evaluateWorkoutLinks)
// against a pseudo-activity built from each block, so the marks shown are
// exactly the links that WOULD be written if the block were logged as-is.
// Logged-side fill state derives from data already in ResolvedDay — no
// ActivityGoalLink reads in v1 (the fill is conservative: a mark never fills
// unless the day's own data says the row's activity happened).
//
// Pure + client-safe: no Prisma, no IO, no date math.

import type { Block, DayTemplate } from "@/lib/program-template";
import type { NutritionPlan } from "@/lib/nutrition-plan";
import { sumPlanTargetMacros } from "@/lib/nutrition-macros";
import {
  evaluateWorkoutLinks,
  type AttributionMemberGoal,
} from "@/lib/attribution";
import type { AttributionRule } from "@/lib/attribution-rules";
import { canonicalExerciseName } from "@/lib/exercise-canonical";

// ── Rhythm slots ────────────────────────────────────────────────────────────

export const RHYTHM_SLOTS = [
  "fasted-am",
  "am",
  "training",
  "skill",
  "anytime",
  "due",
  "fuel",
  "evening",
] as const;

export type RhythmSlot = (typeof RHYTHM_SLOTS)[number];

const RHYTHM_RANK = new Map<RhythmSlot, number>(
  RHYTHM_SLOTS.map((s, i) => [s, i]),
);

export function rhythmRank(slot: RhythmSlot): number {
  return RHYTHM_RANK.get(slot) ?? RHYTHM_SLOTS.length;
}

/** ScheduledItem.payload.rhythm escape hatch (UXR-PV-16): a valid slot string
 *  overrides the item's default "anytime"; anything else falls back rather
 *  than throwing (payload is coach-authored Json). */
export function parseRhythm(raw: unknown): RhythmSlot | null {
  return typeof raw === "string" && (RHYTHM_SLOTS as readonly string[]).includes(raw)
    ? (raw as RhythmSlot)
    : null;
}

/** Template-block slot heuristic (prefix convention, see header comment). */
export function blockRhythm(block: Pick<Block, "type" | "label">): "fasted-am" | "skill" | "training" {
  const label = block.label ?? "";
  if (/^\s*(fasted[\s-]*)?am\b/i.test(label)) return "fasted-am";
  if (/^\s*pm\b/i.test(label)) return "skill";
  return "training";
}

// ── Timeline entries ────────────────────────────────────────────────────────

export type TimelineEntry = {
  /** Stable row id — becomes testid `timeline-row-{id}`. */
  id: string;
  slot: RhythmSlot;
  title: string;
  detail: string | null;
  href: string;
  /** ScheduledItem.type for the TypeBadge; null on non-item rows. */
  itemType: string | null;
  /** Every goal claim this entry serves (R2 — no suppression), deduped.
   *  Order is not significant; the lane sorts by identity slot. */
  goalIds: string[];
  /** Logged-side receipt: true → the row's marks render FILLED. */
  filled: boolean;
};

export type TimelineWorkout = {
  title: string | null;
  exerciseNames: readonly string[];
};

export type TimelineScheduledItem = {
  id: string;
  goalId: string;
  type: string;
  title: string;
  detail?: string | null;
  status: string;
  /** Optional payload.rhythm passthrough — ResolvedDay does not surface the
   *  payload yet, so today this is always absent; the seam is wired for when
   *  it does (UXR-PV-16). */
  rhythm?: unknown;
};

export type TodayTimelineInput = {
  dateKey: string;
  activeWorkout: DayTemplate | null;
  plannedHike: {
    route: string;
    distanceMi: number;
    elevationFt: number;
  } | null;
  baselinesDue: readonly {
    testName: string;
    checkpoint: "initial" | "retest";
    logged: boolean;
  }[];
  scheduledItems: readonly TimelineScheduledItem[];
  nutritionPlan: NutritionPlan | null;
  loggedMealsCount: number;
  completedWorkouts: readonly TimelineWorkout[];
  /** Program member goals (ResolvedDay.program.memberGoals shape). */
  members: readonly AttributionMemberGoal[];
  /** ResolvedDay.goalMarks — the day-level claim vocabulary. */
  goalMarks: readonly { goalId: string; claims: readonly string[] }[];
  attributionRules: readonly AttributionRule[] | null;
  attributionHintsByGoal: ReadonlyMap<string, readonly string[]>;
};

// Scheduled-item statuses the timeline shows. Anything else (canceled,
// skipped, …) is the coach's bookkeeping, not a row the user should act on.
const ITEM_VISIBLE_STATUSES = new Set(["planned", "done", "completed"]);
const ITEM_DONE_STATUSES = new Set(["done", "completed"]);

// ── Fill matching (logged workout ↔ template block) ─────────────────────────

const TOKEN_STOPWORDS = new Set([
  "with",
  "then",
  "each",
  "into",
  "from",
  "block",
  "session",
  "day",
  "the",
  "and",
]);

function titleTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !TOKEN_STOPWORDS.has(w)),
  );
}

function canonSet(names: readonly string[]): Set<string> {
  return new Set(names.map((n) => canonicalExerciseName(n).toLowerCase()));
}

function blockExerciseNames(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) => b.exercises.map((e) => e.name));
}

/** Precise channel: the logged workout shares a canonical exercise name with
 *  the block(s). Works whenever the log carries exercises. */
function workoutSharesExercise(w: TimelineWorkout, blocks: readonly Block[]): boolean {
  if (w.exerciseNames.length === 0) return false;
  const logged = canonSet(w.exerciseNames);
  return blockExerciseNames(blocks).some((n) =>
    logged.has(canonicalExerciseName(n).toLowerCase()),
  );
}

/** Fuzzy channel — AM/PM rows only: title-token overlap with the block's own
 *  label + exercise names. Deliberately NOT applied to the session row (the
 *  session shares generic words like "incline" with the AM walk; a false
 *  receipt is worse than a hollow mark). */
function workoutTitleMatchesBlock(w: TimelineWorkout, blocks: readonly Block[]): boolean {
  if (!w.title) return false;
  const workoutTokens = titleTokens(w.title);
  if (workoutTokens.size === 0) return false;
  const blockText = blocks
    .map((b) => `${b.label ?? ""} ${b.exercises.map((e) => e.name).join(" ")}`)
    .join(" ");
  for (const token of titleTokens(blockText)) {
    if (workoutTokens.has(token)) return true;
  }
  return false;
}

// ── Claim derivation ────────────────────────────────────────────────────────

/** Which goals would this block-set link to if logged as-is? Reuses the
 *  production matcher so claims == prospective links, then unions the
 *  rotation-owning goal (a rotation-template block is inherently the plan
 *  owner's ask, even when no hint/rule names it). */
function blockClaims(
  blocks: readonly Block[],
  pseudoTitle: string | null,
  rotationOwnerGoalId: string | null,
  input: TodayTimelineInput,
): string[] {
  const linked = evaluateWorkoutLinks(
    {
      workoutTitle: pseudoTitle,
      exerciseNames: blockExerciseNames(blocks),
      source: null,
    },
    input.members,
    input.attributionHintsByGoal,
    input.attributionRules,
  );
  const out = new Set(linked);
  if (rotationOwnerGoalId) out.add(rotationOwnerGoalId);
  return [...out];
}

// ── The builder ─────────────────────────────────────────────────────────────

/**
 * Build the day's unified timeline. Returns [] when there is nothing to show
 * (the caller renders the timeline empty state). Rows are ordered by the
 * rhythm ladder; ties keep construction order. Completed rows KEEP their
 * position (UXR-PV-15 — never re-sort on completion).
 */
export function buildTodayTimeline(input: TodayTimelineInput): TimelineEntry[] {
  const dayHref = `/days/${input.dateKey}`;
  const entries: TimelineEntry[] = [];

  const rotationOwnerGoalId =
    input.goalMarks.find((m) => m.claims.includes("rotation"))?.goalId ?? null;

  // ── Template-derived rows (AM / session / PM) ──
  const blocks = input.activeWorkout?.blocks ?? [];
  const amBlocks: { block: Block; index: number }[] = [];
  const pmBlocks: { block: Block; index: number }[] = [];
  const sessionBlocks: Block[] = [];
  blocks.forEach((block, index) => {
    const slot = blockRhythm(block);
    if (slot === "fasted-am") amBlocks.push({ block, index });
    else if (slot === "skill") pmBlocks.push({ block, index });
    else sessionBlocks.push(block);
  });

  // Fill assignment — all matches are computed BEFORE any row is built so the
  // session's fallback can see every claim. Each row matches completed
  // workouts independently: an all-in-one log (walk + lifts + skill exported
  // as one workout) fills every row it truly covers, while a walk-only log
  // fills only the AM row. A workout that matches NO block row falls back to
  // the session (the day's main work is the honest default for an
  // unclassifiable log); when nothing matches anywhere and there is no
  // session row, nothing fills — a hollow mark is never a false receipt.
  const matchedWorkouts = new Set<TimelineWorkout>();
  const rowMatch = (rowBlocks: readonly Block[], fuzzyTitle: boolean): boolean => {
    let filled = false;
    for (const w of input.completedWorkouts) {
      if (
        workoutSharesExercise(w, rowBlocks) ||
        (fuzzyTitle && workoutTitleMatchesBlock(w, rowBlocks))
      ) {
        matchedWorkouts.add(w);
        filled = true;
      }
    }
    return filled;
  };
  const amFilled = amBlocks.map(({ block }) => rowMatch([block], true));
  const pmFilled = pmBlocks.map(({ block }) => rowMatch([block], true));
  const sessionExerciseFilled =
    sessionBlocks.length > 0 && rowMatch(sessionBlocks, false);
  const sessionFilled =
    sessionExerciseFilled ||
    (sessionBlocks.length > 0 &&
      input.completedWorkouts.some((w) => !matchedWorkouts.has(w)));

  amBlocks.forEach(({ block, index }, i) => {
    entries.push({
      id: `am-${index}`,
      slot: "fasted-am",
      title: block.label ?? "Morning block",
      detail: null,
      href: dayHref,
      itemType: null,
      goalIds: blockClaims([block], block.label ?? null, rotationOwnerGoalId, input),
      filled: amFilled[i],
    });
  });

  if (sessionBlocks.length > 0 && input.activeWorkout) {
    entries.push({
      id: "session",
      slot: "training",
      title: input.activeWorkout.title,
      detail:
        sessionBlocks
          .map((b) => b.label)
          .filter((l): l is string => !!l)
          .join(" · ") || null,
      href: dayHref,
      itemType: null,
      goalIds: blockClaims(
        sessionBlocks,
        input.activeWorkout.title,
        rotationOwnerGoalId,
        input,
      ),
      filled: sessionFilled,
    });
  }

  pmBlocks.forEach(({ block, index }, i) => {
    entries.push({
      id: `pm-${index}`,
      slot: "skill",
      title: block.label ?? "Evening block",
      detail: null,
      href: dayHref,
      itemType: null,
      goalIds: blockClaims([block], block.label ?? null, rotationOwnerGoalId, input),
      filled: pmFilled[i],
    });
  });

  // ── Planned hike (deferral-aware: on hike days the session stepped aside,
  //    so this is the day's main effort; research maps it to fasted-am) ──
  if (input.plannedHike) {
    entries.push({
      id: "hike",
      slot: "fasted-am",
      title: `Hike — ${input.plannedHike.route}`,
      detail: `${input.plannedHike.distanceMi} mi · ${input.plannedHike.elevationFt} ft`,
      href: dayHref,
      itemType: null,
      // The hike is the rotation plan's long effort — the plan owner's ask.
      goalIds: rotationOwnerGoalId ? [rotationOwnerGoalId] : [],
      // plannedHikeToday only reflects status:"planned" hikes, so a logged
      // hike drops the row rather than filling it (v1 limitation; the day
      // detail below the timeline carries the completed hike).
      filled: false,
    });
  }

  // ── Baselines due ──
  for (const b of input.baselinesDue) {
    const claimKey = `baseline:${b.testName}`;
    const claimants = input.goalMarks
      .filter((m) => m.claims.includes(claimKey))
      .map((m) => m.goalId);
    entries.push({
      id: `baseline-${b.testName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      slot: "due",
      title: b.testName,
      detail: b.checkpoint === "retest" ? "Retest due" : "Baseline due",
      href: dayHref,
      itemType: null,
      // A due test with no target-claiming goal is still the rotation plan's
      // own scheduling — fall back to the owner rather than an unmarked row.
      goalIds:
        claimants.length > 0
          ? claimants
          : rotationOwnerGoalId
            ? [rotationOwnerGoalId]
            : [],
      filled: b.logged,
    });
  }

  // ── Scheduled items (union across every member goal) ──
  for (const item of input.scheduledItems) {
    if (!ITEM_VISIBLE_STATUSES.has(item.status)) continue;
    entries.push({
      id: `item-${item.id}`,
      slot: parseRhythm(item.rhythm) ?? "anytime",
      title: item.title,
      detail: item.detail ?? null,
      href: dayHref,
      itemType: item.type,
      goalIds: [item.goalId],
      filled: ITEM_DONE_STATUSES.has(item.status),
    });
  }

  // ── Nutrition tier line ──
  const nutritionGoalIds = input.goalMarks
    .filter((m) => m.claims.includes("nutrition"))
    .map((m) => m.goalId);
  if (nutritionGoalIds.length > 0) {
    const planned = sumPlanTargetMacros(input.nutritionPlan);
    const parts: string[] = [];
    if (planned.calories > 0) parts.push(`${Math.round(planned.calories)} cal`);
    if (planned.proteinG > 0) parts.push(`${Math.round(planned.proteinG)} g protein`);
    const target = parts.length > 0 ? `${parts.join(" · ")} target` : null;
    const loggedLine = `${input.loggedMealsCount} ${
      input.loggedMealsCount === 1 ? "meal" : "meals"
    } logged`;
    entries.push({
      id: "fuel",
      slot: "fuel",
      title: "Nutrition",
      detail: target ? `${target} · ${loggedLine}` : loggedLine,
      href: "/nutrition",
      itemType: null,
      goalIds: nutritionGoalIds,
      filled: input.loggedMealsCount > 0,
    });
  }

  // Stable ladder sort — construction order breaks ties, completion never moves a row.
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rhythmRank(a.e.slot) - rhythmRank(b.e.slot) || a.i - b.i)
    .map(({ e }) => e);
}
