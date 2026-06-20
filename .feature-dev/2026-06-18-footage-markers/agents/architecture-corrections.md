# Blueprint Corrections (v2) — from the Devil's Advocate

Apply these on top of `architecture-blueprint.md`. All field names verified correct; these are the required fixes before/at build.

## Backend
- **CRIT-1**: `log_footage` `capturedAt` Zod → `z.string().datetime().optional()` (enforce ISO 8601). In the MCP handler AND `logFootageMarker`, guard the parse: `const d = new Date(raw); capturedAt = isNaN(d.getTime()) ? null : d;` (never write Invalid Date). Add to the `.describe()`: "ISO 8601, e.g. '2026-06-18T09:15:00.000Z'. Blank if camera metadata unavailable."
- **DC-1**: in `footage-actions.ts`, import ONLY `{ parseDateKey }` from `@/lib/calendar` (NOT `@/lib/calendar-core`; drop the unused `dateKey as toDateKey` — `noUnusedLocals` would fail). (S-5)
- **DC-4**: add to `log_footage` description: "workoutId is resolved at call time — call this AFTER log_workout so the FK is set."
- **S-2 / AC#10**: add `src/lib/footage-core.test.ts` (vitest) — `resolveWorkoutIdForDay` returns id when a completed workout is in-window, null otherwise (mock `@/lib/db`). Plus one assertion that the canonicalization branch stores the canonical name (mock `prisma.footageMarker.create`, call the create logic, assert the data arg got `canonicalExerciseName(input)`).
- **DC-5**: in the ClipForge spec §2, note `get_day_footage` is query-heavy (full PR scan) — call once per day, not per marker.

## Frontend
- **CRIT-2**: `FootageForm` submit must be `startTransition(async () => { try { await logFootageMarker(fd); /* reset + success */ } catch (e) { setError(e instanceof Error ? e.message : String(e)); } })` — mirror `WorkoutLoggerForm` (lines ~301–313). Wire the existing `error` state.
- **DC-2**: `FootageList` delete must `startTransition(async () => { try { await deleteFootageMarker(fd); } catch (e) { /* surface */ } })` — await it; NOT `startTransition(() => deleteFootageMarker(fd))`.
- **DC-3 (RESOLVED)**: `capturedAt` is **NOT** in the Day-page form for v1 (MCP-only). Follow the wireframe; omit it from `FootageForm`. (PRD §3.1's "optional capturedAt" is struck.)
- **MR-1**: `externalRef` render policy — if shown at all, render as **muted, non-linked TEXT only**. NEVER `<a href={externalRef}>` (a stored `javascript:`/`data:` URI would be an XSS vector). Simplest: don't surface `externalRef` in `FootageList` v1.
- **MR-2**: after a successful add, show a brief inline "Added ✓" success message (reuse the error slot with a success variant), then the RSC re-render shows the new marker.

## Orchestrator (me)
- Apply the Neon migration myself after merge (additive — verify zero ALTER/DROP in the generated SQL).
- **S-4**: tell the user to disconnect/reconnect the claude.ai connector after deploy so the 3 new tools appear.
