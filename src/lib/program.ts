import type { ProgramTemplate, DayTemplate, Phase } from "@/lib/program-template";
import { startOfDay, dateKey, parseDateKey } from "@/lib/calendar";
import { daysDelta, isInPlan } from "@/lib/rotation-core";
import { getDb } from "@/lib/db";
import { parseAttributionRules, type AttributionRule } from "@/lib/attribution-rules";

export type ActiveProgramSnapshot = {
  // FROZEN contract (#277 / plan §4.2): ALWAYS a Plan id, never a Program id.
  // ≈6 planId-keyed call sites depend on this (every PlanDayOverride lookup,
  // calendar.ts, override-integrity.ts). Program-shaped context lives in
  // ActiveProgramMembership below — this type must never grow a Program id
  // or membership field (keeps game/engine.ts decoupled from Program concepts).
  id: string;
  name: string;
  startedOn: Date;
  template: ProgramTemplate;
  // Track 2: high-water mark from Plan.confirmedThroughDate. null when no
  // weeks have been confirmed.
  confirmedThroughDate: Date | null;
};

/**
 * Program-shaped context for the active multi-domain Program (#277 / plan
 * §4.2). This is the ONLY place the Program's own id is exposed —
 * ActiveProgramSnapshot.id stays a Plan id, so consumers that need the
 * Program row (membership, attribution, the /program dashboard) opt into
 * this separate lookup instead of the day-resolution seam growing new fields.
 *
 * memberGoals returns ALL goals attached via Goal.programId, each carrying
 * its own `status` — consumers filter (e.g. the auto-link engine skips
 * non-active goals; achieved goals are detached at completion anyway, but a
 * defensive filter beats silently hiding attached rows here). Never leaks
 * userId.
 */
export type ActiveProgramMembership = {
  /** The Program's OWN id (not a Plan id — see the type doc above). */
  id: string;
  name: string;
  status: string;
  startedOn: Date;
  endsOn: Date | null;
  notes: string | null;
  /** Parsed + validated attributionRules, or null when unset/malformed
   *  (see parseAttributionRules — malformed Json never throws). */
  attributionRules: AttributionRule[] | null;
  memberGoals: { id: string; objective: string; kind: string; status: string }[];
};

// #285: TodayContext + getTodayContext were DELETED here. getTodayContext was
// a third, independent day-resolver (Math.round day math, weekIndex clamping,
// override-blind) duplicating what resolveDay already computes — the RFC's
// "three duplicate resolvers" cleanup. Callers read resolveDay's
// weekIndex/rotationDay and use the pure template lookups below for the
// phase / split-day equivalents.

/**
 * The seam (#277 / plan §4.2 — frozen external contract). Same signature and
 * return shape as ever: `ActiveProgramSnapshot | null`, `.id` is ALWAYS a
 * Plan id. Selection is now Program-first:
 *
 *  1. Active Program row exists (the partial unique index
 *     `program_one_active_per_user` guarantees ≤1 per user) → the day is
 *     owned by the Plan attached to THAT Program:
 *     `plan.findFirst({ active: true, programId })`, most-recently-updated
 *     wins if several are attached. Plan found → snapshot from it, exactly
 *     as before. No attached active Plan → **null** ("Program with no
 *     rotation" — a normal state: pure-project Programs, mid-transition).
 *     NEVER fall through to an unscoped `plan.findFirst({ active: true })` —
 *     multiple active Plans across goals is the normal steady state, so the
 *     fall-through would surface another goal's dormant plan as "the day"
 *     (the founding cross-goal leak bug this redesign exists to fix —
 *     plan-critique Critical #1).
 *
 *  2. No active Program AND zero Program rows for this user (never adopted
 *     Programs) → the legacy isFocus-desc tiebreak query, byte-identical to
 *     the pre-#277 behavior. This is the per-tenant rollout gate: tenants
 *     without Program rows are untouched by the seam flip.
 *
 *  3. No active Program but Program rows EXIST (all completed/archived/draft)
 *     → null via the Program-aware path. Subtlety, deliberate: "zero Program
 *     rows" means the user never adopted Programs (keep legacy behavior);
 *     "has Programs but none active" means the user RETIRED their program —
 *     they must not silently regress to isFocus-tiebreak day resolution.
 *     Rollback semantics follow: archiving the founder's Program row yields
 *     a safe "no rotation today" (this branch), while deleting the Program
 *     rows entirely restores full legacy behavior (branch 2).
 *
 * M1/#269 (unchanged): the LegacyProgram-table fallback stays deleted — a
 * stale active legacy row can never shadow Plan resolution.
 */
export async function getActiveProgram(): Promise<ActiveProgramSnapshot | null> {
  const db = await getDb();

  const program = await db.program.findFirst({ where: { status: "active" } });
  if (program) {
    // Program-owned rotation: ONLY a Plan attached to this Program may own
    // the day. No `where: { active: true }` fall-through — see doc comment.
    const plan = await db.plan.findFirst({
      where: { active: true, programId: program.id },
      orderBy: { updatedAt: "desc" },
    });
    if (!plan) return null; // Program with no rotation
    return {
      id: plan.id,
      name: plan.name,
      startedOn: plan.startedOn,
      template: plan.planJson as unknown as ProgramTemplate,
      confirmedThroughDate: plan.confirmedThroughDate ?? null,
    };
  }

  // No ACTIVE Program. Distinguish "never adopted" (zero rows → legacy path)
  // from "retired" (rows exist, none active → null). getDb() is
  // tenant-scoped, so count() is this user's rows only.
  const programRowCount = await db.program.count();
  if (programRowCount > 0) return null; // retired/dormant Program user

  // Zero Program rows: legacy pre-Program tenant. Byte-identical to the
  // pre-#277 query — prefer the focus goal's active Plan first (isFocus
  // desc), then any active plan (transition-safe while isFocus adoption
  // was incomplete).
  const plan = await db.plan.findFirst({
    where: { active: true },
    orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }],
  });
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    startedOn: plan.startedOn,
    template: plan.planJson as unknown as ProgramTemplate,
    confirmedThroughDate: plan.confirmedThroughDate ?? null,
  };
}

/**
 * Program-shaped context for the active Program, or null when the user has
 * no ACTIVE Program row (zero rows and retired-Program users alike — there
 * is no membership without an active Program). See ActiveProgramMembership's
 * type doc for the shape contract; the Program's own id lives ONLY here.
 *
 * Deliberately a separate lookup from getActiveProgram(): the seam stays
 * frozen (`.id` = Plan id, no new fields) while Program consumers
 * (attribution engine, /program dashboard, program MCP pack) get the full
 * Program row + membership here. An active Program with no rotation
 * (getActiveProgram() → null) still HAS membership — the chewgether shape.
 */
export async function getActiveProgramMembership(): Promise<ActiveProgramMembership | null> {
  const db = await getDb();

  const program = await db.program.findFirst({ where: { status: "active" } });
  if (!program) return null;

  // All attached goals, any status, explicit select (never leaks userId).
  // createdAt asc = stable, attachment-ordered listing. The id tiebreak makes
  // the order TOTAL — two goals seeded in the same second must not swap
  // positions between renders, because goal-identity.ts derives each goal's
  // mark slot (● ■ ▲) from this order (UXR-PV-04).
  const memberGoals = await db.goal.findMany({
    where: { programId: program.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, objective: true, kind: true, status: true },
  });

  return {
    id: program.id,
    name: program.name,
    status: program.status,
    startedOn: program.startedOn,
    endsOn: program.endsOn ?? null,
    notes: program.notes ?? null,
    attributionRules: parseAttributionRules(program.attributionRules),
    memberGoals,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// #298/#301 (isFocus sweep) — the ROTATION-OWNING GOAL + membership-first
// ordering. Pure additions; nothing above changes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Result of getRotationOwnerGoal(). Callers branch on `mode`, never on
 * goalId truthiness:
 *
 *  - mode "program": Program rows exist for this tenant — resolution is
 *    Program-semantics and must NEVER regress to isFocus. `goalId`/`planId`
 *    name the rotation-owning goal and the Plan that makes it so (the active
 *    Program's attached active Plan — Plan.goalId is non-nullable, so the
 *    pair is always both-set or both-null). Both null means "no rotation
 *    owner today": an active Program with no attached active Plan (pure-
 *    project Programs, mid-transition) or Program rows that are all
 *    retired/draft — same reasoning as getActiveProgram branches 1 and 3.
 *  - mode "legacy": ZERO Program rows (the per-tenant rollout gate, same as
 *    the seam). `goalId` is the legacy focus-goal winner — isFocus=true,
 *    findFirst(updatedAt desc), goal-focus.ts's documented deterministic-
 *    winner idiom for the (DB-unconstrained) multi-focus state — or null
 *    when no goal holds focus. `planId` is always null here.
 *
 * `goalKind` carries the resolved goal's kind (both modes) so single-goal
 * consumers that route on kind (hike attribution) don't need a second fetch.
 */
export type RotationOwnerResolution = {
  mode: "program" | "legacy";
  goalId: string | null;
  goalKind: string | null;
  planId: string | null;
};

/**
 * #298/#301: "the goal whose prescription drives today" — the single-goal
 * replacement for direct `isFocus: true` reads. Mirrors getActiveProgram's
 * three branches exactly (active Program → its attached active Plan's goal;
 * Program rows but none active → no owner; zero rows → legacy isFocus
 * resolution), so this and the seam can never disagree about which Plan owns
 * the day. See RotationOwnerResolution above for the contract.
 */
export async function getRotationOwnerGoal(): Promise<RotationOwnerResolution> {
  const db = await getDb();

  const program = await db.program.findFirst({ where: { status: "active" } });
  if (program) {
    // Same selection as getActiveProgram branch 1: ONLY a Plan attached to
    // THIS Program may own the day; most-recently-updated wins. No unscoped
    // fall-through (the founding cross-goal leak — plan-critique Critical #1).
    const plan = await db.plan.findFirst({
      where: { active: true, programId: program.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, goalId: true, goal: { select: { kind: true } } },
    });
    return {
      mode: "program",
      goalId: plan?.goalId ?? null,
      goalKind: plan?.goal.kind ?? null,
      planId: plan?.id ?? null,
    };
  }

  // No ACTIVE Program. "Retired" (rows exist) stays Program-semantics with no
  // owner — never a silent regression to isFocus (getActiveProgram branch 3).
  const programRowCount = await db.program.count();
  if (programRowCount > 0) {
    return { mode: "program", goalId: null, goalKind: null, planId: null };
  }

  // Zero Program rows: the legacy focus-goal winner, centralized here so the
  // #298 domain files carry no direct isFocus filters of their own.
  const focusGoal = await db.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, kind: true },
  });
  return {
    mode: "legacy",
    goalId: focusGoal?.id ?? null,
    goalKind: focusGoal?.kind ?? null,
    planId: null,
  };
}

/**
 * #298/#301: membership-first ordering for multi-goal LIST contexts ("what's
 * in play") — the rotation-owning goal first, then the active Program's other
 * member goals, then non-members. Pure + stable: rows within the same tier
 * keep their incoming order, so callers express secondary tiebreaks via the
 * DB orderBy they fetched with (exactly how `isFocus: "desc"` used to compose
 * with them).
 *
 * Also expresses the legacy single-goal lift: an empty `memberGoalIds` plus
 * the legacy focus-goal id as `rotationOwnerGoalId` reproduces the healthy-
 * state `orderBy: [{ isFocus: "desc" }, ...rest]` result (one focus row to
 * the front, everything else in DB order).
 */
export function orderMembersFirst<T extends { id: string }>(
  rows: readonly T[],
  memberGoalIds: ReadonlySet<string>,
  rotationOwnerGoalId: string | null,
): T[] {
  const tier = (id: string): number =>
    rotationOwnerGoalId !== null && id === rotationOwnerGoalId
      ? 0
      : memberGoalIds.has(id)
        ? 1
        : 2;
  return [...rows].sort((a, b) => tier(a.id) - tier(b.id));
}

/**
 * Fallback for the game engine (engine.ts's program-fallback, REQ-004c):
 * the most-recently-updated Plan regardless of `active`. Used ONLY when
 * getActiveProgram() returns null (e.g. right after completeGoalCore
 * deactivates the goal's plan(s) — the character page must keep showing the
 * founder's historical XP/level instead of wiping to emptyState()).
 *
 * Mirrors getActiveProgram's snapshot shape exactly — the only difference is
 * dropping the `active: true` filter and ordering purely by `updatedAt desc`
 * ("most recently updated", full stop; no isFocus tiebreak — that tiebreak in
 * getActiveProgram exists for the multi-active-plan transition case, which
 * doesn't apply here). Zero Plan rows → null (M1/#269: the LegacyProgram
 * fallback was deleted here too).
 *
 * getActiveProgram() itself is untouched — this is a separate, explicit
 * fallback the caller opts into, never an implicit change to "the" active
 * program lookup.
 *
 * #277 decision — deliberately NOT given the Program-first treatment (issue
 * AC scopes it out; the reasoning, from its single caller,
 * game/engine.ts:1012 `getActiveProgram() ?? getMostRecentProgram()`):
 * the engine's semantic is "keep showing historical XP/level after
 * completion/retirement instead of wiping /character to emptyState()", and
 * it consumes template + startedOn only — never overrides or 'the day'.
 * Filtering by Program membership here would break exactly that continuity
 * for a user whose historical Plans predate (or sit outside) their Program
 * — e.g. the founder retiring a Program must not blank the character page.
 * "Most-recently-updated Plan, full stop" is the history-preserving pick;
 * a user with zero Plans ever (the pure-project chewgether shape) still
 * gets null → emptyState, which is correct for a user who never had a
 * rotation. Note the seam flip does widen this fallback's reach: an active
 * Program with no rotation now makes getActiveProgram() null, so the engine
 * lands here and may read a NON-member Plan's window — acceptable because
 * it feeds only historical XP display, never day resolution or overrides.
 */
export async function getMostRecentProgram(): Promise<ActiveProgramSnapshot | null> {
  const db = await getDb();
  const plan = await db.plan.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    startedOn: plan.startedOn,
    template: plan.planJson as unknown as ProgramTemplate,
    confirmedThroughDate: plan.confirmedThroughDate ?? null,
  };
}

/**
 * #285: pure TEMPLATE lookup — which phase does a (resolveDay-computed)
 * weekIndex fall in? No date math, no IO; the day-resolution itself lives
 * exclusively in resolveDay now.
 *
 * Fallback semantics preserved from the deleted getTodayContext for in-plan
 * dates: a malformed template (non-array phases) yields null; a weekIndex no
 * phase claims falls back to the first phase. A null weekIndex (out-of-plan
 * date) yields null — the old function's clamped phantom phase on
 * out-of-plan dates is deliberately gone.
 */
export function phaseForWeekIndex(
  template: ProgramTemplate,
  weekIndex: number | null,
): Phase | null {
  if (weekIndex === null) return null;
  // Defensive: a malformed snapshot (e.g., a stringified template that
  // accidentally got persisted as a character-indexed object) shouldn't take
  // the page down. Treat phases as optional.
  const phasesArr = Array.isArray(template?.phases) ? template.phases : [];
  return (
    phasesArr.find((p) => Array.isArray(p?.weeks) && p.weeks.includes(weekIndex)) ??
    phasesArr[0] ??
    null
  );
}

/**
 * #285: pure TEMPLATE lookup — the weeklySplit entry for a
 * (resolveDay-computed) rotation day. Same contract notes as
 * phaseForWeekIndex above: no date math, getTodayContext's in-plan fallback
 * (?? first split day) preserved, null rotationDay (out-of-plan) → null.
 * The template's `weeklySplit[].dayOfWeek` is the rotation index (1..7),
 * NOT a calendar weekday.
 *
 * Distinct from calendar.ts's templateForRotationDay(program, date), which
 * takes a DATE and re-derives the rotation index; this one takes the already
 * resolved index — use it when you hold a ResolvedDay.
 */
export function splitDayForRotationDay(
  template: ProgramTemplate,
  rotationDay: number | null,
): DayTemplate | null {
  if (rotationDay === null) return null;
  const weeklySplitArr = Array.isArray(template?.weeklySplit) ? template.weeklySplit : [];
  return weeklySplitArr.find((d) => d?.dayOfWeek === rotationDay) ?? weeklySplitArr[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// REQ-001 (Goal Story & Time-Aware History, Stage A1) — time-aware program
// lookup for arbitrary dates. getActiveProgram/getMostRecentProgram above
// are UNTOUCHED; this is a separate, additive lookup that callers (resolveDay,
// getCalendarMonth, get_week) opt into for past-date resolution.
// ─────────────────────────────────────────────────────────────────────────

/** A program snapshot annotated with where it came from — the live active
 *  plan, or an archived plan resurfaced because it covered a past date. */
export type ProgramForDate = ActiveProgramSnapshot & { source: "active" | "archived" };

/** A candidate plan window for past-date coverage checks — an
 *  ActiveProgramSnapshot plus the flags pickProgramForDate needs to order and
 *  clamp it (S3 ordering, S4 completion clamp). Produced by
 *  getPlanWindowCandidates(); shared later by the month view / get_week. */
export type PlanWindowCandidate = ActiveProgramSnapshot & {
  active: boolean;
  goalStatus: string;
  goalCompletedAt: Date | null;
};

/**
 * Pure coverage check — rotation-core's daysDelta/isInPlan (B4/A3: the same
 * canonical math resolveDay uses):
 * covered = 0 <= daysDelta(startedOn, target) < template.totalWeeks * 7.
 *
 * S4 clamp: when `goalCompletedAt` is provided, the window's effective end is
 * clamped to the completion day itself — the completion day IS covered, the
 * day after is NOT (no phantom never-followed prescription past the summit).
 * Expressed as `targetMid <= startOfDay(goalCompletedAt)` rather than
 * computing a separate "day after" cursor — equivalent and needs no extra
 * date-math helper.
 *
 * Not exported — an internal helper shared by getProgramForDate's fast-path
 * check and pickProgramForDate's candidate filter.
 */
function coversDayKey(
  program: { startedOn: Date; template: ProgramTemplate },
  targetDayKey: string,
  goalCompletedAt?: Date | null,
): boolean {
  const targetMid = parseDateKey(targetDayKey); // === startOfDay(that date)
  if (!isInPlan(daysDelta(program.startedOn, targetMid), program.template.totalWeeks)) {
    return false;
  }
  if (goalCompletedAt && targetMid.getTime() > startOfDay(goalCompletedAt).getTime()) return false;
  return true;
}

/**
 * Pure — no IO. Shared by resolveDay's per-date lookup (getProgramForDate)
 * and, later, the month view / get_week (which fetch `candidates` once per
 * range/week and call this per cell/day instead of re-querying).
 *
 * Contract (D1 + S3 + S4, binding):
 *  1. If `activeProgram` covers `dayKey` → return it as {source:"active"}.
 *     This is the Today-page contract: whenever this branch hits, the result
 *     is byte-identical to what getActiveProgram() (and resolveDay's Today
 *     path on top of it) produce — applies to past, today, and future dates
 *     alike.
 *  2. Otherwise, ONLY when `dayKey < todayKey` (strictly past, USER_TZ dateKey
 *     string compare — never raw Date comparison): search `candidates` for
 *     ones whose window covers `dayKey` (S4-clamped per candidate). Among
 *     covering candidates, order active-covering first, then achieved-goal
 *     plans before non-achieved-goal plans (SMOKE-3 — see pickCoveringWinner's
 *     doc comment below for why), then startedOn desc. The updatedAt desc
 *     tiebreak (S3) is achieved by *sort stability*, not a field on the
 *     comparator: getPlanWindowCandidates() returns candidates pre-ordered
 *     `updatedAt desc` at the DB level (as documented on that function), and
 *     Array.prototype.sort is a stable sort (guaranteed by spec since ES2019 /
 *     V8 7.0, well within this repo's Node runtime) — so when two candidates
 *     tie on `active`, achieved-status, and `startedOn`, their relative order
 *     from the incoming (updatedAt-desc) list is preserved. Callers who don't
 *     go through getPlanWindowCandidates() must pre-sort by updatedAt desc
 *     themselves for the tiebreak to hold; ties left unresolved (no
 *     candidates, or a caller that didn't pre-sort) simply return the first
 *     covering candidate in input order.
 *  3. Fall through (today/future dayKey, or a past dayKey with no covering
 *     candidate): return `activeProgram` as {source:"active"} when present,
 *     else null. Bit-identical to today's out-of-plan/active behavior.
 *
 * M1/#269: the old SMOKE-1 special case (a legacy Program-table fallback row
 * losing to a covering real-Plan candidate on past dates) was deleted along
 * with getActiveProgram()'s LegacyProgram fallback. `activeProgram` is now
 * always a real Plan snapshot (or null), and a real Plan's id always appears
 * among `candidates` for same-scope callers (getPlanWindowCandidates()
 * fetches every Plan row, active or not) — so the legacy id-membership check
 * had no remaining input that could trigger it.
 */
export function pickProgramForDate(
  candidates: PlanWindowCandidate[],
  dayKey: string,
  todayKey: string,
  activeProgram: ActiveProgramSnapshot | null,
): ProgramForDate | null {
  const isPast = dayKey < todayKey;
  const covering = isPast
    ? candidates.filter((c) => coversDayKey(c, dayKey, c.goalCompletedAt))
    : [];

  // Picks the covering-candidate winner (S3 ordering, extended by SMOKE-3) —
  // returns the raw PlanWindowCandidate (not yet trimmed to ProgramForDate)
  // so callers can both build the snapshot and inspect `winner.active` for
  // labeling.
  //
  // SMOKE-3: a date can be double-covered by two archived candidates
  // belonging to *different* goals (e.g. an earlier-started plan whose goal
  // was later ACHIEVED, and a later-started plan whose goal is still active
  // but was paused/dormant on that date). `active desc, startedOn desc` alone
  // picks the later-started plan regardless of which goal actually ran that
  // day — wrong when the later plan was just sitting dormant. So an
  // achieved-goal's archived plan now outranks a non-achieved-goal's plan
  // (both non-`active`, ordered before the startedOn tiebreak): a goal marked
  // ACHIEVED means its plan was actually run to completion through that date,
  // whereas a paused/inactive plan belonging to a still-active goal was most
  // likely dormant on that date, not the one being followed. Final ordering:
  //   1. `active` first (unchanged),
  //   2. achieved-goal plans before non-achieved-goal plans (SMOKE-3, new),
  //   3. `startedOn desc` (unchanged),
  //   4. stable-sort tiebreak on the incoming updatedAt-desc order (unchanged).
  // Stable sort: ties (equal on all three fields above) preserve the incoming
  // order, which getPlanWindowCandidates() pre-sorts updatedAt desc — see the
  // doc comment above for the full reasoning.
  const pickCoveringWinner = (): PlanWindowCandidate => {
    const ordered = [...covering].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const aAchieved = a.goalStatus === "achieved";
      const bAchieved = b.goalStatus === "achieved";
      if (aAchieved !== bAchieved) return aAchieved ? -1 : 1;
      return b.startedOn.getTime() - a.startedOn.getTime();
    });
    return ordered[0]!;
  };
  const toProgramForDate = (
    winner: PlanWindowCandidate,
    source: "active" | "archived",
  ): ProgramForDate => ({
    id: winner.id,
    name: winner.name,
    startedOn: winner.startedOn,
    template: winner.template,
    confirmedThroughDate: winner.confirmedThroughDate,
    source,
  });

  if (activeProgram && coversDayKey(activeProgram, dayKey)) {
    return {
      id: activeProgram.id,
      name: activeProgram.name,
      startedOn: activeProgram.startedOn,
      template: activeProgram.template,
      confirmedThroughDate: activeProgram.confirmedThroughDate,
      source: "active",
    };
  }

  if (covering.length > 0) {
    return toProgramForDate(pickCoveringWinner(), "archived");
  }

  if (activeProgram) {
    return {
      id: activeProgram.id,
      name: activeProgram.name,
      startedOn: activeProgram.startedOn,
      template: activeProgram.template,
      confirmedThroughDate: activeProgram.confirmedThroughDate,
      source: "active",
    };
  }
  return null;
}

/**
 * DB fetch (getDb()-scoped) of every plan as a coverage-check candidate —
 * reused by pickProgramForDate's archived-fallback branch, and later by the
 * month view + get_week (D1/S1: they fetch this ONCE per range/week instead
 * of once per day/cell). Ordered `updatedAt desc` — see pickProgramForDate's
 * doc comment for why that ordering is load-bearing (S3 tiebreak via sort
 * stability, not a comparator field).
 *
 * planJson is cast to ProgramTemplate exactly like getActiveProgram does
 * (unvalidated — same trust boundary as the rest of this module).
 */
export async function getPlanWindowCandidates(): Promise<PlanWindowCandidate[]> {
  const db = await getDb();
  const plans = await db.plan.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      startedOn: true,
      planJson: true,
      confirmedThroughDate: true,
      active: true,
      goal: { select: { status: true, completedAt: true } },
    },
  });
  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    startedOn: plan.startedOn,
    template: plan.planJson as unknown as ProgramTemplate,
    confirmedThroughDate: plan.confirmedThroughDate ?? null,
    active: plan.active,
    goalStatus: plan.goal.status,
    goalCompletedAt: plan.goal.completedAt ?? null,
  }));
}

/**
 * Time-aware program lookup for an arbitrary date (D1 + S3 + S4, binding).
 * Thin db wrapper — all coverage/ordering/past-gate logic lives in the pure
 * pickProgramForDate, which this calls.
 *
 * - `date` covered by the active program (today, future, or past) → that
 *   program, {source:"active"}. Byte-identical to the existing Today path.
 * - Otherwise, only for a strictly-past `date` (USER_TZ dateKey compare via
 *   `now`): resurface the covering archived plan, {source:"archived"}.
 * - Else: fall through to the active program (or null if none exists) —
 *   today's out-of-plan/active behavior, unchanged.
 *
 * The candidate query is skipped whenever it cannot matter: today/future
 * dates (pickProgramForDate never consults candidates there), and past dates
 * the active program already covers (step 1 wins before candidates are ever
 * considered). M1/#269 restored the covered-past-date skip — it had been
 * disabled only so the (now deleted) SMOKE-1 legacy check could run its
 * id-membership test against the full candidate list.
 */
export async function getProgramForDate(
  date: Date,
  now: Date = new Date(),
): Promise<ProgramForDate | null> {
  const activeProgram = await getActiveProgram();
  const dayKey = dateKey(date);
  const todayKey = dateKey(now);

  const mightNeedArchived =
    dayKey < todayKey && !(activeProgram && coversDayKey(activeProgram, dayKey));
  const candidates = mightNeedArchived ? await getPlanWindowCandidates() : [];

  return pickProgramForDate(candidates, dayKey, todayKey, activeProgram);
}
