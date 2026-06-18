# ClipForge × goaldmine — Day Footage Integration Spec

**Version**: 1.0  
**Date**: 2026-06-18  
**Status**: Draft — ClipForge implementation reference  
**Boundary**: goaldmine is the structured index; ClipForge is the footage store + editor.  
Media bytes never cross via goaldmine — refs only.

---

## §1 Overview

goaldmine holds the structure of every training day: the week/day in the program, which exercises were performed, which set was a PR, the goal narrative, and any footage markers the user (or coach) tagged to that day.

ClipForge is a separate Forge-ecosystem app. It holds the actual media files and assembles them into Reels. goaldmine exposes a single MCP read tool — `get_day_footage` — that gives ClipForge everything it needs to sequence and caption a Reel for a given day.

**Boundary rules**:
- goaldmine stores filenames and optional external refs as opaque strings. It never fetches them.
- ClipForge resolves filenames to files on its local library / cloud storage.
- No media bytes, thumbnails, or signed URLs are stored in goaldmine's database.

---

## §2 `get_day_footage` Contract

### Endpoint

```
POST https://<goaldmine-host>/api/mcp
Authorization: Bearer <MCP_AUTH_TOKEN>
Content-Type: application/json
Accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_day_footage",
    "arguments": { "date": "2026-06-18" }
  }
}
```

`date` is `yyyy-mm-dd` in the user's local time zone (America/Denver default).

### Response shape

```jsonc
{
  "date": "2026-06-18",               // string yyyy-mm-dd
  "day": {
    "programWeek": 3,                 // number | null (null if outside plan range)
    "programDay": 2,                  // number | null (rotation day index)
    "goal": {                         // null if no active focus goal
      "objective": "Summit Mt. Elbert via Black Cloud Trail",
      "kind": "fitness"               // "fitness" | "project"
    },
    "exercises": [                    // from completed workout, ordered by orderIndex
      { "name": "Pull-Up",      "order": 0, "isPR": true  },
      { "name": "Goblet Squat", "order": 1, "isPR": false }
    ],
    "taskType": "workout"             // "workout"|"rest"|"baseline"|"hike"|"out_of_plan"
  },
  "markers": [                        // highlight-first, then capturedAt asc, then createdAt asc
    {
      "id":           "clxxxx",
      "label":        "24-pull-up PR — hero shot",
      "kind":         "video",        // "video" | "photo"
      "filename":     "IMG_4412.mov", // string | null — primary match key
      "externalRef":  null,           // string | null — opaque ref, may be a ClipForge clip id
      "capturedAt":   "2026-06-18T09:15:00.000Z", // ISO string | null
      "exerciseName": "Pull-Up",      // string | null — canonical exercise name
      "highlight":    true            // boolean — hero shot flag
    }
  ]
}
```

### Field semantics

| Field | Type | Notes |
|-------|------|-------|
| `date` | `string` | Day bucket key (`yyyy-mm-dd`). |
| `day.programWeek` | `number \| null` | Week number in the active plan. `null` if the date is outside the plan range. |
| `day.programDay` | `number \| null` | Rotation day index within the week. |
| `day.goal` | `object \| null` | The user's current focus goal. Use `objective` as the Reel's opening-card narrative. |
| `day.exercises[].order` | `number` | Use as the sequence index for ordering clips within the Reel. |
| `day.exercises[].isPR` | `boolean` | If `true`, apply a "PR" badge in the Reel caption for this exercise. |
| `day.taskType` | `string` | The day's primary task type. Useful for Reel template selection (workout vs hike vs rest day). |
| `markers[].filename` | `string \| null` | Primary match key — search ClipForge's file library by this name. |
| `markers[].capturedAt` | `string \| null` | ISO 8601 UTC instant from camera metadata. Used as the disambiguation key when filename collides. `null` when camera metadata was not provided at tag time. |
| `markers[].highlight` | `boolean` | Hero shot flag. ClipForge should lead the Reel with this clip. At most one marker per day is expected to be `true`, but this is not enforced by goaldmine. |
| `markers[].externalRef` | `string \| null` | Opaque user-supplied string. May be a ClipForge clip id (check for `cf_` prefix), a cloud URL, or freeform text. Do NOT auto-fetch URLs — present as a reference link if shown. |
| `markers[].exerciseName` | `string \| null` | Canonical exercise name — matches `day.exercises[].name`. `null` for whole-day / B-roll clips. |

> **Performance note**: `get_day_footage` runs a full exercise-summaries scan to compute `isPR` flags.
> This is a query-heavy operation for a single-user app. Call it **once per day** to build the Reel context —
> do not call it per-marker or in a loop across multiple days.

---

## §3 Filename → File Matching Algorithm

ClipForge resolves each marker to a local file using the following strategy:

1. **Primary lookup**: search ClipForge's local file library for a file whose name exactly matches `marker.filename`.
2. **Exactly one match** → resolved. Proceed to assembly.
3. **Zero matches** (file renamed or not yet ingested) → mark as `{ file: null, status: "unresolved" }`; surface to user for manual location.
4. **Multiple matches** (duplicate filenames on different days): disambiguate by `capturedAt`.
   - Find the file whose EXIF/capture timestamp falls within ±30 seconds of `marker.capturedAt`.
   - Exactly one match → resolved.
   - No match or `capturedAt` is `null` → include as `{ file: null, candidates: [...] }` and prompt the user to select.
5. **`externalRef` resolution**:
   - If the value begins with `cf_`, treat as a ClipForge clip id — resolve directly by id.
   - If it is a URL, present as an external reference link. **Do not auto-fetch.**
   - Otherwise, treat as a freeform annotation — display alongside the marker.

---

## §4 First-Reel Assembly Flow

1. Call `get_day_footage({ date })`.
2. For each marker, run the §3 matching algorithm to resolve `file`.
3. Order clips for the Reel sequence:
   - **a.** The `highlight: true` marker (if any) goes first — hero shot → opening clip.
   - **b.** Non-highlight markers ordered by exercise sequence: find the matching exercise in `day.exercises[]` by `exerciseName`; sort by `exercises[].order` ascending.
   - **c.** Within the same exercise, sort by `capturedAt` ascending (`null`-last).
   - **d.** Markers with `exerciseName: null` (whole-day / B-roll) go last.
4. **Opening card text**: `day.goal.objective` — the goal narrative caption. Omit if `day.goal` is `null`.
5. **Per-clip label**: `"{exerciseName}"` + `" · PR"` if `isPR` + `" · ★"` if `highlight`.
6. **Output**: ordered array of `{ file, label, exerciseName, isPR, highlight, capturedAt }`.

---

## §5 Null / Edge Cases

| Scenario | Behavior |
|----------|----------|
| `markers: []` | Return an empty Reel with the goal narrative opening card only (not an error). |
| `day.goal: null` | Omit the goal narrative opening card. |
| `day.exercises: []` | No completed workout on the day. Markers with `exerciseName` set are associated by name only (no order info). Treat as whole-day clips. |
| Unresolved file (§3 step 3) | Include in output as `{ file: null, status: "unresolved" }`; ClipForge prompts user to locate it. |
| Multiple matches, `capturedAt: null` (§3 step 4) | Include as `{ file: null, candidates: [...] }`; ClipForge prompts user to select. |
| `externalRef` is a `javascript:` or `data:` URI | Do not eval or render as a link. Display as muted text only. |
| `highlight: true` on multiple markers | Use the first one (after `capturedAt` asc sort within the highlight group) as the opening clip. |

---

## §6 Adding Markers (for reference)

Markers are created from two surfaces:

- **Via the coach in claude.ai**: `log_footage` MCP write tool. The coach tags clips during a session debrief — "tag IMG_4412.mov as the 24-pull-up PR set, hero shot."
- **Via the Day page in the goaldmine PWA**: `FootageForm` server action — manual tap entry on `/days/[dateKey]`.

Both paths resolve `workoutId` automatically from the day's completed workout.  
`capturedAt` is MCP-only for v1 (not surfaced in the Day-page form).

To delete a marker: `delete_footage({ id })` — permanent, no undo.
