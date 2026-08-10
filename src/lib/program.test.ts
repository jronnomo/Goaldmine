// src/lib/program.test.ts
//
// Coverage for REQ-001 (Goal Story & Time-Aware History, Stage A1):
// getProgramForDate + pickProgramForDate — the time-aware covering-plan
// lookup that lets past days/weeks/months resolve against the plan that was
// actually active back then, instead of always hardcoding today's active
// plan (calendar.ts:830's getActiveProgram()).
//
// House convention: vi.mock("@/lib/db") dual-export (prisma + getDb).
//
// pickProgramForDate is pure (no IO) — ordering (S3), window-boundary, and
// S4-completion-clamp cases are exercised directly against it, which is both
// faster and pins down the exact contract independent of DB wiring.
// getProgramForDate wires getActiveProgram() + getPlanWindowCandidates()
// (both DB-backed, via getDb()) through pickProgramForDate — the
// Today-contract, "no plans", and USER_TZ-past-gate cases go through the
// full function with a mocked @/lib/db so the DB round-trips themselves are
// covered (including the "skip the archived query when it can't matter"
// fast path).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/db";
import {
  getActiveProgram,
  getMostRecentProgram,
  getProgramForDate,
  pickProgramForDate,
  type ActiveProgramSnapshot,
  type PlanWindowCandidate,
} from "@/lib/program";
import { parseDateKey } from "@/lib/calendar";
import type { ProgramTemplate } from "@/lib/program-template";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

// ─── Fixtures ───────────────────────────────────────────────────────────────

function template(totalWeeks: number): ProgramTemplate {
  return { totalWeeks } as unknown as ProgramTemplate;
}

function snapshot(overrides: Partial<ActiveProgramSnapshot> = {}): ActiveProgramSnapshot {
  return {
    id: "plan-active",
    name: "Active Plan",
    startedOn: parseDateKey("2026-01-01"),
    template: template(4), // 28 days: 2026-01-01 .. 2026-01-28 inclusive
    confirmedThroughDate: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<PlanWindowCandidate> = {}): PlanWindowCandidate {
  return {
    ...snapshot(),
    id: "plan-candidate",
    active: false,
    goalStatus: "achieved",
    goalCompletedAt: null,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkScopedDb(overrides: Record<string, any> = {}) {
  // M1/#269: no legacyProgram accessor here on purpose — program.ts must
  // never touch the LegacyProgram table anymore; if a regression reintroduces
  // a read, these mocks throw (undefined accessor) instead of masking it.
  return {
    plan: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

// A realistic LegacyProgram DB row for the #269 regression tests — seeded
// into an explicit `legacyProgram` mock to prove the row is IGNORED (the
// accessor is never even called), not merely out-ranked.
function legacyProgramDbRow() {
  return {
    id: "legacy-program-row",
    name: "Legacy Seeded Program",
    startedOn: parseDateKey("2026-01-01"),
    phase: 1,
    week: 1,
    day: 1,
    version: 1,
    active: true,
    planJson: template(4),
    userId: "usr_founder",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

// Mirrors the raw Plan row shape getActiveProgram/getPlanWindowCandidates
// read (planJson → template cast, goal.status/completedAt) so fixtures
// declared once as an ActiveProgramSnapshot can be replayed through the DB
// mocks.
function planDbRow(
  s: ActiveProgramSnapshot,
  extra: {
    active?: boolean;
    updatedAt?: Date;
    goal?: { status: string; completedAt: Date | null };
  } = {},
) {
  return {
    id: s.id,
    name: s.name,
    startedOn: s.startedOn,
    planJson: s.template,
    confirmedThroughDate: s.confirmedThroughDate,
    active: extra.active ?? true,
    updatedAt: extra.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
    goal: extra.goal ?? { status: "active", completedAt: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── pickProgramForDate (pure) ──────────────────────────────────────────────

describe("pickProgramForDate (pure)", () => {
  it("active program covering the date wins — the Today-page contract", () => {
    const active = snapshot();
    const result = pickProgramForDate([], "2026-01-15", "2026-01-15", active);
    expect(result).toEqual({ ...active, source: "active" });
  });

  it("today/future date NOT covered by active never falls back to an archived candidate", () => {
    // active only covers March; archived candidate covers the requested
    // (today) date — must still resolve to active, never archived.
    const active = snapshot({ startedOn: parseDateKey("2026-03-01") });
    const archived = candidate({ id: "plan-archived", startedOn: parseDateKey("2026-01-01") });
    const result = pickProgramForDate([archived], "2026-01-15", "2026-01-15", active);
    expect(result).toEqual({ ...active, source: "active" });
  });

  it("no active program and no covering candidate → null", () => {
    const result = pickProgramForDate([], "2026-01-15", "2026-02-01", null);
    expect(result).toBeNull();
  });

  it("past date with a single covering archived candidate resolves as source:archived", () => {
    const active = snapshot({ id: "plan-active", startedOn: parseDateKey("2026-03-01") });
    const archived = candidate({ id: "plan-archived", startedOn: parseDateKey("2026-01-01") });
    const result = pickProgramForDate([archived], "2026-01-15", "2026-02-01", active);
    expect(result).toEqual({
      id: "plan-archived",
      name: archived.name,
      startedOn: archived.startedOn,
      template: archived.template,
      confirmedThroughDate: archived.confirmedThroughDate,
      source: "archived",
    });
  });

  it("S3 ordering: among two covering candidates, startedOn desc wins over input order", () => {
    // `newer` started later than `older` but is placed SECOND in the input
    // array — if the comparator fell back to "first in array wins" instead
    // of comparing startedOn, `older` would win. It must not.
    const older = candidate({ id: "plan-older", startedOn: parseDateKey("2026-01-01") });
    const newer = candidate({ id: "plan-newer", startedOn: parseDateKey("2026-01-10") });
    const result = pickProgramForDate([older, newer], "2026-01-15", "2026-02-01", null);
    expect(result?.id).toBe("plan-newer");
  });

  it("S3 tiebreak: equal startedOn ties resolve via stable-sort input order (caller pre-sorts updatedAt desc)", () => {
    // getPlanWindowCandidates() is documented to return candidates
    // `updatedAt desc` — pickProgramForDate's comparator only breaks ties on
    // `active`/`startedOn` and returns 0 otherwise, so Array.sort's
    // guaranteed stability preserves the incoming updatedAt-desc order for
    // same-startedOn candidates. Simulate that ordering here: the
    // more-recently-updated plan is passed first.
    const startedOn = parseDateKey("2026-01-01");
    const moreRecentlyUpdated = candidate({ id: "plan-recent", startedOn });
    const staler = candidate({ id: "plan-stale", startedOn });
    const result = pickProgramForDate(
      [moreRecentlyUpdated, staler],
      "2026-01-15",
      "2026-02-01",
      null,
    );
    expect(result?.id).toBe("plan-recent");
  });

  it("S3: an active-flagged candidate wins over a later-started non-active one", () => {
    const activeFlagged = candidate({
      id: "plan-active-flag",
      startedOn: parseDateKey("2026-01-01"),
      active: true,
    });
    const laterStarted = candidate({
      id: "plan-later",
      startedOn: parseDateKey("2026-01-10"),
      active: false,
    });
    const result = pickProgramForDate(
      [activeFlagged, laterStarted],
      "2026-01-15",
      "2026-02-01",
      null,
    );
    expect(result?.id).toBe("plan-active-flag");
  });

  // ─── SMOKE-3: achieved-goal plans outrank paused active-goal plans ────────
  //
  // Live repro: a date can be double-covered by two archived candidates
  // belonging to different goals — an earlier-started plan whose goal was
  // later ACHIEVED (the program actually followed through that date), and a
  // later-started plan whose goal is still active but was paused/dormant
  // since creation. Pre-fix ordering (active desc, then startedOn desc alone)
  // picked the later-started paused plan — wrong. These pin the new tier
  // between `active` and `startedOn desc`.

  it("SMOKE-3: achieved-goal plan (earlier start) outranks a later-started plan whose goal is still active/paused", () => {
    const achievedPlan = candidate({
      id: "plan-achieved",
      startedOn: parseDateKey("2026-01-01"),
      goalStatus: "achieved",
    });
    const pausedActiveGoalPlan = candidate({
      id: "plan-paused",
      startedOn: parseDateKey("2026-01-10"),
      goalStatus: "active",
    });
    const result = pickProgramForDate(
      [achievedPlan, pausedActiveGoalPlan],
      "2026-01-15",
      "2026-02-01",
      null,
    );
    expect(result?.id).toBe("plan-achieved");
  });

  it("SMOKE-3: two achieved-goal plans both covering → startedOn desc still decides", () => {
    const olderAchieved = candidate({
      id: "plan-achieved-older",
      startedOn: parseDateKey("2026-01-01"),
      goalStatus: "achieved",
    });
    const newerAchieved = candidate({
      id: "plan-achieved-newer",
      startedOn: parseDateKey("2026-01-10"),
      goalStatus: "achieved",
    });
    const result = pickProgramForDate(
      [olderAchieved, newerAchieved],
      "2026-01-15",
      "2026-02-01",
      null,
    );
    expect(result?.id).toBe("plan-achieved-newer");
  });

  it("window boundary: the startedOn day itself is covered", () => {
    const p = candidate({ startedOn: parseDateKey("2026-01-01"), template: template(4) });
    const result = pickProgramForDate([p], "2026-01-01", "2026-06-01", null);
    expect(result?.source).toBe("archived");
  });

  it("window boundary: startedOn + totalWeeks*7 - 1 days (last in-window day) is covered", () => {
    const p = candidate({ startedOn: parseDateKey("2026-01-01"), template: template(4) }); // 28 days: delta 0..27
    const result = pickProgramForDate([p], "2026-01-28", "2026-06-01", null); // delta 27
    expect(result?.source).toBe("archived");
  });

  it("window boundary: startedOn + totalWeeks*7 days is OUT of window", () => {
    const p = candidate({ startedOn: parseDateKey("2026-01-01"), template: template(4) });
    const result = pickProgramForDate([p], "2026-01-29", "2026-06-01", null); // delta 28
    expect(result).toBeNull();
  });

  it("S4 clamp: the completion day itself is still covered", () => {
    const p = candidate({
      startedOn: parseDateKey("2026-01-01"),
      template: template(12), // long raw window so the clamp is the binding constraint
      goalStatus: "achieved",
      goalCompletedAt: parseDateKey("2026-01-15"),
    });
    const result = pickProgramForDate([p], "2026-01-15", "2026-06-01", null);
    expect(result?.source).toBe("archived");
  });

  it("S4 clamp: the day AFTER completion is NOT covered — falls through to active/null, not to this archived lens", () => {
    const p = candidate({
      startedOn: parseDateKey("2026-01-01"),
      template: template(12),
      goalStatus: "achieved",
      goalCompletedAt: parseDateKey("2026-01-15"),
    });

    const resultNoActive = pickProgramForDate([p], "2026-01-16", "2026-06-01", null);
    expect(resultNoActive).toBeNull();

    // Falls through to whatever IS active (a different, unrelated plan) —
    // never a phantom never-followed prescription from the completed goal's
    // plan past its summit day.
    const stillActive = snapshot({
      id: "plan-still-active",
      startedOn: parseDateKey("2025-01-01"),
      template: template(1), // doesn't cover 2026-01-16 either — proves it's a genuine fall-through
    });
    const resultWithActive = pickProgramForDate([p], "2026-01-16", "2026-06-01", stillActive);
    expect(resultWithActive).toEqual({ ...stillActive, source: "active" });
  });

  // ─── Simplified contract after M1/#269 (SMOKE-1 branch deleted) ───────────
  //
  // getActiveProgram() no longer reads the LegacyProgram table, so
  // `activeProgram` is always a real Plan snapshot (or null) — the old
  // SMOKE-1 special case (id-membership check demoting a legacy-fallback
  // active row on past dates) is gone. These pin the restored single-path
  // contract: a covering activeProgram wins step 1 unconditionally; candidate
  // id-membership is never consulted.

  it("a covering activeProgram wins a past date as source:active even when its id is absent from candidates (no id-membership check — one resolution path)", () => {
    // Pre-#269, this exact input (id ∉ candidates + covering candidate) was
    // the legacy-fallback signal and the candidate won. Post-#269 the
    // activeProgram can only be a real Plan, so step 1 wins unconditionally —
    // callers that pass partial candidate lists get the Today contract back.
    const active = snapshot({ id: "plan-not-in-candidates" });
    const other = candidate({ id: "plan-other", active: false });
    const result = pickProgramForDate([other], "2026-01-15", "2026-02-01", active);
    expect(result).toEqual({ ...active, source: "active" });
  });

  it("TODAY covered by the activeProgram → active wins over a covering candidate (unchanged)", () => {
    const active = snapshot({ id: "plan-today-active" });
    const realPlan = candidate({ id: "plan-real", active: false });
    const result = pickProgramForDate([realPlan], "2026-01-15", "2026-01-15", active);
    expect(result).toEqual({ ...active, source: "active" });
  });

  it("past date + activeProgram + NO covering candidate → active fall-through still wins (unchanged)", () => {
    const active = snapshot({ id: "plan-solo-active" });
    // No candidates at all — e.g. a caller that fetched none.
    const result = pickProgramForDate([], "2026-01-15", "2026-02-01", active);
    expect(result).toEqual({ ...active, source: "active" });
  });

  it("realistic wiring: past date covered by the active Plan, which also appears among candidates → active wins as source:active", () => {
    const realActive = snapshot({ id: "plan-real-active" });
    // The active Plan always appears among candidates in production
    // (getPlanWindowCandidates fetches every Plan row, active or not).
    const asCandidate = candidate({
      id: "plan-real-active",
      startedOn: realActive.startedOn,
      template: realActive.template,
      active: true,
    });
    const result = pickProgramForDate([asCandidate], "2026-01-15", "2026-02-01", realActive);
    expect(result).toEqual({ ...realActive, source: "active" });
  });
});

// ─── getProgramForDate (db-integrated) ──────────────────────────────────────

describe("getProgramForDate (db-integrated)", () => {
  it("active program covering TODAY → identical to getActiveProgram's snapshot, source active, and skips the candidate query (hot path)", async () => {
    const active = snapshot();
    const planFindFirst = vi.fn().mockResolvedValue(planDbRow(active));
    const planFindMany = vi.fn().mockResolvedValue([]);
    mockGetDb.mockResolvedValue(
      mkScopedDb({ plan: { findFirst: planFindFirst, findMany: planFindMany } }),
    );

    // Same dateKey for date and now → not "past" → the SMOKE-1 legacy check
    // (which needs the full candidate list) never applies, so the query stays
    // skipped, exactly as before this fix.
    const result = await getProgramForDate(parseDateKey("2026-01-15"), parseDateKey("2026-01-15"));

    expect(result).toEqual({ ...active, source: "active" });
    expect(planFindMany).not.toHaveBeenCalled();
  });

  it("a real active Plan covering a PAST date wins as source:active AND skips the candidate query (M1/#269 restored the covered-past-date skip)", async () => {
    // The unconditional past-date candidate fetch existed only so the deleted
    // SMOKE-1 legacy check could run its id-membership test. With the legacy
    // fallback gone, a past date the active plan covers is decided by step 1
    // before candidates could ever matter — so the query is skipped again.
    const active = snapshot();
    const planFindFirst = vi.fn().mockResolvedValue(planDbRow(active, { active: true }));
    const planFindMany = vi.fn().mockResolvedValue([planDbRow(active, { active: true })]);
    mockGetDb.mockResolvedValue(
      mkScopedDb({ plan: { findFirst: planFindFirst, findMany: planFindMany } }),
    );

    const result = await getProgramForDate(parseDateKey("2026-01-15"), parseDateKey("2026-01-20"));

    expect(result).toEqual({ ...active, source: "active" });
    expect(planFindMany).not.toHaveBeenCalled();
  });

  it("no plans at all → null", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb());

    const result = await getProgramForDate(parseDateKey("2026-01-15"), parseDateKey("2026-02-01"));

    expect(result).toBeNull();
  });

  it("past date, archived covering plan → archived snapshot with correct fields", async () => {
    const active = snapshot({ id: "plan-active", startedOn: parseDateKey("2026-03-01") }); // doesn't cover Jan
    const archived = candidate({ id: "plan-archived", startedOn: parseDateKey("2026-01-01") });

    const planFindFirst = vi.fn().mockResolvedValue(planDbRow(active, { active: true }));
    const planFindMany = vi
      .fn()
      .mockResolvedValue([
        planDbRow(archived, {
          active: archived.active,
          goal: { status: archived.goalStatus, completedAt: archived.goalCompletedAt },
        }),
        planDbRow(active, { active: true }),
      ]);
    mockGetDb.mockResolvedValue(
      mkScopedDb({ plan: { findFirst: planFindFirst, findMany: planFindMany } }),
    );

    const result = await getProgramForDate(parseDateKey("2026-01-15"), parseDateKey("2026-02-01"));

    expect(result).toEqual({
      id: "plan-archived",
      name: archived.name,
      startedOn: archived.startedOn,
      template: archived.template,
      confirmedThroughDate: archived.confirmedThroughDate,
      source: "archived",
    });
  });

  it("USER_TZ past-gate: a Date instant chronologically before `now` but on the SAME USER_TZ day is not treated as past", async () => {
    // America/Denver, January (MST, UTC-7, no DST):
    //   date = 2026-01-15T01:00 Denver local = 2026-01-15T08:00Z
    //   now  = 2026-01-15T23:00 Denver local = 2026-01-16T06:00Z
    // date.getTime() < now.getTime() (a raw millisecond/UTC-day comparison
    // would call `date` "past"), but both share dateKey "2026-01-15" — the
    // USER_TZ-correct read is "today", so the archived-plan query must never
    // even run.
    const date = new Date(Date.UTC(2026, 0, 15, 8, 0));
    const now = new Date(Date.UTC(2026, 0, 16, 6, 0));
    expect(date.getTime()).toBeLessThan(now.getTime());

    const planFindMany = vi.fn().mockResolvedValue([
      planDbRow(candidate({ id: "plan-would-wrongly-match", startedOn: parseDateKey("2026-01-01") })),
    ]);
    mockGetDb.mockResolvedValue(
      mkScopedDb({ plan: { findFirst: vi.fn().mockResolvedValue(null), findMany: planFindMany } }),
    );

    const result = await getProgramForDate(date, now);

    expect(result).toBeNull();
    expect(planFindMany).not.toHaveBeenCalled();
  });
});

// ─── M1/#269: LegacyProgram fallback deletion regressions ───────────────────
//
// getActiveProgram()/getMostRecentProgram() must NEVER read the LegacyProgram
// table anymore — a stale active legacy row shadowing Plan resolution was a
// live bug class (override-invisibility; analysis §2.2.3). Each test seeds an
// explicit `legacyProgram` mock returning an ACTIVE legacy row and asserts
// both the null/Plan outcome AND that the accessor was never called.

describe("getActiveProgram / getMostRecentProgram — legacy fallback deleted (M1/#269)", () => {
  it("active LegacyProgram row + zero active Plans → getActiveProgram returns null and never queries the legacy table", async () => {
    const legacyFindFirst = vi.fn().mockResolvedValue(legacyProgramDbRow());
    mockGetDb.mockResolvedValue(
      mkScopedDb({ legacyProgram: { findFirst: legacyFindFirst } }),
    );

    const result = await getActiveProgram();

    expect(result).toBeNull();
    expect(legacyFindFirst).not.toHaveBeenCalled();
  });

  it("active LegacyProgram row + an active Plan → the Plan wins (legacy table untouched)", async () => {
    const active = snapshot({ id: "plan-wins" });
    const legacyFindFirst = vi.fn().mockResolvedValue(legacyProgramDbRow());
    mockGetDb.mockResolvedValue(
      mkScopedDb({
        plan: {
          findFirst: vi.fn().mockResolvedValue(planDbRow(active, { active: true })),
          findMany: vi.fn().mockResolvedValue([]),
        },
        legacyProgram: { findFirst: legacyFindFirst },
      }),
    );

    const result = await getActiveProgram();

    expect(result).toEqual(active);
    expect(legacyFindFirst).not.toHaveBeenCalled();
  });

  it("getMostRecentProgram: zero Plan rows → null even with an active LegacyProgram row present (legacy table untouched)", async () => {
    const legacyFindFirst = vi.fn().mockResolvedValue(legacyProgramDbRow());
    mockGetDb.mockResolvedValue(
      mkScopedDb({ legacyProgram: { findFirst: legacyFindFirst } }),
    );

    const result = await getMostRecentProgram();

    expect(result).toBeNull();
    expect(legacyFindFirst).not.toHaveBeenCalled();
  });

  it("getMostRecentProgram: an inactive Plan still wins over an active LegacyProgram row", async () => {
    const inactivePlan = snapshot({ id: "plan-inactive-recent" });
    const legacyFindFirst = vi.fn().mockResolvedValue(legacyProgramDbRow());
    mockGetDb.mockResolvedValue(
      mkScopedDb({
        plan: {
          findFirst: vi.fn().mockResolvedValue(planDbRow(inactivePlan, { active: false })),
          findMany: vi.fn().mockResolvedValue([]),
        },
        legacyProgram: { findFirst: legacyFindFirst },
      }),
    );

    const result = await getMostRecentProgram();

    expect(result).toEqual(inactivePlan);
    expect(legacyFindFirst).not.toHaveBeenCalled();
  });
});
