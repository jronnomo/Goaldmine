# QA Report — Epic C: GitHub Tool Pack
**QA Agent**: Claude (sonnet-4-6)
**Date**: 2026-06-12
**Commit reviewed**: b418043
**Files reviewed**: `src/lib/mcp/tools/github-tools.ts` (896 lines), `src/lib/mcp/tools.ts` (+2), `.env.example`, `.claude/quality-tools.md`

---

## 1. Requirements Status (per Acceptance Criterion)

### REQ-001 — link_github_project (#30)

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| R1-1 | New file `src/lib/mcp/tools/github-tools.ts` exporting `registerGitHubTools(server)` | PASS | Line 338: `export function registerGitHubTools(server: McpServer): void` |
| R1-2 | `registerAll()` calls it after `registerProjectTools` | PASS | tools.ts lines 484-485: `registerProjectTools(server); registerGitHubTools(server);` |
| R1-3 | Repo regex `^[\w.-]+\/[\w.-]+$` | PASS | Line 367: exact pattern, rejects "Chewgether" and "https://..." |
| R1-4 | DB write to `Goal.githubRepo`/`githubProjectNumber` | PASS | Lines 400-407: prisma.goal.update with both fields |
| R1-5 | Works with no GITHUB_TOKEN | PASS | No `ghToken()` call in handler — ghSafe is no-token for DB-only tools |
| R1-6 | Friendly goal-not-found error | PASS | Line 395: `throw new Error(\`Goal not found: ${input.goalId}\`)` |
| R1-7 | All fields `.describe()`d | PASS | goalId, repo, projectNumber all described |

### REQ-002 — get_project_overview (#31)

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| R2-1 | Parallel REST: repo meta, pulls, milestones, commits | PASS | Lines 474-488: `Promise.all([...])` with 4 concurrent ghFetch calls |
| R2-2 | Optional GraphQL when projectNumber set | PASS | Lines 501-534: guarded by `if (projectNumber !== null)` |
| R2-3 | `rateLimitRemaining` from `X-RateLimit-Remaining` header | PASS | Lines 493-496: `repoHeaders.get("x-ratelimit-remaining")` with parseInt and -1 fallback |
| R2-4 | `openIssues = open_issues_count - openPRs` (PR subtraction) | PASS | Lines 491-492: explicit subtraction |
| R2-5 | 409 guard on commits (empty repo) | PASS | Lines 464-472: .catch() converts 409 to `{data:[], headers:new Headers()}` |
| R2-6 | `ghFetch` + `sanitize` pattern established | PASS | ghSafe wraps handler; ghFetch authenticates via header only |
| R2-7 | Friendly errors: 401/403/404/timeout | PASS | ghFetch throws "GitHub {N}: {msg}"; ghSafe catches+sanitizes |
| R2-8 | `projectBoardError` field (v2 ISSUE-4) | PASS | Lines 500, 531-533: variable initialized null, populated in GraphQL catch |
| R2-9 | Board failure non-fatal — overview still valid | PASS | GraphQL catch sets projectBoardError without re-throwing |
| R2-10 | `recentCommits` ≤ 5 with 7-char SHAs | PASS | `per_page=5`; `c.sha.slice(0,7)` |
| R2-11 | `milestones?state=all` in overview | PASS | Line 486: `state=all&per_page=100` |

### REQ-003 — list_project_issues (#32)

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| R3-1 | `state` enum open/closed/all with default open | PASS | Lines 584-587 |
| R3-2 | `label` optional passthrough | PASS | Lines 588-595; `params.set("labels", input.label)` |
| R3-3 | `milestone` with regex `/^\d+$|^\*$|^none$/` (v2 ISSUE-2) | PASS | Lines 599-611: pattern exact-match per blueprint |
| R3-4 | `limit` 1..100 default 30 | PASS | Lines 612-618 |
| R3-5 | PR filter: `raw.filter(i => !i.pull_request)` | PASS | Lines 639-640 |
| R3-6 | Return shape per PRD §4.2 | PASS | Lines 642-654: count, issues[] with all required fields |
| R3-7 | milestone OUTPUT = human-readable title (not number) | PASS | Line 649: `i.milestone?.title ?? null` |

### REQ-004 — sync_github_milestones (#33)

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| R4-1 | kind='project' required (v2 ISSUE-3) | PASS | Lines 702-706: kind check after resolveLinkedGoal, before ghToken() |
| R4-2 | `externalRef = 'gh:milestone:<n>'` | PASS | Line 735: `` `gh:milestone:${m.number}` `` |
| R4-3 | Upsert on `goalId_externalRef` compound key | PASS | Lines 775-808: `where: { goalId_externalRef: { goalId, externalRef } }` |
| R4-4 | UTC→USER_TZ: `due_on.slice(0,10)` → `parseDateKey` | PASS | Lines 747-756: explicit comment + S-3 guard |
| R4-5 | Never `new Date(due_on)` for date storage | PASS | No such call anywhere in file |
| R4-6 | Null `due_on` → skip + count in `skipped` | PASS | Lines 739-742: `if (m.due_on === null) { skipped++; continue; }` with comment |
| R4-7 | `closeCompleted`: closed milestone → `status='done'` + `completedAt=new Date(closed_at)` | PASS | Lines 759-762, 791-800: isClosed check, completedAt via `new Date(m.closed_at)` |
| R4-8 | Open milestone update: ONLY `{title, detail, date, payload}` — never touches status/completedAt (v2 ISSUE-1) | PASS | Lines 801-807: explicit split update blocks, OPEN block omits status+completedAt |
| R4-9 | `{synced, updated, skipped, items}` return shape | PASS | Lines 820: exact shape |
| R4-10 | `state=all` when closeCompleted=true, `state=open` when false | PASS | Lines 712-714: `const state = input.closeCompleted ? "all" : "open"` |
| R4-11 | Pre-query Set for synced vs updated counting | PASS | Lines 720-727: findMany before loop; existingRefs Set |
| R4-12 | `payload` = raw milestone JSON | PASS | Line 789: `m as unknown as Prisma.InputJsonValue` |
| R4-13 | S-3: defensive dateKey format check | PASS | Lines 751-754: regex guard, skips malformed due_on |
| R4-14 | Idempotent re-run | PASS | Upsert on unique key; second run = all updated, 0 synced |

### REQ-005 — set_github_issue_status (#34)

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| R5-1 | PATCH issue state | PASS | Lines 868-875: `method: "PATCH"` with `{state: input.state}` body |
| R5-2 | Already-closed → success | PASS | GitHub returns 200 for re-close; no error path triggered |
| R5-3 | 404 → "Issue #N not found in <repo>." | PASS | Lines 879-882: exact format with issue number and fullRepo |
| R5-4 | Other errors re-thrown (sanitized by ghSafe) | PASS | Line 884: `throw e` re-throw to ghSafe catch |
| R5-5 | Return `{issueNumber, title, state, url, message}` | PASS | Lines 887-893 |

### REQ-006 — Token provisioning (#53)

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| R6-1 | `.env.example` has `GITHUB_TOKEN` placeholder | PASS | Line 15: `GITHUB_TOKEN="ghp_your_github_token_here"` |
| R6-2 | No real token in `.env.example` | PASS | Placeholder is 26 chars with words; real tokens are 40 chars hex. `ghp_your_github_token_here` is clearly synthetic. |
| R6-3 | Scope comment in `.env.example` | PASS | Lines 9-14: scopes, local/Vercel instructions, never-echo rule |
| R6-4 | `quality-tools.md` env-vars section | PASS | Lines 69-79: table with DATABASE_URL, MCP_AUTH_TOKEN, GITHUB_TOKEN + never-echo rule + Vercel note |
| R6-5 | `quality-tools.md` accuracy (scopes, link_github_project exception) | PASS | "PAT scopes: repo + read:project. ... link_github_project works without it." — matches PRD §3.1.5 |

---

## 2. Token-Leak Audit

**Overall verdict: CLEAN — no leak paths found.**

| Path | Token risk | Mitigation | Status |
|------|-----------|-----------|--------|
| `ghFetch` HTTP request | Token in `Authorization: Bearer` header | Header only — never in URL, never in body | PASS |
| `ghFetch` error message | Built from `res.status` (int) + `body.message` (GitHub text) | GitHub never echoes Authorization header in error body (verified in research) | PASS |
| `ghGraphQL` error message | GraphQL errors array joined | Lines 247-248: `sanitize(...)` called BEFORE throw — defense in depth | PASS |
| `ghSafe` catch boundary | Catches all throws from handler body | Line 147: `return errorResult(sanitize(msg))` — every error path sanitized | PASS |
| `projectBoardError` assignment | GraphQL catch populates it | Line 532: `sanitize(e.message)` explicit call | PASS |
| `jsonResult` return values | Structured data from handler | All 5 tools return mapped fields (not raw API response objects) — no auth metadata possible | PASS |
| `sync_github_milestones` payload | Raw milestone object stored to DB | NOT returned in MCP response — items[] only has {externalRef, title, date} | PASS |
| `console.log`/`console.error` | Potential implicit leak | NONE — grep of github-tools.ts: 0 console.* calls | PASS |
| `sanitize("")` guard | `replaceAll("", ...)` insert-everywhere bug | Lines 121-122: `if (!token) return msg` — guards both undefined and empty string | PASS |
| Token in URL strings | URL built in ghFetch | Confirmed: only `${GH_API_BASE}${path}` — token never in path string | PASS |

---

## 3. USER_TZ Audit

| Location | Call | Correct? | Notes |
|----------|------|---------|-------|
| `sync_github_milestones` line 747 | `m.due_on.slice(0, 10)` → `parseDateKey(dateKey)` | PASS | yyyy-mm-dd → USER_TZ midnight. T07:00:00Z → same calendar day in MT |
| `sync_github_milestones` line 762 | `new Date(m.closed_at)` for `completedAt` | PASS | `closed_at` is an instant, not a calendar date — `new Date()` correct |
| `get_project_overview` line 544 | `m.due_on.slice(0, 10)` for display `dueOn` field | PASS | Display-only string, not used for DB date; no TZ conversion needed |
| Raw date primitives grep | `setHours|setDate|getHours|getDate\(|getMonth\(|getFullYear` | PASS | Zero occurrences in github-tools.ts |
| `startOfDay` import | Not imported | PASS | Correct — `parseDateKey` already returns USER_TZ midnight |

---

## 4. Zod/SDK Conformance

| Field | Schema | `.describe()`? | Default? | Notes |
|-------|--------|--------------|---------|-------|
| `link_github_project.goalId` | `z.string()` | PASS | — | |
| `link_github_project.repo` | `z.string().regex(/^[\w.-]+\/[\w.-]+$/)` | PASS | — | Regex rejects bare names and URLs |
| `link_github_project.projectNumber` | `z.number().int().positive().optional()` | PASS | — | |
| `get_project_overview.goalId` | `z.string()` | PASS | — | |
| `list_project_issues.goalId` | `z.string()` | PASS | — | |
| `list_project_issues.state` | `z.enum(["open","closed","all"]).default("open")` | PASS | "open" | |
| `list_project_issues.label` | `z.string().optional()` | PASS | — | |
| `list_project_issues.milestone` | `z.string().regex(/^\d+$|^\*$|^none$/).optional()` | PASS | — | Regex alternation correct; rejects "Sprint 3" → Zod error |
| `list_project_issues.limit` | `z.number().int().min(1).max(100).default(30)` | PASS | 30 | |
| `sync_github_milestones.goalId` | `z.string()` | PASS | — | |
| `sync_github_milestones.closeCompleted` | `z.boolean().default(false)` | PASS | false | |
| `set_github_issue_status.goalId` | `z.string()` | PASS | — | |
| `set_github_issue_status.issueNumber` | `z.number().int().positive()` | PASS | — | |
| `set_github_issue_status.state` | `z.enum(["open","closed"])` | PASS | — | No default (required) — correct |
| Plain-shape inputSchema (not `z.object()`) | All 5 tools use plain-object shape | PASS | — | Matches project-tools.ts pattern |

**Milestone regex alternation correctness**: `/^\d+$|^\*$|^none$/` — alternation with anchors on each branch. No overlapping alternatives. Correctly rejects `"Sprint 3"`, `"not-a-number"`, empty string. Accepts `"42"`, `"*"`, `"none"`. PASS.

---

## 5. Code Quality

| Finding | Severity | Location | Assessment |
|---------|---------|---------|-----------|
| `e.message.includes("404")` for 404 detection | LOW | github-tools.ts line 879 | `ghFetch` formats as `"GitHub 404: ..."` or `"GitHub HTTP 404"` — deterministic prefix. No realistic GitHub error body contains "404" as meaningful text. String check is functional. Acknowledged in merge-log as style observation. |
| `e.message.includes("409")` for 409 detection | LOW | github-tools.ts line 467 | Same reasoning. Empty repo is the only 409 case on the commits endpoint. |
| `m as unknown as Prisma.InputJsonValue` (×3) | NONE | Lines 789, 799, 806 | Blessed boundary cast. Prisma's `Json` field requires this pattern. `GhMilestone` is fully typed — no actual `any` escape. |
| `import type { McpServer }` — type-only import | NONE | Line 8 | Correct — `McpServer` is only used as a type in the function signature. |
| No `any` or `@ts-ignore` | NONE | Whole file | Confirmed by grep — zero occurrences. |
| No unused imports | NONE | Whole file | All 6 imports used: z, McpServer, Prisma, prisma, parseDateKey, jsonResult, errorResult |
| `safe()` not imported | NONE | Intentional | Correct per blueprint D-1 and D-12/S-4. `ghSafe` is the module-private replacement. |
| Style consistency with project-tools.ts | PASS | Whole file | Same file header comment style, same `server.registerTool()` call pattern, same import ordering, same Prisma interaction patterns. |
| `GH_TIMEOUT_MS = 10_000` vs codebase 6000 | NONE | Line 153 | Intentional per D-7 — GitHub can be slower than USDA/food APIs. Documented in comment. |
| `pulls?per_page=100` PR pagination limit | KNOWN | Line 484 | S-5 comment added per blueprint. Acceptable at Chewgether scale (2 PRs). Fix documented. |
| GraphQL `items(first:100)` limit | KNOWN | Line 269 | TODO comment present. Board has 45 items. Would silently undercount at >100. |

---

## 6. Edge-Case Coverage

| Edge Case | Coverage | Notes |
|-----------|---------|-------|
| Goal not found | PASS | Covered in `resolveLinkedGoal` and `link_github_project` handler separately |
| Repo not linked | PASS | `resolveLinkedGoal` throws "No GitHub repo linked...call link_github_project first." |
| GITHUB_TOKEN unset (API tools) | PASS | `ghToken()` throws "GITHUB_TOKEN not configured..." |
| `link_github_project` without GITHUB_TOKEN | PASS | No `ghToken()` call in that handler |
| GitHub 401/403 | PASS | `ghFetch` catches non-2xx, formats "GitHub {N}: {msg}" |
| GitHub 404 (repo level) | PASS | `ghFetch` throws; `ghSafe` surfaces sanitized message |
| GitHub 404 (issue level) | PASS | `set_github_issue_status` inner try/catch converts to "Issue #N not found in <repo>." |
| Timeout/AbortError | PASS | `AbortSignal.timeout(10_000)` set; AbortError propagates to `ghSafe` catch |
| Token in any error body | PASS | `ghSafe` sanitizes all error paths; `ghGraphQL` pre-sanitizes before throw |
| Milestone null `due_on` | PASS | Lines 739-742: skipped with increment |
| Sync re-run (0 duplicates) | PASS | Upsert on unique compound key |
| PR contamination in `/issues` | PASS | `filter(i => !i.pull_request)` |
| Closing already-closed issue | PASS | GitHub returns 200 — not an error path |
| Bare repo name input | PASS | Zod regex rejects at schema validation time |
| Full URL repo input | PASS | Zod regex rejects |
| GraphQL project not found (null projectV2) | PASS | Lines 507, 524-525: `pv2 === null` treated as valid not-found, projectBoard null, projectBoardError null |
| GraphQL errors array | PASS | Lines 245-249: errors joined + sanitized before throw; caught in try/catch → projectBoardError |
| Empty repo (409 on commits) | PASS | `.catch()` converts to `{data:[], headers:new Headers()}` |
| Empty GITHUB_TOKEN string (`""`) | PASS | `ghToken()` uses `if (!t)` — catches empty string; `sanitize()` also guards `if (!token)` |
| `milestone` input = title string | PASS | Zod regex rejects before handler runs |
| `milestone` input = `*` or `none` | PASS | Regex alternation allows these |
| Malformed `due_on` from GitHub | PASS | S-3 guard: `/^\d{4}-\d{2}-\d{2}$/` regex on sliced dateKey — skips malformed |
| `kind !== 'project'` for sync | PASS | Lines 702-706: hard-require check with friendly error |
| Board pagination >100 | PARTIAL | Known limitation, TODO comment present; not a test failure at 45 items |

**Gap identified**: If a milestone is reopened in GitHub (state goes closed→open) and `closeCompleted=false` is used, the ScheduledItem that was previously set to `done` by `closeCompleted=true` will NOT be reset to `planned`. Per D-11, this is intentional — GitHub-reopened milestones do not reset local `done` status. Documented in comments. Not a bug — design decision for single-user app.

---

## 7. Overall Verdict

**SHIP IT**

### Fix Priority List

1. **NONE required** — no blocking issues found.

2. **Low-priority style (no action before ship)**:
   - `includes("404")`/`includes("409")` substring status detection — acknowledged in merge log. Low risk given `ghFetch`'s deterministic error formatting. If a `GhApiError extends Error` is introduced later, these lines are the natural migration point.

3. **Known limitations (documented, acceptable at current scale)**:
   - GraphQL board pagination (`items(first:100)`) — TODO comment present.
   - Pull endpoint pagination (`?per_page=100`) — S-5 comment present.

### Summary

All 5 tools are correctly implemented against blueprint v2. All four v2 amendments are present: status-preserving open-milestone update block (ISSUE-1), milestone Zod regex (ISSUE-2), sync-only kind gate (ISSUE-3), projectBoardError diagnostic (ISSUE-4). Token sanitization is solid: single `ghSafe` boundary + `ghGraphQL` pre-sanitize + empty-token guard in `sanitize()`, zero console.log calls. USER_TZ semantics are correct throughout. `parseDateKey` path covers milestone dates; `new Date(closed_at)` correctly handles instants. No `any`/`@ts-ignore`/unused imports. `.env.example` placeholder is clearly synthetic (26 chars with words; real tokens are 40 chars). `quality-tools.md` env section accurately reflects PRD §3.1 requirements. The two remaining items are low-severity style observations with no correctness impact, both acknowledged pre-merge.
