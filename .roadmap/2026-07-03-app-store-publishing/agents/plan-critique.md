# Plan Devil's Advocate Critique — App Store Publishing (verbatim agent output, 2026-07-03)

## Verdict: REVISE

## Critical (must fix before decomposition)

1. **Sequenced ahead of its own prerequisite.** #187 (F-1: 2nd real invited user E2E over the LIVE surface) and #188 (F-2: deploy checklist + go-live — whose AC already includes "privacy/ToS pages... live" and turning off `ALLOW_LEGACY_MCP_TOKEN`) are OPEN P0s, exec order #19/#20 of phase1-auth. AS-A2 is F-2's own AC restated under a new epic name. Fix: cross-reference F-2, gate the shell work on F-1/F-2 closing, and state plainly this is a chosen detour before web go-live.

2. **#103 is misrepresented as the go/no-go anchor.** The issue says "Tracking stub — NOT built until the in-app loop (3.3-a..c) proves out", "Out of the $0-simple core", P3, Backlog; its dependency #100 is unbuilt. Fix: AS-0's AC must validate that the in-app nudge loop (#100–102) is insufficient BEFORE treating push as load-bearing.

3. **Founder account-duplication under Apple sign-in is not hypothetical — it already happened** (`scripts/founder-cutover.ts` exists because PrismaAdapter created a second User row on Google sign-in). Adding Apple will trigger the identical failure. Fix: dedicated account-linking story (verified-email, before go-live) with a test asserting Google+Apple same email → one User.id, plus budget for a cutover-style repair script.

4. **Session handoff treated as decide-later; it's the highest-variance critical-path item.** `authjs.session-token` is host-only, `__Secure-`-prefixed (no domain attr — confirmed in @auth/core cookie factory); WKWebView storage is isolated from Safari/ASWebAuthenticationSession — no cookie-sharing trick exists. Fix: commit NOW to the server-minted single-use short-TTL exchange code redeemed inside the WKWebView; spike before estimating AS-B2; single-use, ≤60s TTL, device-nonce binding. AASA must EXCLUDE `/api/auth/*`, `/oauth/*`, `/api/mcp*` from claimed paths (don't let Universal Links hijack OAuth callbacks; don't conflate with the OAuth server's redirect-host allowlist which serves a different purpose).

5. **Invite gate + a silent deletion gap.** Email-bound invites match by exact lowercased email (`src/lib/auth/invite-gate.ts:61-90`) — Apple relay addresses never match; the workable fix is code-only invites for Apple sign-ins, and the plan should state that as the decision. Separately: `Invite.redeemedByUserId` has NO FK (schema comment: "keep loose") — account deletion cascades everything else (verified: 31 real ON DELETE CASCADE constraints in applied migrations) but leaves this as a dangling string forever, invisible to db:verify-owned since Invite isn't in SCOPED_MODELS. Fix: explicit null-out step + test in AS-A3.

## Concerns

6. **AS-A3 is M, not L** — cascade is real at the Postgres level; remaining work is UI/confirmation, invite null-out, test, sign-out.

7. **Opportunity cost unpriced.** `docs/roadmap/multi-domain-transformation-brief.md` (2026-06-16): "Closing that gap is the whole next chapter." Solo founder, no second real user on web yet (#187 open). Steelman GO: native push/home-screen habit loop may be the only retention signal available if PWA install friction is the founder's own bottleneck — but that's a retention bet for a ~1-2 user product; say so, don't smuggle it in as "closes #103".

8. **Hidden costs under the $0 posture.** APNs itself is free from a Vercel function. But sub-daily cron needs Vercel Pro ($20/mo) — the "~$99/yr" total omits it. Org enrollment needs D-U-N-S (1–3+ weeks), which alone could eat the schedule; individual recommended.

9. **4.2 read is right, lever misidentified.** The app is NOT a thin wrapper (dozens of interactive routes, camera, game layer) — risk is lower than canonical. But push is invisible in a review click-through and camera flows get skipped; the cheapest visible-native lever is AS-C4 (haptics/badge/FaceID, S, client-only). Reorder: C2+C4 as cheap defense; C1 conditional on AS-0's actual finding.

10. **PushToken additive claim verified correct** — but must be named in SCOPED_MODELS explicitly in the story AC (easy-to-forget one-liner).

## Suggestions

- Treat as two initiatives: (a) compliance/hygiene benefiting web regardless (merge with F-1/F-2 work); (b) native shell + store, gated hard behind AS-0 and F-1/F-2.
- Cut AS-C3 (HealthKit) and AS-B3 (offline shell) from the v1 critical path. [Note: architect overrides B3 — remote-URL mode makes the SW load-bearing; B3 stays P0. C3 cut stands.]
- 3–6 weeks is optimistic specifically because of #4 and #3 — budget a spike week for AS-B2.
- Maintenance-tax framing in AS-E3 (remote-URL = most web deploys skip App Review) is correct as drafted.
