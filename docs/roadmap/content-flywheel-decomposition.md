# Decomposition — Content Flywheel (#87, thread 3.4)

**Stamped:** 2026-06-17 · Decomposes the Backlog epic #87 into buildable stories.
**Now unblocked:** the kind-aware recap card (Sprint 6) shipped; the scheduling mechanism is decided (#86 → Mechanism A, Claude Code routine).

## Vision
The Weekly Recap Card → Instagram journey becomes an automatic build-in-public habit at **$0**: every Sunday the card + a caption are prepared, the user is nudged, and posting is one tap. The tool that documents discipline becomes the thing that grows the audience.

## Architecture (the realistic $0 loop)
```
Sunday routine (#86 Mechanism A, cloud, $0)
  → generate_recap_card(weekOffset:0) + compose caption
  → write a "recap ready" nudge via log_open_item (reuses #86 3.3-a surface)
        ↓
User opens /recap (from the nudge)
  → one-tap Share: fetch card PNG → blob → navigator.share({ files:[png], text: caption })
        → Instagram share sheet (mobile); copy-caption + download fallback (desktop)
  → marks the week posted → nudge clears
```
- **No LLM in the app:** the caption has a deterministic app-side composer (baseline); the routine can refine it in coach voice (cloud). The app only composes-from-template + renders + shares.
- **Instagram API is v2-deferred:** the IG Graph API needs a Business/Creator account + a Facebook app + a long-lived token + the container→publish flow — fragile, app-review friction, not $0-friction-free for personal use. v1 is **manual-assisted one-tap share** (Web Share API), which is the honest $0 build-in-public loop. True auto-post is a deferred escalation only if the habit proves out.

## Reusable (shipped) vs net-new
| Reusable | Net-new |
|---|---|
| `/recap/card` PNG route, `/recap/highlights`, story routes | **caption composer** (`recap-caption.ts`) |
| `computeWeeklyRecap` (all caption fields incl. `statSlots`, `highlights`, `instagramHandle`) | **`/recap/caption` route** (JSON, like `/recap/highlights`) |
| `generate_recap_card` MCP tool (image + JSON) | **Web Share UI** in `RecapClient` (`navigator.share` w/ PNG + copy fallback) |
| `RecapClient` (week nav, template, highlight picker, **download** buttons) | **post-state tracking** (week marked shared) |
| `RecapHighlight` detection; `instagramHandle` on the card | **the Sunday routine** (config + prompt; per #86) |

## Stories
| ID | Title | Effort | Priority | Depends on |
|---|---|---|---|---|
| **3.4-a** | Recap caption composer — deterministic, goal-generic | Medium | P2 | — |
| **3.4-b** | One-tap Share on /recap (Web Share API + copy/download fallback) | Medium | P2 | 3.4-a |
| **3.4-c** | "Recap ready" Sunday routine + weekly nudge | Medium | P3 | #86 3.3-a (nudge surface) + #86 3.3-b (routine setup), 3.4-a, 3.4-b |
| **3.4-d** | Post-state tracking (mark a week posted; clear the nudge) | Small | P3 | 3.4-c |
| **3.4-e** | DEFERRED v2 — true Instagram Graph API auto-post | Large | P3 | 3.4-a..d (only if habit proven) |
| **3.4-f** | Flywheel QA — caption + share at 390px, both verticals, routine loop | Small | P3 | 3.4-a..d |

### 3.4-a — Recap caption composer (deterministic, goal-generic)
New `src/lib/recap-caption.ts`: `composeCaption(recap: WeeklyRecap, highlight: RecapHighlight | null): string`. Builds a build-in-public caption from the bundle — date range, the goal's own `statSlots` (fitness: WORKOUTS/VOLUME/PRs/ELEVATION; project: MRR/MILESTONES), the featured `highlight`, goal objective, streak, `instagramHandle`, and hashtags (#buildinpublic + a goal-kind tag). **No LLM** (deterministic template). Goal-generic (zero hardcoded vertical strings — labels from `statSlots`/`highlights`). Handles `emptyWeek` (a gentle "quiet week" caption). Keeps under a sane IG caption length. Unit-tested (fitness, project, empty week). **(critic F7) Add `INSTAGRAM_HANDLE` to `.env.example`** (it's read for the @-handle in the caption + card footer but isn't documented — silently missing on a fresh deploy). **AC:** Vitest covers all three; goal-generic grep-clean; ≤2200 chars; `.env.example` documents `INSTAGRAM_HANDLE`.

### 3.4-b — One-tap Share on /recap
Add a "Share" action to `RecapClient`: fetch the current `/recap/card?...` PNG → `Blob` → `File` → `navigator.share({ files:[file], text: caption })`. Caption comes from a new **`/recap/caption?weekOffset&goalId&highlight`** route (JSON `{caption}`, computed server-side via 3.4-a — mirrors `/recap/highlights` so no Date crosses the boundary). Fallback when Web Share/`canShare({files})` is unsupported: copy caption to clipboard + the existing download-PNG pattern. Mobile-first (390px); the share button is the primary CTA on mobile. **(critic F3) The Satori card render takes ~1–3s — the Share button MUST show an async loading/disabled state while fetching the PNG + caption, and surface an error toast on failure.** **AC:** `navigator.share` with the PNG file works on mobile, graceful desktop fallback (copy + download); a visible loading state during fetch; caption matches 3.4-a; reuses the existing download mechanics; `navigator.canShare({files})` gates the share path.

### 3.4-c — "Recap ready" Sunday routine + weekly nudge
Per #86 Mechanism A: a Sunday routine (cron Sun, `America/Denver`) calls `generate_recap_card(weekOffset:0)` — which returns the PNG **plus the full WeeklyRecap JSON** (`imageAndJsonResult`) — then writes a nudge via `log_open_item` ("Your Sunday recap is ready — open /recap to post it"). Config + prompt documented in `docs/coaching/` (no app code).
- **(critic F1) Two distinct caption paths — do not conflate:** the routine is an MCP client and **cannot call the app's `/recap/caption` REST route**. So the routine composes its **own coach-voiced nudge body from the `generate_recap_card` JSON stats** (cloud LLM). The app's deterministic `recap-caption.ts` (3.4-a) is used ONLY by the `/recap/caption` route for the manual Share UI (3.4-b). No new MCP caption tool is needed. (Net effect: the user gets a coach-voiced nudge to post + a deterministic caption pre-filled in the share sheet.)
- **(critic F4) Idempotency dedup:** key the nudge to the ISO week — before writing, the routine checks `list_open_items` for an existing unresolved "recap ready" item for the current week (or uses a deterministic `body` prefix like `[recap:YYYY-Www]`); write at most one per week.
**Depends on: #86 3.3-a (nudge display) AND #86 3.3-b (one-time routine setup — network allowlist, bearer-token connector, `/schedule`), 3.4-a, 3.4-b.** **AC:** routine prompt + one-time setup documented; exactly one weekly nudge (dedup proven); reuses 3.3-a surface; "Run now" produces a nudge linking to /recap.

### 3.4-d — Post-state tracking
Mark a week's recap "posted" so the nudge clears and `/recap` shows a "posted ✓" state. Reuse `resolve_open_item` to clear the nudge; persist the posted marker minimally as a `Note type:"shared_recap"` keyed by `dateKey`/weekOffset (Note works for any goal; `ScheduledItem` is project-scoped, so prefer Note).
- **(critic F5/F6) New Note type + a READ path:** `shared_recap` is a NEW value — add it to the `NoteTypeShape` Zod enum + the schema comment (additive, no migration since `type` is a free string column, but keep the enum in sync). The `/recap` page must KNOW a week is posted — add a tiny read (a server query for `shared_recap` notes by dateKey, surfaced into `RecapClient` as a `postedWeeks: string[]` prop, mirroring how labels are passed). Without this read path "posted ✓" cannot render.
**AC:** sharing marks the week (a `shared_recap` Note); the weekly nudge clears (`resolve_open_item`); `/recap` reads + reflects posted state for that week; no duplicate-post nagging.

### 3.4-e — DEFERRED v2: Instagram Graph API auto-post
Tracking stub. True automation: IG Graph API (Business/Creator account, Facebook app, long-lived token via env, the `media` container → `media_publish` 2-step), the card hosted at a public URL (`/recap/card` is already a public route). Heavy + fragile (token refresh, app review, rate limits). **Build ONLY if** the manual-assisted loop (3.4-a..d) proves the habit. **AC (when taken):** documented requirements + a behind-a-flag publish path; until then, not built.

### 3.4-f — Flywheel QA
End-to-end: caption composer (fitness + project + empty week), Share at 390px (Web Share + fallback), the routine nudge loop, post-state clearing. **AC:** both verticals produce a sensible card + caption; share works on mobile width; nudge appears + clears; no production code touched by QA.

## Constraints honored
- **$0:** v1 is Web Share + the Max-subscription routine (#86). No paid infra. IG API (v2) deferred.
- **No LLM in the app:** deterministic caption composer; routine refines in the cloud.
- **Goal-generic:** caption + card derive from `statSlots`/`highlights`, not hardcoded verticals.
- **USER_TZ / Satori:** card already correct (Sprint 6); caption uses the pre-formatted `dateRangeLabel`.
- **Overlap with #86:** 3.4-c is the same Mechanism-A routine as #86 3.3-e — build once, shared routine; don't duplicate.
