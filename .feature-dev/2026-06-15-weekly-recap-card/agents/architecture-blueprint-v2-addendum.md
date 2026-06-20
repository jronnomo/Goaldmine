# Architecture Blueprint v2 — Addendum (Orchestrator decisions resolving the Devil's Advocate critique)

**Read order for developers:** `architecture-blueprint.md` FIRST, then THIS addendum. **On any conflict, THIS addendum wins.** It resolves all 4 criticals + the design concerns from `architecture-critique.md`.

---

## A. Final FROZEN `WeeklyRecap` type (authoritative — replaces blueprint §2)

```typescript
export type RecapTemplate = "coal" | "parchment";
export type RecapSlide = 1 | 2 | 3;

/** Goal progress completeness state — drives goal-zone rendering. (DC-4) */
export type RecapGoalState = "no-goal" | "no-targets" | "all-missing" | "has-data";

/** A PR set during the recap week. v1 emits only source:"exercise". (CRIT-3, CRIT-4, S-4) */
export type RecapPR = {
  source: "exercise" | "baseline";   // v1: always "exercise"; "baseline" reserved
  name: string;                      // canonicalExerciseName output
  bestValue: number;
  units: string;                     // derived via UNIT_FROM_PRIMARY (NOT a field on ExerciseSummary)
};

export type RecapGoalBlock = {
  id: string;
  objective: string;                 // may be long — card wraps/truncates
  progressPct: number | null;        // computeReadiness(...).score; null when no/all-missing targets → render "—" never "0%"
  topMetricLabel: string | null;     // highest-weight non-missing target.label; null → omit bar sub-label (S-2)
  kind: string;                      // Goal.kind — small accent only; must degrade for any kind
};

export type RecapProgramHeader = {
  programWeek: number | null;        // null when no active plan
  dayOfProgram: number | null;       // null when no active plan
  totalProgramDays: number | null;   // plan.template.totalWeeks * 7 (dynamic, 84 now). NOT 90.
};

export type WeeklyRecap = {
  weekStart: Date;                   // SERVER-SIDE ONLY — never passed to a client component (CRIT-2)
  weekEnd: Date;                     // SERVER-SIDE ONLY
  weekOffset: number;
  dateRangeLabel: string;            // e.g. "Jun 9 – Jun 15" (USER_TZ, pre-formatted)
  header: RecapProgramHeader;
  goal: RecapGoalBlock | null;       // null only when there is no focus goal
  goalState: RecapGoalState;         // replaces the old noGoalTargets bool (DC-4)
  workoutsCompleted: number;
  volumeLb: number | null;           // raw lb; null whenever no iron was lifted (rawVol===0) — incl. cardio-only weeks (S-5)
  prCount: number;
  prs: RecapPR[];
  hikeElevationFt: number | null;    // null when no completed hikes
  streakDays: number;                // gameState.streak.current — ALWAYS live-now (no per-week historical; no special copy — MR-3 dropped)
  instagramHandle: string | null;    // process.env.INSTAGRAM_HANDLE ?? null — card omits when null (DC-2)
  noProgram: boolean;                // getActiveProgram() === null
  emptyWeek: boolean;                // workoutsCompleted===0 && hikeElevationFt===null
};
```

Number/units helpers (Stream A, in `recap.ts`):
```typescript
import type { ExerciseSummary } from "@/lib/records";
const UNIT_FROM_PRIMARY: Record<ExerciseSummary["primary"], string> = {
  rm: "lb", reps: "reps", duration: "sec",
};
```

---

## B. CRIT-1 — `dayOfProgram` reference day (replaces blueprint §3.1 note 6)

```typescript
const refDay = (opts?.weekOffset ?? 0) === 0
  ? startOfDay(asOf)     // current week → today's actual program day
  : startOfDay(sunday);  // past week → that week's final day
const daysSinceStart = Math.max(0, Math.round(
  (refDay.getTime() - startOfDay(plan.startedOn).getTime()) / 86_400_000));
const programWeek  = Math.min(plan.template.totalWeeks, Math.floor(daysSinceStart / 7) + 1);
const dayOfProgram = Math.max(1, Math.min(totalProgramDays, daysSinceStart + 1));
```
(`refDay.getTime()` here is server-side numeric diff between two `startOfDay` results — allowed; this is not client wall-clock math.)

---

## C. CRIT-2 — server→client boundary (FREEZE; replaces blueprint §8 "simple option")

- `WeeklyRecap.weekStart/weekEnd` (Date) are **server-only**. **No `WeeklyRecap` and no `Date` is passed to `RecapClient`.**
- Stream A adds to `recap.ts`:
  ```typescript
  /** Pure label, no DB. USER_TZ via @/lib/calendar + Intl. */
  export function weekRangeLabel(asOf: Date, weekOffset: number): string
  ```
- **`RecapClient` props are exactly:**
  ```typescript
  { weeks: { offset: number; label: string }[]; defaultTemplate?: RecapTemplate }
  ```
- `src/app/recap/page.tsx` (server) builds `weeks` for offsets `0..-12`:
  ```typescript
  const now = new Date();
  const weeks = Array.from({ length: 13 }, (_, i) => ({ offset: -i, label: weekRangeLabel(now, -i) }));
  ```
  Passes `weeks` to `<RecapClient weeks={weeks} />`. The preview is an `<img src={/recap/card?weekOffset=…&template=…}>`; the label comes from `weeks[idx].label` — always correct, server-computed, no client TZ math, no Date serialization.

---

## D. CRIT-4 — baseline PRs descoped for v1

`prs`/`prCount` count **exercise PRs only** (`getExerciseSummaries().filter(bestDate ∈ [monday,sunday])`, mapped to `RecapPR{source:"exercise"}`). `getBaselineSummaries()` is **not** called (it has no all-time `bestDate`). REQ-001's `getBaselineSummaries` mention is **descoped** — note it in the ledger. The `source` discriminator reserves a clean future slot.

---

## E. DC-3 + my JSX-in-`.ts` fix — centralized render module (UPDATES file plan)

**New Stream A file:** `src/lib/recap-render.tsx` (`.tsx` — it holds JSX). Owns ALL font loading + `ImageResponse` construction. Exports:
```typescript
export const IMAGE_OPTIONS: ConstructorParameters<typeof ImageResponse>[1];
export function renderRecapCard(recap: WeeklyRecap, template: RecapTemplate): ImageResponse;
export function renderRecapStorySlide(recap: WeeklyRecap, template: RecapTemplate, slide: RecapSlide): ImageResponse;
```
Font load (module scope, DC-1 safe slice):
```typescript
function loadFont(file: string): ArrayBuffer {
  const raw = fs.readFileSync(path.join(process.cwd(), "src/app/recap/fonts", file));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}
```
- **Routes (Stream B)** import `renderRecapCard`/`renderRecapStorySlide` and `return` them directly. They do NOT load fonts or build `ImageResponse` themselves.
- **`tools.ts` (Stream A)** imports `renderRecapCard`, calls `Buffer.from(await renderRecapCard(recap, tpl).arrayBuffer())` → `imageAndJsonResult(buf, recap)`. **No JSX in `tools.ts`** → it stays a `.ts` file. (Resolves the orchestrator-flagged JSX issue + DC-3 duplication in one move.)
- `recap-card.tsx` still owns the pure `RecapCard`/`RecapStorySlide` components; `recap-render.tsx` imports them.

Updated ownership: Stream A also owns `src/lib/recap-render.tsx`. Stream B imports it. Still zero shared-file overlap.

---

## F. DC-5 — number formatting (FREEZE)

In `recap-card.tsx` only (display layer); `WeeklyRecap` keeps raw numbers (MCP JSON stays raw):
- `volumeLb`, `hikeElevationFt`: `new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(n)` → comma-grouped, with unit suffix (` lb`, ` ft`). Null → `"—"`.
- `workoutsCompleted`, `prCount`, `streakDays`: plain `String(n)` (no zero-pad).
- `progressPct`: `` `${n}%` `` when number; `"—"` when null.

---

## G. DC-4 + empty/zero states (replaces blueprint §10 goal rows; add S-1/S-2)

| Condition | Card display |
|---|---|
| `goalState==="no-goal"` (`goal===null`) | Goal zone: muted "No focus goal" placeholder; no bar/Bullseye fill (empty shell). Zone keeps its footprint. |
| `goalState==="no-targets"` | objective + muted "Set goal targets" CTA; empty Bullseye shell; no `%`. |
| `goalState==="all-missing"` | objective + empty Bullseye + `progressPct` → `"—"`. |
| `goalState==="has-data"` | full: objective + filled Bullseye + `${pct}%` + `topMetricLabel` sub-label. |
| `topMetricLabel===null` | omit the bar sub-label (S-2). |
| `header.programWeek===null` | header omits "Week N · Day M of N"; show `dateRangeLabel` only. **Slide 3:** omit the "On to Week N." line; show streak + footer only (S-1). |
| `instagramHandle===null` | footer shows wordmark only, no handle (DC-2). |
| `volumeLb===null` / `hikeElevationFt===null` | `"—"` muted. |
| `emptyWeek===true` | card still renders all zones; add a small encouraging line (template-defined). |
All cells keep a fixed footprint — never collapse.

---

## H. DC-7 — Phase 1 stub fixture (Stream A ships FIRST, typed as `WeeklyRecap`)

```typescript
export async function computeWeeklyRecap(): Promise<WeeklyRecap> {
  return {
    weekStart: new Date(), weekEnd: new Date(), weekOffset: 0,
    dateRangeLabel: "Jun 9 – Jun 15",
    header: { programWeek: 3, dayOfProgram: 19, totalProgramDays: 84 },
    goal: { id: "stub", objective: "Summit Mt. Elbert via Black Cloud Trail",
            progressPct: 41, topMetricLabel: "Body weight", kind: "fitness" },
    goalState: "has-data",
    workoutsCompleted: 4, volumeLb: 18240, prCount: 2,
    prs: [{ source: "exercise", name: "Goblet Squat", bestValue: 65, units: "lb" }],
    hikeElevationFt: 1240, streakDays: 12, instagramHandle: null,
    noProgram: false, emptyWeek: false,
  };
}
```
Stream B codes against this until A ships the real impl. (`weekStart`/`weekEnd` are Dates but never reach the client per §C — they exist only for route/MCP server use.)

---

## I. QA additions

- S-3: smoke **all three** slides — `curl /recap/story/{1,2,3}` each → 1080×1920 PNG.
- DC-6: S3 spike passes only if `tools/call generate_recap_card` returns within ~5s **after a cold start** (restart dev server, call immediately). Keep the tool fast; note "first call may take a few seconds" in nothing user-facing required, just verify no hang.
- New AC: `grep -rwi "gabe\|@gabe" src/lib/recap-card.tsx src/lib/recap.ts` empty (DC-2/MR-1), in addition to the existing `elbert` grep.
- S-6: edit `BottomNav.tsx` by content-matching the `match: (p) => p.startsWith("/progress")` predicate, not a line number.

---

## J. Verdict
With A–I applied, the design is **APPROVED for development**. Stream A delivers `recap-templates.ts` + `recap.ts` (type + `weekRangeLabel` + stub) FIRST so Stream B can compile against the frozen contract; both then proceed in parallel.
