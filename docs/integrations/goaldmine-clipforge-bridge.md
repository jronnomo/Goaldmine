# Goaldmine → ClipForge bridge

**Status:** living doc — keep in sync as `get_day_footage` / `apply_spine` evolve.
**Companion:** [`docs/roadmap/clipforge-day-footage-integration.md`](../roadmap/clipforge-day-footage-integration.md) (the ClipForge consumer spec).

Turns one curated training **day** in Goaldmine into a draft **Reel** in ClipForge,
letting **human curation drive the cut** instead of CLIP guessing on visually-similar
footage.

---

## How it works (agent-mediated — no glue code)

The bridge is **not a service**; it's one Claude with **both MCP connectors attached**
(Goaldmine remote + ClipForge local, on the GPU box) running the operating prompt below.
Claude is the glue: it reads Goaldmine's curation and emits ClipForge `apply_spine` pins.

### Flow (rooted at the Goaldmine Day page — the source of truth)

```
1. Goaldmine Day page → tag footage markers   (WHAT each clip is; the human decides)
2. The actual files land on the GPU box        (Goaldmine stores references, not bytes)
3. Ingest those files into a ClipForge project (so list_assets can match by filename)
4. Bridge: get_day_footage → map markers → pins → apply_spine → frame_strip → render
```

Goaldmine is the manifest + curation; ClipForge holds the bytes and renders. The join key
is the **filename** (capturedAt is the tiebreaker).

---

## Verified contract (2026-06-19)

**Goaldmine `get_day_footage(date)` returns:**

```jsonc
{
  "day": {
    "programWeek": 7, "programDay": 2,
    "goal": { "objective": "Summit Mt. Elbert…", "kind": "fitness" },
    "exercises": [ { "name": "Pull-Up", "order": 0, "isPR": true }, … ],
    "taskType": "workout"
  },
  "markers": [
    { "id", "label", "kind", "filename", "externalRef",
      "capturedAt" /* ISO|null */, "exerciseName", "highlight" }, …
  ]
}
```

**ClipForge `apply_spine` pin (`PinSchema`, `packages/contracts/src/job.ts`):**

```ts
{ slot: string /* spine slot LABEL — exact match */, assetId: string,
  inSec?: number, outSec?: number, position?: "lead" | "member" }
// apply_spine(projectId, spineId, assetIds, pins[], maxDurationSec?=30)
```

**The mapping (every pin field is derivable — via the bridge, not a field match):**

| Pin field        | From                                      | How                                                           |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `assetId`        | `marker.filename`                         | resolve via ClipForge `list_assets` (capturedAt = tiebreaker) |
| `slot`           | `exerciseName` / `highlight` / `taskType` | bridge → a spine slot **label**, read from `list_spines`      |
| `position`       | `marker.highlight`                        | `true` → `"lead"`, else `"member"`                            |
| `inSec`/`outSec` | — (Goaldmine has none)                    | omit → ClipForge picks the peak window inside the asset       |

**Two things to get right (the only fragile joins):**

1. **`slot` is a LABEL STRING, matched exactly** — NOT an index. The bridge must read the
   chosen spine's actual slot labels from `list_spines` and use them verbatim (case-exact).
   A wrong/invented label silently fails to place.
2. **`filename` → `assetId`** requires the files ingested first; watch for macOS
   narrow-no-break-space filenames and renames. capturedAt disambiguates duplicates.

**Confirm on the first live run:** an `assetId`-only pin (no in/out) should trigger
ClipForge's peak-moment selection _within_ that asset (pick the rep), not grab the whole
clip. Verify against the current `spine_fill` pin-resolution.

---

## The operating prompt (paste to the Claude on the GPU box, both connectors attached)

```
# Make a reel from a Goaldmine day (Goaldmine → ClipForge bridge)

You have two MCP toolsets: GOALDMINE (get_day_footage, …) and CLIPFORGE
(list_spines, list_assets, analyze_asset, apply_spine, frame_strip, render, …).
Turn one curated training day into a draft Reel, letting Goaldmine's HUMAN curation
drive the cut. Propose the plan and STOP for my OK before render.

## Preconditions
- The day's footage markers are already tagged in GOALDMINE (Day page → Footage).
  Goaldmine is the source of truth for *what each clip is*. This prompt consumes
  that curation; it does not create it.
- The day's actual video files are on this machine and ingested into a CLIPFORGE
  project (so list_assets can match them by filename). Note the projectId.
- I'll give you the DATE (default: today).

## Steps
1. GOALDMINE get_day_footage(date) →
   { day:{ goal{objective,kind}, exercises[{name,order,isPR}], taskType },
     markers[{ filename, capturedAt, exerciseName, highlight, kind, label }] }

2. CLIPFORGE list_spines → choose the spine that FITS the day's footage:
   - gym-only day  → a tight spine (hook → grind → payoff → resolve)
   - mixed (gym + hike/travel/scenery) → a fuller adventure spine
   ⚠ CRITICAL: capture that spine's EXACT slot LABEL strings verbatim. Pins match
   slots BY LABEL STRING (PinSchema.slot is the label, not an index). An invented
   or mis-cased label silently fails to place.

3. CLIPFORGE list_assets(projectId) → resolve each marker: match marker.filename to
   an asset name → assetId. Duplicate filenames → disambiguate by capturedAt (±30s).
   Unresolved marker → list it, continue, don't guess.

4. Build the pins array. Exact contract per pin:
     { slot: "<EXACT spine slot label from step 2>",
       assetId: "<from step 3>",
       position: "lead" | "member" }     // omit inSec/outSec — ClipForge picks the window
   Mapping from the curation:
   - marker.highlight == true → position:"lead", slot = the opening/peak label
     (hook for an action/PR moment; payoff for a result shot).
   - marker.exerciseName set, taskType=="workout" → position:"member", a grind/work
     label; sequence by day.exercises[].order.
   - hike/scenery/B-roll (taskType=="hike" or exerciseName==null) → member pins in
     adventure/reflect/summit labels.
   - Clips with no curation: leave UNPINNED — apply_spine fills remaining slot
     capacity from the pool with its own scoring.

5. CLIPFORGE apply_spine(projectId, spineId, assetIds, pins, maxDurationSec: 30).
   (assetIds = all the day's resolved assets; pins = the curated subset.)

6. Verify before render: frame_strip the draft. Confirm the hero opens, the order
   tracks the day's arc, and report any slot whose spineNotes flags EPS_GUARD /
   POOL_CYCLED (CLIP fell back to quality-only / reused clips) — those slots are
   the most likely wrong; offer to pin more or swap the spine.

7. Caption: short, coach-voiced, from day.goal.objective + the highlight label
   (e.g. "Week 7. The mountain's closer — 24-pull-up PR."). Destination-agnostic.

## Output (STOP here for my OK)
Show: chosen spine + why · the pins array (filename → slot label → lead/member) ·
unresolved filenames · EPS_GUARD/POOL_CYCLED slots · the frame_strip + caption.
Only render(projectId, preset) on my go-ahead.
```

---

## Wiring checklist (first live run, on the GPU box)

- [ ] Markers tagged for the day in Goaldmine (Day page → Footage).
- [ ] The day's files copied to the GPU box and ingested into a ClipForge project.
- [ ] BOTH connectors attached to one Claude: Goaldmine (remote URL + bearer) + ClipForge (local).
- [ ] Spine slot labels read from `list_spines` and used verbatim in pins.
- [ ] `filename` → `assetId` resolves for every curated marker (capturedAt tiebreaker).
- [ ] Confirm `assetId`-pin → peak-moment-within-asset behavior.

---

## Automated flow (render queue — Goaldmine side shipped 2026-06-24)

The manual operating prompt above is now backed by a **render-job queue** so a curated day
can be rendered by a standing worker on the GPU box instead of pasting the prompt by hand.
Full design: [`docs/roadmap/clipforge-auto-render-plan.md`](../roadmap/clipforge-auto-render-plan.md).
The architecture is **pull, not push** (MCP can't push into a live session): Goaldmine holds
the queue; the GPU-box worker **polls** it.

**Lifecycle:** `pending → claimed → drafted → approved → rendering → rendered` (+ `failed`).

### Goaldmine surface (shipped — Epic A)

- **Day page → Footage card:** "Queue for render" (enter the ClipForge `projectId` the day's
  files were ingested into) creates a `DayRenderJob(pending)`. An "Approve render" button
  appears on `drafted`; the finished reel link shows on `rendered`. The `drafted` badge IS
  the notification (no push infra in v1).
- **MCP tools (the worker's interface):** `queue_render_job`, `list_render_jobs`,
  `claim_render_job` (atomic pending→claimed), `submit_render_draft`, `start_render_job`
  (atomic approved→rendering), `complete_render_job(outputRef, status)`.
- **`GET /api/render-jobs/peek`** (bearer auth) → `{ pendingCount, nextJob, approvedCount,
  nextApprovedJob }` — the cheap cron poll so the worker only wakes Claude when there's work.
- **Stale-claim reaper:** jobs stuck in `claimed`/`rendering` past 30 min reset to
  `pending`/`approved` (runs inside the peek handler).

### Worker (Epic B — NOT yet built; runs on the GPU box, subscription-auth)

Split-run, **never long-polls** for approval:

1. **Draft run** (cron sees `pending`): `claim_render_job` → run the operating prompt above
   (`get_day_footage` → pins → `apply_spine` → `frame_strip` → caption) → `submit_render_draft`
   → exit.
2. *(You click "Approve render" in Goaldmine → `approved`.)*
3. **Render run** (cron sees `approved`): `start_render_job` → ClipForge `render` →
   `complete_render_job(outputRef)`.

Guardrails: authenticate with the Claude **subscription** (no API key → $0 beyond Max — a
goal, not a guarantee; see plan R3); the worker **never computes dates** (all dates come
verbatim from Goaldmine MCP responses); files must be ingested into the ClipForge project
before queuing (unresolved filenames fail the job loudly).
