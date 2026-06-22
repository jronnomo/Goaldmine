# Onboarding → generated Coach Operating Manual

**Status:** Idea / parked (build deferred). Captured 2026-06-21.
**One-liner:** At the end of the goal interview, Goaldmine composes a personalized
"Coach Operating Manual" — a reasoning-discipline instruction the user pastes into their
Claude project/conversation — and offers it as a standard onboarding step.

## Why

A good operating instruction (how Claude should *reason* with the user, not just which
tools to call) is one of the highest-leverage things a Goaldmine user can put in front of
their Claude. Today that artifact only exists because one user hand-wrote it. It should be
a **default deliverable of onboarding**, available to every user.

## Mechanism — the insight that makes it work

The artifact has two separable layers:

- **Generic reasoning core** — domain-agnostic discipline valuable to *every* user
  (mechanism-not-symptom, name-the-lever, map-the-options, get-the-deciding-fact-first,
  confirm-before-structural-writes, confident-and-careful). Already extracted to
  `docs/coaching/coach-operating-manual.default.md`.
- **Flavor layer** — the per-user specifics that make the core operational (capacity
  calibration, injuries/constraints, authoritative systems-of-record + object-type traps,
  intent/priorities, domain levers).

The goal interview already collects the raw material for the flavor layer. So the feature
is mostly **composition**, not new data capture: core (static) + flavor (interview-derived).

## Where it hooks in

There are two goal-onboarding paths today; they converge on `create_goal` /
`createGoalCore`:

- **Path A — app form** (`src/components/GoalCreateForm.tsx` → `src/lib/goal-core.ts`):
  fast commit, collects objective/date/flavor/targets/notes. Gathers no benchmarks,
  intent, or constraints — so it can only ever offer the **generic default** manual, not a
  personalized one.
- **Path B — Claude coach interview** (the canned 7-stage prompt in
  `src/app/coach/page.tsx`, id `interview`): objective → date → benchmarks (logged) →
  constraints → targets → feasibility → **step 7: create**. By the time it reaches create,
  the conversation already holds the entire Flavor layer (capacity from the logged
  benchmarks, constraints/equipment/schedule, intent, domain). This is the natural home.

**The hook: add the manual generation as interview step 7/8 (Path B).** Right after
`create_goal` succeeds (or folded into the same go-ahead), compose the personalized manual
= generic core (`docs/coaching/coach-operating-manual.default.md`) + the flavor the
interview just collected, and hand it to the user as paste-ready project instructions.
Path A users get the generic default with empty flavor slots and a pointer to run the
interview to personalize it.

Reference prototype of a *fully personalized* manual: the single-user inline string in
`src/lib/mcp/instructions.ts` (the working proof that the core + flavor split is real).

## Design options (decide at build time)

1. **Text generator at end of interview (lowest tech, highest leverage).** Compose the
   manual as paste-ready text + downloadable `.md`. No persistent UI.
2. **Editable onboarding step.** A screen that renders the draft, lets the user edit the
   flavor layer, and re-exports. Adds a "refresh my manual" action when goals change.
3. **Seed the generic core into the MCP instructions for all users.** Server-side, every
   Goaldmine conversation carries the reasoning core by default; the personalized manual is
   the user's own paste-able copy on top. (Requires multi-user — see open questions.)

These compose: 1 → 2 → 3 is a sensible phase order.

## Open questions / deciding unknowns

- **Single-user → multi-user.** `instructions.ts` is currently one user's coach (no
  templating). Option 3 needs per-user composition; options 1–2 don't.
- **How much to personalize vs keep generic** without leaking PII into a pasteable doc.
- **Delivery surface:** copy box vs file download vs MCP-served vs all three.
- **Freshness:** the manual should evolve as goals/constraints change — when/how does the
  user regenerate it? (Tie to goal edits and the Sunday review?)

## Phasing

- **Phase 0 (done):** generic default manual exists (`docs/coaching/coach-operating-manual.default.md`).
- **Phase 1:** add manual generation as **step 7/8 of the Path B coach interview**
  (`src/app/coach/page.tsx`, id `interview`) — on create go-ahead, emit the personalized
  text artifact (copy/download).
- **Phase 2:** editable step + regenerate-on-goal-change.
- **Phase 3:** generic core seeded into MCP instructions for all users (multi-user).

## Relationship to current focus

Parked deliberately — build deferred to protect focus on core work. Phase 0 is docs only.
