# Requirements & Readiness — Instagram Graph API auto-post (#96, story 3.4-e, DEFERRED v2)

**Status:** DEFERRED — tracking stub. **Not built.** This doc is the deliverable for #96: it captures everything a future build needs, the gaps that must be closed first, and the go/no-go gate. v1 of the flywheel (manual-assisted one-tap Share, #93/#94/#95, QA #97) is shipped and is the honest `$0` build-in-public loop. Auto-post is an escalation taken **only if the habit proves out**.

See: `docs/roadmap/content-flywheel-decomposition.md` (3.4-e) · `docs/qa/flywheel-qa-87.md` (v1 verified) · `docs/coaching/proactive-coach-routine.md` (the routine this would extend).

---

## 0. The core constraint that shapes everything

The app is **$0 beyond the Claude Max subscription, single-user, LLM-free, MCP-driven**. True IG auto-post **breaks the `$0`-friction property**: it requires a Meta app, an App Review, and a long-lived token with an ongoing refresh story. None of that is bad per se — but it is real, recurring ops for a single user, and it cannot be built end-to-end from this repo alone. **~70% of this story is account/ops work only the user can do**; the code is the easy part.

**Bottom line:** v1 (tap "Share", post it yourself) already closes the loop with zero infra. Auto-post buys you removing **one tap, once a week** in exchange for App Review friction and token babysitting. Build it only if the weekly habit is real and the one tap is genuinely the thing stopping you.

---

## 1. The two hard blockers (neither is code)

### Blocker A — Meta account + app + App Review
- An Instagram **Professional account** (Business *or* Creator) — a personal IG account cannot use the Content Publishing API.
- The IG account must be **linked to a Facebook Page** (the Graph API reaches IG *through* the Page).
- A **Meta app** at developers.facebook.com with the **Instagram Graph API** product added.
- Permissions required: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` (and often `business_management`).
- **App Review:** in dev mode you can only publish to accounts with a role on the app (fine for a single user *if* the IG/FB account is added as a tester). To run "for real" / long-term, `instagram_content_publish` goes through **App Review** — a use-case writeup + screencast, days-to-weeks turnaround, and **Meta can reject**. A single-user app is an unusual review profile; expect scrutiny.

### Blocker B — long-lived token + refresh
- User access tokens last ~1 hour; long-lived tokens ~**60 days**. A weekly cron must **refresh before expiry** or silently stop posting.
- **Recommended:** a **Business Manager system-user token** (non-expiring), which removes the refresh treadmill. Requires a Business Manager and assigning the app + Page to a system user.
- Tokens are secrets → `.env`/Vercel only, **never echoed** (same rule as `MCP_AUTH_TOKEN`/`GITHUB_TOKEN`; the GitHub pack's `sanitize()` layer is the pattern to mirror).

---

## 2. The publish flow (the easy, codeable part)

Two-step, against `graph.facebook.com` (Graph API version pinned, e.g. `v21.0`):

```
1. Create media container:
   POST /{ig-user-id}/media
     ?image_url=<PUBLIC card url>
     &caption=<composed caption>
     &access_token=<token>
   → returns { id: <creation_id> }

2. (recommended) Poll container readiness:
   GET /{creation_id}?fields=status_code&access_token=<token>
   → wait for status_code == "FINISHED"

3. Publish:
   POST /{ig-user-id}/media_publish
     ?creation_id=<creation_id>
     &access_token=<token>
   → returns { id: <published_media_id> }
```

- `image_url` must be **publicly reachable by Meta's servers** (no auth). `/recap/card` is already a public, no-auth GET route ✅ — **but if dashboard auth is ever added, the card route must stay public or be explicitly exempted**, or auto-post breaks.
- **Rate limit:** 25 API-published posts per IG account per rolling 24h. We post ~1/week → a non-issue.

---

## 3. The two real GAPS in our current artifacts (must close before a build)

These are the findings that make this more than "wire up two POSTs":

### GAP-1 — Format: the card is **PNG**, the API wants **JPEG**
`/recap/card` returns a **1080×1920 PNG** (`src/app/recap/card/route.tsx`). The IG Content Publishing API expects **JPEG** for `image_url` (PNG is not reliably accepted for media containers). **Fix when built:** add a JPEG output path to the card route (e.g. `?format=jpeg`) or a sibling route. `next/og`/Satori `ImageResponse` is PNG-only, so this likely means an extra encode step (render → re-encode to JPEG) — a small but non-zero piece of work.

### GAP-2 — Aspect: the card is **9:16 (Stories)**, IG **feed** rejects it
1080×1920 = **0.5625** aspect. IG **feed** posts must be between **4:5 (0.8)** and **1.91:1**. A 9:16 image **cannot be a feed post**. Two paths, and this is a genuine product decision:

| Path | Pros | Cons |
|------|------|------|
| **Publish as a Story** (`media_type=STORIES`) | 9:16 fits as-is; no new art | Stories **expire in 24h**; far less discovery/permanence — weak for build-in-public |
| **Generate a feed-format variant** (e.g. 1080×1350 4:5, or 1080×1080) | Permanent, discoverable, the real build-in-public surface | Needs a second card layout/route; more design + render work |

**Recommendation when built:** a **feed-format variant** is the point of build-in-public (permanence + reach). The existing 9:16 card stays the Story/Download asset. So the real v2 scope includes *a new feed-aspect recap card render*, not just an API call. (Optionally post both: feed image + a Story.)

---

## 4. Proposed shape when built (NOT now)

- **Code:** `src/lib/instagram.ts` — a tiny client (`createMediaContainer`, `waitForContainer`, `publishMedia`) with `sanitize()`-style token redaction on errors. Plus a feed-aspect card route (GAP-2) and a JPEG encode (GAP-1).
- **Trigger:** one of —
  - the **Sunday routine** (claude.ai) gains a step that calls a new **MCP write tool** `publish_recap_to_instagram({ weekOffset, dryRun })` after generating the card; or
  - an **in-app cron** (Vercel) — but that re-introduces server scheduling we deliberately avoided in #86. Routine-triggered MCP is more consistent with the existing architecture.
- **Feature flag:** `IG_AUTOPOST_ENABLED` (default off) + `IG_USER_ID`, `IG_ACCESS_TOKEN` envs. With the flag off or tokens absent, the tool no-ops with a clear message. **Always ship behind the flag** (per AC).
- **Idempotency / safety:** reuse the `shared_recap` marker — auto-post writes the same `shared_recap` note + resolves the `[recap:]` nudge, so manual and auto paths converge and never double-post the same week. A `dryRun` mode (build the container, don't publish) for testing without burning a real post.
- **Caption:** reuse `composeCaption` (already deterministic + goal-generic). One caption source for manual and auto.

---

## 5. Go / no-go gate (the "habit proven" trigger)

Don't start the Meta App Review treadmill until the manual loop is a real habit. Concrete, queryable gate (we already store `shared_recap` notes per posted week):

> **Build #96 only when ≥ 6 of the last 8 ISO weeks have a `shared_recap` marker** (i.e. you actually posted ~weekly for two months using the one-tap loop).

Until then: not built. If the habit *doesn't* form, that's the answer — auto-post would have automated a thing you don't do.

---

## 6. Rough effort & risk (when taken)

- **Code:** ~M (client + feed-aspect card render + JPEG encode + 1 MCP tool + flag). Days, not weeks.
- **Ops (the long pole):** Meta app + Business/Creator conversion + Page link + Business Manager system-user token + **App Review** — **the schedule risk**, externally gated, can be rejected.
- **Ongoing:** token expiry/refresh monitoring (mitigated by a system-user token), Graph API version deprecations (~annual), policy changes. This is the "fragile" the AC warns about.

---

## 7. Constraints honored / broken

- **Honored:** LLM-free app (the routine reasons; the tool just POSTs); reuses `composeCaption` + `shared_recap` + the public card route; behind a feature flag; secrets never echoed.
- **Broken (accepted, eyes open):** strict `$0`-friction — Meta app, App Review, token ops. This is *why* it's deferred, not why it's impossible.

---

## 8. Decision log
- **2026-06-17:** #96 scoped as this requirements/readiness doc (not a build). v1 flywheel verified (#97 PASS) but the habit gate (§5) is not yet met — the Sunday routine isn't even activated in claude.ai yet. Revisit when §5's gate trips.
