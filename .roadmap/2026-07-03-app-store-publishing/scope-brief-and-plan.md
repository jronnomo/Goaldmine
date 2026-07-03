# /roadmap — App Store Publishing Initiative

## Context

The user audited what's missing to publish Goaldmine (multi-tenant Next.js 16 PWA on Vercel) to the Apple App Store, turned it into a draft epic breakdown (`docs/roadmap/app-store-publishing-plan.md`), and invoked `/roadmap` to pressure-test it and materialize a real backlog on GitHub Project #8. Phase 2 ran a Plan Architect + Devil's Advocate (both Sonnet); their outputs are reconciled below. **No production code in this run** — the deliverable is planning docs + GitHub issues.

## Scope decisions (user AFK on AskUserQuestion — defaults taken, flagged in the final report)

1. **AS-0 stays a gate**: full backlog materialized; native-shell work additionally gated on #187/#188 (web go-live) closing.
2. **Sprint=Backlog for all items** — zero edits to board #8's shared Sprint single-select (avoids the option-ID wipe). Sequencing lives in issue bodies + backlog doc.
3. **P2 stories included** as issues.

## Reconciled architecture decisions (Architect ⊕ Devil's Advocate)

- **Two tracks in one backlog.** Track 1 (web compliance: privacy, deletion, Apple sign-in + linking) ships regardless and aligns with open issue #188 (F-2 go-live, whose AC already includes privacy/ToS). Track 2 (native shell + store) is gated on AS-0's verdict AND #187/#188 closing. The report must state plainly this is a chosen detour before web go-live / the multi-domain initiative.
- **AS-0 reframed**: #103 is a P3 deferred stub, not a mandate. The spike tests (a) whether push is worth building at all given the unproven in-app nudge loop (#100–102), and (b) iOS Web Push viability. Go/no-go recorded in the plan doc.
- **Capacitor remote-URL mode is the only option** (server components/middleware everywhere → no static export). Consequence: **offline SW is P0** (cold launch renders nothing without it) — hand-rolled `public/sw.js`, network-first, offline-fallback-page-only, never cache `/api/*`, prod-gated registration.
- **Session handoff (committed design, not decide-later):** system-browser auth via ASWebAuthenticationSession + custom scheme `goaldmine://auth-callback`; server mints a hashed single-use ≤60s handoff code post-auth; the **WKWebView itself** POSTs it to a new `/api/auth/shell-exchange` endpoint so Set-Cookie lands in the WebView's jar. Reuses existing OAuth-server patterns (hashed single-use codes, consumedAt). Split into two stories (web endpoint / native escape) — the true long pole.
- **Sign in with Apple:** dynamic ES256 clientSecret signed at runtime via `jose` from env vars (no 6-month rotation task). **No `allowDangerousEmailAccountLinking`** — dedicated "Link Apple ID" settings story running linkAccount under the live session, with a same-email→one-User.id test (founder duplication already happened once → `scripts/founder-cutover.ts`). Invite gate: unbound **code invites** for Apple relay emails (same convention AS-D4 reviewer access needs).
- **Account deletion is M, not L:** 31 real ON DELETE CASCADE constraints verified → `prisma.user.delete()` + typed-confirmation UI + **null out `Invite.redeemedByUserId`** (no FK; invisible to verifiers) + zero-rows regression test + signOut.
- **Push split:** AS-C1a (P0): PushToken model (add to `SCOPED_MODELS` in `src/lib/db.ts`, run both verifiers; upsert-on-token; revokedAt on APNs 410) + hand-rolled `node:http2`+`jose` APNs client (~80 lines, `src/lib/push/apns.ts`) + send-on-write hook in the note-write path (forwards existing text — no LLM, no new infra). AS-C1b (P2): cron-driven proactive nudges — NEW infra (`vercel.json` crons; sub-daily needs Vercel Pro $20/mo — cost flagged).
- **4.2 defense:** AS-C2 (native scanner) + AS-C1a before submission; **AS-C4 (haptics/badge/FaceID) promoted to P1** — cheapest visibly-native lever for a reviewer's first 60 seconds. AS-C3 (HealthKit) stays P2/post-v1 epic candidate.
- **AASA** via `src/app/.well-known/apple-app-site-association/route.ts` (matches existing OAuth discovery route pattern); MUST exclude `/api/auth/*`, `/oauth/*`, `/api/mcp*`; P2 (custom scheme, not Universal Links, carries the auth callback).
- **Enrollment:** individual account (org needs D-U-N-S, 1–3+ weeks).

## Final backlog — 23 stories, 6 epics + gate

**Gate:** AS-0 push-value + Web Push spike (S/P0).
**AS-A Compliance (Track 1, ungated):** A2 privacy policy `/privacy` (S/P0, cross-ref #188) · A3 account deletion (M/P0) · A4 Apple provider (M/P0) · A5 account linking in settings (M/P0, NEW).
**AS-B Shell (gated):** A1 Apple enrollment (S/P0) · B1 Capacitor scaffold (M/P0) · B3 offline SW (M/P0, promoted) · B2a shell-exchange endpoint (M/P0, NEW split) · B2b native auth escape (L/P0, spike-first) · B4 AASA route (S/P2, NEW).
**AS-C Native:** C1a push registration+send-on-write (L/P0) · C1b proactive cron (M/P2, NEW split) · C2 native scanner (S/P1) · C4 polish (S/P1, promoted) · C3 HealthKit (L/P2).
**AS-D Store:** D1 icon/screenshots (M/P0) · D2 listing+landing (M/P0) · D3 privacy labels (S/P0) · D4 reviewer package (S/P0).
**AS-E Release:** E1 TestFlight (S/P0) · E2 submission+rejection loop (M/P0) · E3 runbook (S/P1).

Critical path: A1 → A4/A5 → B1 → B2a → B2b → E1 → E2.

## Execution steps (after approval)

1. Write `$RUN_DIR` artifacts (`.roadmap/2026-07-03-app-store-publishing/`): scope brief, both agent outputs, `coordination/backlog.json` (23 stories, full fields).
2. Rewrite `docs/roadmap/app-store-publishing-plan.md` per the reconciled decisions; write `docs/roadmap/app-store-publishing-backlog.md`.
3. **Backlog Critic** (1 Sonnet) pass over backlog.json (completeness/cycles/right-sizing); fold fixes.
4. Materialize: create labels (`as-compliance`, `as-shell`, `as-native`, `as-store`, `as-release`); 6 epic issues + 23 story issues via `gh issue create -R jronnomo/goaldmine`; `gh project item-add 8 --owner jronnomo`; set Status=Todo/Priority/Effort via `gh project item-edit` with live field IDs (`gh project field-list 8`). **Sprint field untouched.** Log to `$RUN_DIR/phases/materialize-log.md`; on per-story failure, continue and report.
5. Commit planning docs to `feature/phase1-auth` (NOT main — merging deploys). Conventional commit + Co-Authored-By trailer.
6. Report: board link, track/sprint table, critical path, the defaulted scope decisions (user can reverse), next step `/feature-dev "AS-0 …"`.

## Verification

- Issue count on board matches backlog.json; materialize-log has issue#+item-id per story.
- Pre/post `gh project item-list 8` snapshot confirms existing items' Sprint assignments untouched.
- No production code written; nothing pushed to main.
