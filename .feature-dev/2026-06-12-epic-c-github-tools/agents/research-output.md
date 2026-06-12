# Research Output — Epic C: GitHub Tool Pack

**Agent**: Research Agent  
**Date**: 2026-06-12  
**Verified against**: jronnomo/goaldmine (public read), jronnomo/Chewgether (private, accessible via gh token), jronnomo user project #8

---

## 1. REST Endpoint Verification

### 1.1 Repo Meta — `GET /repos/{owner}/{repo}`

**URL**: `https://api.github.com/repos/{owner}/{repo}`  
**Auth required**: Yes for private repos (Bearer token).

**Verified response fields used by get_project_overview**:

| Field | Type | Notes |
|-------|------|-------|
| `default_branch` | string | e.g. `"main"` |
| `open_issues_count` | integer | **INCLUDES open PRs** — verified below |
| `private` | boolean | `true` for Chewgether |
| `visibility` | string | `"private"` |

**CRITICAL**: `open_issues_count` **includes open pull requests**. Verified empirically:
- Chewgether: `open_issues_count = 74`; open PRs (via `/pulls?state=open`) = 2; open issues via search `type:issue` = 72. Math: 74 − 2 = 72 ✓
- Developer must subtract open PR count to get accurate issue count. Both calls already happen in parallel in `get_project_overview`, so compute `openIssues = open_issues_count - openPRs` client-side.

**Error shapes**:
- 404: `{"message":"Not Found","documentation_url":"https://docs.github.com/...","status":"404"}`
- 401/403: `{"message":"Bad credentials","documentation_url":"..."}` or similar

---

### 1.2 Open PR Count

**Two approaches evaluated**:

**Option A — REST pulls endpoint** (RECOMMENDED):
```
GET /repos/{owner}/{repo}/pulls?state=open&per_page=100
```
- Returns array; `length` = open PR count.
- Rate limit: **core bucket** (5000 req/hr for authed user).
- At Chewgether scale (74 issues, ~2 PRs), single page sufficient — no pagination risk.

**Option B — Search API**:
```
GET /search/issues?q=repo:{owner}/{repo}+type:pr+state:open
```
- Returns `{ total_count: N }` — no array to paginate.
- Rate limit: **separate search bucket** (30 req/min) — do NOT use for a tool that fires on every `get_project_overview` call.

**Recommendation**: Use Option A (REST `/pulls`). Same rate-limit bucket as the other 4 parallel REST calls in `get_project_overview`. Search API's 30/min limit is a footgun if the user calls overview repeatedly in a session.

---

### 1.3 Accurate Open Issue Count (excluding PRs)

**Recommended approach**: `open_issues_count` (from repo meta) minus `openPRs` (from pulls endpoint) = accurate issue count. Both are already fetched in parallel in `get_project_overview`. Do NOT use the search API for this.

Alternative (search `type:issue`) is accurate but burns the 30/min search bucket unnecessarily.

---

### 1.4 Milestones — `GET /repos/{owner}/{repo}/milestones`

**URL**: `https://api.github.com/repos/{owner}/{repo}/milestones?state={state}&per_page=100`

**Verified params**:
- `state`: `open` | `closed` | `all` (default: `open`)
- `sort`: `due_on` (default) | `completeness`
- `direction`: `asc` (default) | `desc`
- `per_page`: max 100

**Verified response fields per milestone object**:

| Field | Type | Notes |
|-------|------|-------|
| `number` | integer | Milestone identifier (used as externalRef suffix) |
| `title` | string | |
| `description` | string \| null | |
| `due_on` | string (ISO 8601) \| null | UTC datetime; `slice(0,10)` gives yyyy-mm-dd |
| `open_issues` | integer | |
| `closed_issues` | integer | |
| `state` | string | `open` \| `closed` |
| `closed_at` | string (ISO 8601) \| null | Use `new Date(closed_at)` — this IS an instant, not a calendar date |
| `html_url` | string | |

**For `sync_github_milestones`**:
- `due_on` null → skip, increment `skipped` (code-comment required per PRD §3.1 pt.6)
- `due_on` non-null: `due_on.slice(0,10)` → `parseDateKey()` → USER_TZ midnight Date
- `closed_at` → `new Date(closed_at)` — correct here (it's an instant)
- `externalRef` pattern: `gh:milestone:<n>` where `<n>` = milestone `number`

**Error shapes**: 404 `{"message":"Not Found",...}` if repo doesn't exist.

---

### 1.5 Recent Commits — `GET /repos/{owner}/{repo}/commits`

**URL**: `https://api.github.com/repos/{owner}/{repo}/commits?per_page=5`

**Verified response fields** (verified against goaldmine):

| Field path | Type | Notes |
|-----------|------|-------|
| `sha` | string | Full 40-char SHA |
| `commit.message` | string | Full message including body; truncate as desired |
| `commit.author.date` | string | ISO 8601 UTC datetime |
| `commit.author.name` | string | Git author name |

**Example verified**:
```json
{
  "sha": "7192d62b8f292dce626f263f3616b3caa9d98b52",
  "commit": {
    "message": "feat(mcp): set_active_goal tool...",
    "author": {
      "date": "2026-06-12T16:33:06Z",
      "name": "jronnomo"
    }
  }
}
```

**EMPTY REPO 409 — documented behavior**:
- GitHub API docs list `409 Conflict` as a possible status for `GET /repos/{owner}/{repo}/commits`.
- Per GitHub's known behavior, the 409 body is: `{"message":"Git Repository is empty.","documentation_url":"https://docs.github.com/..."}` (cannot verify directly without an empty repo, but this is the standard GitHub error for this scenario).
- **Developer must handle 409**: catch it and return `recentCommits: []` (or a friendly error) rather than letting it surface as an unhandled error. The ghFetch layer should handle non-ok statuses before JSON-parsing.

---

### 1.6 Issues List — `GET /repos/{owner}/{repo}/issues`

**URL**: `https://api.github.com/repos/{owner}/{repo}/issues?state=open&labels=&milestone=&per_page=30`

**Verified params**:

| Param | Type | Notes |
|-------|------|-------|
| `state` | `open` \| `closed` \| `all` | default: `open` |
| `labels` | string | **Comma-separated label names** — e.g. `bug,ui,@high`. NOT an array. |
| `milestone` | string or integer | **Milestone NUMBER** (not title), `*` (any milestone), or `none` (no milestone). NOT a title string. |
| `per_page` | integer | max 100 |
| `page` | integer | for pagination |

**CRITICAL GOTCHA — milestone param**: The PRD types `milestone` as `string` in the tool's input schema. This is correct — but the tool description and code comment MUST clarify that the value must be a milestone NUMBER (integer as string, e.g. `"42"`) or `"*"` or `"none"`. Passing a milestone title string silently returns 0 results. Verified from docs.

**PR contamination**: The `/issues` endpoint returns both issues AND pull requests. Entries with a `pull_request` key are PRs. Verified on Chewgether:
- Issue #316: `pull_request` key present → filter out
- Issue #315: no `pull_request` key → keep
- Issue #311: `pull_request` key present → filter out

**Verified issue fields**:

| Field | Type | Notes |
|-------|------|-------|
| `number` | integer | |
| `title` | string | |
| `state` | string | `open` \| `closed` |
| `labels` | array | Each element has `.name` string |
| `milestone` | object \| null | Has `.title`, `.number` |
| `created_at` | string | ISO 8601 |
| `updated_at` | string | ISO 8601 |
| `html_url` | string | |
| `pull_request` | object | PRESENT on PR entries — use this to filter |

**Filter implementation**: `issues.filter(i => !i.pull_request)`

**Error shapes**:
- 404: `{"message":"Not Found","documentation_url":"...","status":"404"}` — verified via GET /repos/jronnomo/goaldmine/issues/99999

---

### 1.7 Issue PATCH — `PATCH /repos/{owner}/{repo}/issues/{issue_number}`

**URL**: `https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}`  
**Method**: `PATCH`  
**Content-Type**: `application/json`  
**Body**: `{ "state": "open" | "closed" }`

**Accepted body fields**: `title`, `body`, `state` (open/closed), `state_reason`, `milestone`, `labels`, `assignees`.

**Response**: Full issue object (200 OK). Key fields for `set_github_issue_status`:
- `number` (integer)
- `title` (string)
- `state` (string: `"open"` or `"closed"`)
- `html_url` (string)

**HTTP status codes**:
- 200: success (including closing an already-closed issue — GitHub returns 200, not error)
- 301: moved permanently
- 403: forbidden
- 404: not found
- 410: gone
- 422: validation failed
- 503: service unavailable

**404 shape**: `{"message":"Not Found","documentation_url":"...","status":"404"}` (same pattern as GET 404, verified above).

**Already-closed behavior**: Sending `state: "closed"` to an already-closed issue returns 200 — GitHub is idempotent here. PRD §4.2 requirement "closing an already-closed issue is success" is naturally satisfied by the API.

---

## 2. PR-vs-Issue Counting Recommendation

**Summary**: Use parallel REST calls, no search API.

```
Promise.all([
  ghFetch(`/repos/${owner}/${repo}`),                          // → open_issues_count
  ghFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`), // → array.length
  ghFetch(`/repos/${owner}/${repo}/milestones?state=open&per_page=100`),
  ghFetch(`/repos/${owner}/${repo}/commits?per_page=5`),
])
```

Then: `openIssues = repo.open_issues_count - pulls.length`; `openPRs = pulls.length`.

All 4 calls hit the **core rate-limit bucket** (5000/hr authed). At Chewgether scale, 1-page pulls is sufficient. Avoid the search API (30/min separate bucket).

---

## 3. Rate Limit

**Header name** (actual GitHub response): `X-Ratelimit-Remaining` (mixed case as GitHub sends it).  
`Access-Control-Expose-Headers` lists it as `X-RateLimit-Remaining` (camelCase).

**In native `fetch`**: `res.headers.get('x-ratelimit-remaining')` — `Headers.get()` is case-insensitive in the browser/Node Fetch spec, so any capitalization works. Use lowercase for consistency.

**Current state** (verified 2026-06-12):
```
core:   { limit: 5000, remaining: ~4985 }
search: { limit: 30/min, remaining: 30 }
```

**Implementation**: Read from one response header in `get_project_overview`. The repo-meta response carries this header:
```ts
const rateLimitRemaining = parseInt(res.headers.get('x-ratelimit-remaining') ?? '-1', 10);
```

**Search bucket**: 30 req/min — separate from core. Do NOT use search API in any of the 5 tools (recommendation: REST only).

---

## 4. GraphQL Projects v2

### 4.1 Verified Query

The following query was run successfully (`gh api graphql`) against user project #8 ("Goaldmine Roadmap"):

```graphql
query($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      title
      items(first: 100) {
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
      }
    }
  }
}
```

**Variables**: `{ "login": "jronnomo", "number": 8 }`

**Verified response shape**:
```json
{
  "data": {
    "user": {
      "projectV2": {
        "title": "Goaldmine Roadmap",
        "items": {
          "nodes": [
            { "fieldValueByName": { "name": "Done" } },
            { "fieldValueByName": { "name": "Todo" } },
            ...
          ]
        }
      }
    }
  }
}
```

**Column counts**: Derived client-side by grouping `nodes` by `fieldValueByName.name`:
```ts
const columns = nodes.reduce((acc, node) => {
  const name = node.fieldValueByName?.name;
  if (name) acc[name] = (acc[name] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);
// Result: { "Done": 18, "Todo": 27 }
// → [{name: "Done", cardCount: 18}, {name: "Todo", cardCount: 27}]
```

**Project #8 verified state** (2026-06-12): 45 items total — 18 "Done", 27 "Todo". Query returns all items with `first: 100` (sufficient for current board size; add pagination comment if board could grow).

**Note on items with no Status value**: If an item has no Status field set, `fieldValueByName` returns `null` (not an object). The reduce should guard: `const name = node.fieldValueByName?.name ?? null; if (name) ...` to skip null entries.

### 4.2 GraphQL Error Shape

If the `errors` array is present in the response, treat as failure and set `projectBoard: null`:
```json
{ "errors": [{ "message": "..." }], "data": { "user": null } }
```

Check `response.data.user?.projectV2` before using — can be null if project not found or no access.

### 4.3 user vs organization Handling

**Recommendation**: Use `repositoryOwner` polymorphic query as primary approach.

**VERIFIED**: `repositoryOwner(login: "jronnomo")` works:
```graphql
query {
  repositoryOwner(login: "jronnomo") {
    ... on User { projectV2(number: 8) { title } }
  }
}
```
Response: `{ "data": { "repositoryOwner": { "projectV2": { "title": "Goaldmine Roadmap" } } } }`

**Full recommended query (handles both user and org)**:
```graphql
query($login: String!, $number: Int!) {
  repositoryOwner(login: $login) {
    ... on User {
      projectV2(number: $number) {
        title
        items(first: 100) {
          nodes {
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
    ... on Organization {
      projectV2(number: $number) {
        title
        items(first: 100) {
          nodes {
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
}
```

**Simpler alternative**: Since the goal owner is stored in `Goal.githubRepo` as `owner/repo`, call the `user` query first; if the `user.projectV2` returns null, fall back to the `organization` query. For this app (single user, known owner), `user(login: ownerFromRepo)` is sufficient — document the org fallback in a code comment.

**Current implementation note (pragmatic)**: Since all current repos are owned by `jronnomo` (a user), the original `user(login:$login)` query is fine. Use `repositoryOwner` form only if org support is added later.

### 4.4 GraphQL Endpoint

**URL**: `https://api.github.com/graphql`  
**Method**: `POST`  
**Body**: `{ "query": "...", "variables": {...} }`  
**Auth**: `Authorization: Bearer <token>` (same as REST)  
**Scope required**: `project` — confirmed present in jronnomo token scopes: `gist, project, read:org, repo, workflow`

---

## 5. Auth + Headers

### 5.1 Authorization Header

**Verified working**: `Authorization: Bearer <token>` for both REST and GraphQL.

The legacy `token` scheme (`Authorization: token <token>`) is still accepted by GitHub but deprecated. **Use `Bearer`** — this is what the PRD specifies and what `gh` CLI uses internally.

**Recommended headers** (REST + GraphQL):
```ts
{
  "Authorization": `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Accept": "application/vnd.github+json",
  "Content-Type": "application/json",  // for POST/PATCH
}
```

`X-GitHub-Api-Version: 2022-11-28` is confirmed selected by GitHub (verified in response header `X-Github-Api-Version-Selected: 2022-11-28`).

### 5.2 Token Type

The `gh` CLI uses an OAuth token (`gho_...`) stored in the system keyring. This works for:
- REST API private repo access ✓
- GraphQL projects queries ✓ (requires `project` scope — present)
- All verified calls in this research ✓

---

## 6. Codebase Patterns

### 6.1 `registerAll` — current registrations

```typescript
// src/lib/mcp/tools.ts, lines 461-484
export function registerAll(server: McpServer) {
  // ... decodeArgsDeep monkey-patch on server.registerTool ...
  registerReadTools(server);
  registerWriteTools(server);
  registerProjectTools(server);   // ← last registered
}
```

**New call**: `registerGitHubTools(server)` goes AFTER `registerProjectTools(server)`. The `decodeArgsDeep` patch is applied BEFORE all register calls, so GitHub tools automatically inherit it.

### 6.2 `tool-helpers.ts` exports

```typescript
// src/lib/mcp/tool-helpers.ts
export function jsonResult(value: unknown): { content: [{type:"text", text:string}] }
export function errorResult(message: string): { content: [{type:"text", text:string}], isError: true }
export async function safe<T>(fn: () => Promise<T>): Promise<jsonResult | errorResult>
export function parseDateInput(s: string): Date  // bare yyyy-mm-dd → parseDateKey; full ISO → new Date(s)
```

**Import in github-tools.ts**: `import { safe, errorResult, jsonResult } from "@/lib/mcp/tool-helpers";`
**Note**: The GitHub tools need a **module-private** `sanitize + safe` wrapper. The PRD says generic `safe()` is NOT the sanitization layer — implement `ghSafe()` wrapping `safe()` but first replacing the token in error messages.

### 6.3 `update_goal` optional-fields pattern (for `link_github_project`)

```typescript
// src/lib/mcp/tools.ts, lines 4286-4301
const data: Record<string, unknown> = {};
if (input.objective !== undefined) data.objective = input.objective;
if (input.targetDate !== undefined) data.targetDate = ...;
// ... etc.
await prisma.goal.update({ where: { id: input.goalId }, data, select: {...} });
```

**For `link_github_project`**: Always set both fields (both are provided in the tool call — `repo` is required, `projectNumber` is optional):
```typescript
await prisma.goal.update({
  where: { id: input.goalId },
  data: {
    githubRepo: input.repo,
    githubProjectNumber: input.projectNumber ?? null,
  },
  select: { id: true, githubRepo: true, githubProjectNumber: true },
});
```

### 6.4 `ScheduledItem` upsert compound key

**Prisma-generated type** (verified in `src/generated/prisma/models/ScheduledItem.ts`, line 258):
```typescript
goalId_externalRef?: Prisma.ScheduledItemGoalIdExternalRefCompoundUniqueInput
```

**Upsert pattern for `sync_github_milestones`**:
```typescript
await prisma.scheduledItem.upsert({
  where: {
    goalId_externalRef: {
      goalId: input.goalId,
      externalRef: `gh:milestone:${milestone.number}`,
    },
  },
  create: { goalId, externalRef, date, type: "milestone", title, status: "planned", payload: milestone },
  update: { title, date, status, completedAt, payload: milestone },
});
```

### 6.5 `parseDateKey` and `startOfDay` signatures

```typescript
// src/lib/calendar.ts, lines 1224-1232
export function parseDateKey(k: string): Date {
  // k = "yyyy-mm-dd"; returns USER_TZ midnight as UTC Date
  const [y, m, d] = k.split("-").map(Number);
  return userTzWallClockToUTC(y!, m!, d!);
}

export function startOfDay(d: Date): Date {
  // Floors a Date to USER_TZ midnight (not UTC midnight)
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day);
}
```

**Usage in `sync_github_milestones`**:
```typescript
const dateKey = milestone.due_on.slice(0, 10);  // "2026-09-01" from "2026-09-01T07:00:00Z"
const date = parseDateKey(dateKey);              // USER_TZ midnight (NOT startOfDay — parseDateKey already gives midnight)
```
Note: `parseDateKey` already returns USER_TZ midnight — no need to pipe through `startOfDay`. `startOfDay` is used when you have an arbitrary Date and need to floor it. `parseDateInput` in tool-helpers chains `parseDateKey` for the same result.

### 6.6 `Goal.githubRepo` and `Goal.githubProjectNumber` schema fields

```prisma
# prisma/schema.prisma, lines 194-195
githubRepo          String? // "owner/repo" for project goals; null otherwise
githubProjectNumber Int?    // GitHub Projects v2 number for project goals; null otherwise
```

Generated types: `githubRepo: string | null`, `githubProjectNumber: number | null`.

### 6.7 Fetch idiom (usda.ts / food-actions.ts pattern)

```typescript
// AbortSignal.timeout(6000) pattern — 6s timeout
const res = await fetch(url, {
  headers: { ... },
  signal: AbortSignal.timeout(6000),
});
if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
const json = await res.json();
```

**AbortError**: When timeout fires, `fetch` throws a `DOMException` with `name: "TimeoutError"` (in Node 18+: `AbortError`). The error message is `"The operation was aborted."` or `"signal timed out"`. This message can contain no token by definition — but the sanitize layer should still wrap all throws for defense in depth.

---

## 7. Risks & Gotchas

### R-1: `open_issues_count` includes PRs (HIGH IMPACT)

The field name is misleading. The PRD's `get_project_overview` output has separate `openIssues` and `openPRs` fields — compute both from the parallel REST calls. If developer reads `open_issues_count` directly as `openIssues`, the count will be wrong whenever PRs exist. Chewgether: 74 (incl. 2 PRs) vs 72 (issues only).

### R-2: `milestone` param takes NUMBER, not title (MEDIUM IMPACT)

The `list_project_issues` tool exposes `milestone?: string`. Claude (the coach) will naturally try to pass milestone titles. The tool description **must** state: "Pass the milestone NUMBER (integer as string, e.g. `'42'`), `'*'` for any milestone, or `'none'` for no milestone. Milestone titles are not accepted by GitHub." Otherwise the coach will pass `"Sprint 3"` and get 0 results silently.

### R-3: Empty repo 409 on commits endpoint (LOW IMPACT for Chewgether)

Chewgether is not empty, but `ghFetch` must handle non-2xx before JSON-parsing. Specifically, a 409 should return `recentCommits: []` rather than crash. Check `res.ok` before `res.json()`.

### R-4: `pull_request` key in `/issues` response (HANDLED in PRD)

PRD §3.1.8 already requires filtering. Verified on Chewgether: some issues ARE PRs with `pull_request` key set. `filter(i => !i.pull_request)` is the correct idiom.

### R-5: `labels` param is comma-separated string, NOT array (LOW IMPACT)

The `list_project_issues` tool's `label` input is a single string (`label?: string`). When passing to GitHub, use it directly as the `labels` query param. If the coach passes multiple labels, they should be comma-separated in the single string: `"bug,ui"`. The Zod schema should describe this.

### R-6: GraphQL `fieldValueByName` can return null for unset Status (LOW IMPACT)

Some board items may have no Status set. `node.fieldValueByName` returns `null` (not an empty object) — guard with optional chaining before accessing `.name`.

### R-7: `items(first: 100)` pagination limit for large boards (LOW IMPACT now)

Current board has 45 items (well under 100). For future-proofing, add a code comment noting the limit. If the board grows past 100, `pageInfo.hasNextPage` would need to be checked and followed.

### R-8: Token scope — `project` required for GraphQL Projects v2 (ALREADY MET)

Confirmed scopes on jronnomo token: `gist, project, read:org, repo, workflow`. The `project` scope is present. A user-provisioned PAT on Vercel will need the same scopes documented in `.env.example`.

### R-9: ghFetch token sanitization placement (HIGH IMPORTANCE)

PRD §3.1.3: sanitize must happen BEFORE `safe()`, not inside it. Pattern:
```typescript
function sanitize(msg: string): string {
  return msg.replaceAll(process.env.GITHUB_TOKEN ?? "", "[REDACTED]");
}

async function ghSafe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResult(sanitize(msg));
  }
}
```
Do NOT use the generic `safe()` from tool-helpers for GitHub tool handlers — use this module-private `ghSafe()`.

### R-10: `due_on` UTC slice correctness

GitHub returns `due_on` like `"2026-09-01T07:00:00Z"` (always at 07:00 UTC, which is midnight in MT -7). `slice(0,10)` gives `"2026-09-01"` which `parseDateKey` converts to MT midnight. PRD §4.5 says: "Never `new Date(due_on)`." — `new Date("2026-09-01T07:00:00Z")` is fine as an instant but `new Date("2026-09-01")` would give UTC midnight (which is 6pm MT previous day). The `slice + parseDateKey` pattern is correct.

---

## 8. Conventions Checklist for Developer

| # | Convention | Source |
|---|-----------|--------|
| 1 | Import `safe`/`errorResult`/`jsonResult`/`parseDateInput` from `@/lib/mcp/tool-helpers` | tool-helpers.ts |
| 2 | Import `parseDateKey`, `startOfDay` from `@/lib/calendar` | calendar.ts |
| 3 | Import `prisma` from `@/lib/db` | db.ts |
| 4 | Import `Prisma` types from `@/generated/prisma/client` | schema |
| 5 | Export `registerGitHubTools(server: McpServer): void` — no default export | project-tools.ts pattern |
| 6 | Call in `registerAll()` AFTER `registerProjectTools(server)` | tools.ts:483 |
| 7 | Use `McpServer` type from `@modelcontextprotocol/sdk/server/mcp.js` | project-tools.ts:7 |
| 8 | All input fields must have `.describe()` strings | project-tools.ts pattern |
| 9 | `AbortSignal.timeout(6000)` for all fetch calls | usda.ts:250, food-actions.ts:244 |
| 10 | Check `res.ok` BEFORE `res.json()` — throw on non-2xx | food-actions.ts:247 |
| 11 | Token sanitize via `replaceAll(process.env.GITHUB_TOKEN ?? "", "[REDACTED]")` | PRD §3.1.3 |
| 12 | Use module-private `ghSafe()` (not generic `safe()`) for all GitHub handlers | PRD §3.1.3 |
| 13 | `ghFetch` sends auth in `Authorization: Bearer` header only — never token in URL | PRD §3.1.3 |
| 14 | `Authorization: Bearer` + `X-GitHub-Api-Version: 2022-11-28` + `Accept: application/vnd.github+json` | §5.1 |
| 15 | Milestone upsert: `goalId_externalRef` compound key, `externalRef = "gh:milestone:<n>"` | §6.4 |
| 16 | Null `due_on` → skip + increment `skipped` (add code comment) | PRD §3.1.6 |
| 17 | `due_on.slice(0,10)` → `parseDateKey()` for milestone dates; `new Date(closed_at)` for instants | PRD §4.5 |
| 18 | Filter PRs: `issues.filter(i => !i.pull_request)` | §1.6 |
| 19 | Compute `openIssues = open_issues_count - openPRs` — never use `open_issues_count` directly | §1.1 |
| 20 | Describe `milestone` param as NUMBER-as-string or `*`/`none` in tool description | §R-2 |
| 21 | Guard `node.fieldValueByName?.name` with optional chaining in GraphQL column aggregation | §R-6 |
| 22 | `link_github_project` works with no GITHUB_TOKEN (DB-only write; token check only for API tools) | PRD §3.1.5 |
| 23 | Repo input regex: `^[\w.-]+\/[\w.-]+$` (rejects bare names and full URLs) | PRD §3.1.5 |
| 24 | `.env.example` needs `GITHUB_TOKEN` placeholder with scope comment | REQ-006 |
| 25 | Tool descriptions must mention project/non-fitness scope (claude.ai routing) | PRD §3.2.2 |

---

## 9. Contradictions / PRD Clarifications

1. **No contradictions found** between the PRD/requirements and verified GitHub API behavior.

2. **Clarification — `milestone` input type in `list_project_issues`**: PRD §4.2 types it as `milestone?: string` in the Zod schema. This is correct behavior-wise (GitHub accepts it as a query string param), but the tool description MUST say the value is a milestone **number** (not a title). Otherwise Claude will pass human-readable milestone titles and get 0 results.

3. **Clarification — `open_issues_count` arithmetic**: PRD §4.2 output shows `openIssues` and `openPRs` as separate fields. The arithmetic `openIssues = open_issues_count - openPRs` is implied but not stated — documented above.

4. **Clarification — empty repo 409**: PRD §6 does not mention the commits-endpoint 409 for empty repos in its edge cases table. Developer should add a `ghFetch` guard that returns `recentCommits: []` on 409 status from the commits endpoint (not a full error — it's a valid repo state).

5. **GraphQL pagination**: PRD specifies `items(first:100)`. Current board has 45 items — fine for now. No action required, but add a TODO comment.
