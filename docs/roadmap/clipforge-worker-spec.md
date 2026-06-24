# ClipForge Auto-Render Worker — Implementation Spec (Epic B · #119–#123)

**Status:** Spec (code lands OUTSIDE this repo, on the GPU box) · **Date:** 2026-06-24
**Companions:** [`clipforge-auto-render-plan.md`](./clipforge-auto-render-plan.md) (the plan + R1–R11) · [`../integrations/goaldmine-clipforge-bridge.md`](../integrations/goaldmine-clipforge-bridge.md) (the manual bridge prompt this automates)
**Depends on (shipped):** `DayRenderJob` model, render MCP tools (`queue/list/claim/start/submit_draft/complete_render_job`), `GET /api/render-jobs/peek`, the stale-claim reaper.

---

## 0. CONSTRAINT — Max subscription only (NON-NEGOTIABLE)

goaldmine runs **only on the Claude Max subscription, never the paid Anthropic API.** `$0 beyond Max` is a core product feature, not a preference.

**Hard consequence — fully-unattended local auto-render is NOT achievable on Max-only:**
- An unattended cron worker = headless `claude -p`, which (a) does **not** honor the Max OAuth token in `--bare` mode and (b) is outside Max's interactive-use scope — it would require `ANTHROPIC_API_KEY`. **Out.**
- claude.ai **routines** DO run on the subscription, but execute in Anthropic's **cloud** — they can't reach the **local GPU** or the **local ClipForge MCP**, so they cannot render. (At most a routine can read the queue and *notify* "a job is pending.")
- Therefore: **no cron robot.** The render must be **triggered by you in an interactive Max session.**

**This is a smaller loss than it sounds:** the bridge already **stops for your approval before rendering** — a human was always in the loop. Max-only just means you also *start* the session (which builds the draft → you approve → it renders), rather than a background process building drafts while you're away.

→ **Sections §2–§7 below describe the unattended API-key worker and are SUPERSEDED / reference-only** (only relevant if the Max-only rule is ever lifted). The viable design is §1.

## 1. The Max-only design (the viable path)

- **Queue — already shipped (Epic A):** Day-page "Queue for render" marks a day ready; `list_render_jobs` + the Day-page status badge show what's pending.
- **Trigger — interactive, on Max:** when you want reels, open an interactive Claude with **both** connectors attached and run the bridge for the next pending day. Two equivalent ways, both $0 on Max:
  - **claude.ai** with the Goaldmine + ClipForge connectors, or
  - **`claude` (Claude Code) on the GPU box**, logged into Max, with both MCP servers in its config.
  - Optional streamliner: a `render-next` shell alias on the box that opens an interactive `claude` pre-seeded with the bridge prompt for the oldest `pending` job (still interactive, still Max).
- **Lifecycle still applies:** the interactive session does claim → draft → (you approve / continue) → render → `complete_render_job`, writing status back so the Day page shows progress + the final reel link. The render MCP tools (#114) work the same whether driven by a human-interactive session or a robot.
- **Optional Max-only nicety:** a claude.ai **routine** (runs on the subscription) that, on a schedule, reads the queue and writes you a nudge ("2 days queued for render") — pure notification, no rendering, no GPU.

**Net:** Epic B collapses from "build an unattended worker" to "make triggering the existing bridge for a queued day frictionless, in an interactive Max session." Much smaller — mostly the already-shipped queue plus an optional launcher alias + an optional notify-routine.

---

## 1. Architecture (recap)
Poll, not push (GPU box is behind NAT). **Split-run, never long-poll** (R2): each cron tick runs one short headless Claude session and exits. Two run types, selected by `/peek`:
- **Draft run** — `pending` jobs: claim → build draft reel → `submit_render_draft` → exit.
- **Render run** — `approved` jobs (you approved the draft in Goaldmine): `start_render_job` → render → `complete_render_job` → exit.
Lifecycle: `pending → claimed → drafted → approved → rendering → rendered` (+ `failed`). The shipped reaper re-queues stuck `claimed`/`rendering` jobs after 30 min.

---

## 2. #119 — Worker scaffold + auth · M
Repo/dir on the GPU box (NOT in goaldmine), e.g. `~/clipforge-worker/`:
```
clipforge-worker/
  worker.sh            # the cron entrypoint (§3)
  mcp-config.json      # both MCP servers (§ below)
  prompts/draft.md     # §4
  prompts/render.md    # §5
  .env                 # ANTHROPIC_API_KEY, GOALDMINE_MCP_URL, GOALDMINE_MCP_TOKEN, CLIPFORGE_* 
  logs/
```
`.env` (chmod 600):
```
ANTHROPIC_API_KEY=sk-ant-...          # paid; see §0
GOALDMINE_MCP_URL=https://workout-planner-gold-three.vercel.app/api/mcp
GOALDMINE_MCP_TOKEN=<MCP_AUTH_TOKEN>   # same bearer the connector uses
GOALDMINE_PEEK_URL=https://workout-planner-gold-three.vercel.app/api/render-jobs/peek
```
`mcp-config.json` — remote Goaldmine (bearer) + local ClipForge (stdio):
```json
{
  "mcpServers": {
    "goaldmine": {
      "type": "streamable-http",
      "url": "${GOALDMINE_MCP_URL}",
      "headers": { "Authorization": "Bearer ${GOALDMINE_MCP_TOKEN}" },
      "timeout": 60000
    },
    "clipforge": {
      "command": "<clipforge mcp launch cmd>",
      "args": ["<...>"],
      "env": { "CLIPFORGE_GPU_DEVICE": "0" }
    }
  }
}
```
AC: a `claude --bare -p "ping" --mcp-config mcp-config.json --output-format json` run authenticates via `ANTHROPIC_API_KEY` and lists both servers' tools. Auth-expiry/disabled-account → exit code 1 + `is_error` → alert (see §6).

## 3. #120 — Cron poller → /peek → launch correct run · S
`cron` every ~5 min runs `worker.sh`:
1. `flock -n` guard (one run at a time — §6).
2. `curl -s -H "Authorization: Bearer $GOALDMINE_MCP_TOKEN" "$GOALDMINE_PEEK_URL"` → JSON `{ pendingCount, nextJob, approvedCount, nextApprovedJob, reaped }`.
3. Branch (drain one job per tick; **render runs first** so approved work finishes before new drafts):
   - `approvedCount > 0` → **render run** for `nextApprovedJob.id`.
   - else `pendingCount > 0` → **draft run** for `nextJob.id`.
   - else exit 0.
4. Launch the matching headless Claude run (§4/§5), passing the job id + date into the prompt.
**The worker computes no dates** (R8) — it passes `nextJob.id`/`.date` through verbatim.

## 4. #121 — Draft run · M
Invocation (single-shot, tool-allowlisted, time-boxed):
```bash
timeout 600 claude --bare -p "$(render_prompt draft "$JOB_ID" "$PROJECT_ID")" \
  --mcp-config mcp-config.json --output-format json --max-turns 12 \
  --allowedTools "mcp__goaldmine__claim_render_job,mcp__goaldmine__get_day_footage,\
mcp__goaldmine__submit_render_draft,mcp__goaldmine__complete_render_job,\
mcp__clipforge__list_spines,mcp__clipforge__list_assets,mcp__clipforge__apply_spine,mcp__clipforge__frame_strip"
```
Operating prompt (`prompts/draft.md`, parameterized by job id; automates the bridge prompt — NO human stop, NO render):
1. `claim_render_job(id)` → if `claimed:false`, exit (another tick took it).
2. `get_day_footage(date)` (the job's date).
3. `clipforge.list_spines` → pick the fitting spine; **capture exact slot labels** (case-exact — the fragile join).
4. `clipforge.list_assets(clipforgeProjectId)` → resolve each `marker.filename → assetId` (capturedAt ±30s tiebreaker). **Unresolved filenames → `complete_render_job(id, status:"failed", errorMessage:"unresolved: <list>")` and exit** (R9 — never render empty).
5. Build pins (highlight → lead/hook; exercise order; B-roll → member). Multiple `highlight` → tie-break `capturedAt asc` (R9).
6. `clipforge.apply_spine(projectId, spineId, assetIds, pins, maxDurationSec:30)` → `frame_strip` to sanity-check.
7. Failure policy (R9): `EPS_GUARD` → retry once with the next-best spine, else fail with message; `POOL_CYCLED` → proceed but note it in the draft notes.
8. Caption (coach voice, from goal objective + highlight).
9. `submit_render_draft(id, draftRef:<clipforge draft id>, notes:<spine + any EPS_GUARD/POOL_CYCLED + caption>)` → **exit. Do not render.**
AC: a `pending` job ends as `drafted` with a draftRef, or `failed` with a clear message; the run never renders; `is_error:false` on the happy path.

## 5. #122 — Render run · S
Invocation as §4 but allowlist `mcp__goaldmine__start_render_job,mcp__goaldmine__complete_render_job,mcp__clipforge__render`.
Prompt (`prompts/render.md`):
1. `start_render_job(id)` → if `started:false`, exit (already taken).
2. `clipforge.render(projectId, preset)` from the approved draft.
3. `complete_render_job(id, outputRef:<reel URL-or-id>, status:"rendered")`. On render error → `complete_render_job(id, status:"failed", errorMessage:<err>)`. Exit either way.
AC: an `approved` job ends `rendered` with `outputRef` (surfaces as the reel link on the Day page), or `failed` with a message.

## 6. #123 — Run-as-a-service + logging + retry · M
- **Schedule:** a launchd `.plist` (macOS) or systemd timer running `worker.sh` every 5 min. (Or a single long-lived loop with `sleep 300` — but cron/timer is simpler and crash-resilient.)
- **Concurrency:** `flock -n /tmp/clipforge-worker.lock` at the top of `worker.sh`; a tick that can't get the lock exits 0. Belt-and-suspenders with the server-side reaper (stuck claims auto-requeue after 30 min).
- **Per-run logs:** `logs/<unix-ts>.log` capturing the peek result, the chosen run, the full JSON output (`result`, `is_error`, `total_cost_usd`, `num_turns`), timestamps.
- **Bounded retry:** on `is_error:true` whose `result` matches transient patterns (`timeout|connection|unavailable|50[0-9]`), retry ≤3 with exponential backoff; non-transient → fail the job and stop.
- **Timeout:** wrap `claude` in `timeout 600`; exit 124 → log + treat as transient (the reaper will requeue the claim).
- **Alerting:** persistent `is_error` / exit 1 (auth) → write a breadcrumb the user sees (e.g. `log_note` via MCP, or a local notification) so a dead worker is noticed.

## 7. Permissions / safety
- `--bare` + explicit `--allowedTools` = no interactive permission prompts (required for unattended). Allowlist ONLY the exact MCP tools each run needs (§4/§5) — least privilege.
- The worker has the Goaldmine bearer + ClipForge local access; keep `.env` 0600; the box is single-user.

## 8. Open items / risks
- **§0 auth/cost gate is the go/no-go.** Everything else assumes `ANTHROPIC_API_KEY`.
- File-ingestion precondition (R4): files must already be in the ClipForge project before a day is queued — out of worker scope; the draft run fails loudly if assets are missing.
- ClipForge MCP tool names/preset values in §4/§5 are placeholders — verify against the live ClipForge MCP schema (`list_*` first).
- `--max-turns`/timeout values are starting points; tune from real run logs.
