# Backlog Critique — Content Flywheel (#87, thread 3.4)

**Critic:** Backlog Critic agent  
**Stamped:** 2026-06-17  
**Source files read:**
- `docs/roadmap/content-flywheel-decomposition.md`
- `docs/roadmap/spike-proactive-coach.md`
- `src/components/RecapClient.tsx`
- `src/app/recap/highlights/route.ts`
- `src/lib/recap.ts`
- `src/lib/mcp/tools.ts` (log_open_item, resolve_open_item, generate_recap_card sections)
- `prisma/schema.prisma`

---

## Verdict: APPROVE-WITH-FIXES

**Gap count: 8** (2 blocking, 4 significant, 2 minor)

**Single most important risk:** 3.4-c's "composes a caption" step has a silent architecture hole — the cloud routine is an MCP client only and cannot call the app's `/recap/caption` REST route directly. It must either (a) write its own LLM-voiced caption from the `generate_recap_card` JSON output, or (b) use a new MCP tool that exposes the deterministic composer. Neither path is specified, making 3.4-c partially unimplementable as written.

---

## Check 1 — Technical Feasibility of 3.4-b (the linchpin)

**Overall:** Technically sound on the fundamentals. Two gaps need explicit AC coverage.

**What works:**
- `RecapClient` is `"use client"` (line 1) and already performs async `fetch("/recap/highlights?...")` in `useEffect` (lines 36–52) — the same pattern a Share button would use for `/recap/card`. Architecturally consistent.
- `/recap/card` is same-origin (Vercel domain); no CORS issue.
- `navigator.canShare({files:[...]})` gating is correctly called out in the doc. Web Share Level 2 files support requires HTTPS and this check before calling `navigator.share`.
- Desktop fallback (copy caption + existing `<a href="..." download="recap-card.png">`) is sound — the download anchor pattern is already proven at `RecapClient.tsx:203–208`.

**FLAG — Blocking gap: async fetch-before-share needs explicit loading state.**  
The current Download button is a plain `<a href download>` — no prefetch, no wait. The Share path must `fetch(cardUrl)` → `arrayBuffer()` → `Blob` → `File` → `navigator.share(...)`. The `/recap/card` Satori render can take 1–3s on cold start. Tapping Share on mobile will produce a perceptible lag before the system share sheet appears. Without a loading state (spinner, disabled button, or "Preparing…" label) this feels broken on mobile. 3.4-b's AC must include "Share button shows loading state during PNG fetch."

**FLAG — Minor gap: localhost dev Share may be unavailable.**  
`navigator.share` requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or localhost). `http://localhost:3000` IS a secure context, so dev is fine. This is not a blocker, just worth a note-to-self.

**FLAG — Minor gap: PNG file size risk.**  
The recap card is 540×960 (9:16). Satori outputs uncompressed or lightly-compressed PNG. Some mobile browsers or share targets (WhatsApp, etc.) may silently reject files over ~5 MB. Recommend asserting the PNG size is sane in the Share handler (`file.size < 5_000_000 || fallback`). Not a blocker for v1 but worth flagging.

---

## Check 2 — Caption Route Necessity (3.4-b)

**Correct and necessary.** `RecapClient` explicitly bans WeeklyRecap crossing the client boundary (line 8–9: "CRIT-2 compliance: receives ONLY {offset, label}[] from the server. No Date objects, no WeeklyRecap, no client-side TZ math."). Computing the caption server-side via a `/recap/caption?weekOffset&goalId&highlight` route and fetching the result from the client is the exact same pattern as `/recap/highlights` — the route.ts file for highlights (lines 18–27) is a 1:1 structural template.

**Could `generate_recap_card` return the caption?** No. `generate_recap_card` is an MCP tool for the cloud coach, not the web app's client. The app's Share button calls REST routes, not MCP tools. The new route is the right path.

**Minor inefficiency:** The Share flow will hit `/recap/caption` (to get the caption string) AND then fetch `/recap/card` (to get the PNG). Both call `computeWeeklyRecap()` independently — two DB round-trips for the same week's data. Not a blocker for v1 but a parallel-fetch or a combined `/recap/share-bundle` route would eliminate this redundancy.

---

## Check 3 — 3.4-a Goal-Genericity

**Confirmed sufficient.** All fields the caption composer needs are present on `WeeklyRecap`:

| Field needed | WeeklyRecap location | Status |
|---|---|---|
| `dateRangeLabel` | `recap.ts:107` | ✓ |
| `statSlots[]` with label/value/isNull | `recap.ts:127`, `ResolvedStatSlot` | ✓ |
| `highlights[]` with icon/label/sub | `recap.ts:121`, `RecapHighlight` | ✓ |
| `goal.objective` | `RecapGoalBlock.objective` | ✓ |
| `streakDays` | `recap.ts:116` | ✓ |
| `instagramHandle` | `recap.ts:117` | ✓ (but see below) |
| `emptyWeek` | `recap.ts:119` | ✓ — drives quiet-week caption |
| `goal.kind` (for hashtag) | `RecapGoalBlock.kind` | ✓ — accessible from `goal.kind` |

No LLM needed: confirmed. All data is deterministic from the bundle.

**FLAG — Significant gap: `INSTAGRAM_HANDLE` env var is undocumented.**  
`recap.ts:517` reads `process.env.INSTAGRAM_HANDLE ?? null`. This env var is NOT present in `.env.example` and NOT in the `.env` file. When unset (the likely default for any new deploy), `instagramHandle` is `null` and the card/caption omit the @-handle silently. 3.4-a's AC or a one-liner setup note should require adding `INSTAGRAM_HANDLE` to `.env.example` with a placeholder comment, and to Vercel env vars. Without this, the "build-in-public" identity branding is missing from day one.

---

## Check 4 — 3.4-c / #86 Overlap

**Dedup is correct.** `spike-proactive-coach.md:91` says explicitly: "3.3-e — Auto Sunday recap card from the same routine (generate_recap_card) — overlaps #87 (content flywheel) | Medium | **merge with 3.4 rather than duplicate**." The decomposition correctly folds 3.3-e into 3.4-c as a single routine.

**FLAG — Blocking gap: 3.4-c is missing dependency #86 3.3-b.**  
The dependency table lists `#86 3.3-a (nudge surface), 3.4-a, 3.4-b` for 3.4-c. But the Sunday routine also requires **3.3-b** (the one-time setup story: network allowlist, bearer-token connector, `/schedule` setup). Without 3.3-b done, the routine cannot be configured or tested. `spike-proactive-coach.md:87` lists 3.3-b as the setup story and explicitly calls out the "network allowlist — easy to forget; document it as step 1." Add `#86 3.3-b` to 3.4-c's dependencies.

**FLAG — Architecture gap in "composes a caption" (3.4-c).**  
This is the single most important feasibility issue. The doc says the Sunday routine "calls `generate_recap_card(weekOffset:0)` + composes a caption." The routine is a cloud Claude Code agent that connects to the app via MCP tools only. It CANNOT call the app's `/recap/caption` REST route directly. Two viable paths:

1. **Routine writes its own LLM-voiced nudge body from the JSON stats** (the `generate_recap_card` MCP tool already returns the full WeeklyRecap as JSON via `imageAndJsonResult` at `tool-helpers.ts:43`). The routine reads `statSlots`, `highlights`, `dateRangeLabel` from that JSON and composes a nudge body in coach voice — it's an LLM, so this is natural. The app's deterministic 3.4-a composer is then used only by the `/recap/caption` route (for the Share button), not by the routine. **Recommended.**

2. **Add a `get_recap_caption(weekOffset, goalId, highlight)` MCP tool** that calls the 3.4-a composer server-side and returns the caption string. The routine calls this and embeds the caption in the nudge body. More work; only worth it if caption consistency between the nudge and the share is required.

3.4-c must pick one of these paths and state it. As written, "composes a caption" is ambiguous and could lead to the routine author either (a) expecting to call a non-existent MCP tool or (b) duplicating the composer logic in the routine prompt.

---

## Check 5 — 3.4-d Post-Tracking

**`resolve_open_item` confirmed:** `tools.ts:2438`. Takes `{id: string, reason: string}`. Type-guards for `type !== 'open_item'` (line 2457). Exactly as 3.4-d describes. ✓

**`Note type:"shared_recap"` — no schema migration needed.**  
`schema.prisma:89`: `type String @default("journal") // audible | journal | ...` — the type field is a plain String, NOT a PostgreSQL enum. Adding `"shared_recap"` as a new type value requires no migration and no Zod enum change in `NoteTypeShape` at `tools.ts:96` (which controls `log_note`, not `log_open_item`). The story should say this explicitly to preempt a false "schema change required" call.

**ScheduledItem vs Note:** ScheduledItem requires a `goalId` FK (`schema.prisma:213`). Since recap posting is global (not scoped to a goal), a Note is the correct choice. ✓

**FLAG — Significant gap: 3.4-d has no READ path defined.**  
To show "posted ✓" on `/recap` and suppress the nudge, the page must query whether a `shared_recap` Note exists for the current `weekOffset`/dateKey. Currently:
- No MCP tool reads for `type:"shared_recap"` notes.
- No REST route returns this.
- `list_open_items` (tools.ts:1178) queries `type:"open_item"` only.

3.4-d needs to specify how `/recap` checks posted state. Options:
- Add a query to an existing or new REST route (e.g., extend `/recap/highlights` response to include `postedAt`).
- Add a new `get_recap_post_state(weekOffset)` REST route.
- Use a `LogEntry` with metric `"recap_shared"` on the focus goal (query via `get_nutrition_history` pattern).

This is net-new code not mentioned in the story. Without it, the "posted ✓" AC is unachievable.

---

## Check 6 — Right-Sizing

| Story | Doc Effort | Assessment |
|---|---|---|
| 3.4-a | Medium | Correct. Single lib function + Vitest coverage for three cases. |
| 3.4-b | Medium | Correct. Share UI + new `/recap/caption` route + loading state + fallback. |
| 3.4-c | Medium | Slight oversize. No app code — config + prompt + docs only. Small-to-Medium. Acceptable as Medium given routine observability requirements from #86 3.3-b. |
| 3.4-d | Small | Correct for write path. Grows to Small-to-Medium once the READ path gap (Check 5) is addressed. |
| 3.4-e | Large | Correct. Deferred stub. |
| 3.4-f | Small | Correct. |

**3.4-a + 3.4-b split:** Correctly separated. Caption composer (3.4-a) is a testable pure library; share UI (3.4-b) depends on it. No merge warranted.

**3.4-c + 3.4-d split:** Correctly separated by "config/docs only" vs "app code." Keep the split.

---

## Check 7 — Dependency Sanity

```
3.4-a  →  (none)
3.4-b  →  3.4-a                          ✓
3.4-c  →  #86 3.3-a, 3.4-a, 3.4-b       MISSING: #86 3.3-b  ← FLAG
3.4-d  →  3.4-c                          ✓
3.4-e  →  3.4-a..d                       ✓
3.4-f  →  3.4-a..d                       ✓
```

No cycles. The cross-epic dep on #86 3.3-a is explicit and correct. **Fix:** Add `#86 3.3-b` to 3.4-c's dependency row.

**Build order** (a→b→c→d, e/f last) is sound.

---

## Check 8 — Completeness

**What the doc covers correctly:**
- `emptyWeek` caption case (quiet-week path in 3.4-a AC) ✓
- IG caption ≤2200 char limit in 3.4-a AC ✓
- Vitest coverage requirement in 3.4-a AC ✓
- Idempotency / dedup in 3.4-c ("one nudge/week; dedup key") — mentioned but not specified (see below)

**Missing from the decomposition:**

| # | Missing item | Severity | Proposed fix |
|---|---|---|---|
| M1 | `INSTAGRAM_HANDLE` not in `.env.example` | Significant | Add to `.env.example` as `INSTAGRAM_HANDLE="@yourhandle"` (optional, omit to suppress from card/caption). Mention in 3.4-a AC or as a setup prerequisite. |
| M2 | Share button loading state | Significant | Add to 3.4-b AC: "Share button shows loading/disabled state during async PNG fetch; error toast on fetch failure." |
| M3 | 3.4-c routine caption path (MCP vs REST) | Blocking | Specify in 3.4-c whether the routine composes its own LLM nudge from the JSON stats (recommended) or needs a new `get_recap_caption` MCP tool. |
| M4 | 3.4-d read path for "posted ✓" state | Significant | Add a sub-task: "REST route or query to check `shared_recap` Note existence for a weekOffset, used by `/recap` page to render posted state." |
| M5 | 3.4-c idempotency mechanism | Moderate | "One nudge/week; dedup key" is stated but unspecified. The routine must check `list_open_items` for an existing unresolved nudge with a matching week label, or encode the weekOffset in the body and grep for it. The story should specify the dedup approach so the routine prompt can implement it. |
| M6 | PNG size guard in Share handler | Minor | Recommend `file.size < 5_000_000 || fallback` to handle oversized PNG on narrow mobile browsers. |
| M7 | Dual-caption inefficiency | Minor | Document that `/recap/caption` and `/recap/card` both call `computeWeeklyRecap()` independently. A future optimization (combined `/recap/share-bundle` or React Query cache) could eliminate the redundant DB round-trip. Not required for v1. |
| M8 | Desktop Share UX copy | Minor | "copy caption + existing download" is the stated fallback. The AC should specify the UX: separate "Copy Caption" button + the existing Download Card link, or a combined "Copy + Download" state. |

---

## Check 9 — $0 / No-LLM / IG-API-Deferred

**The $0 / no-LLM / v1-manual split is honest and accurate.**

- v1 Web Share API: genuinely $0. `navigator.share({files:[...]})` is a browser API, no service cost.
- Max subscription routine: $0 incremental. ✓
- No LLM in the app: confirmed. `generate_recap_card` and the caption composer are purely deterministic. ✓
- IG Graph API deferred: the "Business/Creator account + Facebook app + long-lived token + container→publish flow + app review" characterization is accurate. The newer "Instagram API with Instagram Login" OAuth flow (Meta's newer path) is slightly less friction but still requires the `instagram_content_publish` scope, which requires app review. No truly friction-free personal auto-post path exists at $0.
- Third-party schedulers (Buffer/Later free tiers): a valid cheap alternative not mentioned, but introducing a third-party dependency contradicts the $0-friction-free-for-personal-use principle. Correctly omitted.

---

## Required Fixes Before Implementation

### Priority 1 — Blocking

**Fix F1 (3.4-c architecture ambiguity):** Add a "Routine caption approach" section to 3.4-c's story body:
> "The routine composes its own coach-voiced nudge body from the JSON stats returned by `generate_recap_card` (which includes the full `WeeklyRecap` as a text block). The app's deterministic composer (`recap-caption.ts`) is used only by the `/recap/caption` route (for the Share button); the routine does not need to call it."

**Fix F2 (3.4-c missing dep):** Add `#86 3.3-b` to 3.4-c's "Depends on" column.

### Priority 2 — Significant

**Fix F3 (3.4-b AC):** Add to 3.4-b's AC: "Share button shows loading/disabled state during async PNG fetch; error state with clipboard fallback on fetch failure."

**Fix F4 (3.4-d read path):** Add to 3.4-d's story: "Add a lightweight `GET /recap/post-state?weekOffset=` route that queries for a `shared_recap` Note with a matching weekOffset in its payload; `/recap` fetches this on load to render posted-week state."

**Fix F5 (INSTAGRAM_HANDLE setup):** Add `INSTAGRAM_HANDLE` to `.env.example` with a comment ("Optional: your IG handle, e.g. @username — shown on card and included in caption; omit to suppress"). Mention this in 3.4-a's AC as "env var documented."

### Priority 3 — Moderate

**Fix F6 (3.4-c idempotency):** Specify the dedup key in 3.4-c: "The routine checks `list_open_items` for an existing unresolved item whose body contains the current `dateRangeLabel` before writing a new one. If found, skip."

---

## Summary

The 6-story decomposition is architecturally sound and correctly deduplicates with #86's 3.3-e. The linchpin (3.4-b Web Share flow) is technically feasible with same-origin PNG fetch and the `navigator.canShare` guard. Two blocking fixes are required before implementation: (1) the 3.4-c routine must explicitly specify whether it composes its own LLM caption from the MCP JSON output or calls a new MCP tool — "composes a caption" is ambiguous and silent failure mode is a frustrated dev expecting a non-existent tool call; (2) 3.4-c must declare `#86 3.3-b` as a dependency or the routine can never be tested. Four significant gaps (Share loading state, read path for posted state, INSTAGRAM_HANDLE env doc, idempotency spec) round out the punch list.

**Verdict: APPROVE-WITH-FIXES** — 8 gaps, 2 blocking.
