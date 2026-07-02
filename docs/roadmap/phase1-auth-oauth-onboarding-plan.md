# Phase 1 — Auth + OAuth connector + Onboarding — Plan

**Initiative:** turn the (Phase-0) provably-isolated data layer into a usable, invite-gated, multi-user product. Board #8, label `phase1-auth`. Scope brief: `.roadmap/2026-07-01-phase1-auth-oauth-onboarding/scope-brief.md`.

## Decisions (locked)
Auth.js/NextAuth v5 · Google sign-in · invite-gated signup · defer billing + basic rate-limit · OAuth 2.1 MCP connector (BYO-Claude, $0-beyond-Max).

## Target data model (additive migrations, dev branch first)
- **Auth.js tables** (its Prisma adapter): `Account`, `Session`, `VerificationToken` (+ Auth.js may want fields on `User`). `User` already has `email @unique` + `name` — reuse. Add `image String?` (Google avatar), `emailVerified DateTime?` (adapter expects it).
- **Invite gating:** `Invite` model (code, email?, createdBy, redeemedByUserId?, redeemedAt?, expiresAt?) OR a simpler `allowlistedEmail` set — architect picks. Signup rejects non-invited.
- **OAuth server tables** (for the claude.ai connector): `OAuthClient` (from Dynamic Client Registration — client_id, redirect_uris, metadata), `OAuthAuthCode` (short-lived, PKCE challenge, userId, clientId), `OAuthAccessToken` / `OAuthRefreshToken` (token hash, userId, clientId, scopes, expiry). Access token → userId is what `resolveUserIdFromToken` looks up. Consider a library (e.g. `@node-oauth/oauth2-server`, or `oslo`/hand-rolled minimal) — architect decides vs hand-roll given the MCP spec is a constrained subset.
- **FoodLibrary → FoodUsage split** (newly-live): FoodLibrary becomes shared reference data (name/macros); new `FoodUsage` (userId, foodId, usageCount, lastUsedAt, isFavorite, lastAmount, lastUnit) holds the per-user state. Migration moves the founder's current per-user fields into FoodUsage.

## Auth flow (Auth.js v5)
- Google provider; Prisma adapter; session strategy (database sessions recommended so the OAuth `/authorize` consent can verify a live session server-side).
- **`getCurrentUserId()`** swaps to `const session = await auth(); if (!session) throw/redirect; return session.user.id;` — the single dashboard cutover.
- Sign-in page `/signin`; middleware/`proxy.ts` (Next 16) or per-layout guard protects all dashboard routes; unauth → `/signin`.
- **Invite gate:** the Auth.js `signIn` callback rejects an email not on the allowlist/invite → "request access" page.

## OAuth authorization server (the claude.ai connector — the crux)
The claude.ai remote-MCP custom connector uses the **MCP authorization spec** (OAuth 2.1 + PKCE + Dynamic Client Registration + server metadata). The app must expose (paths per spec — architect confirms against the CURRENT MCP auth spec):
- `/.well-known/oauth-authorization-server` (+ possibly `/.well-known/oauth-protected-resource`) — metadata discovery.
- `POST /register` — Dynamic Client Registration (claude.ai registers itself).
- `GET /authorize` — consent screen, **gated by the Auth.js dashboard session** (user must be logged in; shows "Allow claude.ai to access your goaldmine data"); issues an auth code (PKCE).
- `POST /token` — exchanges code (+ PKCE verifier) → access token (+ refresh). Token stored hashed, mapped to userId.
- **`resolveUserIdFromToken(bearer)`** swaps to: hash → look up `OAuthAccessToken` → userId (throws if missing/expired/revoked). `src/app/api/mcp/route.ts` replaces the shared-token check with this.
- **Deprecate `MCP_AUTH_TOKEN`** (or keep as a founder/dev fallback behind a flag). Per-user tokens are revocable in the dashboard.

## Dashboard gating + onboarding
- Route protection (all `/app` routes require session; the isolation already flows via getCurrentUserId).
- **Onboarding** (`/onboarding`): post-first-signin → create first goal (reuse create_goal/goal-core) → "Connect your Claude" walkthrough (add the custom connector URL, run the OAuth authorize) → land on Today. Per-user empty states (new user has no program/goals — Today/history/stats must render cleanly empty).
- **Founder cutover:** set the founder's Google email on `usr_founder` so their first Google login maps to existing data (a one-time seed/script).

## Hardening (multi-user-live)
- **Basic rate-limiting** on `/api/mcp`, `/authorize`, `/token`, `/register`, sign-in (per-user + per-IP; a lightweight store — Vercel KV/Upstash free tier or in-memory+Neon).
- **getDb leaky-read `select:` cleanup** (recent_history + siblings) — don't serialize other-users' shape/userId.
- **Hard `userId NOT NULL`** via a typed create-input approach (so the 29 injected create sites stay ergonomic) — the Phase-0 deferral, now enforceable.
- Security pass: OAuth token storage (hashed), PKCE, redirect_uri validation, consent CSRF, session cookie flags.

## Phasing (epics → sprints; each leaves main deployable)
1. **E-A Auth foundation** — Auth.js + Google + Prisma adapter + User/auth tables + invite gate + flip `getCurrentUserId`. (Dashboard becomes real-user; founder logs in.)
2. **E-B Dashboard gating + per-user empty states** — route protection, signin/onboarding shell, empty-state UX.
3. **E-C OAuth server for the connector** — metadata/DCR/authorize/token + per-user tokens + flip `resolveUserIdFromToken` + deprecate shared token. (BYO-Claude live.)
4. **E-D Onboarding flow** — first-goal + connect-your-Claude walkthrough + founder cutover.
5. **E-E Multi-user hardening** — rate-limiting, FoodLibrary→FoodUsage split, leaky-read select cleanup, hard NOT NULL, security pass.
6. **E-F Verification & launch** — 2nd real invited user E2E over the real HTTP/OAuth surface (extend the E9 harness to hit the live endpoints); founder-unaffected; invite-flow works; deploy.

## Critical path
E-A (identity) gates everything → E-B (dashboard usable) ∥ E-C (connector) → E-D (onboarding needs both) → E-E (hardening) → E-F (verify). E-A + E-C are the two big rocks; E-C carries the most technical uncertainty (exact MCP-connector OAuth spec).

## Risks
- **claude.ai connector OAuth spec drift** — the exact endpoints/flows the remote-MCP connector requires must be verified against the CURRENT spec (highest risk; architect researches + a spike may be needed).
- **Auth.js v5 + custom OAuth-server coexistence** — Auth.js is the *client* of Google AND we're an OAuth *server* for claude.ai; keep the two roles clean.
- **Founder cutover** — must not orphan existing `usr_founder` data (map by Google email).
- **Empty-state everywhere** — every page/tool assumed founder data; a brand-new user hits empty program/goals — must not crash.
- **Migration safety** — FoodLibrary split moves data; additive + backfill on dev first.
- Rate-limit store choice must stay $0 (free tier / Neon-backed).

---

## DA-hardened revisions (folded before decomposition)
**FIX-REQUIRED:**
1. **S-1 SPIKE is a HARD GATE (1 full day).** Its deliverable: verify against a live claude.ai connector on a preview deploy — (a) does claude.ai actually call `POST /register` (DCR)? If it uses a pre-configured client_id, the `OAuthClient` model is unnecessary; (b) is a `resource` param (RFC 8707) sent? (c) DCR caching + refresh-token cadence + exact redirect_uri + scope value. **E-C1's schema migration does NOT run until S-1 findings are signed off.** E-C1/2/3 hard-depend on S-1.
2. **Founder cutover: NO permanent `allowDangerousEmailAccountLinking`.** `usr_founder` has 0 Account rows → Google links cleanly without it. Test without the flag; if needed, temp env-gate (`FOUNDER_LINKING_MODE=1`) + remove after first login. Never a permanent global flag.
3. **Hard `userId NOT NULL` is DEFERRED to Phase 2** (no clean typed create-input mechanism exists; would need 29 `Omit<>` aliases or out-of-Prisma SQL that breaks migrate-status). The Phase-0 `db:verify-owned` guard is sufficient at invite-gated scale. **E-E3 = leaky-read `select:` cleanup + security pass only** (NOT the NOT NULL flip).
4. **Rate-limiting:** Upstash Redis free tier (10k cmds/day) is genuinely $0 AND atomic (`INCR`+`EXPIRE`) — preferred over a Neon upsert, which is non-atomic (races to 2–3× the limit under load). If staying Neon-only, mark the limiter **advisory under concurrent load** in E-E2.

**CONSIDER (folded):**
- **OAuth route handlers (`/oauth/*`, `/.well-known/*`) use RAW `prisma`, never `getDb()`** — they're public/pre-auth; `getCurrentUserId()` would redirect to `/signin` before the token check. Only `/authorize` reads the Auth.js session (to gate consent).
- **Legacy token fallback flag = `ALLOW_LEGACY_MCP_TOKEN=1`**, NOT `NODE_ENV!=='production'` (Vercel sets `production` on all deploys). Keeps the founder's current single-token connector working through cutover; remove after.
- **E-A gains a sign-out story** (A-*: sign-out + session revocation UX).
- **Onboarding "Connect your Claude" is claude.ai-INITIATED** — the app shows the connector URL + instructions to paste into claude.ai (which then runs the OAuth authorize against our server). NOT an in-app "Authorize" button with a pre-filled client_id.
- **Token revocation UX belongs in E-C3** (list/revoke a user's active claude.ai connections in the dashboard) — not E-E hardening.
- **Auth codes stored HASHED** (like access tokens); short TTL; single-use. Flag redirect_uri validation + consent CSRF for the E-F security review.
- **E-F deploy checklist:** Google OAuth redirect URIs per env (preview + prod), Vercel env vars, `.well-known` routes reachable on the prod domain, privacy/ToS pages (public product), the founder's existing connector cutover (don't break it mid-flight).

## Epic structure (post-DA, for decomposition)
- **S-1** SPIKE — verify claude.ai's connector OAuth flow on a preview deploy (HARD GATE for E-C). [P0, S, no deps]
- **E-A** Auth.js foundation — next-auth@beta + Google + Prisma adapter + Account/Session models + `getCurrentUserId` swap + invite gate + sign-out. [P0, gates all]
- **E-B** Dashboard gating + per-user empty states (14 surfaces render clean). [P1]
- **E-C** OAuth server (depends S-1 + E-A): C1 schema+metadata+DCR · C2 authorize consent (session-gated) · C3 token endpoint + `resolveUserIdFromToken` swap + revocation + deprecate shared token. [P0/P1]
- **E-D** Onboarding — first-goal + claude.ai-initiated connect walkthrough + founder cutover. [P1]
- **E-E** Hardening — E1 FoodLibrary→FoodUsage split · E2 rate-limiting (Upstash) · E3 leaky-read select + security pass. [P1/P2]
- **E-F** Verification & launch — 2nd real invited user E2E over live HTTP/OAuth; founder-unaffected; deploy checklist. [P0 gate to "done"]

**Critical path:** (S-1 ∥ E-A) → E-C1 → E-C2 → E-C3 → E-D → E-F. E-B ∥ E-C. E-E after E-A/E-C.

---

## ✅ S-1 SPIKE FINDINGS — SIGNED OFF (2026-07-02, captured from a live claude.ai web connect)
Observed against the throwaway `spike/oauth-flow` preview with logging stubs. claude.ai's remote-MCP connector uses the full MCP authorization spec. **E-C is unblocked; the OAuthClient model + DCR STAY.**

**Q1 — Discovery:** `POST /api/mcp` (no token) → **401** with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` → client fetches protected-resource → auth-server metadata → proceeds. (Flow completed end-to-end, confirming discovery.)

**Q2 — Dynamic Client Registration: YES (required).** Client `POST`s `/oauth/register` and gets a **fresh `client_id` per connect** (no reuse across a clean re-add). **Public client — NO `client_secret`** (token auth = PKCE only; `token_endpoint_auth_methods_supported: ["none"]` is correct). Registers with `redirect_uri = https://claude.ai/api/mcp/auth_callback`.

**Q3 — `GET /oauth/authorize` (BROWSER navigation — Chrome UA, `referer: https://claude.ai/`):** params = `response_type=code`, `client_id`, `redirect_uri=https://claude.ai/api/mcp/auth_callback`, `code_challenge`, **`code_challenge_method=S256`**, `state`, **`scope=mcp`**, **`resource=<mcp-url>` (RFC 8707)**. → The consent screen is browser-facing → **gate it on the Auth.js session** (redirect to /signin if none), then redirect back with `?code=…&state=…`.

**Q4 — `POST /oauth/token` (form-urlencoded, server-to-server, `python-httpx`):**
- `grant_type=authorization_code`: `code`, **`code_verifier` (PKCE S256 proof)**, `redirect_uri`, `client_id`, `resource` — **no `client_secret`**.
- `grant_type=refresh_token`: `refresh_token`, `client_id`, `resource`. → **Must issue + rotate refresh tokens.**

**Q5 — Authenticated MCP call:** `Authorization: Bearer <access_token>`; body = MCP `initialize`, `protocolVersion 2025-11-25`. Works from claude.ai web (`clientInfo: Anthropic/Toolbox`) AND Claude Code (`clientInfo: claude-code`).

**Confirmed E-C data model (C-1 #178):** keep `OAuthClient` (client_id, redirect_uris, created_at — public, no secret), `OAuthAuthCode` (hashed, PKCE challenge, userId, client_id, redirect_uri, resource, ~short TTL, single-use), `OAuthAccessToken` + `OAuthRefreshToken` (hashed, userId, client_id, resource/audience, expiry; refresh rotates). Metadata: `token_endpoint_auth_methods_supported: ["none"]`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code","refresh_token"]`. Validate `redirect_uri` against the registered value (claude.ai's is `https://claude.ai/api/mcp/auth_callback`). Bind tokens to the `resource` (audience).

**Discard:** `spike/oauth-flow` branch after sign-off (findings are the durable output).
