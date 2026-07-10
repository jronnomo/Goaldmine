# Devil's Advocate Critique — issue #238 `src/lib/plan-format.ts` consolidation

## Verdict: APPROVE-WITH-CONDITIONS

The design's factual premises (byte-identical bodies, which files use which helper) all hold up under
independent re-verification. One real correction survives: the design's per-file "deletions/imports"
list over-specifies `formatSecs` as something to import directly in three of the six files, when in
those files `formatSecs` is only ever called *from inside* a helper that is itself being deleted
(`compactPrescription`/`prescriptionRight`). If a developer imports it anyway in those files it's a
dead import. Not a correctness bug, not a blocker — just needs the exact import list below handed to
the implementer so nothing is over- or under-imported.

No functional, semantic, or cycle risk found. All 4 `blockTypeLabel` copies, 5 canonical `formatSecs`
copies, and 3 `compactPrescription` copies are verified byte-identical (mod one harmless parameter
name). `prescriptionRight` differs from `compactPrescription` only in the documented `|| "—"` fallback.
`CompletedWorkoutCard.tsx`'s `formatSecs` is correctly excluded — it's genuinely different logic.

---

## Attack 1 — call-site completeness per file (evidence: repo-wide grep, cross-checked against manual read of all 6 files)

Repo-wide `grep -rn` for each of the four names confirms the file reads exhaustively — no JSX
template-literal, ternary, or function-reference usage was missed. Full call-site inventory:

**`src/app/page.tsx`**
- `blockTypeLabel` def:456 → called once, line 422 (`BlockCard`, JSX): `{blockTypeLabel(block.type)}`
- `formatSecs` def:486 → called once, line 439 (`ExerciseRow`): `if (ex.durationSec) parts.push(formatSecs(ex.durationSec));`
- Needs direct imports of **both** `blockTypeLabel` and `formatSecs`.
- Note: line 418 uses the *separate*, untouched `defaultBlockLabel` (line 471) — not `blockTypeLabel`. Do not conflate.

**`src/app/days/[dateKey]/page.tsx`**
- `blockTypeLabel` def:476 → called once, line 437 (`BlockView`, JSX): `block.label ?? blockTypeLabel(block.type)`
- `compactPrescription` def:468 → called once, line 452 (`BlockView`, JSX): `{compactPrescription(ex)}`
- `formatSecs` def:491 → called **only** at line 472, *inside* `compactPrescription` itself (being deleted). No other direct call site in this file.
- Needs direct imports of `blockTypeLabel` and `compactPrescription` only. **Do not import `formatSecs` here** — it would be an unused import.

**`src/app/goals/[id]/plan/page.tsx`**
- `blockTypeLabel` def:383 → called once, line 211 (`BlockView`, JSX): `block.label ?? blockTypeLabel(block.type)`
- `prescriptionRight` def:320 → called once, line 138 (main component JSX, `dailyMobility.exercises.map`): `{prescriptionRight(ex)}`
- `compactPrescription` def:328 → called once, line 226 (`BlockView`, JSX): `{compactPrescription(ex)}`
- `formatSecs` def:398 → called only at lines 324 and 332, *inside* `prescriptionRight` and `compactPrescription` (both being deleted). No other direct call site.
- Needs direct imports of `blockTypeLabel`, `prescriptionRight`, `compactPrescription`. **Do not import `formatSecs` here.**

**`src/components/SnapshotView.tsx`**
- `compactPrescription` def:139 → called once, line 130 (`BlockSnapshot`, JSX): `{compactPrescription(ex)}`
- `formatSecs` def:147 → called only at line 143, inside `compactPrescription` (being deleted). No other direct call site.
- `blockTypeLabel` is **never used** in this file — `BlockSnapshot` (line 106-113) falls back to raw `block.type` (e.g. `"straight"`, not `"Straight sets"`) when `block.label` is absent. This is pre-existing, out-of-scope behavior; do not "fix" it as part of this ticket, and do not add a `blockTypeLabel` import here (the design correctly omits it).
- Needs direct import of `compactPrescription` only. **Do not import `formatSecs` here.**

**`src/components/PlanOverview.tsx`**
- `formatSecs` def:133 → called once, line 59, **inside a ternary in JSX**: `{ex.durationSec ? formatSecs(ex.durationSec) : ex.reps !== undefined ? `× ${ex.reps}` : ""}`
- This is the one file where the ternary-embedded-call pattern the prompt warned about actually occurs. Confirmed real, confirmed single call site.
- Needs direct import of `formatSecs` only (no `blockTypeLabel`/`compactPrescription` usage in this file).

**`src/lib/prescription-prefill.ts`**
- `blockTypeLabel` def:59 → called once, line 85 (`prefillFromTemplate`): `block.label ?? blockTypeLabel(block.type)`
- Needs direct import of `blockTypeLabel` only.

**Net correction to the design doc's per-file import list:** only `page.tsx` and `PlanOverview.tsx` need `formatSecs` imported directly. `days/[dateKey]/page.tsx`, `goals/[id]/plan/page.tsx`, and `SnapshotView.tsx` consume `formatSecs`'s behavior only transitively through `compactPrescription`/`prescriptionRight` and must not import it directly. Checked `tsconfig.json` (`noUnusedLocals`/`noUnusedParameters` are **not** set, so `tsc --noEmit` won't fail on this) and `eslint.config.mjs` (`eslint-config-next/typescript` → `@typescript-eslint/no-unused-vars`, default severity is a warn, not a hard `lint` failure) — so an over-import wouldn't break CI, but it's dead code and should be avoided per the ticket's own hygiene goal.

## Attack 2 — body identity re-verification (evidence: pasted below, diffed by hand)

`blockTypeLabel` — 4 copies (`page.tsx:456`, `days/[dateKey]/page.tsx:476`, `goals/[id]/plan/page.tsx:383`, `prescription-prefill.ts:59`): identical switch bodies and return strings. Only difference is the parameter name (`t` in the first three, `type` in `prescription-prefill.ts`) — cosmetic, not behavior-affecting since it's not part of the public signature name.

`formatSecs` (canonical) — 5 copies (`page.tsx:486`, `days/[dateKey]/page.tsx:491`, `goals/[id]/plan/page.tsx:398`, `SnapshotView.tsx:147`, `PlanOverview.tsx:133`): byte-identical, including the `s >= 60` branch, `m`/`r` naming, and `padStart(2, "0")`.

`compactPrescription` — 3 copies (`days/[dateKey]/page.tsx:468`, `goals/[id]/plan/page.tsx:328`, `SnapshotView.tsx:139`): byte-identical, including the `if (ex.sets)` truthy check (see Attack 4) and `|| "—"` fallback.

`CompletedWorkoutCard.tsx:99-103` `formatSecs` — confirmed genuinely divergent, correctly excluded:
```js
function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${s}s`;
}
```
Unlike the canonical version, this has **no** "≥60 and remainder 0 → `N min`" collapse — a logged 120s set always renders `2:00`, never `2 min`. Confirmed semantically distinct (logged-set precision vs. prescription-display brevity); leave it alone.

## Attack 3 — prescription-prefill substitution (evidence: `src/lib/prescription-prefill.ts` full read + `WorkoutLoggerForm.tsx` grep)

- `blockTypeLabel(block.type)` output feeds `sectionLabel` (line 85), which becomes `PrefilledExercise.blockLabel`. That field is consumed in exactly two places in `WorkoutLoggerForm.tsx`: line 241 (`if (p.blockLabel !== lastLabel)` — grouping/section-break comparison) and line 405 (`{prefillEntry?.blockLabel}` — rendered as a UI section header). It is **never** included in the form's submission payload — grep for `blockLabel` near any submit/action/FormData logic in that file returns nothing beyond those two lines, consistent with the type's own doc comment ("NEVER submitted"). So label-string identity is a pure-UI concern; since the map is byte-identical (Attack 2), swapping the import changes nothing observable.
- Map identity: confirmed identical, see Attack 2.
- Cycle check: `src/lib/program-template.ts` (read in full header) has zero imports — it's a pure type/const definitions file. `grep -n "prescription-prefill" src/lib/program-template.ts` returns nothing. `plan-format.ts` only needs types from `program-template.ts`. So the import graph is strictly `prescription-prefill.ts → plan-format.ts → program-template.ts`, one-directional. No cycle.

## Attack 4 — type-strictness / exact conditions (evidence: pasted bodies above)

All 3 `compactPrescription` copies and the 1 `prescriptionRight` copy use the **same three conditions**, verified line-for-line:
```js
if (ex.sets) parts.push(`${ex.sets}×`);                                  // truthy — NOT `!== undefined`
if (ex.reps !== undefined) parts.push(String(ex.reps));                  // undefined-check
if (ex.durationSec !== undefined) parts.push(formatSecs(ex.durationSec)); // undefined-check
```
No copy uses `ex.sets !== undefined`. This means `sets: 0` is silently omitted from all four functions today — pre-existing, consistent behavior across every copy. The shared `prescriptionParts` helper must reproduce `if (ex.sets)` exactly (truthy), not switch to an undefined-check, or a `sets: 0` exercise would newly render `"0×"` in the hoisted version — that would be a behavior change disguised as a pure refactor. Flag this explicitly to the implementer as a "preserve, don't upgrade" instruction.

## Attack 5 — defaultBlockLabel absorption (evidence: `page.tsx:417-433,471-484`)

Confirmed: `BlockCard` (Today page, lines 417-433) uses **both** helpers simultaneously and for different purposes:
- line 418: `const blockTitle = block.label ?? defaultBlockLabel(block.type);` → card **title**
- line 422: `{blockTypeLabel(block.type)}` → subtitle line under the title

They diverge only for `"straight"` (`"Strength"` vs `"Straight sets"`); identical for the other four types. Since a single component consumes both concurrently with different display roles, absorbing `defaultBlockLabel` into `plan-format.ts` would be scope creep with no dedup benefit (single consumer, single file). Ruling of NO-MOVE is correct.

## Attack 6 — other risks (evidence: file reads + greps)

- **Orphaned type imports**: none. `Block`/`ExercisePrescription` (and in `goals/[id]/plan/page.tsx`, `DayTemplate`/`Phase`/`ProgramTemplate`) remain used by surviving functions (`BlockCard`, `ExerciseRow`, `BlockView`, `DayCard`, etc.) in every migrating file — no file loses its last reason to import these types.
- **"use client" status**: `SnapshotView.tsx` and `PlanOverview.tsx` both read start-to-finish — neither has a `"use client"` directive; both are plain modules importable from server components today. `plan-format.ts` (types-only import from `program-template.ts`, no directives) is safe to import from either.
- **Type re-export**: confirmed unnecessary — every one of the 6 files already has its own `import type { Block, ExercisePrescription, ... } from "@/lib/program-template"` at the top; `plan-format.ts` does not need to re-export these.
- No other call sites of any of the four helpers exist anywhere in `src/` beyond what's enumerated in Attack 1 (verified via unscoped repo-wide grep, not per-file).

---

## Exact developer instructions

1. Create `src/lib/plan-format.ts` exporting `blockTypeLabel`, `formatSecs`, private `prescriptionParts`, `compactPrescription`, `prescriptionRight` exactly as specified — bodies are proven identical across all existing copies, condition-for-condition (see Attack 4: `if (ex.sets)` truthy, `ex.reps !== undefined`, `ex.durationSec !== undefined` — do not "fix" the sets=0 truthy check).
2. Delete the local copies and wire imports per file, importing **only** what each file actually calls directly (see Attack 1 table):
   - `src/app/page.tsx` → import `blockTypeLabel`, `formatSecs`. Leave `defaultBlockLabel` and `ExerciseRow`/`BlockCard` untouched.
   - `src/app/days/[dateKey]/page.tsx` → import `blockTypeLabel`, `compactPrescription`. **Not** `formatSecs`.
   - `src/app/goals/[id]/plan/page.tsx` → import `blockTypeLabel`, `prescriptionRight`, `compactPrescription`. **Not** `formatSecs`.
   - `src/components/SnapshotView.tsx` → import `compactPrescription` only. **Not** `formatSecs`, **not** `blockTypeLabel` (this file never used it — its `BlockSnapshot` intentionally falls back to raw `block.type`; leave that as-is, out of scope).
   - `src/components/PlanOverview.tsx` → import `formatSecs` only (the ternary at line 59).
   - `src/lib/prescription-prefill.ts` → import `blockTypeLabel` only.
3. Do not touch `src/components/days/CompletedWorkoutCard.tsx` (divergent `formatSecs`), Today's `defaultBlockLabel`/`ExerciseRow`/`BlockCard` in `page.tsx`, or plan page's `BlockView` — all confirmed out of scope.
4. Add `plan-format.test.ts` covering: the 5-arm `blockTypeLabel` switch; `formatSecs` boundary cases (`59s`→`"59s"`, `60s`→`"1 min"`, `61s`→`"1:01"`, `120s`→`"2 min"`); `compactPrescription`/`prescriptionRight` with `sets: 0` (must omit the sets part, matching current behavior) and with all-fields-absent (`compactPrescription` → `"—"`, `prescriptionRight` → `""`).
5. Run `npx tsc --noEmit` and `npm run lint` after wiring — the over-import risk in step 2 is not build-blocking per current `tsconfig`/`eslint` config, but avoid it anyway per the ticket's own dedup goal.
