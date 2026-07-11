# Architecture critique — #249 nav dead-zones

**Verdict: APPROVE-WITH-CONDITIONS**

The design is small and mostly sound. Two things must be nailed down before a dev picks this up: (1) the exact aria treatment for the lit More button (PRD leaves this as an open question — this doc rules it), and (2) the exact insertion point/markup for RecordsSummary's new link. Everything else is a minor polish note, not a blocker.

---

## Attack 1 — Lit sheet-trigger semantics (RULED — this is the load-bearing finding)

Read `src/components/BottomNav.tsx` in full (91–182). Structure:

- `LinkTab`s (Today/Plan/Progress) render as `<Link>` with `aria-current={active ? "page" : undefined}` (line 102) — the **only** place `aria-current` is used anywhere in `src/` (verified via repo-wide grep, no other hits).
- `SheetTab`s (Log/More) render as `<button type="button">` with `aria-pressed={isSheetOpen}` (line 138), where `isSheetOpen` is pure local React state (`logOpen`/`moreOpen`) — it means "is the sheet currently expanded," a real toggle-button semantic. There is an explicit code comment at line 121: `// Sheet-trigger buttons — never show "active/page" state`. The PRD's own request directly contradicts this existing comment's intent, so the comment needs updating, not just the logic.

**Ruling:**

1. **Do not add `aria-current` to the More `<button>`, in any form ("page" or "true").** `aria-current` (including the `="true"` boolean form) is a "current item in a set" semantic that assumes the element represents a location/step. The More button is not a link to a distinct resource — it opens a sheet — and per the WAI-ARIA authoring guidance `aria-current` is scoped to elements that indicate the user's place within a set of related items (breadcrumbs, nav links, steps, pages). Applying it to a non-navigating toggle button that sits *beside* three real `aria-current="page"` links would make an AT user believe there's a fourth "page" link, when activating it does not navigate anywhere. This is worse than doing nothing.
2. **Do not fold the new route-match condition into `aria-pressed`.** `aria-pressed={isSheetOpen}` currently has one clean meaning: "the sheet is expanded." If you change it to `aria-pressed={isSheetOpen || isOnMoreRoute}`, a screen-reader user on `/coach` with the sheet closed hears "More, button, pressed" — asserting the sheet is toggled open when nothing on screen is expanded. That's a semantic lie, not a lit-tab hint. Keep `aria-pressed={isSheetOpen}` exactly as-is.
3. **The lit styling must be purely visual, driven by a variable independent of `aria-pressed`.** Concretely:
   ```ts
   const isOnMoreRoute = tab.key === "more" && MORE_ROUTES.some((r) => pathname?.startsWith(r));
   const lit = isSheetOpen || isOnMoreRoute; // visual only
   ```
   Use `lit` for the className branch and the filled/hollow Bullseye choice (lines 139–150 today); keep `aria-pressed={isSheetOpen}` untouched. This gives sighted users the "you are here" affordance the PRD wants while keeping the accessibility tree honest.
4. Optional, not blocking: if the team wants parity for AT users, add a visually-hidden `<span className="sr-only">, current section</span>` inside the button when `isOnMoreRoute` — cheap, unambiguous, doesn't touch `aria-pressed`/`aria-current` at all. Nice-to-have, not required for AC.
5. Update the stale comment at BottomNav.tsx:121 (`// Sheet-trigger buttons — never show "active/page" state`) — it will be actively wrong once this ships; replace with something like `// Sheet-trigger buttons never get aria-current/aria-pressed=route-match — only real "sheet is open" reflects in aria-pressed. Route-match drives visual "lit" styling only (see isOnMoreRoute).`

No test currently pins any of this — repo-wide grep for `BottomNav` in `*.test.*` returns zero hits — so nothing existing breaks, but nothing existing catches a regression either. Not asking for new test coverage here (out of proportion for a nav polish ticket) but flagging it so the dev doesn't assume a safety net exists.

---

## Attack 2 — Prefix collisions

Enumerated against current route tree (`find src/app -maxdepth 1 -type d` + `src/app/goals/**`):

- `/goals` startsWith catches: `/goals`, `/goals/new`, `/goals/[id]`, `/goals/[id]/plan`, `/goals/[id]/trends`, `/goals/[id]/revise`, `/goals/[id]/revisions`, `/goals/[id]/revisions/[revisionId]`, `/goals/[id]/metric`, `/goals/[id]/metric/[key]`. All are goal-detail sub-pages — lighting More for all of them is correct and is already the PRD's own accepted edge case (§6 row 1). No new finding here, just confirmed.
- **No overlap between Progress's match and More's match.** Progress's predicate (BottomNav.tsx:54–58) after the change will be `/progress`, `/baselines`, `/recap`, `/compare`. More's new predicate is `/coach`, `/journal`, `/character`, `/goals`, `/history`, `/nutrition`. Disjoint sets — verified by inspection, no string is a prefix of another across the two lists.
- **`/recap` and `/compare` are both MoreSheet destinations (`MoreSheet.tsx` navRows, lines 98–147: recap at 118, compare at 124) that light the *Progress* tab, not More.** This is pre-existing asymmetry for `/recap` (already shipped, per PRD §1.2 premise-check) and the PRD is intentionally extending the same asymmetry to `/compare`. Not a bug — it's precedent-consistent — but it means "is this route in MoreSheet's list" is no longer a reliable predictor of "does More light up," which is exactly why open item #6 below matters.
- `/days` vs `/journal`: no collision — `/days` is claimed by Plan (`p.startsWith("/days")`, line 42), `/journal` is a distinct top-level route (`src/app/journal`) with no shared prefix. Confirmed no overlap.

No collision findings survive as bugs. Clean.

---

## Attack 3 — Import pill removal, orphan-flow check

Grepped every `href="/import"` in `src/`: `page.tsx:272` (the pill being deleted), `history/page.tsx:28` and `:51`, `baselines/page.tsx:93` (empty-state "Import one"), `RecordsSummary.tsx:112` (empty-state "Import one"), and `LogLauncher.tsx:299` (the Log-sheet's own Import row — confirmed by `docs/ux-research/full-app-audit.md:20`, finding P9: "Log tab → LogLauncher sheet: Weight · Body metric · Meal · Note · Import"). That's **five** surviving paths, not the two the PRD cites (§1.3: "/history (×2) and RecordsSummary's empty state") — it undercounts; `/baselines` empty state and the Log sheet itself are additional survivors. Net: removal is safe, and safer than the PRD's own accounting suggests.

Checked the zero-workout/new-user path in `src/app/page.tsx`:
- 0-goal user, no dismiss cookie → hard-redirected to `/onboarding` (lines 42–44) — never sees the hero at all.
- 0-goal user who dismissed onboarding, and `focusGoal?.kind !== "project"` and no `program` → returns the "Get started" card (lines 54–71) — early return, hero (and the pill) never renders on this path either, before or after this change.
- A fitness user with an active program but zero logged workouts *does* reach the hero (the pill's current location) and after this change loses that one in-hero shortcut — but the bottom-nav "Log" sheet is always present and one tap away, with its own Import row. No orphaned flow.

`docs/roadmap/audit-fixes-backlog.md:386` already carried an open item: *"Import pill placement inside Today's workout hero (page.tsx:274-279) is either confirmed intentional or relocated — decision recorded in the PR."* This PRD's §1.3 founder decision (REMOVED, not relocated) is exactly that recorded decision — closes the backlog item, doesn't need separate action.

No blocking finding.

---

## Attack 4 — Back link on /compare at 390px

Read `src/app/compare/page.tsx` (291–303) and `src/components/compare/HeroSpan.tsx` in full.

- `ComparePage` returns `<div className="mx-auto max-w-md space-y-4 p-4">` as the outer wrapper, with `<HeroSpan .../>` as the **first** child today.
- `HeroSpan` itself renders `<header className="px-1 pt-4 pb-2">` with an `text-4xl` `<h1>` immediately inside.
- If the back link is inserted as a new sibling **before** `<HeroSpan>` inside the outer `space-y-4` div (the natural reading of "at top"), it gets `space-y-4`'s 16px top gap from nothing above it (fine, it's first) but then **HeroSpan's own `pt-4` (16px) stacks on top of the `space-y-4` gap below the link**, giving ~32px of dead air between "← Progress" and the date-span headline. Not a broken layout, just looser than the `days/[dateKey]` idiom, where the back link and `<h1>` share one `<header className="pt-2">` wrapper (no double-padding). Cosmetic-only; flag it but don't block on it — prescribe: **put the back link as its own top-level element directly above `<HeroSpan>`** (simplest, matches "days idiom" structurally as a peer element) and accept the extra breathing room, OR fold it into `HeroSpan`'s own header if the dev wants pixel parity with `days/[dateKey]`. Either is acceptable; recommend the simpler top-level placement since `HeroSpan` is a shared/documented component (UX-amendment-governed) and the PRD explicitly scopes this to `compare/page.tsx` only, not `HeroSpan.tsx`.
- **Important: the `days/[dateKey]` "idiom" being cited does *not* itself hit ≥44px.** `src/app/days/[dateKey]/page.tsx:238`: `<Link href="/calendar" className="text-sm text-[var(--accent)]">← Calendar</Link>` — no `min-h-11`, no `inline-flex`, just `text-sm` inline text (~20px line box). The PRD's FR 3.1.2 already anticipates this by explicitly layering `inline-flex items-center min-h-11` *on top of* the idiom's classes rather than copying them verbatim — correct call, but a dev skimming "copy the days idiom" could reasonably copy the classNames byte-for-byte and ship a sub-44px target. **Instruction for the dev: copy the arrow-text pattern and position (`← Progress`, top of page, `text-sm text-[var(--accent)]`) from days/[dateKey]:238, but the className must be `inline-flex items-center min-h-11 text-sm text-[var(--accent)]` — do not paste the days/[dateKey] className unmodified.**
- 390px width: `← Progress` is a short string, sits in its own block/line, nothing else shares the row — no horizontal collision risk at 390px. No overlap with HeroSpan's `px-1` (link should carry its own inline padding is not required since it's not a hit-target row against another element, just needs the min-h-11 vertical box).

No blocking finding, two build-instructions above (placement + className correction) should be handed to the dev verbatim.

---

## Attack 5 — RecordsSummary action slot (RULED — exact insertion)

Read `src/components/Card.tsx` (3–27): `action` is a plain `ReactNode` rendered in a flex header row (`flex items-center justify-between`) alongside `title`, only when `title || action` is truthy (line 18). Existing precedent for this exact idiom: `src/app/progress/page.tsx:141–148` — `<Card title={...} action={<Link href={...} className="text-sm text-[var(--accent)]">Edit →</Link>}>`.

`RecordsSummary.tsx`'s "Tests due" `Card` currently has **no** `action` prop (line 59: `<Card title="Tests due">`). Prescribed exact edit:

```tsx
<Card
  title="Tests due"
  action={
    <Link
      href="/baselines"
      className="text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
    >
      All baselines →
    </Link>
  }
>
```
(className matches the house `action`-slot idiom exactly — copy `progress/page.tsx:145`'s classes, which already include the focus-ring treatment other Card actions in this same file use, e.g. RecordsSummary's own existing "View all N tests →" links at lines 98–104 and 146–152.)

Verified this is safe even for a zero-baseline user: `/baselines` (`src/app/baselines/page.tsx:44–48`) renders a friendly "No active plan. Add a goal to schedule your baseline tests." empty state rather than crashing or showing something misleading — so the **unconditional** nature of the new link (no `schedule.scheduled.length > 0` guard, per PRD FR 3.1.3) is safe to land exactly as specified, including for the true first-run 0-schedule case.

One thing to double check when implementing: the existing conditional mid-list link at lines 97–104 (`View all {schedule.scheduled.length} tests →`, shown only when `testsDue.length === maxTestsDue`) and the new unconditional header link will now **both** point to `/baselines` and can both be visible simultaneously (e.g., 5 scheduled tests, `maxTestsDue=3` → header "All baselines →" AND mid-list "View all 5 tests →" both render). PRD explicitly says "conditional mid-list links stay" (FR 3.1.3) so this duplication is accepted/intended, not a bug — just confirm the dev doesn't try to dedupe it as an unrequested cleanup.

---

## Attack 6 — Drift risk, other odds and ends

- **MoreSheet/BottomNav drift.** `MoreSheet.tsx`'s `navRows` (lines 98–147) is the actual source of truth for what's *in* the More sheet; `BottomNav.tsx`'s new match predicate is a hand-maintained parallel list that must stay a subset (recall: `/recap` and `/compare` are in `navRows` but intentionally *excluded* from the More match list, since they light Progress instead — so it can never be a straight "same array" share). Given that asymmetry, a shared `MORE_DESTINATIONS` constant would actually be *wrong* (it would need to be `navRows` minus `{recap, compare}`, which is more confusing than two arrays with a comment). **Ruling: don't extract a shared constant — proportionate fix is a comment in `BottomNav.tsx` at the More match site**, e.g.:
  ```ts
  // Mirrors MoreSheet.tsx's navRows (src/components/MoreSheet.tsx:98-147) MINUS
  // /recap and /compare, which light Progress instead (kinship mapping, PRD-249).
  // If MoreSheet's destinations change, update this list to match.
  ```
  This is cheap insurance against silent drift without over-engineering a 6-item list touched by two files.
- **`usePathname()` null on first render.** Already handled — `tab.match(pathname ?? "")` (BottomNav.tsx:97) coerces `null` to `""`, so no route matches on the transient null and nothing crashes; the same `?? ""` guard must be reused for the new `isOnMoreRoute` check (`MORE_ROUTES.some((r) => (pathname ?? "").startsWith(r))`), not skipped.
- **No test coverage exists for BottomNav today** (confirmed via repo-wide grep) — this PRD doesn't need to add any per project conventions (nav-styling change, not owned-model/read-tool territory that CLAUDE.md mandates tests for), but don't let a dev assume vitest will catch a mis-typed route string; it won't.
- CalendarMonth.tsx cancel-affordance premise-check (PRD §1.2 row 3) — independently spot-checked: `CalendarMonth.tsx:258` pill text and `:151-159` `handleCompareToggle` toggling off on re-click both confirmed present in the file as claimed. No new finding; PRD's "already satisfied, no change" verdict for AC-3 stands.

---

## Summary of exact developer instructions

1. `BottomNav.tsx`: add `/compare` to Progress's match. Add a **visual-only** `isOnMoreRoute` check (with `pathname ?? ""` guard) driving the same lit className/Bullseye-fill branch as `isSheetOpen`; **do not** touch `aria-pressed` (keep `= isSheetOpen`) and **do not** add `aria-current` to the button. Update the stale comment at line 121. Add the drift-warning comment referencing `MoreSheet.tsx` navRows minus recap/compare.
2. `compare/page.tsx`: add `← Progress` link as its own top-level element directly above `<HeroSpan>`, className `inline-flex items-center min-h-11 text-sm text-[var(--accent)]` — do not copy `days/[dateKey]:238`'s className verbatim (it lacks the tap-box treatment).
3. `RecordsSummary.tsx`: add `action={<Link href="/baselines" className="text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">All baselines →</Link>}` to the "Tests due" `Card` (line 59), unconditional, coexists with the existing conditional mid-list link by design.
4. `page.tsx`: delete lines 271–276 (the `+ Import` pill) — confirmed no orphaned flow.
5. `CalendarMonth.tsx`: no change, confirmed correct.
