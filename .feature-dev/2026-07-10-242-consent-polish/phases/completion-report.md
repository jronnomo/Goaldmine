# Completion report — #242 — 2026-07-10 · Sprint 13

## Shipped (commit d8e4e23, merged on feature/phase1-auth; +130/-18 across 3 files)
1. **SCOPE_COPY lookup**: module-level `Record<string, string[]>` keyed by OAuth scope ("mcp" → the two existing bullets verbatim; safe generic fallback for the validation-unreachable unknown case).
2. **signOutAction(redirectTo?: string | FormData)**: typeof-guarded optional redirect through the existing `safeNext` (open-redirect defense the AC omitted). **The AC's "existing callers unaffected" premise was FALSE as written** — both legacy callers are bare `<form action={signOutAction}>`, so Next injects FormData as arg 1; a naive `redirectTo = "/signin"` default would never fire. The typeof guard + `string | FormData` type widening (needed for React's form-action assignability) keeps both callers byte-untouched AND type-checking. Zero lint disables (iterated once: the documentation-only `_formData` param + its disable were dropped — fewer-params assignability covers the bound shape).
3. **"Not you? Sign out"** is now a real sign-out form bound to `"/oauth/authorize?" + originalQueryString` — signs out AND returns the user to the SAME authorize request after re-auth (the old link did neither). **DA blocking catch: form-inside-`<p>` is invalid HTML** (parser closes the p → hydration mismatch) — wrapper converted to `<div>`, submit button styled as the original link.
4. **Deny microcopy** inside the Deny form (unambiguously scoped): return-to-claude.ai without connecting + reconnect-any-time.
5. **First-ever signOutAction coverage** (5 tests): FormData-as-arg-1 trap, no-args default, valid path pass-through, https://evil + //evil → safeNext's "/" fallback (asserted as "/", not "/signin" — safeNext's real contract, DA-verified acceptable via the middleware bounce).

## Verification
- Gates: tsc 0 · lint 0 errors, zero disables · **799/799** (794 + 5) · **oauth suites explicitly 129/129** · build OK.
- Round-trip traced link-by-link in the premise check: signOut → /oauth/authorize unauthenticated → page session gate → /signin?next → signInWithGoogle rebinds via safeNext → same authorize request. Chain intact (signin honors next; middleware leaves /oauth/authorize public).
- Browser: no OAuthClient exists in the dev DB (verified read-only), so the consent card can't render locally — the invalid-client path was verified live (error card correct, validation untouched) and the card changes by full code re-read. **Real-flow verification lands with the next claude.ai connector auth** (post-deploy smoke item).

## Process
Premise check (the FormData trap; round-trip trace; zero existing coverage) → PRD → DA **APPROVE-WITH-CONDITIONS** (form-in-p blocking defect; safeNext "/" contract; Auth.js redirectTo query-string pass-through verified in installed source; microcopy placement inside the Deny form) → dev agent (stale base self-corrected; one sound type-widening deviation) → orchestrator refinement round (dropped the disable-carrying param via SendMessage; amended) → gates. One light iteration.

## Notes
- Post-deploy smoke addition: run one real claude.ai connector auth to see the new consent card + "Not you?" flow live.
- Sprint 13 remaining: #243, #244, #249.
