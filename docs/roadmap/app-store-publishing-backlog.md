# App Store Publishing — Backlog (materialized 2026-07-03)

Generated from `.roadmap/2026-07-03-app-store-publishing/coordination/backlog.json`. Plan: `app-store-publishing-plan.md`. Board: GitHub Project #8 (all items Sprint=Backlog; sequencing in the plan doc).

**Tracks:** Web compliance — ships regardless of App Store verdict; aligns with #188 (F-2 go-live) // Native shell + store — gated on AS-0 GO verdict AND #187/#188 closing

| ID | Title | Epic | Track | Effort | Pri | Depends on |
|---|---|---|---|---|---|---|
| AS-0 | Spike: push-value assessment + iOS Web Push viability (Track 2 gate) | gate | gate | Small | P0 | — |
| AS-A2 | Privacy policy page at /privacy | AS-A Compliance | track1 | Small | P0 | — |
| AS-A3 | In-app account deletion | AS-A Compliance | track1 | Medium | P0 | — |
| AS-A4 | Sign in with Apple provider | AS-A Compliance | track1 | Medium | P0 | AS-A1 |
| AS-A5 | Account linking: 'Link Apple ID' in settings | AS-A Compliance | track1 | Medium | P0 | AS-A4 |
| AS-A6 | Terms of Service page at /terms | AS-A Compliance | track1 | Small | P0 | — |
| AS-A1 | Apple Developer Program enrollment (individual) | AS-A Compliance | track1 | Small | P0 | — |
| AS-B1 | Capacitor iOS shell scaffold (remote-URL mode) | AS-B Shell | track2 | Medium | P0 | AS-0, AS-A1 |
| AS-B3 | Offline shell service worker | AS-B Shell | track2 | Medium | P0 | AS-B1 |
| AS-B2a | Shell session-exchange endpoint (one-time handoff code) | AS-B Shell | track2 | Medium | P0 | AS-A4 |
| AS-B2b | Native auth escape + callback bridge (ASWebAuthenticationSession) | AS-B Shell | track2 | Large | P0 | AS-B1, AS-B2a |
| AS-B4 | AASA route for deep links (defense-in-depth) | AS-B Shell | track2 | Small | P2 | AS-B1 |
| AS-C1a-1 | PushToken model + device registration endpoint | AS-C Native | track2 | Medium | P0 | AS-B1 |
| AS-C1a-2 | APNs client + send-on-write nudge push | AS-C Native | track2 | Medium | P0 | AS-C1a-1 |
| AS-C1b | Proactive cron nudges (baseline-due / plan-conflict) | AS-C Native | track2 | Medium | P2 | AS-C1a-2 |
| AS-C2 | Native barcode scanner in the shell | AS-C Native | track2 | Small | P1 | AS-B1 |
| AS-C4 | Native polish: haptics, app badge, Face ID lock | AS-C Native | track2 | Small | P1 | AS-B1 |
| AS-C3 | HealthKit read import (post-v1 candidate) | AS-C Native | track2 | Large | P2 | AS-B1 |
| AS-D1 | App Store icon + screenshot sets | AS-D Store | track2 | Medium | P0 | AS-B1 |
| AS-D2 | Listing metadata + landing/support pages | AS-D Store | track2 | Medium | P0 | AS-A1 |
| AS-D3 | Privacy nutrition labels + export compliance | AS-D Store | track2 | Small | P0 | AS-A2 |
| AS-D4 | Reviewer demo-access package | AS-D Store | track2 | Small | P0 | AS-A4, AS-B2b |
| AS-E1 | TestFlight internal beta | AS-E Release | track2 | Small | P0 | AS-B2b, AS-C1a-2, AS-C2 |
| AS-E2 | App Review submission + rejection-response loop | AS-E Release | track2 | Medium | P0 | AS-E1, AS-D1, AS-D2, AS-D3, AS-D4 |
| AS-E3 | Release & versioning runbook | AS-E Release | track2 | Small | P1 | AS-E2 |

## [AS-0] Spike: push-value assessment + iOS Web Push viability (Track 2 gate)

**Value:** Decide whether the native-shell initiative (Track 2) proceeds at all, so 3-6 weeks isn't spent on a bet that a service worker settles in days.

**Acceptance criteria:**
- [ ] Assess the in-app nudge loop (#100-102) status: written verdict on whether anything falls short that push uniquely fixes (#103 is a P3 deferred stub — do not treat it as a mandate)
- [ ] Web Push proof: minimal SW + push subscription on the founder's iPhone (installed PWA, iOS 16.4+), one real nudge delivered
- [ ] GO/NO-GO for Track 2 recorded in docs/roadmap/app-store-publishing-plan.md with rationale (retention-bet framing made explicit)
- [ ] Confirm gate prerequisite: Track 2 stories do not start until #187 (F-1) and #188 (F-2) close

**Touches:** public/sw.js (spike-only), docs/roadmap/app-store-publishing-plan.md · **Effort:** Small · **Priority:** P0 · **Depends on:** nothing

## [AS-A2] Privacy policy page at /privacy

**Value:** Required for App Store Connect AND for web go-live (#188's own AC includes privacy/ToS pages) — ships value regardless of the AS-0 verdict.

**Acceptance criteria:**
- [ ] /privacy route, server component, publicly accessible unauthenticated (route-access updated)
- [ ] Covers: Google/Apple auth data, fitness/nutrition/health logs, the claude.ai MCP connector data flow (third-party access via OAuth), subprocessors (Vercel/Neon/Upstash), retention, deletion contact
- [ ] Linked from /settings and /signin
- [ ] Cross-referenced with #188 (F-2) so the work isn't duplicated

**Touches:** src/app/privacy/, src/lib/auth/route-access.ts, src/app/settings/, src/app/signin/ · **Effort:** Small · **Priority:** P0 · **Depends on:** nothing

## [AS-A3] In-app account deletion

**Value:** Guideline 5.1.1(v) hard blocker for the store, and correct multi-tenant hygiene for web users now.

**Acceptance criteria:**
- [ ] Settings → Delete Account with typed confirmation
- [ ] Server action calls prisma.user.delete() on the raw client (User is not a scoped model; 31 verified ON DELETE CASCADE constraints do the fan-out)
- [ ] Explicitly nulls Invite.redeemedByUserId rows referencing the deleted user (no FK — invisible to verifiers otherwise)
- [ ] Signs out and redirects to /signin
- [ ] Regression test asserts zero rows across all 17 SCOPED_MODELS plus Account/Session/OAuth* for the deleted userId
- [ ] npm run db:verify-owned clean after a test deletion

**Touches:** src/app/settings/, src/lib/auth/, src/lib/db.ts (read-only reference), new *.test.ts · **Effort:** Medium · **Priority:** P0 · **Depends on:** nothing

## [AS-A4] Sign in with Apple provider

**Value:** Guideline 4.8 mandates it once Google login is offered; also unblocks reviewer demo access.

**Acceptance criteria:**
- [ ] Apple provider added in src/lib/auth/auth.ts; clientSecret is a runtime-signed ES256 JWT via jose from AUTH_APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY/ID env vars (~24h TTL, memory-cached) — no stored/rotating static secret
- [ ] .env.example documents the four AUTH_APPLE_* vars (placeholders only)
- [ ] Apple button on /signin; flow completes on web
- [ ] Invite gate passable by an Apple private-relay email via an UNBOUND code invite (email: null) — decision: code invites are the convention for Apple signups
- [ ] allowDangerousEmailAccountLinking is NOT enabled (explicitly asserted in a test or comment)
- [ ] Full auth test suite green

**Touches:** src/lib/auth/auth.ts, src/app/signin/, .env.example, src/lib/auth/invite-gate.ts (verify, likely no change) · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-A1

## [AS-A5] Account linking: 'Link Apple ID' in settings

**Value:** Prevents the founder-cutover account-duplication bug recurring: same human signing in via Apple must NOT create a second User row splitting tenant data.

**Acceptance criteria:**
- [ ] Settings → 'Link Apple ID' runs the Apple OAuth flow while authenticated, calling the adapter's linkAccount under the CURRENT session's userId
- [ ] Test asserts: user with a Google account who links Apple resolves to ONE User.id (no duplicate row) — the scripts/founder-cutover.ts failure mode is the regression under guard
- [ ] Signin page copy nudges existing users to link from settings rather than fresh-signing-in with Apple
- [ ] Unlink is explicitly out of scope (documented)

**Touches:** src/app/settings/, src/lib/auth/auth.ts, new *.test.ts · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-A4

## [AS-A6] Terms of Service page at /terms

**Value:** Closes #188's own go-live AC ('privacy/ToS live') and gives a health/fitness-logging product baseline liability/usage terms before real users or App Review see it — ships regardless of the AS-0 verdict.

**Acceptance criteria:**
- [ ] /terms route, server component, publicly accessible unauthenticated (route-access updated)
- [ ] Covers: acceptable use, no medical/professional-advice disclaimer for coaching guidance, account eligibility, invite-gated access model, termination and cross-reference to account deletion (AS-A3), liability limitation, governing law/contact
- [ ] Linked from /settings and /signin alongside /privacy
- [ ] Cross-referenced with #188 (F-2) so its AC ('privacy/ToS live') closes without duplicated work

**Touches:** src/app/terms/, src/lib/auth/route-access.ts, src/app/settings/, src/app/signin/ · **Effort:** Small · **Priority:** P0 · **Depends on:** nothing

## [AS-A1] Apple Developer Program enrollment (individual)

**Value:** Prerequisite for Sign in with Apple config, APNs keys, and everything native. Wall-clock lead time — start early.

**Acceptance criteria:**
- [ ] Individual membership active ($99/yr); App Store Connect accessible
- [ ] Decision recorded: individual now; org (needs D-U-N-S, 1-3+ weeks) deferred until an LLC exists — seller name is public either way
- [ ] App ID, Services ID (for Apple sign-in), and APNs .p8 key can be created
- [ ] Explicitly EXEMPT from the Track 2 #187/#188 gate: Track 1's AS-A4 (Apple provider) needs the Services ID immediately

**Touches:** (no code) · **Effort:** Small · **Priority:** P0 · **Depends on:** nothing

## [AS-B1] Capacitor iOS shell scaffold (remote-URL mode)

**Value:** The native container. Remote-URL is the only viable mode (server components/middleware everywhere → no static export).

**Acceptance criteria:**
- [ ] Capacitor config: appId com.<org>.goaldmine, server.url = prod domain, cleartext: false, allowNavigation locked to the prod domain only
- [ ] ios/ Xcode project builds and runs on a physical iPhone; all routes usable
- [ ] Safe areas / status bar correct on notched devices; splash screen + app icon set
- [ ] Runbook note captured: with remote-URL mode, web deploys ship without a new binary; only plugins/entitlements/native code need one
- [ ] CLAUDE.md Stack/Key-directories updated to document the Capacitor shell (ios/, capacitor.config.ts)

**Touches:** capacitor.config.ts (new), ios/ (new), package.json · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-0, AS-A1

## [AS-B3] Offline shell service worker

**Value:** In remote-URL mode NOTHING is bundled — a cold launch without network renders a white screen unless a SW intercepts. P0, not polish.

**Acceptance criteria:**
- [ ] Hand-rolled public/sw.js (rejected: serwist/Workbox — precache-manifest pipelines fit static sites, not per-user SSR/RSC)
- [ ] Precache ONLY an offline fallback page + static shell assets (icons/manifest); network-first fetch handler everywhere else
- [ ] Never caches /api/* or RSC payload requests
- [ ] Navigation requests fall back to the branded offline page on network failure; airplane-mode cold launch in the shell shows it
- [ ] Registration via a small client component gated to NODE_ENV === 'production' (no Turbopack HMR interference)
- [ ] No stale-data regressions: Today page reflects a mutation immediately after it (revalidatePath behavior unchanged)
- [ ] CLAUDE.md updated to document public/sw.js and its network-first/no-API-caching contract

**Touches:** public/sw.js (new), src/app/offline/ (new), src/app/layout.tsx · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-B1

## [AS-B2a] Shell session-exchange endpoint (one-time handoff code)

**Value:** Cookies set in the external auth browser never reach the WKWebView; this endpoint is the committed transfer mechanism, buildable and testable web-side before any native code exists.

**Acceptance criteria:**
- [ ] Post-auth shell landing page mints a hashed, single-use, <=60s-TTL handoff code bound to the authenticated userId (reuse the OAuth server's hashed-code + consumedAt patterns from src/lib/oauth/)
- [ ] POST /api/auth/shell-exchange validates + consumes the code and sets the Auth.js session cookie on the response (the WebView makes this request itself, so Set-Cookie lands in its own jar)
- [ ] Replayed or expired code → 401; code is opaque and never logged (never-echo rule)
- [ ] Unit tests: happy path, expiry, single-use enforcement, invalid code
- [ ] Endpoint unreachable/no-op for ordinary web sessions (shell-only entry point documented)

**Touches:** src/app/api/auth/shell-exchange/ (new), src/lib/auth/, src/lib/oauth/ (pattern reuse, no behavior change), prisma/schema.prisma (small additive table or reserved pseudo-client row) · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-A4

## [AS-B2b] Native auth escape + callback bridge (ASWebAuthenticationSession)

**Value:** Google blocks OAuth in embedded WebViews; sign-in must escape to a real browser context and hand the session back. Highest-variance story on the critical path — spike before trusting the estimate.

**Acceptance criteria:**
- [ ] Timeboxed spike first: evaluate @capacitor-community/generic-oauth2 vs a small custom native bridge; decision recorded
- [ ] Sign-in in the shell opens ASWebAuthenticationSession (prefersEphemeralWebBrowserSession: false), runs the UNMODIFIED Auth.js flow, completes via custom scheme goaldmine://auth-callback?code=<handoff code>
- [ ] Native layer passes the code to the WKWebView, which POSTs it to /api/auth/shell-exchange (AS-B2a) — no cookie values ever transit a URL
- [ ] Google AND Apple sign-in complete inside the installed app on a physical device
- [ ] Session persists across app restarts (WKWebsiteDataStore.default persistence)

**Touches:** ios/ native bridge, capacitor.config.ts, src/app/signin/ (shell-aware entry) · **Effort:** Large · **Priority:** P0 · **Depends on:** AS-B1, AS-B2a

## [AS-B4] AASA route for deep links (defense-in-depth)

**Value:** Future deep-linking (/recap/* shares, notification taps). NOT on the auth critical path — the handoff uses a custom scheme.

**Acceptance criteria:**
- [ ] src/app/.well-known/apple-app-site-association/route.ts following the existing OAuth-discovery route-handler pattern; Content-Type application/json, no redirect
- [ ] Claimed applinks paths EXCLUDE /api/auth/*, /oauth/*, /api/mcp* (Universal Links must never intercept OAuth/MCP navigation)
- [ ] Associated-domains entitlement documented; Apple CDN propagation delay noted in the runbook

**Touches:** src/app/.well-known/apple-app-site-association/ (new), ios/ entitlements · **Effort:** Small · **Priority:** P2 · **Depends on:** AS-B1

## [AS-C1a-1] PushToken model + device registration endpoint

**Value:** Owned device-token storage is the prerequisite for any native push — isolating it from the APNs wire-protocol work lets tenant-scoping risk ship and verify independently.

**Acceptance criteria:**
- [ ] Additive migration: PushToken { id, userId?, token @unique, platform default 'ios', createdAt, lastSeenAt?, revokedAt?, user relation onDelete: Cascade, @@index([userId]) }
- [ ] PushToken added to SCOPED_MODELS in src/lib/db.ts; npm run db:verify-owned AND db:verify-isolation green
- [ ] Registration endpoint upserts on token (device may change owning user); best-effort token delete on sign-out; deletion cascade covers account deletion

**Touches:** prisma/schema.prisma, src/lib/db.ts, src/app/api/push/ (new) · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-B1

## [AS-C1a-2] APNs client + send-on-write nudge push

**Value:** The actual push send — the strongest Guideline 4.2 defense and the load-bearing native capability. Zero new infra: forwards text the product already produces (no LLM, no cron).

**Acceptance criteria:**
- [ ] src/lib/push/apns.ts: hand-rolled node:http2 client + jose ES256 provider-token auth to api.push.apple.com (nodejs runtime, NOT edge); ~80 lines; unit-tested with mocked http2; APNs 410/BadDeviceToken sets revokedAt
- [ ] Send-on-write hook in the note-write path forwards the note's existing body (truncated) as the push — no content generation, no LLM
- [ ] Founder receives a real nudge push on-device; permission prompt is contextual, not on first launch
- [ ] CLAUDE.md updated to document the push/APNs infra (src/lib/push/)

**Touches:** src/lib/push/apns.ts (new), src/lib/mcp/tools.ts (note-write hook) · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-C1a-1

## [AS-C1b] Proactive cron nudges (baseline-due / plan-conflict)

**Value:** Pushes that fire without a coach write. NEW infra surface — this repo has no cron today.

**Acceptance criteria:**
- [ ] vercel.json crons entry + secret-header-gated /api/cron/nudge-check route
- [ ] Triggers: baseline due, plan conflict (deterministic reads via existing resolveDay/readiness paths, all dates via @/lib/calendar)
- [ ] COST DECISION RECORDED BEFORE ENABLING: Vercel Hobby cron is once/day; sub-daily requires Pro ($20/mo) — violates the $0 posture unless accepted explicitly
- [ ] CLAUDE.md updated to document the cron surface (vercel.json)

**Touches:** vercel.json (new), src/app/api/cron/ (new) · **Effort:** Medium · **Priority:** P2 · **Depends on:** AS-C1a-2

## [AS-C2] Native barcode scanner in the shell

**Value:** Faster, more reliable scanning than zxing-wasm inside WKWebView, and a visible native capability for review.

**Acceptance criteria:**
- [ ] Capacitor barcode/camera plugin used when running in the shell; zxing-wasm path preserved for web browsers
- [ ] NSCameraUsageDescription string set
- [ ] Nutrition barcode scan completes in the shell; web behavior unchanged

**Touches:** src/app/import/ or nutrition scan component, ios/, capacitor.config.ts · **Effort:** Small · **Priority:** P1 · **Depends on:** AS-B1

## [AS-C4] Native polish: haptics, app badge, Face ID lock

**Value:** Cheapest visibly-native lever for a reviewer's first 60 seconds (push is invisible in a click-through; camera flows get skipped). Pure client-side plugins, no server infra.

**Acceptance criteria:**
- [ ] Haptic feedback on log/complete actions in the shell
- [ ] App icon badge reflects pending nudge count
- [ ] Optional Face ID app lock behind a settings toggle
- [ ] All three degrade silently on web

**Touches:** capacitor plugins, src/app/settings/, shared client hooks · **Effort:** Small · **Priority:** P1 · **Depends on:** AS-B1

## [AS-C3] HealthKit read import (post-v1 candidate)

**Value:** Auto-import workouts/body mass — on-brand but a secretly-separate project (own UX, dedupe logic, entitlement + privacy surface). Keep OFF the v1 critical path.

**Acceptance criteria:**
- [ ] Opt-in toggle; read-only (workouts, body mass)
- [ ] Dedupe against Strong imports by startedAt (DateTime, not date-only)
- [ ] Imported entries visible on Today/History; no duplicate logging
- [ ] Privacy policy + App Store privacy labels updated; HealthKit entitlement added
- [ ] Consider spinning into its own epic if scope grows during design

**Touches:** ios/ entitlements, src/lib/parsers/, src/app/settings/ · **Effort:** Large · **Priority:** P2 · **Depends on:** AS-B1

## [AS-D1] App Store icon + screenshot sets

**Value:** Store-required assets.

**Acceptance criteria:**
- [ ] 1024x1024 opaque icon (no alpha) derived from icon.svg
- [ ] 6.9" and 6.5" iPhone screenshot sets; iPad opt-out decision recorded
- [ ] All assets pass App Store Connect validation

**Touches:** design assets, ios/ · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-B1

## [AS-D2] Listing metadata + landing/support pages

**Value:** The listing itself plus the URLs Apple requires.

**Acceptance criteria:**
- [ ] Name/subtitle/description/keywords drafted; category Health & Fitness; age-rating questionnaire completed
- [ ] Support URL and marketing URL live (real landing page)
- [ ] Listing does NOT frame the app as requiring Claude — the connector is an optional integration

**Touches:** App Store Connect, landing page (new, may live outside this repo) · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-A1

## [AS-D3] Privacy nutrition labels + export compliance

**Value:** Store-required declarations, must match the shipped privacy policy.

**Acceptance criteria:**
- [ ] Labels declare health & fitness data, identifiers, linked-to-identity, no tracking — consistent with /privacy
- [ ] Export compliance: standard HTTPS-only exemption declared

**Touches:** App Store Connect · **Effort:** Small · **Priority:** P0 · **Depends on:** AS-A2

## [AS-D4] Reviewer demo-access package

**Value:** Reviewers must be able to fully use an invite-gated app or it's an automatic rejection.

**Acceptance criteria:**
- [ ] Unbound code invite minted (scripts/mint-invite.ts) and documented in the App Review notes (works with Sign in with Apple relay emails by design — same convention as AS-A4)
- [ ] Connect-Claude onboarding step verified skippable
- [ ] Reviewer walkthrough doc: install → sign in with Apple → redeem invite → log a workout, using only the review notes

**Touches:** scripts/mint-invite.ts (verify), src/app/onboarding/ (verify skippable), review-notes doc · **Effort:** Small · **Priority:** P0 · **Depends on:** AS-A4, AS-B2b

## [AS-E1] TestFlight internal beta

**Value:** Real-device soak before Apple sees it.

**Acceptance criteria:**
- [ ] Archive + upload; internal tester (founder) installed via TestFlight
- [ ] Full loop exercised: sign-in (both providers), log a workout, receive a push, scan a barcode
- [ ] One week of daily real use without a shell-related failure

**Touches:** ios/, App Store Connect · **Effort:** Small · **Priority:** P0 · **Depends on:** AS-B2b, AS-C1a-2, AS-C2

## [AS-E2] App Review submission + rejection-response loop

**Value:** The actual launch. Budget for one rejection.

**Acceptance criteria:**
- [ ] Submitted with the AS-D4 review notes
- [ ] Prepared Resolution Center responses for the two likeliest rejections: 4.2 minimum functionality (enumerate native capabilities: push, scanner, haptics/badge/FaceID) and 5.1.1 account deletion (point at the flow)
- [ ] App live on the App Store

**Touches:** App Store Connect · **Effort:** Medium · **Priority:** P0 · **Depends on:** AS-E1, AS-D1, AS-D2, AS-D3, AS-D4

## [AS-E3] Release & versioning runbook

**Value:** Keeps the native shell from taxing every future web deploy.

**Acceptance criteria:**
- [ ] docs/roadmap/ runbook: remote-URL mode means most web deploys ship with NO new binary/App Review; a new binary is needed only for plugin additions, entitlements, or native-code changes
- [ ] Version numbering scheme + rollback procedure documented
- [ ] Connector-cache and AASA-propagation gotchas carried over

**Touches:** docs/roadmap/ · **Effort:** Small · **Priority:** P1 · **Depends on:** AS-E2
