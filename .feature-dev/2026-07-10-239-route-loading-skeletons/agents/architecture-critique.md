# Architecture critique — #239 route-shaped loading.tsx skeletons

**Verdict: APPROVE-WITH-CONDITIONS**

The design is sound and low-risk (5 static server components, zero logic). Two conditions
must be satisfied before this ships: (1) container/element parity per route as enumerated
below, (2) an explicit written ruling — not silence — on the nutrition/[id]/edit nested-route
shape mismatch (attack 6). Neither blocks the approach; both are cheap to fix in the same PR.

---

## Attack 1 — searchParams flash (calendar Link nav, compare GET form)

**Verdict: real, PRD's "accept" framing is correct for calendar but UNDERSTATES compare's case.**

Evidence:
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md:119` — `searchParams` is
  a "Request-time API whose values cannot be known ahead of time. Using it will opt the page
  into dynamic rendering at request time." Both `/calendar` (`src/app/calendar/page.tsx:12-17`)
  and `/compare` (`src/app/compare/page.tsx:184-189`) read `searchParams`, and both are already
  `force-dynamic` — so every param change forces a fresh server render.
- `loading.md:78,88` — `loading.js` wraps `page.js` (and nested layouts) in a `<Suspense>`
  boundary for that segment. A same-route navigation that changes `searchParams` re-renders the
  suspending leaf, so the boundary's fallback (the skeleton) re-fires even though the URL's path
  segment didn't change. This is standard, documented behavior — not a bug to work around, and
  not something a Link `prefetch` setting changes.
- **Calendar** (`src/app/calendar/page.tsx:1,58-70`): nav is `<Link href="/calendar?y=...&m=...">`
  from `next/link` — a soft, client-side transition. Shared layout (AppHeader/BottomNav) stays
  mounted; only the route segment's Suspense content swaps to the skeleton and back. This matches
  the PRD's accepted trade-off cleanly.
- **Compare** (`src/app/compare/page.tsx:153` `CompareDateForm`, line 174-179 `<button
  type="submit">`): the date-range picker is a **plain `<form method="get">` with no
  `onSubmit`/action handler** — this is a native, uncaptured browser form submission, not a
  Next.js `<Link>` or router transition. It causes a **full document navigation** (the whole
  page unmounts and reloads from the network, not a client-side route swap), even though
  streaming still means the skeleton paints first and the real content replaces it. Practically:
  compare's flash is more disruptive than calendar's — the browser does a real navigation, so
  scroll position resets and (depending on browser) there can be a brief blank flash before any
  paint, on top of the skeleton-then-content swap calendar doesn't have.
- No mitigation exists that stays server-component-only. `useLinkStatus` (debounced pending
  indicator) and Cache Components' `unstable_instant` (`node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`)
  both require client components or an experimental flag (`cacheComponents: true` — not set;
  `next.config.ts` has no `experimental` block at all). Both are explicitly out of scope per
  PRD §3.2 ("any client-side transition mitigation for the searchParams flash").

**Ruling:** accept for both routes, but the PRD language ("Same" trade-off for compare) undersells
the difference. Document it plainly: calendar's flash is a soft in-place skeleton swap; compare's
is a hard reload where the skeleton is the first thing the browser paints. Neither is a reason to
withhold `compare/loading.tsx` — a full reload with no skeleton is strictly worse than one with it.

---

## Attack 2 — container parity (exact wrapper element + classes per page)

Read directly from each page.tsx:

| Route | Outer element + exact className | Source |
|---|---|---|
| `/progress` | `<div className="max-w-md mx-auto p-4 space-y-4">` | `src/app/progress/page.tsx:94` |
| `/calendar` | `<div className="max-w-md mx-auto p-4 space-y-4">` | `src/app/calendar/page.tsx:46` |
| `/nutrition` | `<div className="max-w-md mx-auto p-4 space-y-4">` | `src/app/nutrition/page.tsx:123` |
| `/recap` | **`<main className="max-w-md mx-auto p-4 space-y-4">`** | `src/app/recap/page.tsx:105` |
| `/compare` | `<div className="mx-auto max-w-md space-y-4 p-4">` (same classes, **different order**) | `src/app/compare/page.tsx:292` (also line 232, the error-fallback branch — identical string) |

Root idiom for reference: `<div className="max-w-md mx-auto p-4 space-y-4">` — `src/app/loading.tsx:6`.

Findings:
1. **Recap is confirmed `<main>`**, not `<div>` — the PRD's "recap uses `<main>`?" question is
   answered yes. `recap/loading.tsx` must use `<main>` to match. Side note (pre-existing, out of
   scope): `RootLayout` already wraps children in its own `<main className="flex-1 pb-20">`
   (`src/app/layout.tsx:100,111`), so recap's page nests `<main>` inside `<main>` — a
   pre-existing semantic-HTML wart unrelated to this story. Don't "fix" it by changing recap's
   skeleton to `<div>`; that would break container parity for no benefit. Flag, don't touch.
2. **Compare's class order differs** (`mx-auto max-w-md space-y-4 p-4` vs. the other four's
   `max-w-md mx-auto p-4 space-y-4`). Tailwind utility classes are order-independent for the
   cascade (no two classes here target the same CSS property in a conflicting way), so this is
   **not a rendering bug** — but for byte-for-byte parity and easy diffing against the page it
   mirrors, `compare/loading.tsx` should copy compare's exact string (`mx-auto max-w-md
   space-y-4 p-4`), not the root's order. Instruct explicitly so the implementer doesn't
   "normalize" it to the root's order and introduce a needless diff from the page it's meant to
   mirror.

---

## Attack 3 — reduced motion vs. `animate-pulse`

`src/app/globals.css` has 11 `@media (prefers-reduced-motion: reduce)` blocks (lines 135, 163,
176, 278, 300, 341, 363, 381, 405, 416, 428, 448, 469, 482) — every one of them targets a
specific bespoke animation class (`bullseye-pop`, slide/fade transitions, `.qty-bump`,
`.stale-flag-in`, `.macro-flash`, `.save-confirm-fade`, `.tab-content-fade`, `.compare-pill`,
`.compare-ring`, etc.). **None target `.animate-pulse` or a blanket `*`/`:root` selector.**
Tailwind's `animate-pulse` utility itself does not auto-respect `prefers-reduced-motion` — that's
left to the consuming app, and this app hasn't done it for that utility.

**This is not a regression introduced by #239** — the root `src/app/loading.tsx:9,21,29` already
uses `animate-pulse` unconditionally, and has presumably shipped as-is. The five new files
inherit the identical, pre-existing gap by design (PRD explicitly mandates copying the root
idiom verbatim). Flagging as a known, out-of-scope a11y debt item — not a blocker for this PR,
but worth a follow-up ticket ("silence `animate-pulse` under prefers-reduced-motion repo-wide,"
covering the root loading.tsx too, not just the five new ones).

---

## Attack 4 — theme correctness (`--border` / `--card` in both themes)

Confirmed defined in all four blocks of `src/app/globals.css`:
- Light default: `--card: #FFFBF0` / `--border: #D9C8A2` — lines 8-9
- Dark (`prefers-color-scheme`): `--card: #1A130C` / `--border: #3A2E1F` — lines 39-40
- Light (explicit `data-theme="light"` override): lines 60-61 (byte-identical to default)
- Dark (explicit `data-theme="dark"` override): lines 77-78 (byte-identical to media-query dark)

Bar-on-card contrast holds in both themes (border tone is visibly distinct from card tone in
both palettes). No issue.

---

## Attack 5 — AppHeader/BottomNav duplication; header-bar shape correctness

`src/app/layout.tsx:96-114` — `RootLayout` mounts `<AppHeader>` and `<BottomNav>` **outside**
`{children}`; `loading.tsx` only ever renders inside `{children}` (it replaces the page segment,
per `loading.md:78`). So the skeletons never duplicate the app chrome — confirmed no conflict.

On the "should a title-shaped bar be in the skeleton" question: **yes, and root's omission is
the anomaly, not the model to imitate.** All five target pages render their own `<h1>` inside
their container, immediately after the wrapping div/main:
- `src/app/progress/page.tsx:95-97` — `<header className="pt-2"><h1 ...>Progress</h1></header>`
- `src/app/calendar/page.tsx:47-48` — `<header className="pt-2 flex ..."><h1 ...>Calendar</h1>`
- `src/app/nutrition/page.tsx:124-125` — `<header className="pt-2 space-y-1"><h1 ...>Nutrition</h1>`
- `src/app/recap/page.tsx:106-107` — `<header className="pt-2"><h1 ...>Weekly Recap</h1></header>`
- Root's own page, `src/app/page.tsx:280-282`, **also** renders its own `<h1>` — so root
  `loading.tsx`'s lack of a header-shaped bar isn't because root's page has no title; it's
  simply an inconsistency in the existing root skeleton (first card block starts mid-content
  with a generic `h-5 w-1/3` bar, no distinct title treatment).

**Ruling:** the PRD's per-route shapes (§3.1: "header bar (h1-width)" for progress/recap,
"header row" for calendar, "header (title + subtitle)" for nutrition) are correct and
page-accurate. Do not use the root file as a reason to drop the header block — it would be
copying root's gap, not its idiom.

---

## Attack 6 — nested-route inheritance (the load-bearing finding)

Directory reality check (not what the story text assumed):

```
src/app/nutrition/
├── page.tsx                  (the route getting nutrition/loading.tsx)
└── [id]/
    └── edit/
        └── page.tsx           ← EditNutritionPage, force-dynamic, its own getDb() await

src/app/recap/
├── page.tsx                   (the route getting recap/loading.tsx)
├── caption/route.ts           ← Route Handler, not a page
├── card/route.tsx             ← Route Handler, not a page
├── highlights/route.ts        ← Route Handler, not a page
└── story/[slide]/route.tsx    ← Route Handler, not a page
```

- **`nutrition/[id]/edit` is real** (`src/app/nutrition/[id]/edit/page.tsx`, confirmed force-dynamic
  at line 10, with its own `Promise.all([db.nutritionLog.findUnique(...), getQuickPickFoods()])`
  await at lines 17-22 — a genuine suspend point with no `loading.tsx` of its own in that
  subfolder). Per `loading.md:78,88` ("loading.js will... wrap the page.js file and **any
  children below**"), navigating to `/nutrition/123/edit` **will** show `nutrition/loading.tsx`'s
  fallback while the edit page's data loads. That fallback is shaped like the nutrition list
  (macro banner + two meal-row cards + a form-card teaser) — visibly wrong for the edit page's
  actual layout (back-link header, single `Card` wrapping `EditNutritionForm`,
  `src/app/nutrition/[id]/edit/page.tsx:26-57`). This is a real shape mismatch, not a hypothetical.
- **Recap has no such problem.** `recap/caption`, `recap/card`, `recap/highlights`, and
  `recap/story/[slide]` are all Route Handlers (`export const runtime/dynamic` in `route.ts` /
  `route.tsx` files, confirmed above) — Route Handlers return non-HTML responses and sit outside
  the page/layout Suspense tree entirely (`page.md:32`: `loading.js` wraps `page.js`, not
  `route.ts`). `recap/loading.tsx` cannot leak into them. No action needed for recap.
- `/progress`, `/calendar`, `/compare` have no nested page segments under them at all (`find`
  confirms flat directories) — no inheritance risk for those three.

**Ruling — pick one explicitly, don't leave it implicit:**
- **Option A (recommended, cheapest):** ship `nutrition/loading.tsx` as scoped, and accept the
  one-file mismatch for `/nutrition/[id]/edit` as a known, narrow trade-off — call it out in the
  PR description so it isn't "discovered" later as a bug. It's a transient skeleton on a rarely
  hit, already-fast single-row fetch; low real-world cost.
- **Option B:** add a sixth file, `src/app/nutrition/[id]/edit/loading.tsx`, shaped to match that
  page (header back-link + single form-card), which overrides the inherited nutrition skeleton
  for that segment per normal Next.js loading.tsx nesting rules. This is a 6th file, not 5 — a
  scope change from the PRD's "5 new loading.tsx" framing, so get sign-off before adding it.

Either is acceptable; picking neither and shipping unaware is the actual risk. Since the PRD
explicitly scoped "5 new files" and called `/nutrition/[id]` out of scope for its own skeleton
(§3.2 lists `/nutrition/[id]` — worth noting the PRD's own out-of-scope line names the wrong
path; the real nested page is `/nutrition/[id]/edit`), Option A matches the PRD's stated intent
most closely. Recommend Option A + a one-line PR note.

**Other sub-attacks under 6, both clean:**
- `recap`'s `export const runtime = "nodejs"` (`src/app/recap/page.tsx:6`) has no interaction with
  `loading.tsx` — `loading.js` is runtime-agnostic; nothing to reconcile.
- JSX transform: `tsconfig.json:14` has `"jsx": "react-jsx"` — no `import React` needed, matching
  `src/app/loading.tsx`'s existing convention (no React import). The five new files should follow
  suit; adding an unused `import React` would be the actual lint risk, not omitting it.

---

## Exact developer instructions

1. Five files, server components, no `"use client"`, no imports beyond what's structurally
   necessary (none, per the static-JSX design) — matches `src/app/loading.tsx`'s pattern exactly.
2. Container element + classes, copied verbatim from each page (not normalized to root's order):
   - `progress/loading.tsx`: `<div className="max-w-md mx-auto p-4 space-y-4">`
   - `calendar/loading.tsx`: `<div className="max-w-md mx-auto p-4 space-y-4">`
   - `nutrition/loading.tsx`: `<div className="max-w-md mx-auto p-4 space-y-4">`
   - `recap/loading.tsx`: `<main className="max-w-md mx-auto p-4 space-y-4">` (main, not div)
   - `compare/loading.tsx`: `<div className="mx-auto max-w-md space-y-4 p-4">` (note class order)
3. Each of the four routes whose page renders its own `<h1>` (all but compare, which has no bare
   header row in the PRD's shape) should keep a title/header-shaped bar as its first block, per
   PRD §3.1 — do not drop it by analogy to root's loading.tsx, which is the outlier here (attack 5).
4. Card shells: `animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4
   shadow-sm`, `aria-hidden="true"` on every decorative block, exactly one
   `<span className="sr-only">Loading…</span>` per file — root idiom, unchanged.
5. Ship `nutrition/loading.tsx` scoped to `/nutrition` only (Option A above); note in the PR
   description that `/nutrition/[id]/edit` will transiently show the nutrition-list-shaped
   skeleton by Next.js's normal nested-route inheritance, and that this is accepted, not
   overlooked. Do not add a 6th loading.tsx without separately confirming scope.
6. No action needed on recap's route handlers (caption/card/highlights/story) — they're outside
   the Suspense tree loading.tsx participates in.
7. searchParams-flash trade-off (calendar Link nav, compare GET-form submit): accept both,
   ship both skeletons. Note for the PR/QA pass that compare's flash is a **hard document
   reload** (native `<form method="get">`, not a Next `<Link>`), not a soft in-place swap like
   calendar's — worth confirming visually (PRD AC-5) rather than assuming parity with calendar's
   behavior.
8. `animate-pulse`'s lack of `prefers-reduced-motion` handling is pre-existing (root's file has
   the same gap) — not a blocker for this PR; optionally file a separate follow-up covering all
   six `loading.tsx` files at once rather than partially fixing it here.
