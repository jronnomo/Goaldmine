**Author**: Claude (Planning Lead) + Gabe
**Date**: 2026-07-03
**Status**: Approved
**Board**: Goaldmine Roadmap (#8) — Sprints 10–13
**Derived from**: `docs/ux-research/full-app-audit.md` (v2, 2026-07-02)
**Run artifacts**: `.roadmap/2026-07-03-audit-fixes/` (scope brief, architect blueprint, devil's-advocate critique)

# Roadmap: Fix the 2026-07-02 Full-App Audit Findings

## Context

The 2026-07-02 re-audit (`docs/ux-research/full-app-audit.md` v2) ran after multiuser + compare shipped to production: 19 new findings (N1–N19) + 4 open carry-overs (P5 per-route loading, P7 primitives, P8 a11y, N10 raw-JSON override form). This roadmap turns all of them into a sprint-assigned backlog on GitHub Project #8, built later story-by-story via `/feature-dev`. **Deliverable = plan docs + populated board, no production code.**

Scope lock (user decisions): all three waves; settings gets identity + sign-out now (delete-account/export → Backlog P2/P3); request-access becomes an in-app **AccessRequest** form (founder reviews via CLI, mints invites with existing `scripts/mint-invite.ts`).

The plan below was hardened by a Plan Architect pass and attacked by a Devil's Advocate pass (verdict: **APPROVE-WITH-FIXES** — all fixes folded in and marked ⚡).

## Sprint / epic structure (new options on board #8's Sprint field)

⚠ Adding Sprint options regenerates ALL option IDs → capture item→option mapping first (`gh project item-list 8`), update field, restore every item's Sprint by name.

| Sprint | Epic | Stories |
|---|---|---|
| **Sprint 10 – Multiuser credibility** | Wave 1 | N1 /stats removal · N3 signin error copy · N4 invite input + AccessRequest form · N5 settings identity+sign-out · N6+N17 de-founder copy & token fixes |
| **Sprint 11 – Feature correctness** | Wave 2 | N7/N8 compare as-of semantics + readiness parity · N18 compare small fixes · N9 recap guard · N11 project-kind idioms · N12 onboarding re-entry + calendar first-run |
| **Sprint 12 – High-risk structural** ⚡ | Wave 3a | N2 layout fetch deferral (likely 2 stories) · N10 structured override editor (validation-first) |
| **Sprint 13 – Consolidation, a11y & polish** | Wave 3b | P7/N15 primitive consolidation (4 sub-stories) · P5 per-route loading states · P8/N19 a11y pass · N13 OAuth consent polish · N16 device-verification (2 stories) |
| **Backlog** (existing option) | — | Delete-account (tenant-scoped cascade) · data export · invite `maxUses` race hardening · shared `getGoalCount()` via `React.cache` |

⚡ Devil's Advocate: original plan had N2 inside Sprint 11 (6 findings) and N10 inside the mechanical sweep — both re-slotted into their own sprint since each is the size/risk of a small epic. N2 and N12 both touch `BottomNav`/`MoreSheet`/`layout.tsx`: **must not run concurrently**; backlog will carry an explicit dependency (N2 rebases on N12's changes).

## Hardened design decisions

### Sprint 10
1. **AccessRequest model** (only schema change in the roadmap; additive): plain-String `status` (house style — schema has zero enums), fields `id/email/note?/status("pending")/createdAt/reviewedAt?/reviewedNote?`, `@@index([status])`, `@@index([email])`. Auth-infra model like `Invite`: **raw `prisma`, not `getDb()`** (requester has no User row). ⚡ No verify-owned hedge needed — `scripts/verify-no-null-userid.ts` is a hardcoded 16-model allowlist and cannot flag a new model; AC is just "model list unaffected". Server action `src/lib/auth/access-request-actions.ts` with **rate limiting inside the action** (new `accessRequestHour` bucket in `src/lib/rate-limit.ts` — not middleware; server-action transport isn't cleanly middleware-visible), honeypot field, length caps (email ≤254, note ≤1000). `/request-access` flips `force-static` → `force-dynamic` (needs `?email=` prefill). Review path: new `scripts/list-access-requests.ts`; remove the personal-Gmail mailto.
2. **Invite-code input on `/signin`**: text input prefilled from `?invite=`, feeding the existing `signInWithGoogle(next, code)` cookie flow unchanged (`auth-actions.ts:18-27`). Replace the lying "detected ✓" chip with a timing-safe advisory `previewInviteCode(code)` server action: **one fixed-shape query, returns boolean only, never a reason** (no valid/expired/wrong-email distinction → no enumeration oracle). Real gating stays solely in `checkInviteGate`.
3. **Signin `?error=` mapping** — ⚡ corrected against Auth.js v5 source: invite rejection **never sets `?error=`** (the callback returns a redirect string). Map: `OAuthCallbackError` → "Sign-in was cancelled or Google reported a problem" (this, not `AccessDenied`, is the Google-denial path); `OAuthAccountNotLinked` → relink copy; `AccessDenied` → generic transient-error copy (only reachable when the gate *throws*); `Configuration` → temporarily unavailable; default fallback. AC: run the auth test suite.
4. **/stats removal**: page-level `redirect("/progress")` (not next.config), drop the `/stats` match in `BottomNav.tsx:59`, **port the Totals card to /progress using `StatTile`**. ⚡ Also: delete 17 dead `revalidatePath("/stats")` calls (workout-actions ×6, goal-actions ×6, day-log-actions ×5 style — every site already revalidates `/progress`) and update `src/lib/auth/route-access.test.ts:45`.
5. **Settings account block**: identity (name/email/avatar from session) + sign-out (reuse `signOutAction`) above Connected apps.
6. **De-founder copy + tokens (N6/N17)**: `OnboardingGoalForm.tsx:94` — ⚡ **both** placeholders are founder-specific ("Summit Mt. Elbert" AND "Reach $1k/mo MRR") → pick neutral-but-concrete examples; `coach/page.tsx` — rewrite ~4-5 prompt strings goal-generically (⚡ low blast radius confirmed: the PROMPTS array is copy-paste UI text, distinct from the live `COACH_INSTRUCTIONS` MCP constant which has zero Elbert refs; `docs/claude-ai-setup.md` stays untouched — it's the founder's own brief). Stale strings: "plan details unavailable" (`page.tsx:290`), "/revise Phase 3 MCP" copy, history's "Log your first weight on the Today screen". Split `--target` from `--danger` (⚡ check the apparent duplicate blocks at `globals.css:65-86` first — fixing one of two copies half-fixes it). CoachNudges "claude.ai/code/routines" internal ref.

### Sprint 11
7. **Compare asOf parity (N8)**: in `compare.ts` only (not `compare-core.ts` — it's pure/date-key-only): `const now = new Date(); const todayKey = toDateKey(now);` then `asOfX = dateX === todayKey ? now : cutX`, used **only** at the two `computeReadiness` call sites (`buildGoalSections` gets 4 date args). All other sections deliberately keep `endOfDay` snapshot semantics. Inherited automatically by calendar mode and the `compare_dates` MCP tool. ⚡ Story ACs (quality-tools mandate): MCP curl smoke of `compare_dates` before/after; new `compare.test.ts` regression asserting today-column readiness === /progress; check/update the tool description's today carve-out.
8. **Compare N7/N18**: as-of microcopy line near the hero; render the dead `notesLogged`/`baselineTestsLogged` as StatTiles in "The work between"; `max` attr on date inputs; same-day nudge copy in `HeroSpan`; try/catch around `computeComparison` → friendly error card.
9. **Project-kind idioms (N11)**: goal detail — gate the *computation*: `goal.kind === "fitness" && targets.length > 0` at `goals/[id]/page.tsx:114` (existing JSX guard then hides the card); compare — gate the 4 fitness tiles on `result.goals.some(g => g.kind === "fitness")` (⚡ not `gameState.goalKind` — that breaks multi-domain users); character — new `classLabel` field on the existing `GoalPresentation` registry: "Adventurer" / **"Builder"** (⚡ "Founder" rejected — reintroduces the N6 problem).
10. **Onboarding re-entry + calendar first-run (N12)**: thread `goalCount` prop `layout → BottomNav → MoreSheet` (one cheap `goal.count()` — the single remaining signed-in layout query after N2); "Set up your first goal →" row at top of MoreSheet when `goalCount === 0` **regardless of dismiss cookie**; calendar gets an empty-state Card above the grid when `!goal`, matching Today's get-started voice.
11. **Recap guard (N9)**: `onError` → fallback card on the preview `<img>`; new cheap aggregate in `recap/page.tsx` (one query per activity model across the 13-week window, bucketed in JS → `weeksWithData: number[]`, mirroring `postedWeeks`); empty weeks render "Nothing to recap yet…" instead of mounting the `<img>` (also saves resvg renders).

### Sprint 12 (high-risk)
12. **Layout fetch deferral (N2)** — ⚡ mechanism corrected by code-reading: `BottomSheet`'s SSR guard only protects the portal; `LogLauncher` is already fully mounted on every route, so "fetch on mount" defers nothing. **Chosen**: remove all 5 meal-data props from `BottomNav`/`LogLauncher`; `LogLauncher` self-fetches `GET /api/log-sheet-data` (new route handler returning the exact shape layout computes today) **on every sheet-open transition** (not first-open only — meal edits don't revalidate route handlers), with a lightweight loading state; `layout.tsx` drops the entire 4-query signed-in `Promise.all`; relocate the `TodayMealLite` type out of `layout.tsx`; delete Today's dead `latestMeasurement` query (`page.tsx:92,131`). `resolveDay` double-fetch dies as a side effect. Decompose as 2 stories if needed (layout/props removal · self-fetch + loading). AC: cold-hydration pass on /compare + /days (known BottomSheet fragility), projected-macros header correct after a meal edit, sheet-open latency acceptable.
13. **Structured override editor (N10)** — ⚡ validation-first: the existing write path (`day-actions.ts:10-56`) does bare `JSON.parse` → upsert with **zero validation**, unlike the MCP `apply_day_override` tool. **Required AC: the new write path calls `assertValidDayTemplate` + `assertDayTemplateWithinSize` and reuses the baseline-decision guard (`applyDayOverrideCore`)** — regardless of UI. v1 UI scope (one `/feature-dev` run, capped by AC field list): edit `title` + existing exercises' `sets/reps/weightHint/durationSec/notes` + per-exercise "skip today"; block-level CRUD/reorder/type changes stay on an **Advanced JSON tab using `TargetsBuilder`'s toggle idiom** (⚡ closer precedent than WorkoutEditor — DayTemplate is a prescription JSON blob, not logged relational sets).

### Sprint 13
14. **Primitive consolidation (P7/N15)** — 4 mechanical, tsc/build-verifiable stories: StatTile adoption at 5 sites (`calendar:142`, `progress:259`, `baselines:166`, `RecordsSummary:188`, `MilestoneBurnDown:111`); shared `MEAL_LABELS` (4 dupes); `StatusPill`+helpers dedup (baselines vs RecordsSummary); block/prescription formatter dedup (×3).
15. **Per-route loading states (P5)**: `loading.tsx` for the heavy routes (/progress, /calendar, /nutrition, /recap, /compare).
16. **A11y pass (P8/N19)**: `w-9`→`w-11` on ThemeToggle/SessionMenu avatar/BottomSheet close; chart wrappers `role="img"` + label; 🏔️ labels; SessionMenu `aria-haspopup="menu"` + focus-on-open/return-on-close + avatar `onError`→initials; onboarding errors `role="alert"`.
17. **OAuth consent polish (N13)**: `SCOPE_COPY` lookup keyed by scope (future-proofing — only "mcp" exists today); "Not you?" becomes a real `signOutAction` form — ⚡ **`signOutAction` must accept `redirectTo`** (today it hardcodes `/signin`) and the consent page passes its own `/oauth/authorize?...` query so the account-switch round-trip survives; Deny microcopy line. AC: run the oauth test suite.
18. **Device verification (N16)** — ⚡ split in 2 (different truth-owners): (a) MealComposer iOS Safari sticky chrome w/ keyboard (real iPhone); (b) CalendarMonth 390px wedge + 0.62-opacity WCAG contrast (contrast tool). Both file follow-ups, don't fix blind.

## Constraints
- Migrations: AccessRequest only, additive, guarded `db:migrate`.
- Auth/OAuth-touching stories (N3, N4, N5 sign-out, N13) carry "run auth/oauth test suites" ACs (CLAUDE.md rule).
- No MCP tool list/name changes → **no connector reconnect needed**; `compare_dates` behavior fix is smoke-tested + regression-tested (decision 7).
- No new MCP read tools → no leaky-reads additions (confirm in backlog critique).
- USER_TZ: verified — compare/recap work stays on `@/lib/calendar` paths.

## Execution after approval (roadmap skill Phases 3–6)
1. `RUN_DIR=.roadmap/2026-07-03-audit-fixes`; persist scope brief + this plan → `docs/roadmap/audit-fixes-plan.md`.
2. Story Decomposers (1 Sonnet per epic ×4 + Backlog) → `backlog.json` (~28–36 stories with title/value/AC/touches/effort/priority/deps/sprint).
3. Backlog Critic pass; fold fixes (esp. the N2↔N12 serialization dep and N10 validation ACs).
4. Board #8: capture item→Sprint mapping → add Sprint 10–13 options → restore all prior assignments → verify spot-checks.
5. Create labeled issues (epic parents + stories), add to board, set Status=Todo/Priority/Effort/Sprint; log to `$RUN_DIR/phases/materialize-log.md`.
6. Commit planning docs (currently on `feature/phase1-auth` — commit there; it's the active branch) + completion report with sprint table & critical path.

## Verification (of the roadmap deliverable)
- Board #8 shows Sprints 10–13 populated; every story has Priority/Effort/Sprint/Status; **prior Sprint 1–9 assignments intact** (spot-check ≥3 old items post-field-update).
- `backlog.json`: no dependency cycles; Wave-1 stories all P0/P1 in Sprint 10; N2/N12 serialized; N8 and N10 carry their mandated ACs.
- Planning docs committed; completion report names the critical path and the first `/feature-dev` command to run.
