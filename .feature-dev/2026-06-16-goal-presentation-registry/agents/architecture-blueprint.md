# Architecture Blueprint — Goal-Presentation Registry (#67)

Transcribed from the twice-vetted `plan-blueprint.md §1` (Plan Architect + Devil's Advocate). This story = ONE new pure module + a mechanical formatter hoist in `recap-card.tsx`. No Prisma, no MCP, no surface rewire.

## Files
### CREATE `src/lib/goal-presentation.ts` (pure, client-safe)
Header comment: state the purity contract (no Prisma / no `@/lib/calendar` / no Node built-ins; `Intl.*` ok; importable by Satori JSX + server components). Mirror the tone of `recap-card.tsx`'s header.

Exports, in order:
1. **Formatters** (hoisted verbatim from `recap-card.tsx:13–23`):
   - `fmtComma(n: number): string` — `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })`.
   - `fmtVolume(v: number | null): string` — `v === null ? "—" : \`${fmtComma(v)} lb\``.
   - `fmtElevation(v: number | null): string` — `v === null ? "—" : \`${fmtComma(v)} ft\``.
   (Move them EXACTLY — do not alter logic; byte-identical output is a hard requirement.)
2. **Types** — `StatFormat`, `StatSource`, `StatSlot`, `HeaderStyle`, `GoalPresentation` (PRD §3, verbatim).
3. **Entries**:
   - `FITNESS_PRESENTATION: GoalPresentation` — kind `"fitness"`, ring `"READINESS"`, header `"program-week"`, 4 slots (`workouts→recapField workoutsCompleted/int`, `volume→recapField volumeLb/volumeLb`, `prs→recapField prCount/int` label `"NEW PRs"`, `elevation→recapField hikeElevationFt/elevationFt`), `restCopy` = the generic recovery copy (blueprint §1.4: "A short walk or light stretch today builds the aerobic base and joint resilience your goal needs — treat recovery as training, not a day off."), `legendDefault: "fitness"`.
   - `PROJECT_PRESENTATION: GoalPresentation` — kind `"project"`, ring `"PROGRESS"`, header `"weeks-to-target"`, **exactly 2 slots** (`mrr→logLatest metricKey:"mrr"/currency` label `"MRR"`; `milestones→scheduledItem itemType:"milestone" agg:"doneOverTotal"/ratioOfTotal` label `"MILESTONES"`), `restCopy: null`, `legendDefault: "project"`.
   - `DEFAULT_PRESENTATION: GoalPresentation` — `{ ...FITNESS_PRESENTATION, kind: "__default__" }`.
4. **Registry + resolver**:
   - `const REGISTRY: Record<string, GoalPresentation> = { fitness: FITNESS_PRESENTATION, project: PROJECT_PRESENTATION }`.
   - `export function presentationForGoal(goal: { kind?: string | null } | null | undefined): GoalPresentation` → `const k = goal?.kind ?? null; return (k && REGISTRY[k]) ? REGISTRY[k] : DEFAULT_PRESENTATION;`

### MODIFY `src/lib/recap-card.tsx`
- Remove local `fmtComma`/`fmtVolume`/`fmtElevation` (lines 13–23).
- `import { fmtVolume, fmtElevation } from "@/lib/goal-presentation";` (and `fmtComma` if still referenced elsewhere in the file — grep first; if `fmtComma` is used outside the two fmt helpers, import it too).
- Nothing else changes. The card still renders identically.

## Invariants
- **Purity:** `grep -nE "@/lib/(db|calendar)|generated/prisma|require\(|^import .*\bfs\b|\bpath\b" src/lib/goal-presentation.ts` must be empty.
- **Byte-identical:** formatter logic moved verbatim → recap-card output unchanged. Turbopack build is the proof the Satori import path is valid.
- **No consumer rewire:** nothing reads `statSlots`/`ringLabel`/`headerStyle` from the registry yet (that's #68/#69). This story only *defines* them + re-points the formatters.
- **Anti-vertical:** project = 2 slots, ring `"PROGRESS"` (not `"TRACTION"`). Do not add Subs/Conversion.

## Test note (for #70, not built here)
`presentationForGoal` and the formatters are trivially unit-testable (pure). This story just needs build-green; #70 adds the Vitest coverage.
