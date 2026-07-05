# PRD: AS-0 Web Push Spike (push-value assessment + iOS viability)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-05
**Status**: Approved
**GitHub Issue**: #189 ([AS-0] Spike — Track 2 gate for the App Store initiative)
**Branch**: spike/web-push (off feature/phase1-auth; deleted after verdict)
**UX-research**: skipped — infrastructure spike, throwaway UI behind a secret key, no product surface

---

## 1. Overview

### 1.1 Problem Statement
The App Store initiative's Track 2 (~19 gated issues, ~3–6 weeks) is justified primarily by native push for coach nudges. But nudges today are pull-only (`open_item` Notes read on `/coach`), the in-app nudge loop (#100–102) is unbuilt, and iOS 16.4+ supports Web Push for installed PWAs. Before building a native shell, prove or disprove: **can a plain service worker deliver a real coach nudge to the founder's iPhone lock screen from the installed PWA?**

### 1.2 Proposed Solution
A self-contained, secret-key-gated spike: a push-only service worker (`public/spike-sw.js`), a diagnostics/subscribe page (`/spike/push`), two API routes (store subscription in Upstash; send a push whose payload is the founder's latest unresolved `open_item` note), and an assessment doc capturing the evidence and an open GO/NO-GO section. Tested on a Vercel preview deployment of `spike/web-push` installed to the founder's home screen. Everything is marked SPIKE and removable in one commit.

### 1.3 Success Criteria
- A Web Push notification containing a real nudge body appears on the founder's iPhone lock screen with the app closed (manual step, user-confirmed).
- `docs/roadmap/as0-push-assessment.md` contains the nudge-loop map, issue statuses, device-test evidence slot, and the GO/NO-GO decision framework.
- Zero impact on the main app: no layout/manifest/schema/MCP changes; all gates green.

---

## 2. User Stories

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 | Founder (only) | subscribe my iPhone's installed PWA to push and receive a real nudge | I can judge whether Web Push kills the need for a native shell | Must Have |
| US-002 | Founder | see environment diagnostics (standalone? permission? PushManager?) on the spike page | I can debug the iOS install/permission dance without guesswork | Must Have |
| US-003 | Tech lead | an assessment doc with the evidence and decision framework | the GO/NO-GO verdict is recorded, not vibes | Must Have |

All stories founder-only. No tenant-facing surface.

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. `public/spike-sw.js`: `push` event → `self.registration.showNotification(title, { body, icon: "/icon-192.png" })`; `notificationclick` → focus existing client or `clients.openWindow("/")`. **No fetch/caching handlers.**
2. `/spike/push` (server component): `searchParams.key !== process.env.SPIKE_PUSH_KEY` (or key unset) → `notFound()`. Passes `NEXT_PUBLIC`-safe VAPID public key (read server-side from env, passed as prop — no NEXT_PUBLIC var needed).
3. `SpikePushClient` (`"use client"`): diagnostics (display-mode standalone, `'serviceWorker' in navigator`, `'PushManager' in window`, `Notification.permission`, subscription-exists state) + **Enable notifications** button (register SW → subscribe with `userVisibleOnly: true`, `applicationServerKey` = VAPID public key as Uint8Array → POST subscription to subscribe route) + **Send test push** button. All API calls send the key in an `x-spike-key` header. Buttons must be inside user-gesture handlers (iOS requirement).
4. `POST /api/spike/push/subscribe`: header key check (timing-safe compare) → store `JSON.stringify(subscription)` in Upstash at `spike:webpush:subscription`. Missing Upstash env → 503 with clear JSON error.
5. `POST /api/spike/push/send`: header key check → load subscription (absent → 404 JSON "no subscription") → payload title "Goaldmine coach" + body = founder's latest unresolved `open_item` note (`runWithUser(FOUNDER_USER_ID)` + `getDb()`, read-only, newest by `date`), fallback "Test nudge from the Web Push spike 🎯" → `webpush.sendNotification` → return `{ ok, statusCode }` or structured error (expired subscription → 410 handling: delete stored subscription, report it).
6. Route access: `/spike/push` and `/api/spike/push/*` public in `src/lib/auth/route-access.ts` (self-gated); cases added to `route-access.test.ts`.
7. `.env.example`: `SPIKE_PUSH_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` placeholders, commented as spike-only.
8. `docs/roadmap/as0-push-assessment.md` per plan.

### 3.2 Secondary Requirements
1. Send route returns delivery latency ms (nice diagnostics).
2. Spike page shows the stored-subscription endpoint hostname (truncated) so "subscribed on this device?" is verifiable.

### 3.3 Out of Scope
GO/NO-GO verdict; PushToken Prisma model (AS-C1a-1); layout/manifest changes; hooking the note-write path; per-user subscriptions (single fixed Upstash key); removing the spike.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
N/A — no schema change. Persistence is one Upstash key (`spike:webpush:subscription`) via `@upstash/redis` (already installed, same client pattern as `src/lib/rate-limit.ts`).

### 4.2 MCP Tool Surface
N/A — no MCP changes, no leaky-reads impact, no connector reload needed.

### 4.3 Server Actions
N/A — spike uses route handlers, not server actions (no revalidation needs; page state is client-driven).

### 4.4 Pages / Components
- `src/app/spike/push/page.tsx` — server component, `dynamic = "force-dynamic"`, `runtime = "nodejs"`.
- `src/app/spike/push/SpikePushClient.tsx` — client component (all interactivity).
- No BottomNav / navigation changes — the page is deliberately unreachable except by URL.

### 4.5 Date / Time Semantics
Only "newest note" ordering (`orderBy date desc`) — no date construction. No `@/lib/calendar` needs beyond what the query uses.

### 4.6 Deferral / Override Awareness
N/A — reads Notes only, never per-day plan state.

### 4.7 Tenant Scoping & Auth
- Note read via `runWithUser(FOUNDER_USER_ID)` + `getDb()` (scoped client), read-only.
- New public routes justified: preview deployments can't do Google OAuth (redirect allowlist); routes self-gate via `SPIKE_PUSH_KEY`. If `SPIKE_PUSH_KEY` is unset, page 404s and API routes 503 — **fail closed**.
- Key comparison timing-safe (`crypto.timingSafeEqual` on hashed/equal-length buffers, matching the `MCP_AUTH_TOKEN` pattern in `current-user.ts`).

### 4.8 Third-Party Dependencies
`web-push` (+ `@types/web-push`) — the standard VAPID/Web Push protocol client. Server-side only, $0. No LLM APIs.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions
`/spike/push` at 390px — single Card stack, spike-styled (plain, uses existing tokens):
```
┌──────────────────────────────┐
│ ⚠ SPIKE — Web Push viability │
│ Diagnostics                  │
│  standalone: yes/no          │
│  serviceWorker: yes/no       │
│  PushManager: yes/no         │
│  permission: default/granted │
│  subscription: none/active   │
│ [ Enable notifications ]     │
│ [ Send test push ]           │
│ status line (last action)    │
└──────────────────────────────┘
```
States: unsupported (any diagnostic no → explain + disable buttons), permission denied (explain iOS reset path), subscribed (send enabled), send result (ok/error JSON pretty-printed).

### 5.2 Navigation Flow
URL-only entry (`/spike/push?key=…`). No nav integration.

### 5.3 Responsive + Mobile-First Spec
390px primary; buttons ≥44px; existing `<Card>`/tokens; no hardcoded colors.

### 5.4 Accessibility
Buttons are real `<button>`s with visible focus; status line `aria-live="polite"`.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| `SPIKE_PUSH_KEY` unset | Page 404; API routes 503 JSON — fail closed |
| Wrong/missing `x-spike-key` | 401 JSON |
| Upstash env missing (local dev) | Subscribe/send → 503 JSON naming the missing config |
| No stored subscription on send | 404 JSON `{ error: "no subscription stored" }` |
| Expired/revoked subscription (410 from push service) | Delete Upstash key; return `{ ok: false, gone: true }` |
| No unresolved open_item note | Static fallback body |
| Safari not installed-to-home-screen (iOS) | Diagnostics show standalone: no; explain Add to Home Screen requirement; disable Enable button |
| Permission previously denied | Explain Settings → Notifications reset path |

---

## 7. Security Considerations

- Public routes fail closed without the env key; key never logged; timing-safe compare.
- Page key rides the query string (visible in logs) — accepted for a throwaway spike; API routes use a header. Key is low-value (gates a test page, not data) — the only data exposure is the founder's latest open_item body in a push payload, which is E2E-encrypted to the subscribed device.
- No new MCP/OAuth surface. Rate limiting: not added (key-gated, single-user spike).
- Subscription JSON contains push-service endpoint + client keys — stored server-side in Upstash only, never rendered back in full.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` 0 errors; `npm run lint` no new errors; `npm run test` green (incl. new route-access cases); `npm run build` succeeds
2. [ ] `GET /spike/push` without/with-wrong key → 404; with key → renders diagnostics UI at 390px
3. [ ] `POST /api/spike/push/subscribe` with wrong key → 401; valid key + body → 200 and key present in Upstash (or 503 if Upstash unconfigured)
4. [ ] `POST /api/spike/push/send` with no subscription → 404 JSON; with desktop-browser subscription → real notification received locally
5. [ ] `public/spike-sw.js` contains NO fetch handler (grep)
6. [ ] `src/app/layout.tsx`, `public/manifest.webmanifest`, `prisma/schema.prisma`, `src/lib/mcp/**` untouched (git diff)
7. [ ] `route-access.test.ts` covers the two new public paths
8. [ ] `docs/roadmap/as0-push-assessment.md` exists with all sections + open verdict
9. [ ] iPhone lock-screen delivery — **manual user step**, evidence recorded in the assessment doc afterward

---

## 9. Open Questions

None — deploy target, persistence, gating, and verdict ownership resolved in discovery (see plan file / Appendix).

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Tests / Build
All four gates; new tests: `route-access.test.ts` additions only.

### 10.2 MCP curl smoke
N/A (no MCP changes).

### 10.3 Browser smoke
1. `npm run dev`; visit `/spike/push` (404) and `/spike/push?key=$SPIKE_PUSH_KEY` (renders) at 390px.
2. Desktop end-to-end: Enable notifications in Chrome/Safari → Send test push → notification appears locally.
3. curl the two API routes: wrong key (401), no subscription (404).

### 10.4 Migration verification
N/A.

### Device test (manual, user)
Preview URL (branch alias) → Safari → Add to Home Screen → open installed app → `/spike/push?key=…` → Enable → close app → Send (curl or second device) → lock-screen notification. Prereqs: VAPID + SPIKE_PUSH_KEY env vars in Vercel (Preview scope); Deployment Protection off or bypass token.

---

## 11. Appendix

### 11.1 Discovery Notes
Nudges pull-only (`/coach`, open_item Notes, `[week:` prefix); #100–102 open (loop unbuilt); #187/#188 open (Track 2 gated regardless); no SW/push/cron/email infra exists. User chose: spike branch + preview, Upstash persistence, secret-key gate, user-owned verdict.

### 11.2 References
Issue #189; `docs/roadmap/app-store-publishing-plan.md` (v2); `.roadmap/2026-07-03-app-store-publishing/agents/plan-critique.md` (DA findings 2, 7); Explore report at `.feature-dev/2026-07-05-as0-web-push-spike/agents/research-output.md`.
