# PRD: Harden invite maxUses against concurrent redemption (#247)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-11
**Status**: Approved
**GitHub Issue**: #247 (Account & hardening backlog — closer)
**Branch**: feature/phase1-auth
**UX-research**: skipped — no UI change (the race loser lands on the existing /request-access page)

---

## 1. Overview

### 1.1 Problem Statement
Two simultaneous signups on a maxUses:1 invite both pass the gate: the useCount<maxUses comparison runs in JS at the signIn callback, and the unguarded `increment: 1` runs later in events.createUser — both requests read useCount=0 before either writes.

### 1.2 Premise check (2026-07-11, HEAD 7da44a0)
| Claim | Verdict |
|---|---|
| Race real | **CONFIRMED** — window mapped in installed @auth/core: per-signup intra-request (signIn callback → adapter createUser → events.createUser); exploit = two callback requests interleaving. OAuth roundtrip NOT in the window (cookie set pre-redirect) |
| Fix = "updateMany with useCount < maxUses guard" | **INEXPRESSIBLE in Prisma** — column-vs-column WHERE unsupported (the documented reason the JS check exists, invite-gate.ts:62-63). Requires raw parameterized SQL with affected-row count |
| Where to claim | **At the gate (signIn callback)** — createUser-time rejection strands an orphaned User+Account and surfaces generic AccessDenied; the gate's loser path is the existing clean `/request-access?email=…` redirect |
| Naive-fix follow-on bug | Post-claim, createUser's re-check sees the exhausted invite → redeemedByUserId would never backfill. createUser must stop checking/incrementing; backfill-only by cookie-code resolution |
| "Unit test simulating concurrency" | **Overpromise** — mocks can prove guard shape + loser branch, not atomicity (that lives in Postgres). True proof = permanent guarded real-DB race script (house pattern) |

### 1.3 Success Criteria
Exactly one winner on a maxUses:1 race (real-Postgres proven); loser lands on /request-access; single-redeemer path byte-equivalent; redeemedByUserId still backfills; all 26 existing invite-gate tests pass unmodified; gates green at 817+new.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Founder minting maxUses:1 codes | exactly one redemption per slot | invites mean what they say | Must Have |
| US-002 | The race loser | a clean request-access page, not an error | graceful denial | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `claimInvite(inviteId)` (invite-gate.ts): parameterized `$executeRaw` — `UPDATE "Invite" SET "useCount" = "useCount" + 1, "redeemedAt" = COALESCE("redeemedAt", NOW()) WHERE "id" = ? AND "useCount" < "maxUses" AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`; affected-count 1 = claimed, 0 = lost/expired.
2. auth.ts signIn callback: allowed + redeemInviteId → claim; 0 rows → `/request-access?email=…`. Allowed without redeemInviteId (OPEN_SIGNUP/founder/returning) → no claim.
3. events.createUser: re-check + increment REMOVED; backfill-only — resolve invite by cookie (gate's resolution order), `updateMany({ where: { id, redeemedByUserId: null }, data: { redeemedByUserId } })` with the DA-prescribed guard against stale-cookie backfill on bypass-path signups.
4. Tests: existing 26 pass untouched (mock gains $executeRaw); new claimInvite unit cases (claimed/lost).
5. **`scripts/verify-invite-race.ts`** (permanent, DB_ENV guard, self-cleaning): temp maxUses:1 invite → two concurrent claims → assert exactly one winner + useCount===1 → cleanup. THE atomicity proof.

### 3.2 Out of Scope
DB CHECK constraint backstop (migration → prod; noted for future); rate limiting; admin invite management.

---

## 4. Technical Design
No schema change. Raw SQL confined to claimInvite (tagged template, injection-safe). Auth surface change covered by the existing + new suites per Gate-6 discipline.

---

## 5. UI/UX
None — loser sees the existing /request-access page.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Two concurrent maxUses:1 redemptions | Exactly one wins; loser → /request-access |
| Claim raced between check and claim | 0 rows → same loser path |
| Invite expires between check and claim | 0 rows (expiry re-guard in the SQL) |
| OPEN_SIGNUP/founder signup with stale invite cookie | NO claim, NO backfill (guarded) |
| Winner's signup fails after claim (slot burned) | Accepted + documented (founder re-mints; DA rules) |
| maxUses:3 sequential redemptions | All three claim; fourth rejected |

---

## 7. Security
Atomic claim closes the gate bypass; parameterized SQL; no new inputs; loser path leaks nothing new.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] Atomic conditional claim (raw SQL — the AC's updateMany shape is inexpressible; amended) at the signIn gate; loser rejected to /request-access
2. [ ] Real-Postgres race proof: exactly one success on maxUses:1 (permanent script, run twice)
3. [ ] All 26 existing invite-gate tests pass unmodified; single-redeemer behavior unchanged; redeemedByUserId backfills
4. [ ] tsc 0 / lint no new / 817+new / build OK; auth+oauth suites green

---

## 9. Open Questions
DA rules: $executeRaw return typing; thrown-vs-returned callback semantics; the stale-cookie backfill guard; same-user-retry slot burn; race-script connection concurrency.

---

## 10. Test Plan
Gates; new unit cases; the race script (dev agent + orchestrator runs); explicit auth suite run.

---

## 11. Appendix
Flow trace + @auth/core ordering verification in the premise report (plan file). Sibling hardening: #245 (delete), #246 (export) — this closes the set.
