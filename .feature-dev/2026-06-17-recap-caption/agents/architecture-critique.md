# Architecture Critique — Recap Caption Composer (#92)

**Role:** Devil's Advocate · **Reviewer:** Sonnet 4.6 · **Date:** 2026-06-17
**Against:** `architecture-blueprint.md` (same directory)
**Verified against:** `src/lib/recap.ts` (live file), `vitest.config.ts`, `tsconfig.json`, `src/lib/goal-presentation.test.ts`

---

## Verdict

**APPROVE WITH ONE BLOCKING FIX.** The architecture is sound in all major respects. The `import type` purity claim is correct and self-enforcing. All fixtures are type-complete. Section assembly, null guards, and `emptyWeek` precedence are correct. One finding is a blocker: the truncation test never actually exercises the truncation code path. Everything else is concerns, minors, and suggestions.

---

## Critical (Blocker)

### CRIT-1 — Truncation test uses a 800-char objective that never triggers truncation

**Blueprint claim:** `"A".repeat(800)` tests the truncation path and the `expect(caption.length).toBeLessThanOrEqual(2200)` assertion validates it.

**Reality:** With `programWeek: 7, dayOfProgram: 46`, objective `"A"×800`, plus PR_HIGHLIGHT, all four stat slots, `streakDays: 12`, and hashtags, the full assembled caption is approximately **948 characters** (verified with Node.js arithmetic):

```
opener:     818  ("Week 7 · Day 46 — " [18] + "A"×800)
highlight:   32  ("🏆 Goblet Squat — 65 lb — new PR"; 🏆.length=2)
stats:       40
streak:      16  ("🔥 12-day streak"; 🔥.length=2)
hashtags:    34
separators:   8  (4× "\n\n")
TOTAL:      948  ← well under 2200
```

`truncateCaption` hits `full.length <= LIMIT` → returns immediately. The `rebuildWithoutStats` function is never called. The `slice(0, 2197) + "…"` line is never reached. The assertion `caption.length <= 2200` passes trivially on a 948-char string: it proves nothing about truncation.

**Why this matters:** The entire purpose of the truncation test is to prove that a pathologically long caption is correctly cut. As written, it tests the happy path twice. A regression that broke `truncateCaption` entirely (e.g., it returned the raw untruncated string) would pass this test.

**Minimum objective length to actually trigger step 1** (full > 2200): **2095 chars** (computed: `2200 - 18_opener_prefix - 32_highlight - 40_stats - 16_streak - 34_hashtags - 8_seps + 1 = 2095`). Because stats are dropped before step 2, `rebuildWithoutStats` only needs to fit 906 chars (opener + rest without stats), so the same 2095-char objective also exercises step 2 (goes from full > 2200 → drop stats → also > 2200 → hard-trim).

**Fix:** Replace `"A".repeat(800)` with `"A".repeat(2200)` (guaranteed to exceed both steps, leaves no room for math errors):

```ts
it("caption never exceeds 2200 chars — truncation exercised", () => {
  const longObjRecap: WeeklyRecap = {
    ...FITNESS_RECAP,
    goal: { ...FITNESS_RECAP.goal!, objective: "A".repeat(2200) },
  };
  const caption = composeCaption(longObjRecap, PR_HIGHLIGHT);
  expect(caption.length).toBeLessThanOrEqual(2200);
  // Also verify the truncation actually happened — it shouldn't equal the raw output:
  expect(caption.endsWith("…")).toBe(true);
});
```

The `endsWith("…")` assertion is the canary: if truncation never fires, the caption ends with `#goaldmine`, not `"…"`.

---

## Concerns (Non-blocking but require developer attention)

### CON-1 — Blueprint claims IG API limit is "2,200 bytes" — it is 2,200 characters (codepoints)

**Blueprint (§4, first paragraph):** "the API rejects captions longer than 2,200 bytes."

**Reality:** Instagram's limit is 2,200 **Unicode codepoints** (characters), not bytes. A single emoji like 🔥 (U+1F525) is 1 codepoint but 4 bytes in UTF-8 and 2 units in UTF-16. Calling it a byte limit is incorrect and would alarm a future reader wondering why emoji-heavy captions are not being caught.

**Does the wrong claim cause a wrong implementation?** No — and here is why. JavaScript's `.length` counts UTF-16 code units (surrogate pairs contribute 2 units per codepoint). Since `string.length >= codepoints` for any valid JS string (emoji inflate length, never shrink it), using `.length <= 2200` as the guard is **conservative**: it may truncate an emoji-heavy caption slightly earlier than Instagram requires, but it can NEVER let an over-limit caption through. The `slice(0, 2197) + "…"` hard-trim therefore produces at most 2198 UTF-16 units, which is at most 2198 codepoints — always under Instagram's 2,200-codepoint limit.

**Fix:** Correct the comment in the blueprint and in the source file comment. Change "2,200 bytes" to "2,200 characters (Unicode codepoints)." Add a note that `.length` is a safe conservative proxy because `length >= codepoints`. No code change needed.

### CON-2 — `KIND_HASHTAG[kind] ?? "#goals"` fallback is invisible to TypeScript

**Blueprint (§3, Section 5):** Uses `KIND_HASHTAG[kind] ?? "#goals"` where `KIND_HASHTAG: Record<string, string>`.

**Confirmed:** `tsconfig.json` does NOT enable `noUncheckedIndexedAccess` (only `"isolatedModules": true` and `"strict": true`). Under standard TypeScript strict mode without `noUncheckedIndexedAccess`, indexing a `Record<string, string>` with any string key returns `string` (not `string | undefined`). TypeScript considers `KIND_HASHTAG["unknown-kind"]` to be `string`, making the `?? "#goals"` unreachable from the type system's perspective. The `??` works correctly at runtime (JavaScript index access returns `undefined` for missing keys, and `undefined ?? "#goals"` yields `"#goals"`), but the type contract is misleading.

**Risk:** A developer adding `noUncheckedIndexedAccess` in the future would suddenly see the null-check as necessary. More immediately, a future reviewer might delete the `?? "#goals"` as "dead code" after trusting the type. That would silently emit `"#buildinpublic undefined #goaldmine"` for any new goal kind.

**Fix:** Annotate the map type explicitly to expose the optionality:

```ts
const KIND_HASHTAG: Partial<Record<string, string>> = {
  fitness: "#fitness",
  project: "#projectgoal",
};
```

`Partial<Record<string, string>>` makes the return type `string | undefined`, so the `?? "#goals"` is type-visible and the compiler will flag any attempt to remove it. Alternatively, use a `Map<string, string>` with `.get(kind) ?? "#goals"`.

### CON-3 — `header.programWeek` and `header.weeksToTarget` can both be non-null simultaneously

**Blueprint (§3, Opener):** The `buildOpener` function checks `header.programWeek !== null` first; if true, takes the fitness path and never checks `header.weeksToTarget`.

**Confirmed from `recap.ts:457-492`:** The `header` object is constructed in two branches:
- No plan (`!plan`): `programWeek: null, dayOfProgram: null, totalProgramDays: null, weeksToTarget, targetDateLabel`
- With plan: `programWeek, dayOfProgram, totalProgramDays, weeksToTarget, targetDateLabel`

`weeksToTarget` is set at step 10: only if `presentation.headerStyle === "weeks-to-target" && goal?.targetDate`. The fitness presentation has `headerStyle: "program-week"` so for a fitness focus goal, `weeksToTarget` stays null. But if a user has an **active fitness plan** (so `plan !== null` → `programWeek` gets set) AND their **focus goal is `kind: "project"`** (so `presentation.headerStyle === "weeks-to-target"` and `weeksToTarget` gets set), then both `programWeek !== null` AND `weeksToTarget !== null` simultaneously.

In that state, `buildOpener` would emit `"Week 7 · Day 46 — Ship Chewgether to the App Store"` — a fitness-frame opener for a project goal. This is unlikely but architecturally valid since the DB doesn't enforce that a focus project goal can't coexist with an active fitness plan.

**Blueprint coverage:** None. No fixture covers this. No edge-case entry in §7.

**Fix:** Add to §7 edge case table. Consider checking `recap.goal?.kind` (or `presentation.headerStyle` if surfaced) rather than `header.programWeek` to select the opener branch. Or document the known limitation and accept the fitness-frame fallback as intentional. At minimum, add a comment in `buildOpener` explaining the priority.

---

## Minor / Nitpicks

### MIN-1 — Blueprint terminology: "1 byte" for `"…"` is wrong

**Blueprint (§7, "Very long goal.objective" row):** "Verify the `'…'` char is 1 byte in the `.length` check."

**Reality:** U+2026 (HORIZONTAL ELLIPSIS) is in the Basic Multilingual Plane. It occupies **1 UTF-16 code unit** (JavaScript `.length === 1`), which is 2 bytes in UTF-16 encoding and 3 bytes in UTF-8. The `.length` behavior is correct (the claim is right numerically) but the word "byte" is wrong — it should say "1 UTF-16 code unit" or just "`.length === 1`."

Confirmed in Node.js: `"…".length === 1`.

### MIN-2 — No explicit warning against defensive `vi.mock("@/lib/db")` in the test

**Blueprint (§5):** Correctly states no `vi.mock` is needed. Does not warn against adding one.

**Risk:** A developer following the pattern from `goal-presentation.test.ts:19` might add `vi.mock("@/lib/db", () => ({ prisma: {} }))` to the caption test "just in case," especially when the test file lives alongside the other test that does need it. This mock, if added, would silently paper over a broken purity invariant: if `recap.ts` were accidentally loaded at runtime (e.g., a value import snuck in), the mock prevents the "DATABASE_URL is not set" throw that would otherwise immediately surface the violation.

The test is designed to be self-enforcing — its DB-freedom IS the contract proof. Adding the mock disconnects the test from that proof.

**Fix:** Add a comment at the top of `recap-caption.test.ts`:

```ts
// NO vi.mock("@/lib/db") here. recap-caption.ts uses import type only —
// recap.ts never loads at test time. If this test ever throws
// "DATABASE_URL is not set", a runtime import from recap.ts has snuck in;
// fix the import, do NOT add a mock to silence the error.
```

---

## Suggestions (No action required, take or leave)

### SUG-1 — Add one test explicitly covering `rebuildWithoutStats` path isolation

Even with CRIT-1 fixed, consider a second truncation test that verifies stats are absent after drop-and-rebuild, not just that length ≤ 2200:

```ts
it("truncation drops stats first — truncated caption contains no stat labels", () => {
  const longObjRecap: WeeklyRecap = {
    ...FITNESS_RECAP,
    goal: { ...FITNESS_RECAP.goal!, objective: "A".repeat(2200) },
  };
  const caption = composeCaption(longObjRecap, null);
  expect(caption).not.toContain("WORKOUTS");
  expect(caption).not.toContain("VOLUME");
  expect(caption).toContain("#goaldmine"); // hashtags survive
  expect(caption.length).toBeLessThanOrEqual(2200);
});
```

### SUG-2 — `"A".repeat(2200)` alone doesn't reach step 2 if highlight is null

With no highlight, the step-2 path (`withoutStats > 2200`) needs the opener alone to exceed 2200. Confirm by varying which sections are present:

- With `PR_HIGHLIGHT`: `opener(2218) + \n\n + highlight(32) + \n\n + streak(16) + \n\n + hashtags(34) + 3*2 = 2318 → full > 2200 → drop stats → withoutStats = 2318 → still > 2200 → step 2 hard-trim`. ✓
- Without highlight: `opener(2218) + \n\n + streak(16) + \n\n + hashtags(34) + 2*2 = 2274 → full > 2200 → drop stats → withoutStats = 2274 → step 2`. ✓ Either way, `"A".repeat(2200)` exercises both steps.

### SUG-3 — `weeksToTarget === 0` deserves a small assertion in the invariant block

The §7 table mentions it as "0 weeks to Sep 30 — … — truthful, not filtered." One line in the all-null or no-goal test would confirm it:

```ts
// header.weeksToTarget === 0 is honest — not skipped
const dueThisWeek = { ...PROJECT_RECAP, header: { ...PROJECT_RECAP.header, weeksToTarget: 0 } };
expect(composeCaption(dueThisWeek, null)).toContain("0 weeks to Sep 30");
```

---

## Verified-Correct (no action needed)

| Claim | Status |
|-------|--------|
| `import type` erases at compile time, recap.ts never loaded | **Confirmed.** `isolatedModules: true` in tsconfig enforces this; Vite/esbuild strip type imports. `recap.ts:16` has `import { prisma } from "@/lib/db"` as a live runtime import that would throw without a DB URL — the test's DB-freedom is real. |
| Fixture type-completeness (all `WeeklyRecap` required fields present) | **Confirmed.** All 18 required fields on `WeeklyRecap` (recap.ts:103-128) are present in FITNESS_RECAP, PROJECT_RECAP, EMPTY_WEEK_RECAP, and all spread variants. `RecapGoalBlock` (recap.ts:67-76) fields all present. No tsc errors expected. |
| `emptyWeek` precedence over `buildStatsLine` | **Confirmed.** EMPTY_WEEK fixture has `statSlots` with `isNull: false` entries (`WORKOUTS "0"`, `NEW PRs "0"`). A statSlots-first check would emit `"WORKOUTS 0 · NEW PRs 0"` — dishonest. Blueprint correctly guards with `if (recap.emptyWeek)` before calling `buildStatsLine`. |
| All-null statSlots → empty string → section not pushed → no dangling separator | **Confirmed.** `buildStatsLine` returns `""` when `active.length === 0`; `if (statsLine)` is falsy. `sections.join("\n\n")` never produces triple newlines because empty strings are never pushed. |
| Highlight `sub === null` → no dangling ` — ` suffix | **Confirmed.** `h.sub !== null ? ... : \`${h.icon} ${h.label}\`` handles it cleanly. |
| `streak === 0` → streak section skipped | **Confirmed.** `if (recap.streakDays > 0)` guards the push. |
| `goal === null` → no kind tag in hashtags | **Confirmed.** `recap.goal?.kind ?? null` → `buildHashtags(null)` → `kindTag = null` → filtered out → `"#buildinpublic #goaldmine"`. |
| `"…".length === 1` → hard-trim produces ≤ 2200 chars | **Confirmed.** `slice(0, 2197) + "…"` = 2197 + 1 = 2198 ≤ 2200. |
| Goal-generic: composer source clean of hardcoded verticals | **Confirmed by inspection.** `"Summit Mt. Elbert"` appears only inside test fixture strings (data), never in the composer logic. `KIND_HASHTAG` maps category strings to tag strings; no vertical content appears in the template. |
| `\n\n` join produces no leading/trailing blank lines | **Confirmed.** `Array.join("\n\n")` inserts separator only BETWEEN elements. Opener and hashtags are always present so the array always has ≥ 2 elements. |

---

## Summary

| ID | Severity | Title | Fix required? |
|----|----------|-------|---------------|
| CRIT-1 | **Blocker** | Truncation test uses 800-char objective — truncation never fires | Yes — use `"A".repeat(2200)` + `endsWith("…")` assertion |
| CON-1 | Concern | IG limit described as "2200 bytes" not "2200 characters" | Comment fix only |
| CON-2 | Concern | `KIND_HASHTAG[kind] ?? "#goals"` invisible to tsc without `noUncheckedIndexedAccess` | Annotate map as `Partial<Record<string, string>>` |
| CON-3 | Concern | `programWeek` + `weeksToTarget` both non-null (project goal + fitness plan) unhandled | Document or add branch-by-kind check |
| MIN-1 | Nitpick | "1 byte" should be "1 UTF-16 code unit" | Comment fix |
| MIN-2 | Minor | No guard against defensive `vi.mock("@/lib/db")` in test | Add comment to test file |
| SUG-1 | Suggestion | Add `not.toContain("WORKOUTS")` assertion on truncated caption | Optional |
| SUG-2 | Suggestion | Verify `weeksToTarget === 0` is not filtered | Optional |

---

## The Single Most Important Thing the Developer Must Get Right

**Fix the truncation test (CRIT-1).** Change `"A".repeat(800)` to `"A".repeat(2200)` and add `expect(caption.endsWith("…")).toBe(true)`. With 800 chars the truncation code path is unreachable — the full caption is 948 chars, the fast-path returns on line 1 of `truncateCaption`, and `rebuildWithoutStats` is dead code in the test suite. A refactor could delete the entire truncation implementation and all tests would still pass. The `endsWith("…")` assertion is the load-bearing proof that the hard-trim actually ran.
