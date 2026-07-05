# Research Output — nudge-loop + Web Push surface map (Explore agent, 2026-07-05)

## 1. Nudge/Note surface today
- Note model: `prisma/schema.prisma:162-193`; `type` is a bare String (no enum); values: audible|journal|feedback|standing_rule|review|open_item|shared_recap. Fields: body, date, targetDate?, resolvedAt?+resolvedReason? (pending = resolvedAt NULL), lastAcknowledgedAt?, priority? (open_item), userId?. Indexes incl. [userId,type,date].
- Written via MCP: `log_note` (tools.ts:2839), `batch_log_note` (:4689), `log_open_item` (:2850 → type "open_item" at :2878). Routine weekly nudges = open_items with body prefix `[week:` (string convention; staleness query `src/app/coach/page.tsx:117-120`). `shared_recap` notes carry targetDate = week's Monday (tools.ts:108).
- Read via MCP: `get_pending_notes` (:1050), `acknowledge_notes` (:1134), `list_promotable_notes` (:1077), `list_open_items` (:1295).
- UI: **/coach page, not Today.** `src/app/coach/page.tsx:96-137` queries open_items (resolvedAt null), maps overdue/priority, computes lastNudgeDaysAgo + recapPostedThisWeek. Rendered by `src/components/CoachNudges.tsx` (client); Dismiss → `resolveOpenItem` server action (`src/lib/note-actions.ts:20-32`: resolvedAt=now, revalidatePath("/coach")). `PendingNotes.tsx` renders on goal pages. Today page has NO nudge card.

## 2. Delivery today
- **Pull-only.** Visible only by opening /coach or via coach chat turns. NO push/email (no nodemailer/resend/sendgrid). NO app cron: no vercel.json, no node-cron. Only cron-adjacent: `src/app/api/render-jobs/peek/route.ts` (external GPU-box poller, bearer MCP_AUTH_TOKEN). API routes total: mcp, mcp/[token], auth/[...nextauth], render-jobs/peek.

## 3. Web Push spike surface
- **Zero push infra**: grep for serviceWorker|sw.js|workbox|web-push|PushManager|VAPID → 0 hits in src/ + public/.
- `src/app/layout.tsx:35-53`: metadata.manifest = "/manifest.webmanifest" (:38), icons svg+192+apple; viewport themeColor #0F0B07, viewportFit cover. No push metadata.
- `public/manifest.webmanifest`: standalone display, installable, no push fields.
- Settings = single file `src/app/settings/page.tsx` (force-dynamic, nodejs): ConnectClaudePanel + Connected-apps card. No notifications section.
- Settings server-action pattern to mirror: `src/lib/oauth/connection-actions.ts` ("use server", mutation, revalidatePath("/settings"):26) invoked from `src/components/RevokeConnectionButton.tsx`. Same pattern in `src/lib/note-actions.ts`.

## 4. Env/config
- No src/lib/env.ts; raw `process.env` everywhere (e.g. `src/lib/auth/founder.ts:2`, current-user.ts). VAPID keys → .env/.env.example + Vercel. `.env.example:16-100` currently: DATABASE_URL, DB_ENV, MCP_AUTH_TOKEN, GITHUB_TOKEN, FOUNDER_USER_ID, INSTAGRAM_HANDLE, AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, OPEN_SIGNUP, FOUNDER_GOOGLE_EMAIL, UPSTASH_REDIS_REST_URL/TOKEN. `web-push` NOT installed (package.json + lockfile confirmed).

## 5. Founder identity
- `src/lib/auth/founder.ts:2`: `FOUNDER_USER_ID = process.env.FOUNDER_USER_ID ?? "usr_founder"`. MCP legacy route uses `runWithUser(FOUNDER_USER_ID, …)` (`src/app/api/mcp/[token]/route.ts:10,49`). `getCurrentUserId()` (RSC) redirects to /signin when no session — never falls back to founder. `resolveUserIdFromToken` falls back to founder only under ALLOW_LEGACY_MCP_TOKEN + timing-safe MCP_AUTH_TOKEN match.

## Net
Coach writes open_item notes via MCP → user pulls on /coach → dismiss = server action. A Web Push spike is entirely greenfield on an installable, pull-only PWA.
