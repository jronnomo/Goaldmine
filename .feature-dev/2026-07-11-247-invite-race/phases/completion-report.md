# Completion report — #247 — 2026-07-11 · Invite race fix — ACCOUNT-HARDENING SET COMPLETE

## Shipped (commit 2db9e4a, merged on feature/phase1-auth; +380/-42 across 4 files)
1. **`claimInvite(inviteId)`**: one atomic conditional UPDATE via parameterized `$executeRaw` — `WHERE useCount < maxUses AND (expiresAt IS NULL OR > NOW())`. The AC's suggested `updateMany` guard is INEXPRESSIBLE in Prisma (column-vs-column WHERE — the documented reason the racy JS check existed); raw SQL was the only correct shape.
2. **Claim moved to the gate** (signIn callback): the loser gets 0 affected rows → the existing clean `/request-access?email=…` redirect BEFORE any User row exists. Bypass paths (OPEN_SIGNUP/founder/returning) claim nothing.
3. **`invite_claim_id` cookie** (the DA's design, superseding the PRD's backfill-resolution approach after proving BOTH its variants wrong): set exclusively on claim success; `events.createUser` trusts ONLY its presence and does a set-if-null `redeemedByUserId` backfill — stale `invite_code` cookies on bypass signups can no longer corrupt the audit trail, and the winner's own backfill can't be broken by the post-claim exhausted re-check. Cookie viability verified against Next 16 route-handler internals.
4. **Burned-slot risk** (adapter fails after claim → slot consumed, no user) documented in-code as accepted founder-scale risk with the diagnostic signature (`useCount > 0 AND redeemedByUserId IS NULL`).
5. **`scripts/verify-invite-race.ts`** (permanent, guarded, self-cleaning): the real-Postgres atomicity proof — maxUses:1 concurrent race → exactly one winner; maxUses:3 sequence → 3 succeed, 4th rejected.

## Verification
- Gates: tsc 0 · lint 0 errors, no disables · **822/822** (817 + 5) · build OK · auth+oauth **226/226**.
- **Race proof run 3× total** (dev agent 2×, orchestrator post-merge 1×): all 6 checks PASS every run; zero leftover test rows.
- All **26 pre-existing invite-gate tests pass UNMODIFIED** (mock gained only `$executeRaw`); single-redeemer behavior byte-equivalent.
- Greps: no `useCount: { increment` anywhere in src/; the claim cookie set exactly once, on the success branch only.

## Process
Premise check (race confirmed with the exact window mapped in installed @auth/core; the AC's fix proven inexpressible; the naive fix's follow-on backfill bug predicted) → PRD → DA **APPROVE-WITH-CONDITIONS** (killed the PRD's backfill-resolution in both variants; designed the claim-cookie handoff and verified Next 16 cookie-mutation plumbing; confirmed callback string-return semantics byte-equivalent) → dev agent (stale base self-corrected; zero deviations) → gates + orchestrator race re-run. Zero iterations.

## ACCOUNT-HARDENING SET COMPLETE: #245 (delete) + #246 (export) + #247 (invite race)
Tests across the set: 799 → **822**. Three permanent verification scripts now guard the account lifecycle: verify-tenant-isolation-full (17-model live cascade), measure-export (size watchdog), verify-invite-race (atomicity proof).

## Remaining backlog
#250 (de-founder MCP instructions/badges), #252 (nested-dialog Log sheet bug), #251 (web push productization), App Store P3s, strategic (mde-*/roadmap). Consider a /launch-gate + deploy for the hardening set, or batch with #250.
