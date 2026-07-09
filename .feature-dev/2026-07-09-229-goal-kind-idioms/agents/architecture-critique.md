# Architecture critique — #229 (AMENDED scope), Devil's Advocate

Blueprint: `docs/prds/PRD-229-goal-kind-idioms.md` §3.1 + §6. Verified against source at HEAD (feature/phase1-auth).

---

## Critical

None. No axis surfaces a correctness bug that would ship broken; the two items below are design gaps the PRD gestures at but doesn't pin down precisely enough to implement without re-deriving the logic — promoted to Concerns since the PRD's own edge-case table (§6) already names the requirement, just not the shape.

---

## Concerns

### C1. `workBetweenLabel` needs a fully conditional clause builder, not a single extra `if` (axis 4)
Current code (`compare/page.tsx:258-266`) unconditionally concatenates all 5 fitness clauses (workouts, hikes, baseline tests, ft, mi) + notes + XP, then appends the level clause only if both are non-null. The AMENDED design needs the **fitness clauses themselves** gated on `hasFitnessGoal`, independently from the level clause. That's two independent booleans multiplying into 4 outcomes, and the string-concatenation style in the current code invites getting one branch wrong (e.g. leaving a stray leading/trailing comma when the fitness segment is omitted). Prescribe an array-of-clauses + `.join(", ")` builder instead of string concatenation, e.g.:

```ts
const clauses: string[] = [];
if (hasFitnessGoal) {
  clauses.push(
    `${between.workoutsCompleted} workouts`,
    `${between.hikesCompleted} hikes`,
    `${between.baselineTestsLogged} baseline tests logged`,
  );
}
clauses.push(`${between.notesLogged} notes logged`);
if (hasFitnessGoal) {
  clauses.push(`${between.hikeElevationFt} feet climbed`, `${between.hikeDistanceMi} miles hiked`);
}
clauses.push(`${between.xpEarned} XP earned`);
if (between.levelA !== null && between.levelB !== null) {
  clauses.push(`level ${between.levelA} to ${between.levelB}`);
}
const workBetweenLabel =
  `The work between ${formatHeroDate(result.dateA)} and ${formatHeroDate(result.dateB)}: ` + clauses.join(", ");
```
This guarantees the label always matches the rendered tile set in all 4 combos without needing to hand-verify comma placement in each branch. The rendered `<StatTile>` grid needs the identical `{hasFitnessGoal && <>...5 tiles...</>}` wrapping — don't reorder the existing tiles, just fragment-wrap the fitness subset so the fitness-present path stays byte-identical (see C-axis-5 below).

### C2. `cumulative[]` — confirmed gate-all, not filter (axis 4)
Verified `compare.ts:397-401`: all three `cumulative` entries (`counter:workouts`, `counter:elevation`, `counter:distance`) are fitness-domain, unconditionally pushed regardless of the viewer's goal kinds. There is no kind-neutral entry mixed in today. **Gate the entire `cumulative.map(...)` block on `hasFitnessGoal`** (PRD's stated approach) — filtering per-entry would be over-engineering for a set that's 100% fitness today, and would silently do nothing if a future kind-neutral entry were added without updating the filter predicate.

### C3. `hasAnyDataA` banner is computed server-side independent of the page's `hasFitnessGoal` gate — can now describe hidden data (axis 4, minor pre-existing seam)
`computeHasAnyDataA` (`compare.ts:504-506`) folds in `cumulativeHasA`, which reflects raw workout/hike counts **regardless of whether any active goal has `kind === "fitness"`** — a user can log workouts without a fitness goal existing (Workout rows aren't goal-scoped). Post-#229, a project-only-goals user who nonetheless has historical workout data would: (a) have `hasFitnessGoal === false` → fitness tiles + cumulative rows hidden on the page, while (b) `result.hasAnyDataA` may still be `true` because of that same hidden workout data, or the "everything below is new since then" banner could reference data the user can no longer see on this page. This is a real (if narrow) inconsistency, but it's a pre-existing seam between "goal-kind gating" (new, page-level) and "any-data-logged gating" (existing, compare.ts-level) — the PRD explicitly scopes changes to rendering only and forbids touching `compare.ts`'s `hasAnyDataA` logic. Flagging as accepted scope boundary, not a blocker — but worth a one-line code comment at the gate site noting the seam so a future dev doesn't "fix" hasAnyDataA into a regression.

### C4. classLabel DEFAULT-inherits-Adventurer is reachable today, not just hypothetical (axis 3)
`prisma/schema.prisma:285`: `kind String @default("fitness")` — a free-form String column, **not a Prisma enum**. `computeGameState` (`engine.ts:914`) passes `goal?.kind ?? "fitness"` straight through with zero validation; `types.ts:27` types `goalKind` as bare `string | null`, not a literal union. So if any goal in the DB (hand-edited, future kind added without a REGISTRY entry, or a bug elsewhere) is the `isFocus` goal with an unrecognized `kind`, `/character` will render "Adventurer" for it via `DEFAULT_PRESENTATION`. This is exactly what PRD §6's edge-case row documents and accepts ("DEFAULT presentation → Adventurer label ... documented AC choice"), and the founder's current data has only `fitness`/`project` kinds — so **verdict: acceptable-per-AC**, not a regression to fix in this story. Noted for completeness since the DA brief asked to check reachability explicitly, and the answer is "yes, reachable in principle, schema doesn't prevent it."

---

## Suggestions

### S1. ringLabel-as-card-title: title-casing is fine, but specify the exact transform (axis 1)
`ringLabel` is confirmed to be a small muted-color ring caption in `recap-card.tsx:437-447` and `:870-873` (`letterSpacing: 3`, `tok.fontSize.readinessLabel`, always rendered as the raw pre-uppercased string "READINESS"/"PROGRESS") — a stylistic label under a progress ring, not a card header anywhere today. Reusing it as a `<Card title>` is a legitimate semantic reuse ("what this score is called") since both current values (`FITNESS_PRESENTATION.ringLabel = "READINESS"`, `PROJECT_PRESENTATION.ringLabel = "PROGRESS"`) are single words, and `Card`'s title renders as plain `text-base font-semibold` with **no CSS uppercase transform** (`Card.tsx:20`), so the DOM text must literally already read "Readiness" to match the current literal `<Card title="Readiness">`. A dedicated `scoreCardTitle` field would be more explicit but is unnecessary duplication for 2 kinds with single-word ring labels — not worth the extra registry field per PRD's "file-level, minimal" framing.

Prescribed transform (word-safe, not just first-letter-of-string):
```ts
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
```
`titleCase("READINESS")` → `"Readiness"` (byte-identical to today's literal). `titleCase("PROGRESS")` → `"Progress"`. This is deliberately word-aware (not `s[0] + s.slice(1).toLowerCase()`) so a hypothetical future multi-word `ringLabel` (e.g. "STACK REACH") title-cases to "Stack Reach", not "Stack reach" — cheap insurance, same line count as the naive version.

### S2. Confirm the fitness-present JSX path is a superset-wrap, not a rewrite (axis 5)
Byte-identical is provable and should hold: `hasFitnessGoal` will always be `true` for any comparison touching a fitness goal (`result.goals.some(g => g.kind === "fitness")`), so wrapping the 5 existing fitness `<StatTile>`s and the `cumulative.map(...)` block in `{hasFitnessGoal && <>...</>}` — **without reordering, relabeling, or re-keying any existing element** — preserves DOM output exactly for every user who has a fitness goal (founder included, per PRD §10's test plan). The only diff risk is if the implementer restructures the grid (e.g. moves `notes` before `workouts`) while adding the conditional — call this out in the dev handoff as a "wrap, don't rewrite" instruction.

### S3. No code changes needed for axes 2 and 6 — confirmed structurally sound
- Axis 2: `goals/[id]/page.tsx`'s `db.goal.findUnique(...)` (`:39-54`) has no `select`, so Prisma returns all scalar columns including `kind` by default — `presentationForGoal(goal)` receives a fully-populated Prisma `Goal` with `kind: string`, structurally compatible with `presentationForGoal`'s `{ kind?: string | null } | null | undefined` parameter. No cast, no `select` addition needed.
- Axis 6: `computeGameState`'s `goalKind` is typed `string | null` (`types.ts:27`), and `character/page.tsx:32`'s `if (!state.goalKind) return ...` narrows it to `string` for the rest of the component (TS control-flow narrowing holds since `state` is a `const` from a resolved `Promise.all`, never reassigned). `presentationForGoal({ kind: state.goalKind })` at `:76` type-checks cleanly with no SSR risk — `presentationForGoal` is already null-safe internally (`goal?.kind ?? null`).

### S4. Scope confirmed clean (axis 7)
Grepped every `computeReadiness` call site (`progress/page.tsx:45`, `goals/[id]/page.tsx:114`, `compare.ts:104-105`, `readiness.ts:249/255`, `recap.ts:446`, `mcp/tools.ts:1036/1045`) — none carry a kind conditional today, and this PRD's changes don't touch any of them (goals/[id]'s readiness *computation* is explicitly untouched per §3.1 item 4; only the Card *title* changes). `recap-card.tsx`'s two `ringLabel` consumers are unaffected — no title-casing applied there, `presentation.ringLabel` keeps rendering the raw uppercase string as it does today. `legend.ts:100` consumes `legendDefault`, not `classLabel` — additive field, no interaction. AC6 ("no kind-gating added to any computeReadiness call site") is satisfiable by construction since the PRD never proposes touching `readiness.ts` or its call sites.

---

## Verdict: APPROVE-WITH-FIXES
