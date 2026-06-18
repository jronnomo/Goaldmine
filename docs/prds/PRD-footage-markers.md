# PRD: Footage Markers — tag clips to day/task/exercise for ClipForge

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-18
**Status**: Draft
**GitHub Issue**: N/A — direct-to-main
**Branch**: main

UX-research: skipped — capture-utility (a labeled add-form + a marker list) reusing existing Day-page `Card`/client-form patterns; no novel visual surface. Speed-to-usable prioritized (use-pulled: today's footage → first reel).

---

## 1. Overview

### 1.1 Problem Statement
Gabe shot a batch of footage during this morning's workout and wants ClipForge (a separate Forge-ecosystem app) to assemble the first rhino.the.grey Reel from it. ClipForge needs to know **the structure of the day** (what happened, in what order, toward what goal) and **which clip belongs to which moment** (the 24-pull-up PR set, the StairMaster B-roll, the hero shot). goaldmine already holds the day's structure; it has no way to associate footage to a task/exercise. Today the clip→moment mapping lives only in Gabe's head.

### 1.2 Proposed Solution
Add a lightweight **FootageMarker** — metadata only, **never the media bytes** (goaldmine is a $0 Postgres logger with no blob storage; video must not live here). A marker records `{ date, capturedAt?, kind, filename?, externalRef?, label, workoutId?, exerciseName?, taskType?, highlight }`. ClipForge holds the actual files and **matches them to markers by filename / capturedAt**.

Two creation paths: an **MCP write tool** (`log_footage`) so the coach can take "here are my clips: …" and tag them, plus a **Day-page capture form** for manual entry. One **MCP read tool** (`get_day_footage`) exposes the ordered day structure + markers + highlights + goal narrative — exactly what ClipForge consumes to assemble a reel. A companion **ClipForge consumer spec** documents the cross-app contract (ClipForge code lives in its own repo; not built here).

### 1.3 Success Criteria
- A marker can be created (via MCP and via the Day page) and linked to the day, optionally a workout, an exercise (by canonical name), with a highlight flag.
- `get_day_footage(date)` returns the day's structure + all its markers in a shape ClipForge can assemble a reel from, including which exercise each clip maps to and which is the hero shot.
- No media bytes stored; no new blob infra; migration is additive and Neon-safe.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run` all clean.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | user (via the coach in claude.ai) | tell the coach "tag IMG_4412.mov as the 24-pull-up PR set, hero shot" | the clip→moment mapping is captured without manual app taps | Must |
| US-002 | user on the Day page (PWA) | add a footage marker to a specific exercise of today's workout + flag the hero shot | I can organize this morning's clips against the real session | Must |
| US-003 | ClipForge (via MCP) | read the day's ordered structure + footage markers + highlights + goal context | I can assemble the first Reel, cutting to the PR set, with the right narrative | Must |
| US-004 | user | see / delete the markers on a day | I can correct mistags | Should |

---

## 3. Functional Requirements

### 3.1 Core
1. **FootageMarker** Prisma model (metadata only — no media), additive migration, optional relation to `Workout`.
2. **`log_footage`** MCP write tool: create a marker. Associates to the day's completed workout by `date` (resolves `workoutId`), accepts `exerciseName` (canonicalized via `canonicalExerciseName`), `label`, `kind`, `filename`, `externalRef`, `capturedAt`, `taskType`, `highlight`. `date: string` parsed via `parseDateInput`.
3. **`get_day_footage`** MCP read tool: given `date`, return `{ day: <structured: date, programWeek/day, goal objective + kind, the workout's exercises in order with PRs flagged, hike/baseline tasks>, markers: [<each with its exercise link, kind, filename, capturedAt, highlight, label>] }`. Ordered + grouped so ClipForge can build a sequence.
4. **`delete_footage`** MCP write tool: remove a marker by id.
5. **Day-page capture form** (`FootageForm`, client): add a marker — label, kind toggle (video/photo), an exercise picker populated from the day's workout exercises (plus "whole day / no exercise"), filename, highlight toggle, optional capturedAt. Calls a server action `logFootageMarker(formData)` → `revalidatePath`.
6. **Day-page marker display**: a "Footage" `Card` listing the day's markers, highlight badge on hero shots, delete control.

### 3.2 Secondary
7. **ClipForge consumer spec** at `docs/roadmap/clipforge-day-footage-integration.md`: the `get_day_footage` contract, the filename/capturedAt matching strategy, and the first-Reel assembly flow (ordered structure → clip resolution → highlight-first cut → goal narrative). ClipForge is a separate repo — this is design, not code.
8. **Today page** (`/`) optional shortcut: a link/affordance to add footage for today (deferred if it complicates Today — Today stays training-focused).

### 3.3 Out of Scope
- **Storing media bytes / uploads / thumbnails** — refs only. No Vercel Blob/S3.
- **Building ClipForge** — its ingestion + assembly live in its own repo; we only expose the read surface + spec.
- **Auto-detecting clips** — no camera-roll scanning; markers are user/coach-created.
- **Set-level association** — markers attach to an exercise (by name), not an individual set (sets carry no timestamps; out of scope for v1).
- **Editing markers** — v1 is create + delete; edit is a follow-up.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
```prisma
model FootageMarker {
  id           String    @id @default(cuid())
  date         DateTime  // USER_TZ midnight — the day the footage is bucketed to (parseDateInput)
  capturedAt   DateTime? // when the clip was shot (camera metadata); match/disambiguation key
  kind         String    @default("video") // "video" | "photo"
  filename     String?   // original filename — primary match key for ClipForge
  externalRef  String?   // optional URI / cloud link / ClipForge clip id
  label        String    // human caption, e.g. "24-pull-up PR — hero shot"
  workoutId    String?   // optional link to the day's Workout (the task)
  exerciseName String?   // canonicalExerciseName — links the clip to an exercise
  taskType     String?   // optional: "workout" | "hike" | "baseline" | "other"
  highlight    Boolean   @default(false) // the hero / featured shot
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  workout      Workout?  @relation(fields: [workoutId], references: [id], onDelete: SetNull)

  @@index([date])
  @@index([workoutId])
}
```
Add to `Workout`: `footageMarkers FootageMarker[]` (virtual relation; no column).

Migration:
- Name: `footage-markers`. Commands: `npx prisma migrate dev --name footage-markers` then `npx prisma generate`.
- ⚠ Neon-shared with prod — **additive only**: one new table + two indexes + a nullable FK (`onDelete: SetNull` so deleting a workout preserves markers as day-level). No change to existing tables/columns. **Review the generated SQL before it lands on Neon.**
- No backfill.

### 4.2 MCP Tool Surface
| Tool | Purpose | R/W | Notes |
|------|---------|-----|-------|
| `log_footage` | Create a footage marker | W | `date` via `parseDateInput`; `exerciseName` via `canonicalExerciseName`; resolves `workoutId` from the day's completed workout |
| `get_day_footage` | Day structure + markers for ClipForge | R | Returns ordered exercises + PRs + goal context + markers grouped by exercise |
| `delete_footage` | Remove a marker | W | by `id` |

- All handlers wrap in `safe(async () => …)`, Zod inputs with `.describe()`.
- `log_footage` inputSchema: `date` (DateKeyShape), `label` (string), `kind` (enum video/photo, default video), `filename?`, `externalRef?`, `capturedAt?` (ISO datetime string → Date), `exerciseName?`, `taskType?` (enum), `highlight?` (bool, default false).
- Return shapes: `{ id, message }` for writes; `get_day_footage` returns `{ date, day: {...}, markers: [...] }`.

### 4.3 Server Actions
| Action | File | FormData | Mutation | revalidatePath | Returns |
|--------|------|----------|----------|----------------|---------|
| `logFootageMarker` | `src/lib/footage-actions.ts` (new, `"use server"`) | date, label, kind, exerciseName?, filename?, highlight, capturedAt? | `footageMarker.create` (+ resolve workoutId) | `/days/[dateKey]`, `/` | redirect? no |
| `deleteFootageMarker` | same | id | `footageMarker.delete` | `/days/[dateKey]`, `/` | — |

### 4.4 Pages / Components
- **`src/components/days/FootageForm.tsx`** (new, client): the add-marker form. Receives the day's `exercises: {name}[]` (from the resolved/ completed workout) to populate the exercise picker. Mobile-first, `Card`-wrapped, tap targets ≥44px.
- **`src/components/days/FootageList.tsx`** (new, client or server): renders the day's markers with kind icon, exercise link, highlight badge, delete control.
- **Modify `src/app/days/[dateKey]/page.tsx`**: query `footageMarker.findMany({ where: { date } })`, render a "Footage" `CollapsibleCard` with `FootageForm` + `FootageList`. Pass the completed workout's exercise names to the form.
- No new route; no `BottomNav` change.

### 4.5 Date / Time Semantics
- `date` bucketing via `parseDateInput` (MCP) / `parseDateKey` (page) — USER_TZ midnight.
- `capturedAt` is a precise instant (camera metadata) — stored as-is (DateTime), not normalized.
- No raw `setHours/getDate/...` — all through `@/lib/calendar`.

### 4.6 Override-Awareness
- The Day page already uses `resolveDay(date)`; the footage card reads markers by `date` independently (orthogonal to overrides). The exercise picker draws from the **completed** workout (`r.workouts`) when present, else the resolved template's exercises.

### 4.7 Third-Party Dependencies
- None. No blob storage, no new packages.

---

## 5. UI/UX Specifications

### 5.1 Screen — Day page "Footage" card (390px)
```
┌──────────────────────────────┐
│ 🎬 Footage              (3)   │  ← CollapsibleCard
├──────────────────────────────┤
│ ▶ IMG_4412.mov · Pull-Ups  ★ │  ← marker: kind · exercise · highlight star
│   "24-pull-up PR — hero"  [x] │
│ ▶ IMG_4410.mov · whole day    │
│ ⊞ IMG_4408.jpg · StairMaster  │
│ ── Add footage ────────────── │
│ [ label………………………… ]          │
│ kind [▶ video][⊞ photo]       │
│ exercise [ Pull-Ups      ▼ ]  │
│ filename [ IMG_4412.mov ]     │
│ [☆ hero shot]      [ Add ]    │
└──────────────────────────────┘
```
States: empty ("No footage tagged for this day yet."), populated (list), highlight (★ badge, `var(--accent)`), error (inline).

### 5.2 Navigation
Entry via the Day page (`/days/[dateKey]`) and Today. Markers are added inline; no deep route.

### 5.3 Responsive
390px primary; ≥44px tap targets; `Card`/`CollapsibleCard`; tokens only (`var(--accent)`, `var(--muted)`, `var(--border)`, `var(--card)`).

### 5.4 Accessibility
- Form labels associated; kind/highlight toggles have `aria-pressed`; delete has a confirm; focus rings preserved; highlight conveyed by text ("hero shot") not only the star.

---

## 6. Edge Cases & Error Handling
| Scenario | Behavior |
|----------|----------|
| No workout on the day | Marker still creatable; `workoutId` null; exercise picker shows "whole day / no exercise" only |
| exerciseName not in the day's workout | Stored as given (coach knows best); not rejected |
| Duplicate filename | Allowed; ClipForge disambiguates via capturedAt |
| Marker for a day with an override | Orthogonal — markers key on `date`, unaffected |
| Workout later deleted | `onDelete: SetNull` → marker survives as day-level (workoutId null) |
| Long label/filename on 390px | Truncate with ellipsis; no overflow |
| `get_day_footage` for an empty day | Returns `{ day: {...}, markers: [] }` — no error |

---

## 7. Security
- New MCP tools behind the existing bearer-token gate; Zod-validated; no new public route.
- Server actions parse FormData defensively; Prisma type-safe writes.
- `externalRef`/`filename`/`label` are user strings rendered as text — no `dangerouslySetInnerHTML`.
- No secrets; no media bytes; no SSRF surface (goaldmine never fetches `externalRef`).

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run` all clean.
2. [ ] `FootageMarker` model added; `npx prisma migrate dev --name footage-markers` is **additive** (new table + indexes + nullable FK only — verified against the SQL); `npx prisma generate` run.
3. [ ] MCP `tools/list` returns `log_footage`, `get_day_footage`, `delete_footage` with correct titles/descriptions.
4. [ ] MCP `log_footage` with `{date, label, exerciseName, filename, highlight:true}` writes a marker, resolves `workoutId` from the day's completed workout, canonicalizes `exerciseName`.
5. [ ] MCP `get_day_footage` returns `{ date, day:{ordered exercises + PRs + goal}, markers:[…] }` with each marker's exercise link + highlight.
6. [ ] `/days/[dateKey]` renders a "Footage" card; the form adds a marker (server action → `revalidatePath`); the list shows it with a highlight badge; delete removes it.
7. [ ] All Date math via `@/lib/calendar`; `date` inputs via `parseDateInput`/`parseDateKey`.
8. [ ] No media bytes stored anywhere; no blob/storage dependency added.
9. [ ] `docs/roadmap/clipforge-day-footage-integration.md` documents the consumer contract + first-Reel flow.
10. [ ] A vitest covers `log_footage` argument handling / marker shape (mocked Prisma) — at minimum the workoutId-resolution + exerciseName canonicalization branches.

---

## 9. Open Questions
_Resolved in discovery (2026-06-18):_
- **Media storage?** → Refs only (filename + capturedAt); ClipForge holds bytes, matches by filename/time. No blob storage.
- **Granularity?** → day + optional task + optional exercise (by name) + highlight.
- **Input paths?** → both MCP (`log_footage`) and a Day-page form.
- **Scope?** → goaldmine side (model + UI + MCP read) **plus** a ClipForge consumer spec doc.

---

## 10. Test Plan
### 10.1 Gates
tsc / lint / build / vitest — clean.
### 10.2 MCP curl
`tools/list` (3 new tools); `log_footage` (write + workoutId resolution); `get_day_footage` (shape); `delete_footage`.
### 10.3 Browser
`/days/2026-06-18` at 390px: add a marker to an exercise + hero flag → appears with badge → delete. Cross-check `get_day_footage` curl matches the UI.
### 10.4 Migration
`prisma migrate dev` SQL reviewed (additive); `src/generated/prisma` regenerated; existing rows unaffected.

---

## 11. Appendix
### 11.1 Discovery Notes
- goaldmine = structured index; ClipForge = footage store + editor. Boundary kept clean (refs only).
- Workout has `startedAt` (workout-level time); `Set`/`WorkoutExercise` carry **no** timestamps → exercise-level association needs an explicit marker (this feature), set-level is out.
- Day page (`src/app/days/[dateKey]/page.tsx`) is card-based on `resolveDay`; `canonicalExerciseName` in `src/lib/records.ts`; MCP write pattern per `log_note`.
### 11.2 References
- Forge content-engine vision: `/Users/ggronnii/Development/instagram-page-plan.md` ("your apps ARE the content engine").
- Memory: `multi-domain-vision`, `dev-pause-for-use` (use-pulled build).
