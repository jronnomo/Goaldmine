# Hydration baseline BEFORE #233 (HEAD c26edc8, dev mode, 2026-07-10)

One pre-existing hydration EXCEPTION, identical signature, confirmed on /, /compare, /days (route-independent — broader than the memory's "/compare + /days"; fires wherever BottomNav renders in dev):

- Error: "Hydration failed because the server rendered HTML didn't match the client…"
- Anchor: RootLayout → Shell → BottomNav(todaysMeals=[...] …) → BottomSheet(open=false, title="Log") → client renders `<dialog className="bottom-sheet" …>` where server had `<script>`.
- Interpretation: BottomSheet's null-on-first-pass guard (BottomSheet.tsx:81) is not holding as documented in dev — client's hydration pass renders the <dialog> while the server slot was a script placeholder.

AFTER-criterion for #233: same signature or better (fewer/no warnings). Any NEW/different mismatch = regression, blocker.
Note: the mismatch's component line will change cosmetically (BottomNav props list shrinks to goalCount) — same signature ≠ literal string equality; compare the structural anchor (BottomSheet dialog/script diff).
