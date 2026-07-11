# Devil's Advocate critique — PRD-250 de-founder MCP (2026-07-11)

## Verdict: APPROVE-WITH-CONDITIONS

The design is sound and the premise checks in the PRD hold up under independent re-verification. Three concrete gaps must be closed before/during implementation (not after): (1) the constant rename ripples into two `scripts/*.ts` files the PRD doesn't list, which will break `tsc --noEmit`; (2) the guard-test file-scope in AC#4's example grep command doesn't match the actual target-file list in FR §3.1 item 5 (misses `metrics-registry.ts`'s real path); (3) the guard-test token list needs exact word/phrase scoping to avoid false-positiving on legitimate generic content (`snowboard`, bare `155`) that survives in the *same files* post-edit. All three are fixed below with exact prescriptions. No attack found a reason to block or redesign.

---

## Attack 1 — Coaching-quality regression (orphan facts)

Read `src/lib/mcp/instructions.ts:30-33` and traced each fact against what `get_session_brief` (tools.ts:1337-1637) and `get_today_plan` (tools.ts:552-632) actually deliver live:

| Fact in :30-33 | Live equivalent? | Evidence |
|---|---|---|
| "159 lb ... toward 155 lb lean" | **Yes** | `get_session_brief.weightTrend` (tools.ts:1525-1538: latest/delta7d/delta30d from Measurement rows); the 155 target itself is stored in `Goal.targets` (`metrics-registry.ts:438-446`, `weightLb` metric) and readable via `get_goal`. |
| "male" | **N/A — unused** | Zero references to gender/sex anywhere in `src/lib` (`grep -rln "gender\|\bsex\b" src/lib` → empty). Nothing computes off it. Pure decoration; dropping it changes no behavior. |
| "Hero goal: Mt. Elbert via Black Cloud Trail (~11mi/~5,200ft/14,440ft)" | **Yes** | These are the user-entered `Goal.objective`/description-equivalent fields, readable per-tenant via `list_goals`/`get_goal` — each tenant's own goal already carries their own route facts. Not founder-only. |
| "Secondary: shredded, snowboard, hike + backpack" | **Yes** | Surfaced via `list_goals` (other goals) / legend flavor, not instructions-only. |
| "Plan is 12-ish weeks, 3 phases" | **Yes** | `get_today_plan`/`get_session_brief` return week/phase (per tool description tools.ts:1350, and PlanOverview reads `Plan.weeks`/`endsOn` per instructions.ts rule 4, which is being kept). |
| "Two active goals: Mt. Elbert (fitness/focus) and Chewgether (project)" | **Yes** | `list_goals` delivers exactly this, generically, for any tenant. |
| **"Home gym: StairMaster, stationary bike, dumbbells to 65 lb. Loves outdoor running."** | **No live equivalent — genuine orphan** | Checked `prisma/schema.prisma`: the only `equipment` field (line 82) is per-*logged-exercise* equipment on `WorkoutExercise` (what was used in a specific past workout), not a home-gym inventory the coach can query before prescribing. No tool surfaces "what equipment is available to this user." |

**Ruling: one true orphan** — the equipment/terrain-preference line. Everything else in :30-33 is redundant with live tool reads and safe to delete outright, exactly as the PRD's premise-check claims.

**Prescribed remediation.** The PRD's Core Requirement #1 says rules/principles/rhythms (:40-135) stay untouched, but Edge Cases (§6, row 4) explicitly asks the DA to rule on adding an equipment line — these two statements are in tension. Resolve it by treating this as a pure *addition*, not a modification: append a new numbered rule **after rule 14**, before the "Project goal operating rhythm" section, so rules 1-14's existing text stays byte-identical (satisfies the spirit of "untouched") and only new content is added:

```
15. Equipment and terrain aren't tracked as structured fields. When prescribing new exercises, routes, or gear-dependent work, don't assume a specific home-gym setup or terrain access — check recent workout/hike history for what's actually been used, or ask the user directly.
```

This is generic (no founder nouns), preserves force (still tells the coach to actively ground the prescription instead of guessing), and closes the one real gap.

---

## Attack 2 — Covenant force (instructions.ts:38)

Full text as it stands today:

> `- set_active_goal switches which goal is active/focus. Propose-before-switching covenant: call list_goals to show both goals and their current states, state what will change, get explicit user approval before calling set_active_goal. Warn the user when they are mid-program on fitness: flipping isFocus to the project goal suspends the daily prescription for Mt. Elbert and changes what Today surfaces — confirm this is intentional before applying.`

Two founder-coupled defects beyond the proper noun: it says "**both** goals" (hardcodes exactly 2 goals — breaks for any tenant with 3+ goals) and it's written unidirectionally ("flipping isFocus **to the project goal**" — only warns fitness→project, not fitness→fitness or the reverse).

**Prescribed rewrite** (preserves force, generalizes correctly, drops the proper noun):

```
- set_active_goal switches which goal is active/focus. Propose-before-switching covenant: call list_goals to show all goals and their current states, state what will change, get explicit user approval before calling set_active_goal. Warn the user whenever the switch moves focus away from a fitness goal that is mid-program: doing so suspends that goal's daily prescription and changes what Today surfaces — confirm this is intentional before applying.
```

This is strictly more correct than the original (now covers switching away from *any* mid-program fitness goal, not just the one named Mt. Elbert, and not just fitness→project), not just de-personalized.

---

## Attack 3 — Guard-test token list and scoping

Verified every candidate token against the actual scoped files for false positives:

- **`Elbert`** (case-insensitive substring) — clean. Only hits in scope are the ones being fixed (`instructions.ts:30`, `tools.ts:1881,2752,4417`, `metrics-registry.ts:350,364,385,395,457`, `goal-targets.ts:23,65`). Catches `MT_ELBERT_DEFAULT_TARGETS` and `elbert-ready` too.
- **`Chewgether`** (case-insensitive) — clean. Only in `github-tools.ts` (×5) and `project-tools.ts:775`. **Not** present anywhere in `tools.ts` itself (verified — don't assume it needs scanning there beyond the other tokens).
- **`jronnomo`** (case-insensitive) — clean **only if the guard test's file list matches the PRD's item-5 list exactly**. `jronnomo` also appears in `src/lib/food-actions.ts:256` (`"Goaldmine/1.0 (github.com/jronnomo/goaldmine)"`, a legitimate OpenFoodFacts API User-Agent identifier) and in `src/lib/mcp/today-shapers.test.ts` (a test fixture, explicitly out of scope per PRD §3.2). **If the guard test globs broader than the prescribed 5 files/dirs (e.g. `src/lib/**`), it will false-positive on `food-actions.ts`.** Scope the fs-read list to exactly: `instructions.ts`, `badges.ts`, `tools.ts`, `tools/github-tools.ts`, `tools/project-tools.ts`, `tools/render-tools.ts`, `metrics-registry.ts` — no directory globbing.
- **`Black Cloud`** (case-insensitive phrase) — clean. Only `instructions.ts:30` and `metrics-registry.ts:385`.
- **`155 lb`** (literal phrase, not bare `155`) — clean, and phrase-scoping matters: bare `155` risks colliding with unrelated numerics later (line counts in comments, unrelated targets). Only 2 hits today (`instructions.ts:30`, `tools.ts:3614`), both being fixed.
- **`159 lb`** (literal phrase) — same rationale, `instructions.ts:30` only.
- **Do NOT ban `snowboard`.** It reads as founder-flavored in the deleted line 30, but it is also a legitimate, generic goal-flavor/legend-preset name used in code that **stays**: `instructions.ts:108` (rule 11, explicitly untouched per Core Req #1), `tools.ts:3860` and `:3905` (flavor enum + error message). Banning it would make the guard test fail against the surviving, correct post-edit files.
- **Do NOT ban `El` or `"El"` as a monogram token.** Word-boundary variants would false-positive on unrelated words (Elevation, etc.) and it's unnecessary — the badge id/name (`elbert-ready`/`Elbert Ready`) is already caught by the `Elbert` token; once renamed to `summit-ready`/`Summit Ready`/`SR` there's nothing left for a 2-char token to catch.
- **`StairMaster`/`dumbbells to 65 lb`** — no guard token needed. These die with the deleted :30-33 block and are generic equipment nouns that legitimately could appear in other tenants' future context; don't blocklist real-world gym-equipment names.

**Final guard-token list**: `elbert`, `chewgether`, `jronnomo`, `black cloud`, `155 lb`, `159 lb` — all case-insensitive substring or literal-phrase matches — applied only to the 7 explicit file paths above (no directory globbing).

---

## Attack 4 — Badge rename ripple

Re-verified independently (not just trusting the PRD's "DISSOLVED" claim):

- `evaluateBadges()` (`badges.ts:316-331`) recomputes `BADGE_CATALOG`/unlock dates from `EngineContext` (Hike rows) on every call — no `id`/name is ever persisted to the DB. Confirmed via schema/grep: no table stores a badge id string.
- Monogram collision check: full catalog is `1st, PR, ×10, BS, RT, △, 10k, 3k, El→SR, 7d, 14d, 30d, 5c, HT, 7N, ✓`. `SR` does not collide with any existing monogram.
- `grep -rn "Elbert\|elbert-ready\|monogram" src/ tests` beyond `badges.ts` itself: no snapshot test, recap-card test, or BadgeWall test asserts on the `elbert-ready` id or `"Elbert Ready"`/`"El"` strings. `FeasibilityReadout.test.ts:209-218` asserts the *component* renders no `Elbert`/`Chewgether` strings — unrelated surface (dashboard UI), already passing, not affected by this rename.

**Confirmed clean — no migration, no ripple beyond the one file.**

---

## Attack 5 — github-tools example concreteness

Read `github-tools.ts:335-390` in full. The `jronnomo/Chewgether` examples appear 5×, all teaching the same thing: the required `owner/repo` format (vs. bare names or full URLs, both rejected by the Zod regex at :368-370). Any concrete-looking `owner/repo` pair works — there's no collision risk because this is documentation text, never parsed against a real registry.

**Prescribed replacements** (keep the same instructional shape at every site):

| Site | Old | New |
|---|---|---|
| `github-tools.ts:351` | "e.g. chewgether" | "e.g. a side project or startup" |
| `github-tools.ts:353` | `'jronnomo/Chewgether'` | `'acme/roadmap-app'` |
| `github-tools.ts:354` | Bare `'Chewgether'` | Bare `'roadmap-app'` |
| `github-tools.ts:369` (Zod regex message) | `jronnomo/Chewgether` | `acme/roadmap-app` |
| `github-tools.ts:373` (input describe) | `'jronnomo/Chewgether'` | `'acme/roadmap-app'` |
| `project-tools.ts:775` | "(e.g. chewgether)" | "(e.g. a side project)" |

Note: `github-tools.ts:485` also has a code **comment** — `// Acceptable at Chewgether scale (2 open PRs)` — referencing Chewgether. This is explicitly out of scope per PRD §3.2 ("code comments... internal, data-not-hardcode") and won't trip the guard test (comments aren't served to tenants). Leave it; flagging only so it isn't mistaken for a missed instance during review.

---

## Attack 6 — Instructions/rename blast radius

1. **No test asserts instruction content.** Confirmed via `grep -rln "COACH_INSTRUCTIONS\|from \"@/lib/mcp/instructions\"" src` → only the two route files and `instructions.ts` itself import it; `tools.ts:1350` merely *mentions* the string "COACH_INSTRUCTIONS" in a tool description as a pointer, it doesn't import or assert content. No `.test.ts` references either. Premise holds.

2. **`docs/coaching/coach-operating-manual.default.md` exists** (the file the header comment at instructions.ts:21-25 points to) and was independently re-checked: `grep -n "Elbert\|Chewgether\|155\|159\|Black Cloud\|jronnomo"` on it returns **zero matches**. It's already generic — no in-scope work needed there, contrary to a plausible worry.

3. **Real gap the PRD undercounts — constant rename ripple.** FR §3.1 item 4 says "`MT_ELBERT_DEFAULT_TARGETS` → `HIKE_DEFAULT_TARGETS` (+ 2 imports in goal-targets.ts)". Actual import sites, verified by `grep -rln "MT_ELBERT_DEFAULT_TARGETS"` across the whole repo:
   - `src/lib/goal-targets.ts:23` (re-export — the "+2 imports" the PRD likely means, though it's really 1 export line)
   - `src/lib/metrics-registry.ts:364` (the definition itself)
   - **`scripts/seed-goal.ts:7,30`** (imports + uses it directly) — **not in the PRD's file list**
   - **`scripts/apply-grounded-defaults.ts:6,20`** (imports + uses it directly) — **not in the PRD's file list**

   `tsconfig.json`'s `include` is `["**/*.ts", ...]` with no exclusion for `scripts/` — `npx tsc --noEmit` (required by AC #5) **will** type-check these two scripts and **will fail** if the export is renamed without updating them. This is a concrete, verifiable gate-breaker, not a hypothetical. **Add both `scripts/seed-goal.ts` and `scripts/apply-grounded-defaults.ts` to the rename's touch-list** (update the import + call site to `HIKE_DEFAULT_TARGETS` in both).

4. **AC #4's example grep command doesn't match the guard test's real scope.** PRD §8 AC#4: `grep -rn "Elbert" src/lib/mcp src/lib/game → 0`. But `metrics-registry.ts` (item 4's target) physically lives at `src/lib/metrics-registry.ts` — **outside both `src/lib/mcp` and `src/lib/game`**. A dev running that literal sanity-check grep after the edit would get a clean "0" even if `metrics-registry.ts` were left untouched, which is a false-negative trap. **Fix AC #4's grep example to**: `grep -rn "Elbert" src/lib/mcp src/lib/game src/lib/metrics-registry.ts src/lib/goal-targets.ts`. (The actual `no-founder-leak.test.ts` file list in FR item 5 is correct — this is a doc/AC fix, not a code fix.)

5. **`goal-targets.ts:65` and `program-template.ts`, `legend.ts:16,71`, `compare-core.ts:251` carry residual "Elbert" mentions** — all are code **comments**, explicitly out of scope per §3.2, and none are in the guard-test's 7-file list, so they won't trip it. Confirmed intentional, not missed.

6. **Both MCP routes verified to serve identical, byte-identical instructions.** `src/app/api/mcp/route.ts` and `src/app/api/mcp/[token]/route.ts` both `import { COACH_INSTRUCTIONS } from "@/lib/mcp/instructions"` directly — a single edit to `instructions.ts` fixes both routes with no duplication risk. Note (informational, not a blocker): the `[token]/route.ts` legacy route is *already* hard-scoped to `FOUNDER_USER_ID` via `runWithUser(FOUNDER_USER_ID, ...)` (per the recent commit `ce4273a`), so today it only ever serves the founder anyway — the actual multi-tenant leak vector is exclusively the Bearer-token `/api/mcp` route, which is static and not parameterized by `userId`. This matches the PRD's stated problem correctly.

7. **`MCP_SERVER_VERSION` mechanism confirmed**: `tools.ts:477` — `` `1.1.0+${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev"}` ``. Every deploy has a new commit SHA, so the version string changes on every deploy, which drives the claimed connector auto-refetch. Verified true, not aspirational.

---

## Attack 7 — Other findings

- **`update_goal_targets` example numbers** (`tools.ts:3614`): only `155 lb` is a verbatim match to the founder's actual stored target (`metrics-registry.ts:442`). The other two example numbers in the same string (`1.5-mi run ≤ 11:30`, `max pull-ups ≥ 12`) don't exactly match any stored founder value (the actual stored 1.5-mi target is 660s = 11:00, not 11:30) and read as already-generic placeholder examples — no change required there. **Prescribed replacement for the one that matters**: swap `155 lb` → `175 lb` (any round, non-matching number works; picked to avoid looking like a plausible real "lean target" coincidence with the founder's actual number).
- **No other founder-identifying literal** (email, real name beyond `jronnomo`, address, etc.) appears anywhere in the 7 scoped files — the token list above is exhaustive for this PRD's stated scope.

---

## Summary of implementation-constraining rulings

1. **Equipment orphan is real** — add rule 15 (exact text above) after rule 14; everything else in :30-33 is safely covered by live tools, delete outright.
2. **Covenant rewrite** (exact text above) — generalizes "both goals"→"all goals" and fixes the unidirectional-warning bug as a byproduct of de-personalizing.
3. **Guard-test tokens**: `elbert`, `chewgether`, `jronnomo`, `black cloud`, `155 lb`, `159 lb` (word/phrase-scoped) against exactly 7 named files — **do not** glob directories (catches `food-actions.ts` false-positive) and **do not** ban `snowboard` (breaks on surviving legitimate content in the same files).
4. **Rename ripple**: also update `scripts/seed-goal.ts` and `scripts/apply-grounded-defaults.ts` (2 more `MT_ELBERT_DEFAULT_TARGETS` import sites) or `tsc --noEmit` fails — PRD's "+2 imports" undercounts these.
5. **Fix AC #4's grep example** to include `src/lib/metrics-registry.ts src/lib/goal-targets.ts` (they're outside `src/lib/mcp`/`src/lib/game`).
