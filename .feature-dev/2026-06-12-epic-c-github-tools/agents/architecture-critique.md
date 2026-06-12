# Architecture Critique — Epic C: GitHub Tool Pack

**Author**: Devil's Advocate Agent  
**Date**: 2026-06-12  
**Target**: `architecture-blueprint.md` (+ PRD, requirements, research-output)  
**Verified against**: `src/lib/mcp/tool-helpers.ts`, `src/lib/mcp/tools/project-tools.ts`, `src/lib/mcp/tools.ts` L461-484, `prisma/schema.prisma` L179-244, `src/lib/calendar.ts` L1224-1232

---

## Verdict

**NEEDS REVISION** — no blocking security failures, but three issues require an explicit design decision before coding, one medium API-correctness gap must be fixed, and one GraphQL error-handling gap degrades usability.

---

## 1. Critical Issues

**None found.** The token sanitization layer is structurally sound. Analysis follows (see §2 for reasoning).

---

## 2. Token Leakage Analysis (CRITICAL FOCUS — all paths traced)

### 2.1 `ghSafe` contract match with `safe()`

`ghSafe` is the module-private replacement for `safe()`. Both use the same `jsonResult` and `errorResult` functions from `tool-helpers.ts`, producing identical MCP response shapes. The only addition is `sanitize(msg)` before `errorResult`. **The contract is correctly replicated — no type mismatch.**

Verified: `safe()` in tool-helpers.ts (L21-27) and the blueprint's `ghSafe` are structurally identical except for the sanitize step.

### 2.2 Empty-string token guard

`sanitize()` correctly checks `if (!token) return msg` — an empty string token is falsy, so `replaceAll("", "[REDACTED]")` (which would corrupt every character) is never reached. `ghToken()` also guards with `if (!t)` so an empty-string token causes a friendly throw. **Both defenses are correct and consistent.**

### 2.3 Every error path traced

| Source | Message content | Token reachable? | Verdict |
|--------|-----------------|------------------|---------|
| `ghToken()` throws | "GITHUB_TOKEN not configured…" | No — message is a literal | ✓ safe |
| `ghFetch` HTTP error | "GitHub {N}: {body.message}" | No — GitHub never echoes Authorization header in response body (verified empirically in research) | ✓ safe |
| `ghFetch` non-JSON body | "GitHub HTTP {N}" | No — status code only | ✓ safe |
| `ghGraphQL` errors array | Sanitized before throw (defense-in-depth) | No at throw; sanitize is an extra layer | ✓ safe |
| AbortError / TimeoutError | "signal timed out" / "The operation was aborted" | No — timeout message has no token | ✓ safe |
| Prisma P2025/P2002 | Record IDs and field names only | No — token never passed to Prisma | ✓ safe |
| `resolveLinkedGoal` throws | "Goal not found: {id}" or "No GitHub repo linked…" | No | ✓ safe |
| Zod validation errors | Handled by MCP framework before handler body runs | Never reaches `ghSafe` | ✓ safe |
| DNS / network failure | "getaddrinfo ENOTFOUND api.github.com" | No — token is in headers, never in URL | ✓ safe |

`jsonResult(value)` calls `JSON.stringify(value, null, 2)`. None of the five success return values include the raw `GITHUB_TOKEN` env value. The only raw GitHub object stored in DB is `payload: m` (milestone object in sync), which does not contain auth headers. **No token leak path through jsonResult.**

### 2.4 Errors BEFORE `ghSafe`'s try

The handler is `async (input) => ghSafe(async () => {...})`. Zod validation failures are handled by the MCP SDK before the handler is invoked — they produce a framework-level error, never entering `ghSafe`. This is confirmed correct.

### 2.5 The `sanitize()` + `ghSafe` design is sound

The blueprint's coverage proof in §D-1 and §D-8 is accurate. **APPROVED for the sanitization design.**

---

## 3. Design Concerns (NEEDS REVISION)

### ISSUE-1 (Medium) — `sync_github_milestones` status-clobbering on re-sync is undocumented

**WHAT**: The upsert `update` block unconditionally sets `status = isClosed ? "done" : "planned"` and `completedAt = null` for open milestones. On every re-sync, any open GitHub milestone is reset to `status='planned'` regardless of what is stored in the DB.

**WHY THIS MATTERS**:
- Scenario A: User manually marks a milestone ScheduledItem as `status='done'` via `complete_scheduled_item` or any write tool, then runs sync with `closeCompleted=false` → status silently reverts to `'planned'`. The manual completion is lost.
- Scenario B (benign): A milestone closed in GitHub is re-synced with `closeCompleted=false` (state=open fetch skips it) → DB entry retains its previous status unchanged. Correct.
- Scenario C (benign): A closed milestone is reopened in GitHub, then sync with `closeCompleted=false` → it appears as open, update sets `status='planned'`. This is the intended behavior.

**THE DECISION NEEDED**: Does GitHub mirror unconditionally (open in GH → always 'planned' in DB, overwriting manual changes), or does sync only propagate GitHub-sourced changes (never clobbering user-set status)?

The former (mirror unconditionally) is arguably correct — GitHub is source of truth for synced items. But this must be an explicit design decision, not an accidental consequence of the update block structure.

**HOW TO FIX**: Add **D-11** to the blueprint. State: "For `gh:milestone:*` ScheduledItems, GitHub is authoritative on status. Re-sync unconditionally resets open-milestone status to 'planned'. Users who want 'done' status on a GitHub-synced item must close the milestone in GitHub and re-sync with `closeCompleted=true`. Manually setting status on a synced item has no durability guarantee."

Severity: **Medium** — silent data mutation without documentation. No code change required, but the decision must be captured.

---

### ISSUE-2 (Medium) — `milestone` filter in `list_project_issues` accepts any string; silent wrong results

**WHAT**: `z.string().optional()` accepts any string as the `milestone` param. The GitHub `/issues` API requires the milestone to be a NUMBER (integer string like `"42"`), `"*"`, or `"none"`. Passing a milestone title like `"Sprint 3"` returns 0 results with HTTP 200 — no error, no feedback.

**WHY**: The description correctly warns about this, but descriptions are soft guidance. Claude will plausibly pass `"Sprint 1"` (a title) and receive 0 issues with no indication that the filter was ignored. This is the research output's own R-2 risk.

**HOW TO FIX**: Add a Zod regex to the `milestone` field:

```typescript
milestone: z
  .string()
  .regex(
    /^\d+$|^\*$|^none$/,
    "Must be a milestone number (e.g. '42'), '*' for any milestone, or 'none' for no milestone.",
  )
  .optional()
  .describe(...)
```

This converts a silent wrong-result bug into an early, clear validation error. The regex covers all three valid GitHub values.

Severity: **Medium** — no crash, but produces systematically wrong output with no diagnostic signal.

---

### ISSUE-3 (Medium) — `resolveLinkedGoal` no-kind-check creates cross-domain write inconsistency

**WHAT**: `resolveLinkedGoal` intentionally does not hard-block by `kind`. `sync_github_milestones` can therefore write `ScheduledItem` rows onto a `kind='fitness'` goal. `schedule_item` (project-tools.ts L74-84) hard-blocks fitness goals with:

```
"Goal {id} is kind='fitness'. Use fitness tools..."
```

**WHY THIS IS A GAP**: The blueprint's D-6 rationale is "GitHub tools are bound to the presence of a githubRepo link, not goal kind." But the consequence of link + sync is exactly what `schedule_item` explicitly prevents: ScheduledItem rows on a fitness goal. The constraint in `schedule_item` exists because ScheduledItem rows on fitness goals confuse project queries and the coaching context. `sync_github_milestones` bypasses that invariant.

**HOW TO FIX (two options)**:

Option A (recommended for single-user): Keep no hard-block, but add a warning to the `link_github_project` return if the goal's `kind !== 'project'`:
```typescript
...(goal.kind !== "project" && {
  warning:
    `Goal ${updated.id} is kind='${goal.kind}'. ` +
    "GitHub tools primarily target project goals. " +
    "Milestone sync will create ScheduledItems on this fitness goal.",
}),
```

Option B: Add a `kind` check to `link_github_project` (not `resolveLinkedGoal`) and reject linking a fitness goal to a repo. This aligns with `schedule_item`'s invariant.

Either way, **document the decision explicitly as a D-6 addendum**. The current D-6 in the blueprint justifies no hard-block but does not acknowledge that `sync_github_milestones` writes ScheduledItems, which is the exact thing `schedule_item` hard-blocks on fitness goals.

Severity: **Medium** — architectural inconsistency that passes silently. Acceptable in single-user context but must be a deliberate choice.

---

### ISSUE-4 (Medium) — GraphQL error is silently swallowed; no diagnostic signal to coach

**WHAT**:

```typescript
} catch {
  // GraphQL errors are non-fatal; return null projectBoard
  projectBoard = null;
}
```

If the Projects v2 GraphQL call fails (network timeout, missing `read:project` scope, bad project number), the coach receives `projectBoard: null`. This is the same value as "no project number configured." The coach cannot distinguish "project board not linked" from "project board call failed."

**WHY**: The PRD §6 edge case table lists "GraphQL errors array: projectBoard only on clean response." The null-on-failure behavior is correct. But it should surface *some* signal on failure.

**HOW TO FIX**: Return a `projectBoardError` string (or boolean `projectBoardFetchFailed`) alongside the null:

```typescript
let projectBoardError: string | null = null;
...
} catch (e) {
  projectBoard = null;
  projectBoardError =
    e instanceof Error ? sanitize(e.message) : "Projects v2 board fetch failed.";
}
...
return {
  ...,
  projectBoard,
  projectBoardError,  // null when clean; message string when fetch failed
  rateLimitRemaining,
};
```

This avoids the tool failing (the overview is still valuable), while giving the coach actionable context.

The PRD's §4.2 shape does not include `projectBoardError`. **This requires a PRD shape amendment**, so flag it for the orchestrator to decide whether to add it or accept the silent null.

Severity: **Medium** — usability gap; the coach will be confused about why the board is null when `projectNumber` is configured.

---

## 4. Suggestions (Low Severity)

### S-1 — Redundant `ghToken()` call in `get_project_overview`

`ghToken()` is called explicitly once before `Promise.all`, and again inside each of the 4 `ghFetch` calls (which call `ghToken()` internally). This results in 5 reads of `process.env.GITHUB_TOKEN`. Harmless, but confusing. Consider reading the token once at the top and passing it... or simply remove the explicit pre-call and rely on `ghFetch`'s internal guard. The explicit call provides an "early exit before any network starts" guarantee, which is its only value.

Recommendation: Keep the explicit call but add a comment explaining why:
```typescript
// Pre-validate token before any network IO — ghFetch checks too, but this gives
// a clean early exit before committing 5 parallel request slots.
ghToken();
```

### S-2 — `Content-Type: application/json` on every `ghFetch` call including GET

`ghFetch` sets `Content-Type: application/json` unconditionally. GET requests carry no body and don't need a Content-Type header (GitHub ignores it, but it's misleading code). Consider setting it only when `init?.method` is POST or PATCH:

```typescript
...(init?.method && ["POST", "PATCH"].includes(init.method) && {
  "Content-Type": "application/json",
}),
```

Severity: Very Low — cosmetic correctness.

### S-3 — `due_on.slice(0,10)` has no defensive format check

`parseDateKey` silently produces an Invalid Date if the slice produces a non-`yyyy-mm-dd` string. GitHub's API is reliable and this is a theoretical-only concern, but a guard costs almost nothing:

```typescript
const dateKey = m.due_on.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
  skipped++;  // treat malformed due_on as undatable
  continue;
}
```

### S-4 — `ghSafe` used for `link_github_project` (pure DB tool)

`link_github_project` is a DB-only tool; it doesn't make GitHub API calls and has no token to sanitize from. Using `ghSafe` works (sanitize is a no-op when token is unset, and Prisma errors don't contain the token) but creates a slight conceptual mismatch — `ghSafe` exists specifically for sanitizing token leaks. Consider using `safe()` from tool-helpers for `link_github_project` to keep the sanitization boundary semantically accurate. This also avoids future developers being confused about why a token-free tool uses `ghSafe`.

### S-5 — `>100 open PRs` pagination gap should be code-commented

The blueprint documents this as "open concern 2" but specifies only a code comment noting the limit. The *failure mode* should be explicit in the comment:

```typescript
// LIMIT: per_page=100 — if the repo has >100 open PRs, openPRs is undercounted
// and openIssues is overcounted. Acceptable at Chewgether scale (2 open PRs).
// Fix: paginate pulls endpoint until empty page if this repo grows.
```

---

## 5. Missing Requirements

### MR-1 — PRD §4.2 "rateLimitRemaining: number" — which parallel call provides the header?

The blueprint reads `rateLimitRemaining` from `repoHeaders` (the repo meta response). The research confirms all 4-5 parallel calls return this header. This is correct — repo meta is always fetched. ✓ No gap.

### MR-2 — PRD §3.1.6 code comment requirement for null `due_on` skip

The PRD explicitly requires: "Milestones with null `due_on` are skipped (counted in `skipped`), **documented in code**." Blueprint §4.4 does include a comment:

```typescript
// null due_on → skip. GitHub milestones without a due date cannot be placed
// on the calendar spine. Per PRD §3.1.6: count in skipped, do not upsert.
```

✓ Satisfied.

### MR-3 — PRD §3.2.2: Tool descriptions must state "project/non-fitness scope" for claude.ai routing

Verified in blueprint:
- `link_github_project`: "Primarily for project goals (e.g. chewgether); fitness goals can be linked but GitHub tools are most useful for project-kind goals." ✓
- `get_project_overview`: "Use at the start of a coaching session to ground project review." ✓
- `list_project_issues`: "Use for weekly review, sprint planning, and issue triage in a coaching session." ✓
- `sync_github_milestones`: "for project goals primarily" implied. ✓
- `set_github_issue_status`: "For project goals primarily — fitness goals should not have linked GitHub repos." ✓

### MR-4 — PRD AC §8.3: `projectBoard: null` when no projectNumber set (not error)

Blueprint §4.2: `if (projectNumber !== null)` gate — when projectNumber is null, the `let projectBoard = null` default is returned as-is. ✓

---

## 6. API Correctness Verification

| Claim | Status | Notes |
|-------|--------|-------|
| `open_issues_count` includes PRs, subtract `openPRs` | ✓ Correct | Research verified empirically; blueprint documents in comment |
| `milestone` param is NUMBER not title | PARTIAL | Description warns correctly; Zod doesn't enforce — see ISSUE-2 |
| `pull_request` key for PR filtering | ✓ Correct | Verified on Chewgether; filter `!i.pull_request` |
| `due_on.slice(0,10)` → `parseDateKey` USER_TZ midnight | ✓ Correct | parseDateKey confirmed (calendar.ts L1224-1226); no startOfDay double-apply |
| `closed_at` → `new Date(closed_at)` as instant | ✓ Correct | Not a calendar date; UTC instant, correct semantics |
| Commits 409 on empty repo handled | ✓ Correct | `.catch()` guards 409, returns empty array |
| GraphQL `items(first:100)` sufficient | ✓ Current | 45 items; TODO comment planned |
| `>100 open PRs` overcounts openIssues | KNOWN GAP | Blueprint notes it; acceptable for Chewgether scale (2 PRs) |
| `URLSearchParams` encodes labels/milestone correctly | ✓ Correct | `%2C` for comma is decoded server-side; GitHub handles it |
| `X-GitHub-Api-Version: 2022-11-28` header | ✓ Correct | Research verified response `X-Github-Api-Version-Selected: 2022-11-28` |
| 404 message format "Issue #N not found in <repo>." | ✓ Correct | Blueprint produces exact match with trailing period |
| Already-closed issue returns 200 (idempotent) | ✓ Correct | Research verified GitHub returns 200 on re-close |
| Fetch follows 301 redirects | ✓ Correct | Node.js fetch default `redirect: 'follow'` |
| Rate limit header case-insensitive | ✓ Correct | `headers.get('x-ratelimit-remaining')` — Fetch Headers.get is case-insensitive |

---

## 7. Date/Time Correctness

**parseDateKey + startOfDay double-application concern:**

The blueprint and research both correctly document that `parseDateKey(k)` already returns USER_TZ midnight. `startOfDay` is NOT called after `parseDateKey` in the blueprint. Verified in calendar.ts L1224-1226:

```typescript
export function parseDateKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return userTzWallClockToUTC(y!, m!, d!);
}
```

No double-application. ✓

**`due_on` slice correctness with DST:**

GitHub returns `due_on` at a fixed UTC time (empirically verified as 07:00 UTC for MST repos). `slice(0,10)` gives the calendar date the user set — immune to the new Date() day-shift bug (which would occur only if `new Date(due_on)` was used). `parseDateKey` converts the date string to MT midnight regardless of DST. The slice approach is correct because the goal is to anchor to the user-intended calendar date, not to reconstruct the exact UTC instant. ✓

---

## 8. Type Safety Review

| Concern | Status |
|---------|--------|
| `payload: m as unknown as Prisma.InputJsonValue` double-cast | Acceptable — standard Prisma Json field pattern; `GhMilestone.due_on: string | null` nested in object is handled by Postgres/Prisma at runtime |
| Raw API responses use typed interfaces (not `any`) | ✓ GhRepo, GhMilestone, GhIssue, GhCommit, GhPull, GqlProjectResponse |
| `body.data as T` in ghGraphQL when `body.data` is undefined | Caught by the try-catch in the caller — `projectBoard = null` |
| `r.externalRef` in existingRefs Set is typed as `string | null` but only non-null values populate it (startsWith filter) | ✓ No runtime null in Set despite TS type |

---

## 9. Idempotency Correctness

**Upsert uniqueness**: `@@unique([goalId, externalRef])` (schema.prisma L225). Prisma upsert on `goalId_externalRef` compound key. `externalRef` is always `"gh:milestone:<n>"` (non-null) in sync — the null-externalRef multiple-row Postgres quirk (noted in project-tools.ts L91 comment) does not apply. ✓

**Pre-query Set race**: Single-user app, no concurrent writes. The `findMany` snapshot before the upsert loop correctly captures existing refs. ✓

**`updatedAt` on re-run**: `ScheduledItem.updatedAt @updatedAt` — Prisma bumps it on every upsert `update` path. ✓

**Status behavior on re-run**: See ISSUE-1. The status-clobbering is a design gap that must be documented, not fixed.

---

## 10. Zod v4 Compatibility

**`.default()` usage**: Verified in `project-tools.ts` L375, 483, 575 — `.default()` is already used in production Zod inputSchemas and works with the MCP SDK. The blueprint's `.default("open")`, `.default(30)`, `.default(false)` are consistent with existing patterns. ✓

**`.regex()` in plain-shape inputSchema**: Confirmed unchanged from Zod 3. ✓

**`.number().int().positive()`**: Standard Zod, consistent. ✓

---

## 11. Risk Assessment Table

| Risk | Likelihood | Impact | Blueprint Coverage |
|------|------------|--------|-------------------|
| Token appears in tool output | Very Low | Critical | Fully addressed (multi-layer) |
| `milestone` filter silently returns 0 results | Medium | High | Description only — no Zod validation (ISSUE-2) |
| Open-milestone status clobbered on re-sync | Medium | Medium | Undocumented behavior (ISSUE-1) |
| Fitness goal gets ScheduledItems via sync | Low | Medium | Documented but inconsistent (ISSUE-3) |
| GraphQL failure indistinguishable from "not configured" | Medium | Low | No diagnostic signal (ISSUE-4) |
| >100 open PRs miscounts openIssues | Very Low | Low | Noted as open concern |
| GraphQL board > 100 items truncated | Very Low | Low | TODO comment planned |
| Double-apply startOfDay | N/A | N/A | Correctly avoided |
| AbortError / network error leaks token | None | Critical | Token not in URL — not possible |

---

## 12. Final Verdict

**NEEDS REVISION** — specifically these items before dev starts:

1. **ISSUE-1 (Medium)**: Add D-11 to blueprint: explicit design decision that sync mirrors GitHub status unconditionally, clobbering manually-set DB status. No code change — documentation only.

2. **ISSUE-2 (Medium)**: Add Zod regex `^\\d+$|^\\*$|^none$` to `milestone` field in `list_project_issues`. One-line code change; prevents silent wrong results.

3. **ISSUE-3 (Medium)**: Decide on soft-warn vs hard-block for fitness goal linking, add D-6 addendum acknowledging the ScheduledItem cross-domain write. Minimal code change (optional warning in `link_github_project` return).

4. **ISSUE-4 (Medium)**: Decide whether to add `projectBoardError: string | null` to `get_project_overview` return shape. If yes, requires PRD §4.2 amendment. If no, document the "null is ambiguous" limitation explicitly.

Items 1, 3, and 4 are decisions for the orchestrator/PRD author, not the dev agent. Item 2 is a one-line fix the dev agent can apply without escalation.

The token sanitization design is sound and approved as-is. The date semantics are correct. The idempotency design is correct. Type safety is acceptable. No critical issues.
