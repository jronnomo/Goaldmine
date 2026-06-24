#!/usr/bin/env bash
#
# render-next.sh — Max-only ClipForge render launcher (GPU box).
#
# Opens an INTERACTIVE Claude Code session (your Claude Max subscription — $0,
# no API key) pre-loaded to run the Goaldmine→ClipForge bridge for the OLDEST
# day you've queued for render in Goaldmine. This is the "as far as Max takes
# us" trigger: you run one command, stay in the loop (the bridge stops for your
# OK before rendering), and it writes status back to Goaldmine as it goes.
#
# It is NOT an unattended worker — that would require the paid API, which
# goaldmine never uses. You run this when you want reels.
#
# Setup (once):
#   1. `claude login`  on this box (uses your Max subscription).
#   2. Create ./mcp-config.json next to this script with BOTH MCP servers:
#        {
#          "mcpServers": {
#            "goaldmine":  { "type": "streamable-http",
#                            "url": "https://<your-deploy>/api/mcp",
#                            "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" } },
#            "clipforge":  { "command": "<clipforge mcp cmd>", "args": ["<...>"] }
#          }
#        }
#   3. Export GOALDMINE_PEEK_URL and GOALDMINE_MCP_TOKEN (or edit the CONFIG block).
#   4. Make sure this day's footage files are already INGESTED into the ClipForge
#      project (the bridge fails loudly on unresolved filenames).
#
# Usage:  ./render-next.sh            # picks the oldest pending job
#         ./render-next.sh 2026-06-23 # force a specific date
set -euo pipefail

# ── CONFIG ──────────────────────────────────────────────────────────────────
PEEK_URL="${GOALDMINE_PEEK_URL:?set GOALDMINE_PEEK_URL=https://<deploy>/api/render-jobs/peek}"
TOKEN="${GOALDMINE_MCP_TOKEN:?set GOALDMINE_MCP_TOKEN=<MCP_AUTH_TOKEN>}"
MCP_CONFIG="$(dirname "$0")/mcp-config.json"
# ────────────────────────────────────────────────────────────────────────────

DATE="${1:-}"
if [[ -z "$DATE" ]]; then
  PEEK="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$PEEK_URL")"
  DATE="$(printf '%s' "$PEEK" | jq -r '.nextJob.date // empty')"
  if [[ -z "$DATE" ]]; then
    echo "No days are queued for render (pendingCount=$(printf '%s' "$PEEK" | jq -r '.pendingCount'))."
    echo "Queue one from the Goaldmine Day page → Footage → 'Queue for render'."
    exit 0
  fi
  echo "Oldest pending render day: $DATE"
fi

read -r -d '' PROMPT <<EOF || true
Run the Goaldmine→ClipForge bridge for the training day ${DATE}. You have both
MCP toolsets attached: GOALDMINE and CLIPFORGE. Follow the operating procedure in
docs/integrations/goaldmine-clipforge-bridge.md (the "Make a reel from a Goaldmine
day" prompt), with these queue hooks:

1. GOALDMINE claim_render_job for the ${DATE} job (list_render_jobs status:"pending"
   to find its id; claim_render_job(id) — if claimed:false, stop, another run took it).
2. get_day_footage(${DATE}) → CLIPFORGE list_spines (capture exact slot labels) →
   list_assets → resolve filename→assetId (capturedAt tiebreaker). Unresolved
   filenames → complete_render_job(id, status:"failed", errorMessage: the list) and stop.
3. Build pins, apply_spine(maxDurationSec:30), frame_strip, write a coach-voice caption.
4. submit_render_draft(id, draftRef:<clipforge draft id>, notes:<spine + caption +
   any EPS_GUARD/POOL_CYCLED>). Then SHOW me the plan and STOP for my OK.
5. On my go-ahead: render, then complete_render_job(id, outputRef:<reel url-or-id>,
   status:"rendered"). On render error → complete_render_job(id, status:"failed", errorMessage).
EOF

echo "Launching interactive Claude (Max) for ${DATE}…"
exec claude --mcp-config "$MCP_CONFIG" "$PROMPT"
