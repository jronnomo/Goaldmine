# AS-0 — Web Push Viability Assessment

**Branch:** `spike/web-push` (off `feature/phase1-auth`; deleted after verdict)
**Issue:** #189 ([AS-0] Spike — Track 2 gate for the App Store initiative)
**Status:** VERDICT OPEN — awaiting founder device test.

---

## 1. Why this gate exists

The App Store initiative's Track 2 (~19 gated issues, ~3–6 weeks: native shell,
APNs push, HealthKit, native polish, store submission) is justified primarily
by **native push for coach nudges**. That justification was challenged by the
plan Devil's Advocate review (`.roadmap/2026-07-03-app-store-publishing/agents/plan-critique.md`):

- **DA Finding 2** — #103 ("native push") is misrepresented as the go/no-go
  anchor: the tracking issue itself says it's a stub, "NOT built until the
  in-app nudge loop (#100–102) proves out," and is explicitly out of the
  $0-simple core. This spike's job is to validate that a **plain Web Push
  service worker on the existing PWA** is (or isn't) sufficient — i.e. to
  test the load-bearing claim before ~3–6 weeks are spent on a native shell
  to get it.
- **DA Finding 7** — opportunity cost is unpriced. The founder is a solo
  developer with no second real web user yet (#187 open) and a stated
  strategic priority (`docs/roadmap/multi-domain-transformation-brief.md`:
  "closing that gap is the whole next chapter"). Native push is a retention
  bet for a ~1–2 user product; this spike exists so that bet is made with
  evidence, not vibes.

Track 1 (web go-live: F-1/F-2, #187/#188) continues regardless of this
verdict — AS-0 only gates whether Track 2 (native shell) is worth starting.

---

## 2. Nudge loop today

- **Pull-only.** Coach nudges are `open_item`-type `Note` rows (weekly
  routine nudges use a `[week:` body prefix convention), written via MCP
  (`log_note`, `batch_log_note`, `log_open_item`) and surfaced only when the
  user opens `/coach` (`src/app/coach/page.tsx`) or during a coach chat turn.
  **The Today page has no nudge card.**
- **No delivery infrastructure exists.** No push/email (no nodemailer/resend/
  sendgrid), no app cron (no `vercel.json` cron, no node-cron). The only
  cron-adjacent surface is `src/app/api/render-jobs/peek/route.ts`, an
  external GPU-box poller — unrelated to nudges.
- Dismissal is a server action (`resolveOpenItem`,
  `src/lib/note-actions.ts:20-32`): sets `resolvedAt`, revalidates `/coach`.
- **Zero push infra pre-spike**: a repo-wide grep for
  `serviceWorker|sw.js|workbox|web-push|PushManager|VAPID` returned 0 hits in
  `src/` + `public/` before this branch.

---

## 3. Issue statuses

| Issue | Title | Status |
|---|---|---|
| #100–102 | In-app nudge loop (card on Today, dismiss/snooze, staleness surfacing) | Open, unbuilt |
| #103 | Native push tracking stub | Open, explicitly deferred until #100–102 prove insufficient |
| #187 | F-1: 2nd real invited user E2E over the live web surface | Open, P0 |
| #188 | F-2: deploy checklist + go-live | Open, P0 |

#187/#188 are gating Track 1 regardless of this spike's outcome — they are
not re-litigated here.

---

## 4. Web Push viability evidence

### 4.1 Desktop (fill in during QA / dev testing)

| Step | Result |
|---|---|
| Enable notifications (Chrome/Safari desktop) | _fill in_ |
| Subscribe → `POST /api/spike/push/subscribe` | _fill in_ |
| Send test push → `POST /api/spike/push/send` | _fill in_ |
| Notification received locally | _fill in_ |
| Delivery latency (`ms` from send response) | _fill in_ |

### 4.2 iPhone — ✅ PASSED (founder device test, 2026-07-05)

| Field | Value |
|---|---|
| Device / iOS version | Founder's iPhone (screenshot evidence in session; iOS ≥16.4) |
| Installed to Home Screen (standalone)? | Yes — via the page-scoped A2HS metadata fix ("GM Push Spike" install) |
| Enable notifications result | Granted; subscription stored in Upstash |
| Push received with app closed? | Yes — app fully closed, send triggered by curl from desktop |
| **Lock-screen delivery confirmed?** | **YES** — lock-screen notification "Goaldmine coach / from GM Push Spike" |
| Payload | A REAL coach nudge — the Sunday routine's `[recap:2026-W27]` open_item note, read from the founder's data via runWithUser/getDb on the preview deployment (fallback body was not needed) |

**Conclusion of the technical spike: iOS Web Push is fully viable for coach-nudge
delivery from the installed PWA — no native shell required for this capability.**
Two field notes for any future permanent implementation (AS-B3-style SW or
Track 1 web push): (1) A2HS start_url vs deliberately-unlinked pages needs a UI
entry point or page-scoped metadata; (2) Vercel project renames move the
branch-alias hostname.
| Notes / gotchas encountered | _fill in_ |

---

## 5. Decision framework

**GO** (build the native shell — proceed with Track 2, ~19 issues, ~3–6
weeks: native shell, APNs push, HealthKit read import, native polish,
discoverability, store submission) if Web Push proves **insufficient or
fragile** — e.g. no lock-screen delivery with the app closed, iOS silently
throttling/dropping notifications, or the standalone-install requirement
being too much user friction to be a real delivery channel.

**NO-GO** (skip native push; Web Push + an AS-B3-style permanent service
worker covers the nudge-delivery need) if the spike demonstrates reliable
lock-screen delivery to an installed PWA. In this case:
- The in-app nudge loop (#100–102) should still be built — it is the
  cheaper, load-bearing win regardless of push.
- A permanent Web Push implementation (real `PushToken` Prisma model per
  AS-C1a-1, real `public/sw.js` per AS-B3) can be scheduled as ordinary
  product work, not gated behind a native shell.

Track 1 (#187/#188, web go-live) continues either way — this verdict only
resolves whether Track 2 (native shell) is worth starting.

---

## 6. VERDICT: OPEN — awaiting founder device test.

---

## 7. Device-test runbook

**Setup:**
1. ✅ DONE (2026-07-05): VAPID keypair generated; `SPIKE_PUSH_KEY`,
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` set in the
   `workout-planner` project's **Preview** scope via `vercel env add`.
   Retrieve the key value locally (never printed in logs):
   `npx vercel env pull .env.preview.local --environment=preview`, read
   `SPIKE_PUSH_KEY` from that file, then delete the file.
   - Still confirm `DATABASE_URL` and `UPSTASH_REDIS_REST_URL`/`_TOKEN`
     exist in Preview scope (send falls back to a static body if the DB
     read fails, so only the Upstash pair is load-bearing).
2. **Stable preview URL (verified building & gated, 2026-07-05):**
   `https://goaldmine-git-spike-web-push-jronnomos-projects.vercel.app`
   (the Vercel project was renamed workout-planner → goaldmine on 2026-07-05;
   the old `workout-planner-git-…` alias is frozen on a stale deployment —
   don't use it)
3. ⚠ **REMAINING BLOCKER:** Vercel Deployment Protection currently 302s the
   preview to `vercel.com/sso-api` (verified via curl). In the dashboard:
   Project `workout-planner` → Settings → Deployment Protection → set
   Vercel Authentication to **Only Production Deployments** (or Disabled),
   so the phone can reach the URL without a Vercel login.

**Device test (on the founder's iPhone):**
4. Open the preview URL in Safari, tap Share → Add to Home Screen.
5. Open the newly installed app icon (not the Safari tab — Web Push on iOS
   only works from the standalone install).
6. Navigate to `/spike/push?key=$SPIKE_PUSH_KEY`.
7. Tap **Enable notifications**; grant the permission prompt.
8. Close the app fully (swipe up / app switcher, don't just background it).
9. Trigger a send from a computer:
   `curl -X POST https://<preview-url>/api/spike/push/send -H "x-spike-key: $SPIKE_PUSH_KEY"`
10. Confirm whether a notification appears on the lock screen. Record the
    result in §4.2.

**Teardown (after the verdict is recorded — do this before AS-B3 ships its
permanent `public/sw.js` to the same device/scope):**
11. The spike's service worker (`spike-sw.js`) and the real future SW both
    register at root scope (`/`); a later registration supersedes an
    earlier one once activated, so there's no permanent double-SW risk. But
    the founder's iPhone will still have `spike-sw.js` installed and a live
    push subscription tied to it during and after the spike window — `git rm
    public/spike-sw.js` removes the source file, it does **not** unregister
    the worker already installed on the device.
12. Before AS-B3 ships its real `public/sw.js` to this same phone, either:
    (a) uninstall and reinstall the home-screen PWA, or (b) open Safari's
    remote inspector against the device and run
    `navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`.
    Skipping this could leave AS-B3 QA confused by a stale spike worker or
    subscription still answering pushes.
