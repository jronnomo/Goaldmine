# PRD: Delete-account with tenant-scoped cascade (#245)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-11
**Status**: Approved
**GitHub Issue**: #245 (Account & hardening backlog) — substantially satisfies #191 (AS-A3)
**Branch**: feature/phase1-auth
**UX-research**: skipped — standard danger-zone pattern with AC-prescribed typed confirmation; house tokens and existing card idioms

---

## 1. Overview

### 1.1 Problem Statement
Users cannot permanently remove their account and owned data — multiuser table stakes and a GDPR/CCPA expectation.

### 1.2 Premise check (2026-07-11, HEAD 72bc9b8) — the mechanics collapse
| Claim | Verdict |
|---|---|
| "Transaction deleting all 16 SCOPED_MODELS + Account/Session + OAuth grants" | **REDUCIBLE TO ONE STATEMENT** — every User.id relation (all **17** owned models — FoodUsage joined in E-1; the AC's 16 is stale — plus Account, Session, OAuthAuthCode/AccessToken/RefreshToken) is `onDelete: Cascade` in schema AND live migration SQL. `prisma.user.delete()` is atomic and complete |
| Correctly surviving | OAuthClient (global DCR registry), FoodLibrary (shared catalog), VerificationToken, AccessRequest, Invite.redeemedByUserId (no FK — dangles for audit, by design) |
| Sign-out after delete | SAFE — @auth/core try/catches deleteSession (row already cascade-gone → logged, cookie still cleared, redirect proceeds). Verified in installed source |
| Typed confirmation exists to reuse | NO — ConfirmButton is two-tap; type-to-confirm is greenfield |
| Depends-on (settings identity block) | EXISTS (#224, settings:85-137) |
| **Harness gap (found)** | verify-tenant-isolation-full.ts sweeps only 16 models (omits FoodUsage) and cleans up via manual per-model deleteMany — it never exercises the User cascade. IN SCOPE: add FoodUsage + switch cleanup to `user.delete()`, making every harness run a live cascade + founder-untouched proof |

### 1.3 Success Criteria
Typed-confirm danger zone on /settings; one-statement cascade delete (session-derived uid only); sign-out to /signin with a confirmation message; harness proves cascade isolation on the real dev DB across all 17 models; mocked unit suite for the action; gates green at 799+new.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Any tenant | permanently delete my account + all data | I control my data (GDPR/CCPA) | Must Have |
| US-002 | Any OTHER tenant | to be provably untouched by someone else's deletion | tenant isolation extends to destruction | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `deleteAccountAction(formData)` in `src/lib/auth/auth-actions.ts`: `auth()` → session uid (reject if none); SERVER-SIDE phrase validation (`"delete my account"`); `prisma.user.delete({ where: { id: uid } })` (raw singleton — house rule for auth-infra/non-scoped ops); `signOut({ redirectTo: "/signin?deleted=1" })`. NEVER a form-supplied id; no founder special-case; must not catch NEXT_REDIRECT.
2. `DeleteAccountSection.tsx` (client island): danger Card — permanent-consequences copy, labeled type-to-confirm input, submit disabled until exact match, pending state, role="alert" errors.
3. settings/page.tsx: section rendered last.
4. signin/page.tsx: `?deleted` param → fixed confirmation line above the card.
5. Harness: FoodUsage added (17-model sweep); cleanup = `user.delete(B)` + assert founder counts unchanged AND B rows zero everywhere.
6. `delete-account.test.ts` (mocked): phrase matrix, session-uid-only, ordering, no-session rejection.

### 3.2 Out of Scope
Data export before delete (#246); grace-period/soft-delete; email confirmation; #191's Apple-specific requirements beyond deletion itself.

---

## 4. Technical Design
One server action + one client island + two page touches + harness upgrade. No schema changes (cascade already complete). No MCP changes (an active claude.ai connection 401s after its tokens cascade — DA confirms acceptable).

---

## 5. UI/UX
Danger-zone card, house danger tokens; typed confirmation; calm signin message.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Wrong/empty phrase (client bypassed) | Server rejects; nothing deleted |
| Double-submit | Second call finds no user → clean error path, no crash |
| Active MCP connection | Tokens cascade → next call 401s (correct) |
| Session cookie after delete | signOut clears it (deleteSession failure is caught upstream) |
| Founder running the harness | Founder rows byte-untouched (guarded, asserted) |

---

## 7. Security
Session-derived uid only; server-side confirmation; raw-singleton use confined to the action; open-redirect N/A (fixed target); destructive path exercised only via the guarded dev-DB harness.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] Typed-confirm delete flow on /settings (no window.confirm)
2. [ ] `user.delete()` cascade removes User + all 17 owned models + Account/Session + OAuth tokens (harness-proven on real DB)
3. [ ] Signs out → /signin?deleted=1 with confirmation message
4. [ ] db:verify-isolation green with the upgraded 17-model cascade-cleanup harness; mocked unit suite for the action
5. [ ] tsc 0 / lint no new / 799+new / build OK; auth + oauth suites green

---

## 9. Open Questions
DA rules: NEXT_REDIRECT handling; phrase exactness (trim/case); double-submit semantics; harness founder-safety; $transaction value (expected: none).

---

## 10. Test Plan
Gates; new mocked suite; `npm run db:verify-isolation` (now the live cascade proof); browser UI-state checks WITHOUT submitting (founder account is not a test fixture).

---

## 11. Appendix
Cascade evidence: schema.prisma relation lines (17 owned + auth + oauth), migrations 20260701110534/20260702164751/20260702111255. House rules: db.ts:379, connections.ts header. Related: #246 (export), #191 (AS-A3).
