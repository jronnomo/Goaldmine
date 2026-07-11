# Devil's Advocate critique — #246 data export

**Verdict: APPROVE-WITH-CONDITIONS**

Two CONFIRMED correctness/completeness bugs must be fixed before merge (FootageMarker
double-nesting ambiguity, byte-cap using string `.length` instead of UTF-8 byte length).
Everything else in the design (relation names, scoped-client include behavior, JSON.stringify
hazards, dateKey/TZ safety) checks out against the schema and live code. The open risk the
PRD flagged for me (Vercel size limit vs. founder payload) is resolved empirically below —
**a bounded in-memory build with a 4,000,000-byte cap is safe now**; streaming is not required
for this ship, but I give a concrete numeric trigger for revisiting that.

---

## Attack 1 — Vercel response-size limit vs. founder payload (THE open risk)

**Verdict: cap-based (non-streaming) approach is safe now. Cap = 4,000,000 bytes (4 MB).**

### Platform limit
Vercel Serverless Functions (Node.js runtime, which this route must use — Prisma needs
`runtime = "nodejs"`, same as `api/log-sheet-data/route.ts:20` and `api/mcp/route.ts`) have a
**4.5 MB response body limit**, inherited from the underlying AWS Lambda synchronous-invocation
payload cap, uniform across Hobby/Pro/Enterprise. This is a platform fact from my training
knowledge, not something present in the local `node_modules/next/dist/docs` (those only cover
the OSS Next.js body-parser default of 4 MB for the *Pages Router* API routes —
`node_modules/next/dist/docs/02-pages/.../07-api-routes.md:159` — which is a different,
irrelevant knob; this route is an App Router route handler with no `bodyParser` config surface).
**I could not re-verify the 4.5 MB figure against a locally-fetchable Vercel doc in this
read-only pass — the dev agent should sanity-check it against vercel.com/docs/functions/limitations
before finalizing, but should not need to change the cap value unless that number is wrong.**

### Empirical founder payload (ground truth, not estimate)
I ran the *actual* `buildExportPayload` shape (17 models, the exact includes from the PRD)
against the live dev DB (founder user, `usr_founder`, ~2.3 months of real usage, 2026-05-02 →
2026-06-30) using the raw `prisma` client (unscoped, read-only — no writes performed):

| Model | Rows | JSON bytes |
|---|---|---|
| workout (+exercises+sets+footageMarkers) | 77 | 292.8 KB |
| plan (+revisions×28+overrides×53) | 3 | **682.1 KB** |
| nutritionLog | 255 | 169.5 KB |
| note | 80 | 127.4 KB |
| goal | 7 | 34.6 KB |
| scheduledItem | 31 | 29.3 KB |
| baseline | 38 | 14.7 KB |
| hike | 14 | 12.2 KB |
| foodUsage | 38 | 10.8 KB |
| program | 1 | 10.0 KB |
| measurement | 48 | 10.0 KB |
| bodyMetric | 22 | 4.4 KB |
| logEntry | 10 | 5.4 KB |
| mobilityCheckin | 4 | 1.4 KB |
| gameBonusXp | 1 | 0.3 KB |
| footageMarker (top-level, see Attack 4) | 0 | 0.0 KB |
| dayRenderJob | 0 | 0.0 KB |
| **Full envelope (all 17 + envelope wrapper)** | | **1,438,830 bytes = 1.372 MB** |

`Plan` dominates: **not** because `planJson` is huge (measured 13.8–19.1 KB per plan, not the
PRD's guessed ~64 KB) but because of **`PlanRevision.snapshotJson` count** — 28 revisions
already exist for 3 plans in 2.3 months (avg 17.75 KB/revision, min 13.1 KB, max 21.1 KB). Every
plan edit clones the *full* plan state into a new revision row with no cap or pruning
(`prisma/schema.prisma:422-436`) — this is the actual unbounded-growth vector, not the raw row
tables.

### Growth trajectory and the real risk
1.372 MB today against a 4.5 MB hard ceiling means the founder is at ~30% of the limit after
~10 weeks of active (unusually heavy — 28 revisions is a lot) use. Extrapolating current revision
churn (28 rev / 2.3 mo ≈ 12/mo × 17.75 KB ≈ 213 KB/mo from `PlanRevision` alone) plus proportional
growth in workout/nutrition/note rows, the founder's export is on a trajectory to approach 4 MB
within roughly a year of continued use at this pace — this is a real, foreseeable failure mode
for *this specific app's heaviest user*, not a hypothetical.

### Ruling
- **Do not build streaming now.** It's not required by the current numbers (1.37 MB / 4.5 MB),
  and it conflicts with the PRD's stated simplicity goal (plain `<a href download>`, no client
  island) — a streamed response can't be `Content-Length`-known upfront and complicates the
  413 pre-check.
- **Cap = 4,000,000 bytes (4 MB)**, checked against the *actual serialized byte length* (see
  Attack-1b below for why this must not be `string.length`). This leaves ~500 KB / 11% headroom
  below the platform's 4.5 MB ceiling for HTTP framing/header overhead, while giving ~2.9x
  runway over today's measured payload.
- **Escalation rule for the dev agent**: keep the dry-run script from PRD §10 ("Test Plan") as a
  permanent, rerunnable script (e.g. `scripts/export-dry-run.ts`, read-only, no `db:guard` write
  gate needed since it's non-destructive) that prints total bytes and the per-model breakdown
  table above. **If a future run of that script measures >2.5 MB (60% of cap) for any user,
  that is the trigger** to either (a) cap `PlanRevision` history in the export to the most recent
  N revisions with a documented "older revisions summarized/omitted" note, or (b) implement
  NDJSON/chunked streaming. Don't build either speculatively now.

---

## Attack 2 — JSON.stringify hazards

**Verdict: clear, no hazards.**

`grep -n "BigInt\|Bytes\|Decimal" prisma/schema.prisma` returns zero matches across all 30
models — no field type that `JSON.stringify` throws on or silently mangles (BigInt throws;
`Bytes`/`Decimal` would serialize as unexpected shapes). All monetary/measurement fields use
plain `Float`/`Int`.

`Json` fields (`NutritionLog.items`, `Goal.targets/references/legend/coachFeasibility/
attributionHints`, `Plan.planJson/lintAcknowledgements`, `PlanDayOverride.workoutJson/
baselineTestNames/nutritionPlan`, `PlanRevision.snapshotJson`, `ScheduledItem.payload`,
`LogEntry.payload`, `Program.planJson`, `DayRenderJob.payload`) deserialize from Prisma as plain
JS values (object/array/string/number/null) — no special wrapper type — confirmed by my probe
actually running `JSON.stringify()` over all 17 models including every `Json` field with zero
errors and byte counts matching expectations.

`DateTime` fields deserialize to native `Date` objects; `JSON.stringify` auto-invokes
`.toJSON()` → ISO-8601 string. Confirmed working end-to-end in the probe (`exportedAt` and every
row's `createdAt`/`date`/`startedAt` etc. all serialized cleanly).

---

## Attack 3 — dateKey import in a route

**Verdict: clear, filename will be USER_TZ-correct, not UTC-shifted.**

`src/lib/calendar-core.ts:83-86` — `dateKey(d)` formats via `Intl.DateTimeFormat("en-CA", {
timeZone: USER_TZ, ... })` (line 16-25), never touches `d.getUTCDate()`/raw ISO slicing. `USER_TZ`
(`calendar-core.ts:14`) is `process.env.USER_TZ ?? "America/Denver"`. The file's header comment
(lines 1-12) explicitly documents it as pure (no `@/lib/db`/prisma import, no `"use server"`) so
it's safe to import in any context, client or server.

**One efficiency nit (not a blocker):** the PRD says "dateKey from `@/lib/calendar`" — but
`@/lib/calendar.ts:4` imports `prisma`/`getDb` and transitively pulls in `program.ts`,
`records.ts`, `goal-events.ts`, `goal-conflicts.ts`, `nutrition-plan.ts`. The route already needs
`@/lib/db` for `runWithUser`, so this doesn't break anything, but it's needless module-graph
weight for a route that only wants a date string. **Import `dateKey` from
`@/lib/calendar-core` directly**, not `@/lib/calendar`.

---

## Attack 4 — Include shapes: exact relation field names (verified against schema.prisma)

**Verdict: all names in the PRD are exactly correct — but there's a real completeness bug
adjacent to them (see 4b).**

| Parent | Relation field | Type | Schema line |
|---|---|---|---|
| `Workout` | `exercises` | `WorkoutExercise[]` | `schema.prisma:69` |
| `Workout` | `footageMarkers` | `FootageMarker[]` | `schema.prisma:70` |
| `WorkoutExercise` | `sets` | `Set[]` | `schema.prisma:86` |
| `Plan` | `revisions` | `PlanRevision[]` | `schema.prisma:376` |
| `Plan` | `overrides` | `PlanDayOverride[]` | `schema.prisma:377` |

No typos, no tsc break risk. Use exactly:
```ts
db.workout.findMany({
  include: { exercises: { include: { sets: true } }, footageMarkers: true },
  orderBy: { createdAt: "asc" },
})
db.plan.findMany({
  include: { revisions: true, overrides: true },
  orderBy: { createdAt: "asc" },
})
```

### 4b — CONFIRMED bug: FootageMarker is double-homed and will be silently incomplete

`FootageMarker` is one of the **17 SCOPED_MODELS** in `src/lib/db.ts:43` (it has its own
`userId String?` — `schema.prisma:133` — and its own isolation index `@@index([userId, date])`
— `schema.prisma:142`). It is *also* nested under `Workout.footageMarkers`. But
`FootageMarker.workoutId` is **nullable** (`schema.prisma:129`, comment: "optional link to the
day's Workout") and the model carries a `taskType` field distinguishing `"workout" | "hike" |
"baseline" | "other"` (`schema.prisma:131`) — meaning footage clips can exist that are **not**
attached to any Workout row at all (hike footage, baseline-test footage, general footage).

If the implementer reads the PRD's phrasing ("`workout: include {..., footageMarkers: true}`")
and concludes the nested include "covers" FootageMarker — and skips a separate top-level
`db.footageMarker.findMany(...)` — then **any footage clip with `workoutId: null` (or pointing
to a hike/baseline/other-tagged capture) silently vanishes from the export**, while the export
still claims "all 17 scoped models" per PRD Acceptance Criterion #2. This is exactly the kind of
gap a unit test asserting "17 models queried" would NOT catch, because the top-level query for
FootageMarker either doesn't happen, or happens but the reviewer doesn't realize the nested
copy under `workout[]` is not equivalent/complete.

Founder-scale currently has 0 FootageMarker rows (feature is unused so far), so this bug is
invisible in dry-run testing — it will only surface once footage logging is used for hike/other
captures, at which point it's a silent, undetected data-portability gap (exactly the failure mode
GDPR portability exists to prevent).

**Exact instruction:** add `footageMarker: await db.footageMarker.findMany({ orderBy: {
createdAt: "asc" } })` as its own **top-level key** in the `models` envelope object, in addition
to the nested `workout[].footageMarkers`. Accept the minor duplication (unlinked footage appears
once top-level; workout-linked footage appears both top-level and nested under its workout) —
this is the safe, complete choice and costs nothing at current 0-row footage volume. Do **not**
drop the nested include either — day-detail readers of the export benefit from seeing footage
in context under its workout.

---

## Attack 5 — Scoped-client include behavior (db.ts:120-196, 213-236)

**Verdict: clear, no interference, no recursion risk.**

`injectUserId` (`src/lib/db.ts:149-196`) only mutates `args.where` / `args.data` / `args.create`
for the *top-level* model+operation pair passed into `$allOperations`. It never touches
`args.include`. Prisma's `$extends` `$allOperations` hook fires exactly once per outer
client-method call — a `findMany({ include: {...} })` compiles to one extension invocation with
the include payload passed through untouched; nested relation fetches are not separate
"operations" from the extension's perspective (that only applies to `$allOperations`; the file's
own "CRITICAL LIMITATION" comment at `db.ts:365-370` is specifically about nested **writes**
inside `create`, not reads/includes — different mechanism, doesn't apply here).

This is already proven in production, not just theoretically: `src/lib/calendar.ts:857-861`
(`resolveDay`, called by `get_day`/`get_today_plan` on every session) already does
`db.workout.findMany({ include: { exercises: { select: { id: true } } } })` against the
ALS-scoped `getDb()` client today. The export's heavier `exercises: { include: { sets: true } }`
is the identical mechanism one level deeper — same code path, same guarantee.

Since `WorkoutExercise`/`Set`/`PlanDayOverride`/`PlanRevision` are **not** in `SCOPED_MODELS`
(confirmed: they have no `userId` column — `schema.prisma:77-104`, `390-436`), they correctly
rely entirely on the parent's `userId`-scoped `where` + FK traversal for isolation, exactly as
`db.ts:268-270`'s doc comment states. No gap here.

---

## Attack 6 — Proxy-mock test design

No existing repo precedent uses a `Proxy`-based db mock (`log-sheet-data.test.ts` and
`delete-account.test.ts` both use plain object mocks with only the specific models/methods they
touch pre-defined — `src/lib/log-sheet-data.test.ts:8-17`, `src/lib/auth/delete-account.test.ts:34-41`).
The PRD's ask (assert *only* the 17 expected models are touched, and that `db.account`/
`db.session` access throws) needs a `Proxy` specifically because a plain object mock would just
return `undefined` on an unexpected property access (silently passing) rather than failing loud.

**Exact mock skeleton:**

```ts
// src/lib/export-data.test.ts
const EXPECTED_MODELS = [
  "workout", "measurement", "footageMarker", "baseline", "note", "hike",
  "nutritionLog", "mobilityCheckin", "goal", "program", "gameBonusXp",
  "bodyMetric", "scheduledItem", "logEntry", "plan", "dayRenderJob", "foodUsage",
] as const;

const { mockFindManyByModel, accessedModels } = vi.hoisted(() => {
  const mockFindManyByModel = new Map<string, ReturnType<typeof vi.fn>>();
  const accessedModels = new Set<string>();
  return { mockFindManyByModel, accessedModels };
});

function buildMockDb() {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        accessedModels.add(prop);
        if (!EXPECTED_MODELS.includes(prop as (typeof EXPECTED_MODELS)[number])) {
          throw new Error(`export-data touched unexpected model "${prop}" — not in the 17 scoped models`);
        }
        if (!mockFindManyByModel.has(prop)) {
          mockFindManyByModel.set(prop, vi.fn().mockResolvedValue([]));
        }
        return { findMany: mockFindManyByModel.get(prop) };
      },
    },
  );
}
```

Tests to write against this (matches PRD §3.1's "~6 tests"):
1. All 17 `EXPECTED_MODELS` keys are present in `accessedModels` after calling
   `buildExportPayload(mockDb)` — asserts nothing is skipped.
2. `mockFindManyByModel.get("workout")` was called with
   `expect.objectContaining({ include: { exercises: { include: { sets: true } }, footageMarkers: true } })`.
3. `mockFindManyByModel.get("plan")` was called with
   `expect.objectContaining({ include: { revisions: true, overrides: true } })`.
4. Accessing `mockDb.account` or `mockDb.session` (simulate via
   `expect(() => (buildMockDb() as any).account).toThrow()`) throws — proves the Proxy's
   allowlist behavior, standing in for "buildExportPayload structurally cannot reach
   non-scoped/secret models even if someone typos one in later."
5. `Note` rows returned unfiltered regardless of `type` (feed a `standing_rule`-typed row
   through the mock, assert it appears in `models.note` — the PRD's explicit ruling that
   ACTIVITY_NOTE_TYPES filtering must NOT apply here).
6. Empty user (`findMany` returns `[]` for every model, the default) → `buildExportPayload`
   resolves with `models.workout === []` etc., no throw — "brand-new user" edge case.

Keep the Proxy itself dumb (throw-on-unknown + auto-vend `findMany` mocks) — resist the urge to
make it a full multi-method mock; `buildExportPayload` per the PRD only ever calls `findMany`.

---

## Attack 7 — Ordering (createdAt on all 17?)

**Verdict: yes, uniformly. No per-model exception list needed.**

Checked every one of the 17 `SCOPED_MODELS` in `schema.prisma`: all 17 declare
`createdAt DateTime @default(now())`.

| Model | createdAt line |
|---|---|
| Workout | 66 | Measurement | 113 | FootageMarker | 134 | Baseline | 154 |
| Note | 183 | Hike | 208 | NutritionLog | 236 | MobilityCheckin | 253 |
| Goal | 289 | ScheduledItem | 320 | LogEntry | 342 | Plan | 373 |
| Program | 449 | GameBonusXp | 465 | FoodUsage | 512 | BodyMetric | 533 |
| DayRenderJob | 558 | | | | |

**Exact instruction:** `orderBy: { createdAt: "asc" }` on all 17 top-level `findMany` calls,
uniformly, no exceptions.

For the 4 nested children (not top-level, so this doesn't affect the PRD's "17 models" claim,
but affects export readability — recommend, not required):
- `WorkoutExercise` has `orderIndex Int` (`schema.prisma:83`) — order by that, not creation, so
  the exported exercise order matches the session's actual set order:
  `exercises: { orderBy: { orderIndex: "asc" }, include: { sets: { orderBy: { setIndex: "asc" } } } }`
  (`Set.setIndex` — `schema.prisma:95`).
- `PlanDayOverride` has no `createdAt` visible in the include shape's use case — order by `date`
  (its natural key, `@@unique([planId, date])` — `schema.prisma:413`), not `createdAt`:
  `overrides: { orderBy: { date: "asc" } }`.
- `PlanRevision` has `createdAt` (`schema.prisma:432`) — `revisions: { orderBy: { createdAt: "asc" } }`.

---

## Attack 8 — Metadata (schema/app version in the envelope)

**Verdict: endorse as-is — format string only, no separate version field.** The PRD's stated
envelope (`{ exportedAt, format: "goaldmine-export-v1", models }`) already excludes a churny
app/schema-version field. `format` alone is sufficient for a future importer to branch on shape;
a numeric app version would need bumping on every unrelated deploy and buys nothing a git tag
doesn't already give you. No change needed.

---

## Attack 9 — Grab bag

- **Anchor + `download`, cross-origin**: `/api/export` is same-origin relative — no CORS
  concern, `download` attribute honored normally. Clear.
- **413 body is JSON but the anchor expects a file — CONFIRMED UX gap, not a blocker.** Per the
  HTML spec, `<a href download>` on a same-origin URL downloads *whatever bytes come back*
  regardless of HTTP status — a 413 (or a stray 401/500) will download as a file, using the
  server's `Content-Disposition` filename if present, containing the JSON error body. The user
  sees what looks like a successful "goaldmine-export-2026-07-11.json" download that's actually
  a two-line error object — easy to miss, no error message ever surfaces in the UI. **Ruling:
  accept for v1** — founder-scale is 1.37 MB against a 4 MB cap (Attack 1), so a 413 is not
  expected to occur in practice for a long while, and building a client-island fetch-and-check
  path contradicts the PRD's explicit "no client island" simplicity call. **Exact instruction**:
  only set `Content-Disposition: attachment; filename=...` on the 200 success response; the
  413/401 JSON error responses should omit that header entirely (plain `Content-Type:
  application/json`, no `Cache-Control: no-store` bug either way) — this at least means a curl/
  fetch caller distinguishes success from failure by header presence, even though the plain
  `<a>` tag's browser behavior can't. Flag as a known follow-up if 413s start happening for real.
- **Duplicate concurrent exports**: harmless — read-only, no shared mutable state. Clear.
- **Memory during `JSON.stringify` of ~MBs**: confirmed fine — the actual 1.37 MB payload
  stringified without incident in my probe; Node's default heap handles this trivially. Clear.
- **Upstash rate limiting**: skip per PRD, founder-scale. Clear, no action.
- **`PlanDayOverride` relation name on `Plan`**: confirmed `overrides` (see Attack 4 table).
  Clear.

### New finding not in the attack list — CONFIRMED: byte cap must use UTF-8 byte length, not `string.length`

`JSON.stringify(...).length` counts **UTF-16 code units**, not bytes. Vercel's 4.5 MB limit and
the `Content-Length` HTTP header are **byte** limits. Any character outside the Basic Multilingual
Plane (most emoji) is a surrogate pair — 2 UTF-16 units — but 4 UTF-8 *bytes*, and even common
non-ASCII text (accented characters, curly quotes a coach or user might paste) is 1 unit / 2-3
bytes. This app already uses emoji as UI content (e.g. `src/lib/calendar.ts`'s hike marker
comment references 🥾 rendered in `CalendarMonth`; the PRD list includes a dedicated
`chart-emoji-alert-a11y` ticket), so emoji in free-text fields (`Note.body`, `NutritionLog.items`
notes, `Workout.notes`) is a live possibility, not a theoretical one. A cap check written as
`json.length > CAP` will **undercount** the true byte size and let a payload through that a
downstream byte-based consumer (or the platform itself) rejects.

**Exact instruction**: measure with `Buffer.byteLength(json, "utf8")`, not `json.length`, both
for the cap comparison and for any logging/telemetry about payload size.

---

## Summary of exact developer instructions

1. **Cap**: `Buffer.byteLength(json, "utf8") > 4_000_000` → 413 JSON error, no
   `Content-Disposition` header on that response. Success path sets `Content-Disposition:
   attachment; filename="goaldmine-export-<dateKey>.json"`.
2. **Escalation trigger**: keep the founder dry-run script permanently
   (`scripts/export-dry-run.ts`, read-only); if it ever measures >2.5 MB for any user, that's
   the signal to cap `PlanRevision` history or add streaming — not before.
3. **FootageMarker**: add a top-level `models.footageMarker = await db.footageMarker.findMany({
   orderBy: { createdAt: "asc" } })` in addition to the nested `Workout.footageMarkers` include —
   do not treat the nested include as sufficient (unlinked hike/baseline/other footage would
   silently vanish otherwise).
4. **Relation names** (all confirmed correct, use verbatim): `Workout.exercises`,
   `Workout.footageMarkers`, `WorkoutExercise.sets`, `Plan.revisions`, `Plan.overrides`.
5. **Ordering**: `createdAt: "asc"` uniformly on all 17 top-level models (all have the column,
   no exceptions). For nested children: `WorkoutExercise` by `orderIndex`, `Set` by `setIndex`,
   `PlanDayOverride` by `date`, `PlanRevision` by `createdAt`.
6. **dateKey import**: from `@/lib/calendar-core`, not `@/lib/calendar` (avoids pulling
   program/records/goal-events into the route's module graph).
7. **Test mock**: `Proxy`-based allowlist over the 17 `EXPECTED_MODELS` array (skeleton above),
   throw on any other property access (`account`, `session`, etc.), auto-vend `findMany` mocks.
8. **Metadata**: envelope stays `{ exportedAt, format: "goaldmine-export-v1", models }` exactly
   as scoped — no app/schema version field.
