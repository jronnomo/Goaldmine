# Architecture Blueprint — Recap Caption Composer (#92)

**Story:** 3.4-a · **Architect:** Sonnet 4.6 · **Date:** 2026-06-17

---

## 1. Module Purity & Imports

### Decision: `import type` — erased at compile, zero runtime cost

`src/lib/recap-caption.ts` uses:

```ts
import type { WeeklyRecap, RecapHighlight, ResolvedStatSlot } from "@/lib/recap";
```

**Why this is safe (mechanically confirmed):**
TypeScript `import type` declarations are purely compile-time. The TypeScript compiler erases them completely — they produce **zero JavaScript output**. The module `recap.ts` is never evaluated or executed at runtime when only its types are imported. This means `recap.ts`'s chain of runtime-executing imports (`import { prisma } from "@/lib/db"`, `import { computeReadiness } from "@/lib/readiness"`, etc.) never fire. The composer and its Vitest test are fully DB-free with **no `vi.mock` required**.

Compare to `goal-presentation.test.ts` (line 19), which imports the _runtime export_ `resolveStatSlot` from `recap.ts` — that transitively pulls in `@/lib/db` and therefore needs:
```ts
vi.mock("@/lib/db", () => ({ prisma: {} }));
```

The caption composer never imports any runtime symbol from `recap.ts` (no `computeWeeklyRecap`, no `resolveStatSlot`, no `resolveHighlight`). Types only. No mock.

**Alternative rejected:** Re-defining local mirror types for `WeeklyRecap` / `RecapHighlight` / `ResolvedStatSlot` in the caption file. Rejected because: (a) type drift as `recap.ts` evolves, (b) defeats the single-source-of-truth for the contract, (c) unnecessary — `import type` is exactly the mechanism TypeScript designed for this scenario.

**Additional constraint:** The composer must NOT import from:
- `@/lib/db` (Prisma)
- `@/lib/calendar` (uses `process.env.USER_TZ`)
- `@/lib/program`, `@/lib/readiness`, `@/lib/records`, `@/lib/game/engine`
- Any Next.js / Node.js module

All content comes from the already-resolved `WeeklyRecap` bundle — the composer is a pure string transformation.

---

## 2. Fields the Composer Reads

The following fields on `WeeklyRecap` are read by the composer. Everything else is **never touched** (including `weekStart: Date`, `weekEnd: Date`, which are server-only Date instances per the CRIT-2 comment in recap.ts:101).

| Field | Usage |
|-------|-------|
| `recap.dateRangeLabel` | Opener fallback (no-goal path) |
| `recap.header.programWeek` | Opener branch: fitness path |
| `recap.header.dayOfProgram` | Opener: "Day N" component |
| `recap.header.weeksToTarget` | Opener branch: project path |
| `recap.header.targetDateLabel` | Opener: "to Sep 30" component |
| `recap.goal` (null check) | Guards objective + kind |
| `recap.goal.objective` | Opener body text |
| `recap.goal.kind` | Hashtag mapping |
| `recap.statSlots` | Stats line (filtered by `!isNull`) |
| `recap.streakDays` | Streak section (omitted when 0) |
| `recap.emptyWeek` | Switches stats → quiet-week line |

**NOT read:** `weekStart`, `weekEnd`, `weekOffset`, `workoutsCompleted`, `volumeLb`, `prCount`, `prs`, `hikeElevationFt`, `instagramHandle`, `noProgram`, `goalState`, `highlights` (highlight is passed separately as the second param).

**Nullability confirmed:**
- `goal` is `RecapGoalBlock | null` — null when no focus goal
- `goal.progressPct` is `number | null` — not read by composer
- `goal.coverage` is `{ tested: number; total: number } | null` — not read
- `header.programWeek` is `number | null` — null when no plan
- `header.dayOfProgram` is `number | null` — null when no plan; safe to use `?? "?"` as fallback but if `programWeek != null` then a plan exists and `dayOfProgram` will also be non-null (both are derived from the same `plan` object in `computeWeeklyRecap` step 11)
- `header.weeksToTarget` is `number | null`
- `header.targetDateLabel` is `string | null`
- `streakDays` is always `number` (never null) — 0 when no streak
- `emptyWeek` is always `boolean`
- `statSlots` is always `ResolvedStatSlot[]` (may be empty)
- `ResolvedStatSlot.isNull` is always `boolean`

---

## 3. The Exact `composeCaption` Structure

### Function signature

```ts
export function composeCaption(recap: WeeklyRecap, highlight: RecapHighlight | null): string
```

### Section assembly (sections joined by `"\n\n"`)

```
Section 1: Opener        — always present
Section 2: Highlight     — omit when highlight === null
Section 3: Stats OR Quiet — stats line (non-null slots) OR "A quiet week — back at it." (emptyWeek)
Section 4: Streak        — omit when streakDays === 0
Section 5: Hashtags      — always present
```

### Section 1: Opener

Three branches, checked in order:

```ts
function buildOpener(recap: WeeklyRecap): string {
  const { header, goal, dateRangeLabel } = recap;
  if (header.programWeek !== null) {
    // Fitness path: program-week header style
    const day = header.dayOfProgram ?? "?";
    const body = goal?.objective ?? dateRangeLabel;
    return `Week ${header.programWeek} · Day ${day} — ${body}`;
  }
  if (header.weeksToTarget !== null) {
    // Project path: weeks-to-target header style
    const toDate = header.targetDateLabel ?? "target";
    const body = goal?.objective ?? dateRangeLabel;
    return `${header.weeksToTarget} weeks to ${toDate} — ${body}`;
  }
  // No goal / someday / no plan
  return dateRangeLabel;
}
```

**Decision on goal null + programWeek set:** If `header.programWeek != null` but `goal === null` (fitness plan exists, no focus goal), the opener still uses the week/day frame but falls back to `dateRangeLabel` as the body. Not ideal but consistent.

### Section 2: Highlight

```ts
function buildHighlight(h: RecapHighlight): string {
  // PRD spec: "${icon} ${label}${sub ? ` — ${sub}` : ""}"
  return h.sub !== null ? `${h.icon} ${h.label} — ${h.sub}` : `${h.icon} ${h.label}`;
}
```

Example output: `"🏆 Goblet Squat — 65 lb — new PR"`

### Section 3: Stats line OR quiet week

```ts
function buildStatsLine(slots: ResolvedStatSlot[]): string {
  // Filter out null slots — goal-generic (never hardcodes labels)
  const active = slots.filter((s) => !s.isNull);
  if (active.length === 0) return ""; // all-null → skip entire section
  return active.map((s) => `${s.label} ${s.value}`).join(" · ");
}
```

- `emptyWeek === true` → emit `"A quiet week — back at it."` instead (no stats)
- `emptyWeek === false` → call `buildStatsLine`; if it returns `""`, push nothing (no dangling separator)
- Example: `"WORKOUTS 4 · VOLUME 5,370 lb · NEW PRs 7"` (elevation skipped because `isNull: true`)

### Section 4: Streak

```ts
// Only emit when streakDays > 0
`🔥 ${recap.streakDays}-day streak`
```

### Section 5: Hashtags

```ts
const KIND_HASHTAG: Record<string, string> = {
  fitness: "#fitness",
  project: "#projectgoal",
  // extend here for new goal kinds — no other file changes needed
};

function buildHashtags(kind: string | null): string {
  const kindTag = kind !== null ? (KIND_HASHTAG[kind] ?? "#goals") : null;
  return ["#buildinpublic", kindTag, "#goaldmine"].filter(Boolean).join(" ");
}
```

**Decision on kind mapping:**
- `"fitness"` → `"#fitness"` (most common; maps to IG fitness community)
- `"project"` → `"#projectgoal"` (build-in-public context; more specific than `#project`)
- `null` (no goal) → skip the kind tag entirely; output: `"#buildinpublic #goaldmine"`
- Unknown kind (any future string not in map) → `"#goals"` (generic fallback)

**Alternative rejected for null:** Using `"#goals"` even when goal is null — rejected because it implies a goal context that doesn't exist. Clean omission is more honest.

### Complete skeleton

```ts
import type { WeeklyRecap, RecapHighlight, ResolvedStatSlot } from "@/lib/recap";

const KIND_HASHTAG: Record<string, string> = {
  fitness: "#fitness",
  project: "#projectgoal",
};

function buildOpener(recap: WeeklyRecap): string { /* see above */ }
function buildHighlight(h: RecapHighlight): string { /* see above */ }
function buildStatsLine(slots: ResolvedStatSlot[]): string { /* see above */ }
function buildHashtags(kind: string | null): string { /* see above */ }

export function composeCaption(
  recap: WeeklyRecap,
  highlight: RecapHighlight | null,
): string {
  const sections: string[] = [];

  // 1. Opener — always present
  sections.push(buildOpener(recap));

  // 2. Highlight — omit when null
  if (highlight !== null) {
    sections.push(buildHighlight(highlight));
  }

  // 3. Stats OR quiet week
  if (recap.emptyWeek) {
    sections.push("A quiet week — back at it.");
  } else {
    const statsLine = buildStatsLine(recap.statSlots);
    if (statsLine) sections.push(statsLine);
  }

  // 4. Streak — omit when 0
  if (recap.streakDays > 0) {
    sections.push(`🔥 ${recap.streakDays}-day streak`);
  }

  // 5. Hashtags — always present
  sections.push(buildHashtags(recap.goal?.kind ?? null));

  const full = sections.join("\n\n");
  return truncateCaption(full, recap, highlight);
}
```

---

## 4. Truncation Algorithm

**Instagram caption limit: 2,200 characters.** Confirmed — Instagram's UI hard-truncates and hides content past 2,200 chars with a "more" link, but the API rejects captions longer than 2,200 bytes. The PRD correctly specifies this limit.

### Priority order (highest to lowest, i.e. last to drop)

1. Opener (identity — required for context)
2. Hashtags (discoverability — required for build-in-public)
3. Highlight (featured callout — high engagement value)
4. Streak (nice-to-have social signal)
5. **Stats line** (most expendable — drops first)

### Algorithm

```ts
function truncateCaption(
  full: string,
  recap: WeeklyRecap,
  highlight: RecapHighlight | null,
): string {
  const LIMIT = 2200;

  // Fast path — no truncation needed (typical case)
  if (full.length <= LIMIT) return full;

  // Step 1: Rebuild without the stats line (keep everything else)
  const withoutStats = rebuildWithoutStats(recap, highlight);
  if (withoutStats.length <= LIMIT) return withoutStats;

  // Step 2: Hard-trim to 2197 chars + ellipsis
  // Only reachable if opener+highlight+streak+hashtags > 2200 (extremely rare;
  // would require ~2000-char objective). Ensures output is always ≤ 2200.
  return withoutStats.slice(0, 2197) + "…";
}

function rebuildWithoutStats(
  recap: WeeklyRecap,
  highlight: RecapHighlight | null,
): string {
  const sections: string[] = [];
  sections.push(buildOpener(recap));
  if (highlight !== null) sections.push(buildHighlight(highlight));
  if (recap.emptyWeek) sections.push("A quiet week — back at it.");
  // Stats line intentionally omitted
  if (recap.streakDays > 0) sections.push(`🔥 ${recap.streakDays}-day streak`);
  sections.push(buildHashtags(recap.goal?.kind ?? null));
  return sections.join("\n\n");
}
```

**Decision — why stats drops before streak:** Stats can be discovered by following the account or visiting the recap card. The streak is personal social capital that adds story continuity; slightly higher engagement signal.

**Decision — no intermediate streak-drop step:** The PRD only specifies "drop stats first." Adding a streak-drop step adds complexity for an edge case that requires >2200 chars with stats already removed (i.e., the remaining 4 sections alone exceed 2200). In practice: opener (~80 chars) + highlight (~50) + quiet-week copy or nothing + streak (~20) + hashtags (~40) = ~190 chars minimum, well under 2200. Only a pathological 2000-char `goal.objective` could breach the limit after dropping stats. Hard-trim at step 2 handles that without introducing drop-streak logic.

---

## 5. Test Fixtures

### Import pattern — no vi.mock needed

```ts
// src/lib/recap-caption.test.ts
import { describe, it, expect } from "vitest";
import { composeCaption } from "@/lib/recap-caption";
import type { WeeklyRecap, RecapHighlight } from "@/lib/recap";
// ↑ import type — no vi.mock("@/lib/db") needed
```

`recap-caption.ts` uses only `import type` from `recap.ts` → no runtime module evaluation → Prisma never loads. The test is a pure unit test. No vi.mock anywhere.

### Fixture A: Fitness (4 workouts, 5,370 lb volume, 7 PRs, elevation null, PR highlight, streak 12)

```ts
const FITNESS_RECAP: WeeklyRecap = {
  weekStart: new Date("2026-06-09"), // composer never reads — any Date is fine
  weekEnd: new Date("2026-06-15"),   // composer never reads
  weekOffset: 0,
  dateRangeLabel: "Jun 9 – Jun 15",
  header: {
    programWeek: 7,
    dayOfProgram: 46,
    totalProgramDays: 84,
    weeksToTarget: null,
    targetDateLabel: null,
  },
  goal: {
    id: "goal-fitness-1",
    objective: "Summit Mt. Elbert via Black Cloud Trail",
    progressPct: 62,
    topMetricLabel: "VO2max",
    kind: "fitness",
    coverage: { tested: 3, total: 4 },
    openGateCount: 0,
  },
  goalState: "has-data",
  workoutsCompleted: 4,
  volumeLb: 5370,
  prCount: 7,
  prs: [],
  hikeElevationFt: null,
  streakDays: 12,
  instagramHandle: null,
  noProgram: false,
  emptyWeek: false,
  highlights: [],
  statSlots: [
    { key: "workouts",  label: "WORKOUTS",  value: "4",        isNull: false },
    { key: "volume",    label: "VOLUME",    value: "5,370 lb", isNull: false },
    { key: "prs",       label: "NEW PRs",   value: "7",        isNull: false },
    { key: "elevation", label: "ELEVATION", value: "—",        isNull: true  }, // null → skipped
  ],
};

const PR_HIGHLIGHT: RecapHighlight = {
  id: "pr:Goblet Squat",
  kind: "pr",
  icon: "🏆",
  label: "Goblet Squat — 65 lb",
  sub: "new PR",
};
```

**Expected caption (exact structure):**
```
Week 7 · Day 46 — Summit Mt. Elbert via Black Cloud Trail

🏆 Goblet Squat — 65 lb — new PR

WORKOUTS 4 · VOLUME 5,370 lb · NEW PRs 7

🔥 12-day streak

#buildinpublic #fitness #goaldmine
```

**Assertions:**
```ts
it("fitness: correct opener, highlight with sub, stats without null slot, streak, hashtag", () => {
  const caption = composeCaption(FITNESS_RECAP, PR_HIGHLIGHT);

  // Opener
  expect(caption).toContain("Week 7 · Day 46");
  expect(caption).toContain("Summit Mt. Elbert via Black Cloud Trail"); // objective passthrough (data, not hardcode)

  // Highlight — PRD template: "${icon} ${label} — ${sub}"
  expect(caption).toContain("🏆 Goblet Squat — 65 lb — new PR");

  // Stats — goal-generic: labels from statSlots, null slot skipped
  expect(caption).toContain("WORKOUTS 4 · VOLUME 5,370 lb · NEW PRs 7");
  expect(caption).not.toContain("ELEVATION"); // isNull=true → must not appear

  // Streak
  expect(caption).toContain("🔥 12-day streak");

  // Hashtags
  expect(caption).toContain("#buildinpublic");
  expect(caption).toContain("#fitness");
  expect(caption).toContain("#goaldmine");

  // Length invariant
  expect(caption.length).toBeLessThanOrEqual(2200);
});
```

---

### Fixture B: Project (MRR null → skipped, MILESTONES 0/7, no highlight, streak 0)

```ts
const PROJECT_RECAP: WeeklyRecap = {
  weekStart: new Date("2026-06-09"),
  weekEnd: new Date("2026-06-15"),
  weekOffset: 0,
  dateRangeLabel: "Jun 9 – Jun 15",
  header: {
    programWeek: null,          // no fitness plan
    dayOfProgram: null,
    totalProgramDays: null,
    weeksToTarget: 15,          // project path
    targetDateLabel: "Sep 30",
  },
  goal: {
    id: "goal-project-1",
    objective: "Ship Chewgether to the App Store",
    progressPct: null,
    topMetricLabel: null,
    kind: "project",
    coverage: null,
    openGateCount: 0,
  },
  goalState: "no-targets",
  workoutsCompleted: 0,
  volumeLb: null,
  prCount: 0,
  prs: [],
  hikeElevationFt: null,
  streakDays: 0,
  instagramHandle: null,
  noProgram: true,
  emptyWeek: false, // has milestone progress even without workouts
  highlights: [],
  statSlots: [
    { key: "mrr",        label: "MRR",       value: "—",    isNull: true  }, // null → skipped
    { key: "milestones", label: "MILESTONES", value: "0/7",  isNull: false },
  ],
};
```

**Expected caption:**
```
15 weeks to Sep 30 — Ship Chewgether to the App Store

MILESTONES 0/7

#buildinpublic #projectgoal #goaldmine
```

**Assertions:**
```ts
it("project: weeks-to-target opener, null MRR skipped, no highlight, no streak, #projectgoal", () => {
  const caption = composeCaption(PROJECT_RECAP, null);

  // Opener
  expect(caption).toContain("15 weeks to Sep 30");
  expect(caption).toContain("Ship Chewgether to the App Store");

  // Stats — MRR null → must not appear; MILESTONES present
  expect(caption).not.toContain("MRR");
  expect(caption).toContain("MILESTONES 0/7");

  // Streak skipped (streakDays 0)
  expect(caption).not.toContain("🔥");

  // No highlight section
  expect(caption).not.toContain("🏆");

  // Hashtags
  expect(caption).toContain("#projectgoal");
  expect(caption).toContain("#goaldmine");
  expect(caption).not.toContain("#fitness");

  // Goal-generic: no hardcoded labels other than from statSlots data
  expect(caption.length).toBeLessThanOrEqual(2200);
});
```

---

### Fixture C: Empty week (emptyWeek true, no highlight, streak 0)

```ts
const EMPTY_WEEK_RECAP: WeeklyRecap = {
  weekStart: new Date("2026-06-09"),
  weekEnd: new Date("2026-06-15"),
  weekOffset: 0,
  dateRangeLabel: "Jun 9 – Jun 15",
  header: {
    programWeek: 7,
    dayOfProgram: 46,
    totalProgramDays: 84,
    weeksToTarget: null,
    targetDateLabel: null,
  },
  goal: {
    id: "goal-fitness-1",
    objective: "Summit Mt. Elbert via Black Cloud Trail",
    progressPct: null,
    topMetricLabel: null,
    kind: "fitness",
    coverage: null,
    openGateCount: 0,
  },
  goalState: "has-data",
  workoutsCompleted: 0,
  volumeLb: null,
  prCount: 0,
  prs: [],
  hikeElevationFt: null,
  streakDays: 0,
  instagramHandle: null,
  noProgram: false,
  emptyWeek: true,    // ← the key flag
  highlights: [],
  statSlots: [        // present but must be ignored when emptyWeek=true
    { key: "workouts",  label: "WORKOUTS",  value: "0", isNull: false },
    { key: "volume",    label: "VOLUME",    value: "—", isNull: true  },
    { key: "prs",       label: "NEW PRs",   value: "0", isNull: false },
    { key: "elevation", label: "ELEVATION", value: "—", isNull: true  },
  ],
};
```

**Expected caption:**
```
Week 7 · Day 46 — Summit Mt. Elbert via Black Cloud Trail

A quiet week — back at it.

#buildinpublic #fitness #goaldmine
```

**Assertions:**
```ts
it("empty-week: quiet-week copy replaces stats, no highlight, no streak", () => {
  const caption = composeCaption(EMPTY_WEEK_RECAP, null);

  // Quiet week copy — honest, no fake stats
  expect(caption).toContain("A quiet week — back at it.");

  // Stats must NOT appear even though statSlots has non-null values (emptyWeek=true overrides)
  expect(caption).not.toContain("WORKOUTS");
  expect(caption).not.toContain("NEW PRs");

  // Streak skipped
  expect(caption).not.toContain("🔥");

  // No highlight
  expect(caption).not.toContain("🏆");
  expect(caption).not.toContain("⭐");

  // Hashtags still present
  expect(caption).toContain("#goaldmine");

  expect(caption.length).toBeLessThanOrEqual(2200);
});
```

---

### Additional invariant tests

```ts
it("no-goal: opener is dateRangeLabel, hashtags contain no kind tag", () => {
  const noGoalRecap: WeeklyRecap = {
    ...FITNESS_RECAP,
    goal: null,
    goalState: "no-goal",
    header: { programWeek: null, dayOfProgram: null, totalProgramDays: null, weeksToTarget: null, targetDateLabel: null },
    statSlots: [],
    streakDays: 0,
    emptyWeek: false,
  };
  const caption = composeCaption(noGoalRecap, null);
  expect(caption).toContain("Jun 9 – Jun 15"); // dateRangeLabel
  expect(caption).not.toContain("#fitness");
  expect(caption).not.toContain("#projectgoal");
  expect(caption).toContain("#buildinpublic");
  expect(caption).toContain("#goaldmine");
});

it("all-null statSlots: stats section entirely absent — no dangling separator", () => {
  const allNullRecap: WeeklyRecap = {
    ...PROJECT_RECAP,
    statSlots: [
      { key: "mrr", label: "MRR", value: "—", isNull: true },
    ],
    emptyWeek: false,
  };
  const caption = composeCaption(allNullRecap, null);
  expect(caption).not.toContain("MRR");
  // No dangling " · " or double newlines around empty stats
  expect(caption).not.toMatch(/\n\n\n/); // never 3 consecutive newlines
});

it("caption never exceeds 2200 chars", () => {
  // Pathological: 800-char objective
  const longObjRecap: WeeklyRecap = {
    ...FITNESS_RECAP,
    goal: { ...FITNESS_RECAP.goal!, objective: "A".repeat(800) },
  };
  const caption = composeCaption(longObjRecap, PR_HIGHLIGHT);
  expect(caption.length).toBeLessThanOrEqual(2200);
});
```

---

## 6. `.env.example` Addition

Add immediately after the `MCP_AUTH_TOKEN` block (or at end of file), before `GITHUB_TOKEN`:

```
# Instagram handle for the recap card overlay and caption (without the @ symbol).
# Optional — omit or leave blank to hide the handle from the card and caption.
# Used by: computeWeeklyRecap (src/lib/recap.ts) and indirectly by composeCaption.
INSTAGRAM_HANDLE="your_instagram_handle"
```

**Decision:** Placed before `GITHUB_TOKEN` because it's a user-facing UX variable, not a privileged API credential. The comment clarifies it's the bare handle (no @), confirms it's optional, and names both usage sites.

---

## 7. Edge Cases (full inventory)

| Case | Behavior | Risk |
|------|----------|------|
| `goal === null` | Opener = `dateRangeLabel`; hashtags skip kind tag | None — handled by `recap.goal?.kind ?? null` |
| All `statSlots` have `isNull: true` | `buildStatsLine` returns `""`; section not pushed; no empty `\n\n` gap | None — `if (statsLine)` guards the push |
| `highlight === null` | Section 2 skipped entirely | None — `if (highlight !== null)` guards |
| `streakDays === 0` | Section 4 skipped | None — `if (recap.streakDays > 0)` guards |
| `emptyWeek === true` with non-null statSlots | Quiet-week copy emitted; statSlots IGNORED | **Gotcha:** the `emptyWeek` branch must precede the stats branch and must NOT call `buildStatsLine` — not a fallthrough |
| Very long `goal.objective` (e.g. 800 chars) | Truncation step 2 catches it after stats drop; hard-slices at 2197 + "…" | Verify the `"…"` char is 1 byte in the `.length` check (it's a UTF-16 single code unit — fine) |
| `header.programWeek !== null` but `goal === null` | Opener uses week/day frame but falls back to `dateRangeLabel` as body | Unusual state but handled |
| `header.weeksToTarget === 0` | Opener: `"0 weeks to Sep 30 — …"` — truthful, not filtered | Expected; 0 is valid (deadline this week) |
| Unknown `goal.kind` (future kinds) | `KIND_HASHTAG[kind] ?? "#goals"` — generic fallback | Extensible — add to `KIND_HASHTAG` for new kinds, no other changes |
| `highlight.sub === null` | `buildHighlight` omits the `" — ${sub}"` suffix — no dangling " — " | Handled by the ternary |

---

## 8. Do-NOT-Touch List

| File | Reason |
|------|--------|
| `src/lib/recap.ts` | Source of truth for types and `computeWeeklyRecap`; caption logic does NOT belong here |
| `src/lib/goal-presentation.ts` | Presentation registry; no caption concern |
| `src/generated/prisma/` | No schema changes for this story |
| `prisma/schema.prisma` | No new DB fields |
| `src/app/api/mcp/` | MCP endpoint untouched; this story is pure lib |
| `src/lib/mcp/tools.ts` | MCP tool surface untouched |
| Any existing `.test.ts` file | Don't modify the passing Vitest suite; add only `recap-caption.test.ts` |

---

## 9. Files to Create

| File | Purpose |
|------|---------|
| `src/lib/recap-caption.ts` | The composer — pure function, ~80 lines |
| `src/lib/recap-caption.test.ts` | Vitest suite — 3 fixtures + invariant tests, no vi.mock |
| `.env.example` (edit, not create) | Add `INSTAGRAM_HANDLE` entry |

---

## 10. Verification Commands

```sh
# Type-check (strict — catches any type error in the new module)
npx tsc --noEmit

# Lint
npm run lint

# Tests
npx vitest run src/lib/recap-caption.test.ts

# Goal-generic guardrail — source file must be clean
grep -nE "Elbert|Chewgether|\bMRR\b|\\\$[0-9]" src/lib/recap-caption.ts
# Expected: no output

# Confirm .env.example updated
grep "INSTAGRAM_HANDLE" .env.example
```
