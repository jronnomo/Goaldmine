# PRD: OAuth consent copy + account-switch flow polish (#242)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #242 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — microcopy/maintainability polish with AC-prescribed copy and a flow fix; no design-space exploration

---

## 1. Overview

### 1.1 Problem Statement
The consent screen's scope copy is hardcoded prose (unmaintainable as scopes grow); "Not you? Sign out" is a bare `/signin` link that neither signs out nor preserves the authorize request (dead-ends the account-switch flow); Deny has no explanatory microcopy.

### 1.2 Premise check (2026-07-10, HEAD d565636) — corrections
| Claim | Verdict |
|---|---|
| Hardcoded scope copy → SCOPE_COPY | TRUE (:153-162, two bullets); "mcp" the only scope, validated pre-render (scope ∈ {undefined, "mcp"}) |
| signOutAction optional redirectTo "leaves callers unaffected" | **PARTIAL — TRAP**: both callers (settings:127, SessionMenu:175) are bare `<form action={signOutAction}>` → Next passes FormData as arg 1, clobbering a naive default. Fix = typeof-guarded `(redirectTo?: string, _formData?: FormData)` + route through existing `safeNext` (open-redirect defense the AC omitted) |
| "Not you?" at :175 → bound sign-out form | TRUE; today's link doesn't even sign out (already broken). Round-trip verified INTACT: authorize gate → /signin?next → signInWithGoogle rebinds → same request (one extra hop, acceptable) |
| Deny microcopy at :208 | TRUE, net-new |
| Test mandate | Oauth suites untouched by these ACs; signOutAction has ZERO coverage — new `auth-actions.test.ts` (~4 tests) guards the FormData trap |

### 1.3 Success Criteria
SCOPE_COPY lookup with mcp entry + safe fallback; typeof-guarded signOutAction through safeNext with legacy callers byte-untouched; working bound sign-out form preserving the authorize request; Deny microcopy; full suite green (oauth suites explicitly) at 794+new.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | User on the wrong account at consent | "Not you?" to sign me out and return me to the SAME authorize request after re-auth | account switch without restarting from claude.ai | Must Have |
| US-002 | User unsure about Deny | one line explaining the consequence | confident choice | Must Have |
| US-003 | Maintainer | scope copy keyed by scope | new scopes = new entry, not prose surgery | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `authorize/page.tsx`: module-level `SCOPE_COPY: Record<string, string[]>`, `"mcp"` → the two existing bullets verbatim; render `(SCOPE_COPY[scope ?? "mcp"] ?? ["Access your Goaldmine data"])`.
2. `auth-actions.ts`: `signOutAction(redirectTo?: string, _formData?: FormData)`; `typeof redirectTo === "string" ? safeNext(redirectTo) : "/signin"` → `signOut({ redirectTo: target })`. Callers untouched.
3. `authorize/page.tsx`: "Not you? Sign out" becomes `<form action={signOutAction.bind(null, "/oauth/authorize?" + originalQueryString)}>` + link-styled submit (visual parity). redirectTo is server-composed (:57-61), not user-injected.
4. Deny microcopy (muted, text-xs, near the Deny button): explains return-to-claude.ai without connecting + reconnect-any-time (final wording DA/dev).
5. New `src/lib/auth/auth-actions.test.ts`: FormData-as-arg1 → /signin; undefined → /signin; "/oauth/authorize?x=1" → passed via safeNext; "https://evil"/"//evil" → safeNext fallback.

### 3.2 Out of Scope
New scopes; authorize-actions/token logic (no oauth/ lib changes); pointing redirectTo at /signin?next directly (extra-hop variant accepted); consent-screen visual redesign.

---

## 4. Technical Design
One RSC page + one server-action module + one new test file. No oauth/ lib, schema, route, or MCP changes (no connector reload). Auth surface changes covered by new tests per Gate-6 discipline.

---

## 5. UI/UX
Visible copy identical except the new Deny microcopy line; "Not you?" renders as the same link (form-styled).

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Bare `<form action={signOutAction}>` legacy callers | FormData arg → typeof guard → /signin (unchanged behavior) |
| Malicious redirectTo | safeNext rejects → safe fallback |
| Unknown scope (unreachable — validation) | Generic fallback copy renders |
| Sign-out → re-auth round trip | Same authorize params re-render the consent card |

---

## 7. Security
redirectTo server-composed + safeNext-filtered (defense in depth); no oauth validation/token paths touched; legacy sign-out behavior byte-identical.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] SCOPE_COPY lookup; no hardcoded scope bullets outside it
2. [ ] typeof-guarded signOutAction via safeNext; settings + SessionMenu callers untouched
3. [ ] "Not you?" = bound sign-out form; round-trip preserves the authorize request
4. [ ] Deny microcopy present
5. [ ] tsc 0 / lint no new / 794 + new tests green (oauth suites explicitly) / build OK

---

## 9. Open Questions
DA rules: bound-string-arg serialization in Next 16; safeNext fallback semantics; Auth.js signOut redirectTo with query strings; microcopy placement/wording; form nesting validity in the card.

---

## 10. Test Plan
Gates; new auth-actions suite; browser: consent card copy + working "Not you?" form (read-only against dev DB — no approve/deny mutations).

---

## 11. Appendix
Premise trace incl. full round-trip verification in plan file. Precedent: signInWithGoogle's (next?, formData?) + .bind shape; safeNext (safe-next.ts).
