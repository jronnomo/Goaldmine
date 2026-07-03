# Plan Architect Blueprint — App Store Publishing (verbatim agent output, 2026-07-03)

## 1. Capacitor architecture: remote-URL is the only option, treat it as such

**Decision:** `server.url` remote-URL mode is not a "start simple" choice — it's the *only* viable one. This app has server components, `auth()`, `getDb()`, server actions, and `src/middleware.ts` at nearly every route; none of that survives `next export`. Bundled static export is **rejected outright** — it would require a parallel client-only SPA hitting a separate API, i.e. a second product.

Config: appId `com.<org>.goaldmine`; `webDir: "public"` (bundled into the IPA only as SW/offline fallback); `server: { url: <prod>, cleartext: false, allowNavigation: [<prod-domain>] }`; `ios.contentInset: "always"`. The main WKWebView never navigates to google.com/appleid.apple.com — OAuth escapes to a separate browser context (§2).

Implications:
- **App Review risk:** remote-URL mode IS the literal "website in a WebView" 4.2 pattern. AS-C1 (push) + AS-C2 (native camera) are the entire justification — keep P0-before-submission, and say so in the AS-D4 reviewer notes.
- **Offline:** nothing is bundled → cold launch without network renders NOTHING without a SW. **AS-B3 promoted P1 → P0, immediately after AS-B1.**
- **Cookies:** WKWebsiteDataStore.default() persists across restarts; once the session cookie lands, persistence is free. The hard part is only getting it there the first time.

## 2. Auth/session handoff into the WKWebView — the hardest problem

**Decision:** sign-in opens ASWebAuthenticationSession (`prefersEphemeralWebBrowserSession: false`), completing via **custom URL scheme** `goaldmine://auth-callback` (not Universal Links — UL-based completion is fragile mid-flow; reliable https-callback is iOS 17.4+ only). Rejected: Capacitor stock Browser plugin (SFSafariViewController — no callback detection), window.open/Safari app-switch (no return path). A small custom native bridge (or `@capacitor-community/generic-oauth2` if it satisfies the contract at spike time) is required — new native code, not a config toggle.

**Cookies never transfer regardless of browser choice.** Mechanism (reuses `src/lib/oauth/` patterns — hashed single-use codes, consumedAt):
1. System browser completes the UNMODIFIED Auth.js flow → real session + cookie in the browser's jar.
2. Landing page mints a single-use ~60s-TTL hashed handoff code bound to the userId; redirects to `goaldmine://auth-callback?code=...`.
3. Native hands the code to the WKWebView, which itself POSTs `/api/auth/shell-exchange` with `credentials: 'include'` — Set-Cookie lands naturally in the WebView's own WKWebsiteDataStore. No manual cookie copying; no cookie value ever transits a URL.
4. WebView reloads `/` — authenticated.

Security: single-use, short TTL, opaque, symmetric with the existing tested OAuth 2.1 auth-code design.

## 3. Sign in with Apple

**Client secret rotation lives nowhere** — sign a short-lived (~24h) ES256 JWT at request/module-load time via `jose` (memory-cached) from `AUTH_APPLE_TEAM_ID` / `AUTH_APPLE_KEY_ID` / `AUTH_APPLE_PRIVATE_KEY` (.p8) / `AUTH_APPLE_ID` env vars. Rejected: scheduled rotation script writing a long-lived JWT into a Vercel env var (adds an ops task + silent-failure auth outage).

**Account linking — explicitly NOT `allowDangerousEmailAccountLinking`** (trusts unverified email claims). Existing users get a "Link Apple ID" button in /settings running the Apple flow while authenticated, calling the adapter's linkAccount under the current session's userId. First-time Apple sign-ins with no link create a normal new User.

**Invite gate vs relay emails:** mint **unbound code invites** (`email: null`) for Apple signups/reviewers — exactly what AS-D4 needs anyway; no new invite-gate logic.

## 4. PushToken model

```prisma
model PushToken {
  id         String    @id @default(cuid())
  userId     String?
  token      String    @unique
  platform   String    @default("ios")
  createdAt  DateTime  @default(now())
  lastSeenAt DateTime?
  revokedAt  DateTime?   // APNs 410 Unregistered/BadDeviceToken
  user       User?     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([platform])
}
```
Add to SCOPED_MODELS; `pushTokens PushToken[]` on User; run both verifiers. Register via upsert-on-token. Cleanup: deletion cascades; sign-out best-effort DELETE (hygiene, not security — row carries no secret).

**Send path:** Vercel serverless nodejs runtime (NOT edge) — hand-rolled `node:http2` + `jose` ES256 provider token to api.push.apple.com (~80 lines, `src/lib/push/apns.ts`, unit-testable with mocked http2; `node-apn` is stale).

**Trigger split:** P0 = send-on-write hooked into the note-write path, forwarding the note's already-authored body (no LLM, no infra). P2 = proactive cron (baseline-due/plan-conflict) — NEW surface: `vercel.json` crons + secret-gated route; repo has no cron today.

## 5. Account deletion — the schema already did the hard work

Verified: all 17 SCOPED_MODELS' user relations are `onDelete: Cascade`, as are Account/Session/OAuthAuthCode/OAuthAccessToken/OAuthRefreshToken; children cascade transitively. Real Postgres constraints, not app-level emulation.

**Decision:** deletion IS `prisma.user.delete()` (raw client — User isn't scoped). Rejected: manual 17-model cascade routine (redundant, riskier on future schema adds). Remaining work: typed-confirmation server action; Invite.redeemedByUserId handling; delete → signOut sequence; zero-rows regression test.

## 6. Service worker

Hand-rolled `public/sw.js`, NOT serwist/Workbox (precache-manifest pipelines fit static sites; this app is per-user dynamic SSR/RSC — generic pipelines risk exactly the stale-Today-page bug class). Precache offline fallback + static shell assets only; network-first everywhere; never cache `/api/*` or RSC data; register from a client component gated to production.

## 7. AASA / Universal Links

`src/app/.well-known/apple-app-site-association/route.ts` (matches existing OAuth discovery route handlers; explicit Content-Type, no extension/redirect issues). Defense-in-depth/future deep links only — custom scheme carries the auth callback. Document Apple CDN propagation delay.

## 8. Phasing (web-deployable vs needs-a-new-binary)

| Slice | Stories | Ships via |
|---|---|---|
| 1 | AS-0, AS-A2, AS-A3 | web deploy |
| 2 | AS-A1 (wall-clock), AS-A4 web-side | web deploy |
| 3 | AS-B1 + AS-B3 (promoted P0) | new binary |
| 4 | AS-B2 (highest risk) | new binary |
| 5 | AS-C1a, AS-C2 | new binary |
| 6 | AS-D1–D4, AS-E1 | new binary |
| 7 | AS-E2, AS-E3 | — |

## 9. Secretly separate projects

- **AS-C3 HealthKit** — own UX/dedupe/entitlement surface; correctly P2, spin into its own post-v1 epic.
- **AS-C1 push** — split C1a (P0 registration + send-on-write) vs C1b (P2 cron, new vercel.json infra).
- **AS-A4 + AS-B2** together are the true long pole — split AS-B2 into "escape-the-webview" and "session-exchange-endpoint" stories.
- Payments/Android correctly out of scope.
