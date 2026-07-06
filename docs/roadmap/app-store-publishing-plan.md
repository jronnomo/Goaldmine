# App Store Publishing — Plan (v2, pressure-tested)

**Initiative:** Ship Goaldmine to the Apple App Store as a Capacitor-wrapped native app.
**Status:** PLANNED — backlog materialized on GitHub Project #8 (2026-07-03). v1 of this doc was the raw audit breakdown; v2 folds in the Plan Architect blueprint and Devil's Advocate critique (both in `.roadmap/2026-07-03-app-store-publishing/agents/`).
**Verdict context:** the Devil's Advocate returned REVISE; this v2 is the revision.

## The honest framing (read this first)

- **This initiative is a chosen detour.** Web go-live isn't finished: **#187** (F-1: 2nd real invited user E2E) and **#188** (F-2: deploy checklist + go-live) are open P0s, and the planned next chapter was the multi-domain transformation (`multi-domain-transformation-brief.md`). Track 2 below is **gated on #187/#188 closing AND on AS-0's GO verdict**.
- **#103 (push nudges) does not justify urgency** — it's an explicitly deferred P3 stub pending the in-app nudge loop (#100–102) proving out. The real bet is retention: a home-screen native app + push habit loop for a product whose founder is currently its main user. AS-0 tests that bet before anything native gets built.
- **Costs beyond $99/yr:** sub-daily proactive push (AS-C1b) needs Vercel Pro ($20/mo) — flagged as an explicit decision, not a default. Org enrollment needs D-U-N-S (1–3+ weeks); **individual enrollment chosen** for now.

## Two tracks

**Track 1 — Web compliance (ungated, start anytime):** privacy policy, terms of service, account deletion, Sign in with Apple + account linking, plus Apple Developer enrollment (needed for the Services ID — explicitly exempt from the Track 2 gate). All ship value for the web product regardless of the App Store verdict; AS-A2/AS-A6 overlap #188's own acceptance criteria (cross-referenced, not duplicated).

**Track 2 — Native shell + store (gated):** Capacitor shell, session handoff, push, scanner, listing, TestFlight, submission.

## Load-bearing architecture decisions (from the pressure-test)

1. **Capacitor remote-URL mode is the ONLY option** — server components/middleware everywhere; no static export. Consequences: (a) 4.2 "wrapped website" risk is structural, so native capabilities (C1a/C2/C4) are the submission defense; (b) **the offline service worker is P0** — nothing is bundled, so a cold offline launch renders a white screen without it.
2. **Session handoff (committed design):** OAuth escapes the WebView via ASWebAuthenticationSession → completes the unmodified Auth.js flow → server mints a hashed single-use ≤60s handoff code → custom scheme `goaldmine://auth-callback?code=` → the **WKWebView itself** POSTs `/api/auth/shell-exchange` so Set-Cookie lands in its own jar. Reuses `src/lib/oauth/` hashed-code/consumedAt patterns. Split into B2a (web endpoint, testable now) + B2b (native bridge, spike-first).
3. **Sign in with Apple:** runtime-signed ES256 clientSecret via `jose` from `AUTH_APPLE_*` env vars (no 6-month rotation task). **No `allowDangerousEmailAccountLinking`.** Dedicated "Link Apple ID" settings story (AS-A5) with a same-email→one-User.id regression test — the founder-cutover duplication bug must not recur. Invite gate: **unbound code invites** are the convention for Apple relay emails (same mechanism AS-D4 reviewer access uses).
4. **Account deletion is `prisma.user.delete()`** — 31 verified ON DELETE CASCADE constraints do the fan-out. Plus: typed confirmation UI, **null out `Invite.redeemedByUserId`** (no FK; invisible to verifiers), sign-out, zero-rows regression test. Re-sized L→M.
5. **Push split:** C1a (P0) = PushToken model (added to `SCOPED_MODELS`, both verifiers run) + hand-rolled `node:http2`+`jose` APNs client (`src/lib/push/apns.ts`, nodejs runtime) + send-on-write hook forwarding existing note text — no LLM, no new infra. C1b (P2) = proactive cron — new `vercel.json` surface + the cost decision.
6. **4.2 defense ordering:** C2 (native scanner) and C4 (haptics/badge/FaceID — cheapest *visible* native signal, promoted P1) ship before submission alongside C1a. C3 (HealthKit) is P2 and a post-v1 epic candidate — off the critical path.
7. **AASA** via a `.well-known` route handler (existing OAuth-discovery pattern); claimed paths **exclude** `/api/auth/*`, `/oauth/*`, `/api/mcp*`. P2 — the auth callback rides the custom scheme, not Universal Links.

## Backlog (25 stories — live on board #8, Sprint=Backlog, sequencing below)

| Slice | Stories | Ships via |
|---|---|---|
| 1 (Track 1) | AS-0 gate spike · A2 privacy · A6 terms · A3 deletion | web deploy |
| 2 (Track 1) | A1 enrollment (wall-clock, gate-exempt) · A4 Apple provider · A5 linking | web deploy |
| — GATE — | Track 2 requires: AS-0 = GO, #187 + #188 closed | |
| 3 | B1 scaffold · B3 offline SW | new binary |
| 4 | B2a exchange endpoint · B2b native auth bridge (spike-first) | binary + web |
| 5 | C1a-1 push model/registration · C1a-2 APNs send · C2 scanner · C4 polish | new binary |
| 6 | D1 icon/screenshots · D2 listing/landing · D3 privacy labels · D4 reviewer package · E1 TestFlight | new binary |
| 7 | E2 submission · E3 runbook | — |
| Backlog | B4 AASA · C1b cron push · C3 HealthKit | — |

**Critical path:** A1 → A4/A5 → B1 → B2a → B2b → E1 → E2. B2b is the highest-variance story — spike before trusting any estimate. Full story definitions with acceptance criteria: `docs/roadmap/app-store-publishing-backlog.md` + the GitHub issues.

## AS-0 gate — RESOLVED: NO-GO (2026-07-05)

**The gate fired exactly as designed.** The spike delivered a real coach nudge to the founder's iPhone lock screen via Web Push from the installed PWA (evidence: `as0-push-assessment.md` §4.2) — push is solved without a native shell. Founder verdict: **NO-GO on Track 2; productize Web Push instead.**

- Track 2 closed (#196–#213 stories, #215–#218 epics, not-planned); AS-0 #189 closed completed.
- Apple-specific stories #192/#193/#195 downgraded P0→P3 (no store listing → no Guideline 4.8 mandate).
- Compliance stories #190/#191/#194 remain open — required by web go-live (#188) anyway.
- Replacement story: **productize Web Push nudge delivery** (see issue created 2026-07-05; supersedes #103's intent). Spike code preserved at git tag `spike/web-push-final`.
- Total initiative spend: one spike (~1 day) instead of 3–6 weeks. This outcome is a success, not a failure — the whole point of the gate.

This initiative is now **closed**. Revisit natively only if discoverability/HealthKit become independently business-critical (see Future flags).

## Future flags (out of scope)

- **Payments:** any digital-goods billing surfaced in the iOS app must use Apple IAP (15% small-business tier) or an external-purchase-link entitlement. Decide before chewgether monetization touches the app.
- **Android/Play Store:** cheap later via Capacitor; separate epic.
- **HealthKit write / workout sessions:** revisit post-launch.
