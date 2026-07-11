# PRD: Data export (JSON) from /settings (#246)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-11
**Status**: Approved
**GitHub Issue**: #246 (Account & hardening backlog)
**Branch**: feature/phase1-auth
**UX-research**: skipped — single download-link row using existing card idioms; no design space

---

## 1. Overview

### 1.1 Problem Statement
Users can now delete their account (#245) but can't take their data with them first — the missing half of account-lifecycle completeness (GDPR data portability).

### 1.2 Premise check (2026-07-11, HEAD 6902ac6)
| Finding | Detail |
|---|---|
| Template | #232's `api/log-sheet-data/route.ts`: auth() → 401 → runWithUser; runtime nodejs; NO route-access registration needed (protected-by-default) |
| Isolation | By construction — ALS-scoped getDb() injects where.userId on all 17 SCOPED_MODELS |
| Child models | WorkoutExercise/Set (under Workout) + PlanDayOverride/PlanRevision (under Plan) have NO userId — relation includes ONLY; top-level queries would leak cross-user |
| Secrets | Structurally excluded (Account/Session/OAuth*/Invite/VerificationToken non-scoped); forbidden anti-pattern: db.account/db.session |
| **Ruling: all Note types** | standing_rule/review/open_item are the user's own rows; leaky-reads is MCP-surface, not ownership. ACTIVITY_NOTE_TYPES filter would drop the user's own data — include everything |
| No precedent | Zero ReadableStream / Content-Disposition repo-wide — net-new, trivial |
| **Open risk → DA** | Vercel response-size limit vs founder payload (planJson/snapshotJson blobs); DA estimates + rules cap-vs-stream; dev agent's dry-run script measures empirically |

### 1.3 Success Criteria
One-click JSON download of all 17 owned models (+ 4 nested children) for the session user; provably isolated; secrets structurally unreachable; explicit byte cap with a clear 413 (no silent truncation); gates green at 809+new.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Any tenant | download all my data as JSON | portability before deletion, or just a backup | Must Have |
| US-002 | Any OTHER tenant | zero of my rows in someone's export | isolation extends to reads | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `src/lib/export-data.ts`: `buildExportPayload(db)` over the passed scoped client — 17 models, `workout: {exercises: {sets}, footageMarkers}` + `plan: {revisions, overrides}` includes, createdAt-asc where sensible; `{ exportedAt, format: "goaldmine-export-v1", models }` envelope.
2. `src/app/api/export/route.ts`: #232 skeleton; serialize; DA-prescribed byte cap → 413 JSON error (never truncate); `Content-Disposition: attachment; filename="goaldmine-export-<dateKey>.json"` (USER_TZ via @/lib/calendar); no-store.
3. settings/page.tsx: "Your data" card above the danger zone; plain `<a href="/api/export" download>` (no client island).
4. `export-data.test.ts` (~6, Proxy-mock client per DA): all 17 queried; includes present; non-scoped access fails; note types unfiltered; empty user valid.

### 3.2 Out of Scope
Streaming (unless the DA's size estimate demands it now); CSV/other formats; import/restore; rate limiting (founder-scale — noted).

---

## 4. Technical Design
New lib fn + new GET route + one settings card. No schema/MCP changes. Route protected by default (middleware cookie gate + in-route auth()).

---

## 5. UI/UX
One card, one button-styled anchor; sits above Delete account (portability before destruction).

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Signed-out direct hit | Middleware 307 → /signin (browser); in-route 401 backstop |
| Brand-new user | Valid export, empty arrays |
| Payload over cap | 413 with clear JSON error, nothing truncated |
| Date fields | ISO strings via JSON.stringify (DA checks for BigInt/Bytes hazards) |

---

## 7. Security
Only the 17 scoped models touched (unit-enforced); session-derived scope via runWithUser; no query params; no-store.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] Export action on /settings → single JSON download via getDb()
2. [ ] All 17 scoped models + 4 relation-included children; no other user's rows (unit test); no OAuth/infra secrets (structural + unit test)
3. [ ] Explicit byte cap, 413 beyond it — no unbounded concat, no silent truncation
4. [ ] tsc 0 / lint no new / 809+new / build OK
5. [ ] Founder-scale dry run measures real payload size (informs/validates the cap)

---

## 9. Open Questions
DA rules: Vercel limit + cap value + stream-now-or-later; JSON.stringify hazards; Proxy-mock shape; metadata (schema/app version) inclusion.

---

## 10. Test Plan
Gates; unit suite; read-only founder dry-run script (counts + bytes); settings card render check.

---

## 11. Appendix
Template: api/log-sheet-data/route.ts (#232). Sibling: #245 delete-account (the write-side mirror). db.ts:268-270 (the four child models), db.ts:40-58 (SCOPED_MODELS).
