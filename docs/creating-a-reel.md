# Creating a reel from a Goaldmine day

Quick reference for turning a curated training day into a ClipForge reel.
Two parts: **curate in Goaldmine** (the decisions that drive the cut), then
**render on your Claude Max subscription** ($0 — never the paid API).

Deeper docs: [`integrations/goaldmine-clipforge-bridge.md`](./integrations/goaldmine-clipforge-bridge.md)
(the bridge contract + operating prompt) · [`roadmap/clipforge-worker-spec.md`](./roadmap/clipforge-worker-spec.md)
(why it's Max-only / human-triggered).

---

## Per-reel checklist

1. **Tag the footage** — Day page → **Footage** card → add a marker per clip:
   - the **filename** (the join key to the actual video file),
   - which **exercise** it's from,
   - flag your hero shot as **highlight** (becomes the opener/lead).
   This curation is what makes the cut yours. (Or have the coach do it via `log_footage`.)

2. **Get the files to ClipForge** — copy the day's video files onto the **GPU box** and
   **ingest them into a ClipForge project** so ClipForge can match them to your markers by
   filename. **Note that ClipForge `projectId`.**

3. **Queue it** — Day page → Footage card → **"Queue for render"**, paste the ClipForge
   `projectId`. A status badge appears (the render job is now `pending`).

4. **Render it (interactive, Max, $0)** — on the GPU box run:
   ```
   ./scripts/render-next.sh
   ```
   It opens an interactive Claude that claims the queued day, builds the draft reel, shows
   you the frame-strip + caption, and **stops for your OK**. Approve → it renders → the reel
   link shows back on the Day page.

---

## Status / lifecycle (the Day-page badge)

`pending → claimed → drafted → approved → rendering → rendered` (or `failed` with a message).
- `drafted` = the draft is ready for your approval (you can also click **Approve render** on
  the Day page instead of approving inline).
- `rendered` = done; the badge shows the **reel link**.

---

## One-time setup (GPU box) — to use `render-next.sh`

- `claude login` on the box (your Claude **Max** subscription — no API key).
- Create `mcp-config.json` next to `scripts/render-next.sh` with **both** MCP servers:
  - `goaldmine` (remote streamable-HTTP, `Authorization: Bearer <MCP_AUTH_TOKEN>`),
  - `clipforge` (local stdio — your ClipForge MCP server on the box).
- Export `GOALDMINE_PEEK_URL` and `GOALDMINE_MCP_TOKEN` (or edit the CONFIG block in the script).
- The script header has the full template.

## No-setup path (works today)

If `render-next.sh` isn't set up yet, skip steps 3–4 and just open **claude.ai** with the
**Goaldmine + ClipForge** connectors attached and say:
> "Make a reel from today's Goaldmine day."

Same bridge, same result — the queue + `render-next.sh` only make it one command instead of a paste.

---

## Gotchas

- **`filename` is the join key.** A marker whose filename isn't ingested into the ClipForge
  project fails the job loudly (by design — better than a silent empty render). Ingest first.
- **`highlight`** picks the hero/opener; multiple highlights tie-break by capture time.
- **Max-only.** The render is always **human-triggered** in an interactive session — there's
  no unattended/background worker (that would require the paid API, which goaldmine never uses).
- Spine **slot labels** are matched exactly (case-sensitive) inside the bridge — that's handled
  for you by the operating prompt; just know it's the fragile join if a clip doesn't place.
