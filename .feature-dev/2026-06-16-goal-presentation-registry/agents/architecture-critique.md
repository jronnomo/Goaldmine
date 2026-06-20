# Architecture Critique — Goal-Presentation Registry (#67)

Devil's Advocate pass. All findings are grounded in direct file reads and grep output.

---

## Critical

### C-1 — `fmtComma` export vs. import split: developer must not conflate the two

**Evidence:** grep of `src/lib/recap-card.tsx` for all three formatter names:

```
recap-card.tsx:13  function fmtComma(n: number): string {
recap-card.tsx:18    return v === null ? "—" : `${fmtComma(v)} lb`;   ← inside fmtVolume
recap-card.tsx:22    return v === null ? "—" : `${fmtComma(v)} ft`;   ← inside fmtElevation
```

`fmtComma` is referenced **only inside the bodies of `fmtVolume` and `fmtElevation`** — never directly in JSX or elsewhere in the file. After the hoist:

- `goal-presentation.ts` must **export** `fmtComma` (blueprint says so; #70 will `import { fmtComma }` to unit-test it).
- `recap-card.tsx` must **not** import `fmtComma` — it only calls `fmtVolume` and `fmtElevation`. The import is:
  ```ts
  import { fmtVolume, fmtElevation } from "@/lib/goal-presentation";
  ```

**Risk:** a developer who reasons "recap-card doesn't need fmtComma, so why export it?" will silently break the #70 test story. Conversely, a developer who imports `fmtComma` into `recap-card.tsx` out of caution will get an ESLint `no-unused-vars` failure (`npm run lint` gate).

The blueprint's "grep first" instruction is correct but leaves the conclusion unstated. **The Developer must know explicitly:** export it from `goal-presentation.ts`, do NOT import it in `recap-card.tsx`.

**Fix:** Add one sentence to the blueprint's MODIFY block: "Post-hoist, `fmtComma` has no direct call sites in `recap-card.tsx`; import only `{ fmtVolume, fmtElevation }`."

---

## Concerns

### W-1 — Purity verification grep is false-positive-prone on `\bpath\b`

**Blueprint invariant (`architecture-blueprint.md` §Invariants):**
```
grep -nE "@/lib/(db|calendar)|generated/prisma|require\(|^import .*\bfs\b|\bpath\b"
```

The `\bpath\b` token matches **any line containing the word "path"** — comments, string literals, variable names, type aliases. A future commit could add a comment like `// resolve the icon path to …` and the grep would fire, confusing the QA agent into thinking the module is impure.

A tighter check:
```
grep -nE '@/lib/(db|calendar)|generated/prisma|require\(|from "fs"|from "path"'
```

**Severity:** low — will never cause a build failure; only affects the CI self-check step. Fix before the invariant is relied on in #70.

### W-2 — `legendDefault: "fitness" | "project"` is a closed union that must grow

**Evidence:** `src/lib/legend.ts` exports `DEFAULT_LEGEND` and `PROJECT_DEFAULT_LEGEND`; `resolveLegend` dispatches on `goal.kind === "project"`. The proposed `GoalPresentation.legendDefault` type (`PRD §3`) mirrors those two values.

When a third goal kind (e.g., `"marathon"`, `"financial"`) ships, the developer will have to:
1. Extend the union in `GoalPresentation` (breaking if any consumer does exhaustive matching), AND
2. Add a third entry to whatever lookup table #72–#74 build on top of `legendDefault`.

The values `"fitness"` and `"project"` also perfectly coincide with `goal.kind` values, making `legendDefault` **redundant with `kind`** for the two known cases. A consumer in #72 that reads `presentation.legendDefault` could just as well read `goal.kind` — these fields carry the same information today.

**Fix (for #72–#74, not for this story):** Document in `goal-presentation.ts` that the lookup is `{ fitness: DEFAULT_LEGEND, project: PROJECT_DEFAULT_LEGEND }` and that extending requires both this union and that map. Or widen `legendDefault` to `string` with a JSDoc comment listing valid values. Neither is urgent for #67, but the Developer should note it as a follow-up debt.

### W-3 — Blueprint does not explicitly guard the hardcoded `"READINESS"` strings in `recap-card.tsx`

**Evidence:** `recap-card.tsx` lines 426 and 855 contain the literal string `READINESS`. These are the fitness-vertical ring labels that #69 will eventually replace by reading `presentation.ringLabel`.

A developer who reads the blueprint and sees `FITNESS_PRESENTATION.ringLabel = "READINESS"` might reasonably infer "oh, I can already wire the card to the registry while I'm in here." That would be **scope creep** — this story explicitly defers all consumer rewiring to #69.

**Fix:** Add a comment in the blueprint's MODIFY block: "Do NOT touch the `READINESS` string literal at lines 426/855 — those are wired in #69, not here."

### W-4 — Pre-existing elevation formatting inconsistency not introduced by hoist, but worth noting

**Evidence:** `src/lib/recap.ts:374`:
```ts
label: `${h.route} — ${h.distanceMi.toFixed(1)} mi · ${new Intl.NumberFormat("en-US").format(h.elevationFt)} ft`
```

This formats elevation for highlight labels using `Intl.NumberFormat("en-US")` **without** `{ maximumFractionDigits: 0 }`. The hoisted `fmtElevation` uses `fmtComma` which does pass `maximumFractionDigits: 0`. For integer `elevationFt` values the outputs are identical; for a hypothetical float they would differ. This is a PRE-EXISTING inconsistency — the hoist neither creates nor fixes it. The Developer should not attempt to "fix" it in this story.

---

## Suggestions

### S-1 — `Intl.NumberFormat` in Satori: confirmed safe, no action needed

`recap-card.tsx:14` already calls `new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)` inside the component file that Satori serializes, and the build is green. Moving the same call to `goal-presentation.ts` (which `recap-card.tsx` imports) changes nothing about the Satori execution environment. Confirmed safe.

### S-2 — `WeeklyRecap` field names in `StatSource.recapField` match exactly

Verified by direct read of `src/lib/recap.ts:84–107`:
| `recapField.field` value | `WeeklyRecap` field | TypeScript type | `StatFormat` |
|---|---|---|---|
| `"workoutsCompleted"` | `workoutsCompleted` | `number` | `"int"` |
| `"volumeLb"` | `volumeLb` | `number \| null` | `"volumeLb"` |
| `"prCount"` | `prCount` | `number` | `"int"` |
| `"hikeElevationFt"` | `hikeElevationFt` | `number \| null` | `"elevationFt"` |

No typos. The null-able fields (`volumeLb`, `hikeElevationFt`) correctly pair with formats that call formatters that handle null (`fmtVolume(null) → "—"`, `fmtElevation(null) → "—"`). Type-safety for the #68 `resolveStatSlot` consumer is solid.

### S-3 — No other consumers of `fmtComma`/`fmtVolume`/`fmtElevation` exist in `src/`

Grep confirms the three formatters exist exclusively in `recap-card.tsx`. `recap-render.tsx` (which uses `fs`/`path`) imports `RecapCard`/`RecapStorySlide` from `recap-card.tsx` but does not import the formatters directly. The hoist leaves zero dangling references outside the two files being touched.

### S-4 — `PROJECT_PRESENTATION` anti-vertical invariants check out

From blueprint §1.4 and PRD §5:
- `ringLabel: "PROGRESS"` (not "TRACTION") — explicitly present in both documents ✓
- Exactly 2 stat slots (MRR `logLatest`, MILESTONES `scheduledItem/doneOverTotal`) ✓
- `restCopy: null` ✓
- No Subs, no Conversion, no Churn ✓

### S-5 — `DEFAULT_PRESENTATION` spread is safe

`DEFAULT_PRESENTATION: { ...FITNESS_PRESENTATION, kind: "__default__" }` means it inherits `legendDefault: "fitness"`. No consumer reads `legendDefault` in this story. Safe.

---

## Verdict

**APPROVE-WITH-FIXES**

The design is architecturally sound. No finding would cause a build failure if the Developer follows the blueprint carefully. Two fixes are needed before handoff to the Developer:

1. **Blueprint MODIFY block** — add one sentence: "Post-hoist, `fmtComma` has no direct call sites in `recap-card.tsx`; import only `{ fmtVolume, fmtElevation }`. Export `fmtComma` from `goal-presentation.ts` anyway — #70 needs it."
2. **Blueprint MODIFY block** — add one sentence: "Do not touch the `READINESS` literal at lines 426/855 in `recap-card.tsx` — that rewire is #69."

The verification grep for `\bpath\b` (W-1) should be tightened before the #70 test story uses it as a CI gate.

---

**The single most important thing the Developer must get right:**

Export `fmtComma` from `goal-presentation.ts` but do NOT import it in `recap-card.tsx`. These are two independent facts that point in opposite directions, and conflating them causes either a broken #70 test story (if `fmtComma` is not exported) or a lint failure (if `fmtComma` is imported into `recap-card.tsx` unused).
