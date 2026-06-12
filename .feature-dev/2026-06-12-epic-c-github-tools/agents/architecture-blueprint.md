# Architecture Blueprint — Epic C: GitHub Tool Pack

**Author**: Architect Agent  
**Date**: 2026-06-12  
**Status**: Ready for dev  
**Dev agent scope**: single agent implements everything in this document. Read every section before writing a line.

---

## 1. File Plan

| Action | Path | Purpose | Key exports |
|--------|------|---------|-------------|
| CREATE | `src/lib/mcp/tools/github-tools.ts` | Module-private helpers + all 5 GitHub MCP tools | `registerGitHubTools(server: McpServer): void` |
| EDIT | `src/lib/mcp/tools.ts` | Import + wire into registerAll | (see exact lines below) |
| EDIT | `.env.example` | GITHUB_TOKEN placeholder + scope comment | (docs) |
| EDIT | `.claude/quality-tools.md` | Env-vars reference table + never-echo rule | (docs) |

### Exact tools.ts insertion points

**Import** — add immediately after line 87:
```
// Before (line 87):
import { registerProjectTools } from "@/lib/mcp/tools/project-tools";

// After:
import { registerProjectTools } from "@/lib/mcp/tools/project-tools";
import { registerGitHubTools } from "@/lib/mcp/tools/github-tools";
```

**Call** — add inside registerAll immediately after line 483:
```
// Before (lines 481-484):
  registerReadTools(server);
  registerWriteTools(server);
  registerProjectTools(server);
}

// After:
  registerReadTools(server);
  registerWriteTools(server);
  registerProjectTools(server);
  registerGitHubTools(server);
}
```

The `decodeArgsDeep` monkey-patch is applied at the top of registerAll before any register calls, so GitHub tools inherit it automatically — no extra wiring needed.

---

## 2. Raw GitHub API Type Definitions

Place these at the top of `github-tools.ts`, after imports, before helpers. These are typed casts at the fetch boundary. No `any` anywhere.

```typescript
// --- Raw GitHub REST API shapes (typed cast at fetch boundary) ---------------

interface GhRepo {
  default_branch: string;
  /** CAUTION: includes open PRs in the count — subtract openPRs for true issue count */
  open_issues_count: number;
  private: boolean;
  visibility: string;
}

interface GhMilestone {
  number: number;
  title: string;
  description: string | null;
  /** UTC ISO 8601 datetime, or null when no due date is set */
  due_on: string | null;
  open_issues: number;
  closed_issues: number;
  state: "open" | "closed";
  /** UTC ISO 8601 instant — use new Date(closed_at), NOT parseDateKey */
  closed_at: string | null;
  html_url: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  milestone: { title: string; number: number } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  /** Present only on PR entries — use as a filter flag, never read its value */
  pull_request?: object;
}

interface GhCommit {
  /** Full 40-char SHA — use .slice(0, 7) for display */
  sha: string;
  commit: {
    /** Full message including body — use .split('\n')[0] for first line */
    message: string;
    author: { date: string; name: string };
  };
}

/** Only .length is used; minimal fields are sufficient */
interface GhPull {
  number: number;
}

// --- GraphQL Projects v2 shapes ----------------------------------------------

interface GqlProjectNode {
  /** null when item has no Status field set */
  fieldValueByName: { name: string } | null;
}

interface GqlProjectV2 {
  title: string;
  items: { nodes: GqlProjectNode[] };
}

interface GqlRepositoryOwner {
  /**
   * Both `... on User` and `... on Organization` inline fragments expose
   * the same `projectV2` field — the JSON response merges them at this key.
   */
  projectV2?: GqlProjectV2 | null;
}

interface GqlProjectResponse {
  repositoryOwner?: GqlRepositoryOwner | null;
}
```

---

## 3. Module Skeleton — `src/lib/mcp/tools/github-tools.ts`

### 3.1 Imports Block (all annotated; zero unused)

```typescript
// src/lib/mcp/tools/github-tools.ts
// GitHub tool pack — link, overview, list, sync, patch.
// Module-private sanitize layer: GITHUB_TOKEN is NEVER surfaced in any output.
// See PRD §3.1.3 and §7 for the token-sanitization contract.

import { z } from "zod";
// McpServer: server.registerTool() — same import as project-tools.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Prisma: ScheduledItemUpdateInput, InputJsonValue (payload cast), JsonNull not needed here
import { Prisma } from "@/generated/prisma/client";
// prisma singleton — all DB access
import { prisma } from "@/lib/db";
// parseDateKey: yyyy-mm-dd → USER_TZ midnight Date (used for milestone due dates)
import { parseDateKey } from "@/lib/calendar";
// jsonResult, errorResult: format MCP tool responses
// NOTE: safe() from tool-helpers is NOT used in this module —
//       ghSafe() is the module-private replacement that sanitizes before errorResult.
import { jsonResult, errorResult } from "@/lib/mcp/tool-helpers";
```

**Why `safe` is not imported**: `ghSafe` (defined below) is the sanitization boundary. Importing `safe` and also defining `ghSafe` would be confusing and risks a dev accidentally using the wrong one. Omit it entirely.

**Why `startOfDay` is not imported**: `parseDateKey` already returns USER_TZ midnight. `startOfDay` is for flooring an arbitrary Date to midnight — not needed when starting from a date-string key. (If a future tool needs to floor an existing Date, add it then.)

**Why `dateKey as toDateKey` is not imported**: None of the 5 tools need to convert a Date back to a `yyyy-mm-dd` key for return values. Milestone `date` in sync result is returned as a plain `dateKey` string derived directly from `due_on.slice(0, 10)`, not from a Date round-trip.

### 3.2 Module-Private Helpers

Place all helpers between the imports and the `registerGitHubTools` export. They are module-private by virtue of not being exported.

#### 3.2.1 `ghToken()`

```typescript
/**
 * Reads GITHUB_TOKEN from env. Throws a friendly, non-leaking error when unset.
 * Call at the top of every handler that makes GitHub API calls.
 * link_github_project is DB-only and must NOT call this.
 */
function ghToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "GITHUB_TOKEN not configured — set it in .env (local: `gh auth token`) " +
        "or Vercel environment variables (production). " +
        "Required for all GitHub API calls. link_github_project works without it.",
    );
  }
  return t;
}
```

#### 3.2.2 `sanitize()`

```typescript
/**
 * Replaces GITHUB_TOKEN literal with "[REDACTED]" in any string.
 * Guard: no-op when token is unset or empty (avoids replaceAll("", ...) which
 * would insert [REDACTED] between every character).
 */
function sanitize(msg: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return msg;
  return msg.replaceAll(token, "[REDACTED]");
}
```

#### 3.2.3 `ghSafe()` — the sanitization boundary

```typescript
/**
 * Module-private replacement for safe() from tool-helpers.
 * ALL GitHub tool handlers use this — never the generic safe().
 *
 * Sanitization contract: every throw path in a GitHub handler passes through
 * this catch before being surfaced as an errorResult:
 *   - ghToken() throws "GITHUB_TOKEN not configured..." — no token in message
 *   - ghFetch() throws "GitHub {N}: {body.message}" — GitHub never echoes the
 *     Authorization header value; sanitize() is defense-in-depth
 *   - ghGraphQL() throws sanitized GraphQL error text (sanitized before throw)
 *   - Prisma errors (P2025/P2002) — cannot contain the token by construction
 *   - AbortError ("signal timed out") — no token
 *   - resolveLinkedGoal throws — no token
 * Zod validation errors are handled by the MCP framework before the handler
 * runs and never reach this catch.
 */
async function ghSafe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResult(sanitize(msg));
  }
}
```

**Coverage proof**: The token travels only in the `Authorization: Bearer` HTTP header, set inside `ghFetch`/`ghGraphQL`. GitHub's error response bodies never echo the Authorization header value (verified empirically — GitHub reflects request body fields only, not headers). Therefore the only theoretical path where the token could appear in an error message is if the developer mistakenly included it in a URL or body string. `ghSafe`'s catch sanitizes that too. This single-boundary strategy is provably sufficient; defense-in-depth via ghGraphQL's pre-throw sanitize (see §3.2.5) adds a second layer on the GraphQL path.

#### 3.2.4 `ghFetch()` — base REST helper

```typescript
const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";
const GH_TIMEOUT_MS = 10_000; // 10s — GitHub can be slower than USDA/food APIs (6s)

/**
 * Authenticated GitHub REST call. Returns parsed JSON + response headers.
 *
 * Headers tuple is returned (not discarded) so callers can read
 * X-RateLimit-Remaining from the repo-meta response in get_project_overview.
 * Callers that don't need headers just destructure: const { data } = await ghFetch(...).
 *
 * Error contract:
 *   - non-2xx: reads GitHub error body (best-effort JSON parse), throws
 *     Error(`GitHub {status}: {body.message}`). If body is not JSON, throws
 *     Error(`GitHub HTTP {status}`). The message never contains the token
 *     (GitHub does not echo Authorization header values in error bodies).
 *   - Timeout (AbortError): propagates as-is ("signal timed out" — no token).
 *   - Callers can inspect e.message for status codes (e.g. "GitHub 404:")
 *     to provide friendly, context-specific error messages.
 *
 * 409 on commits endpoint (empty repo): throw with "GitHub 409:" prefix.
 * The get_project_overview handler catches this and returns recentCommits: [].
 */
async function ghFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  const token = ghToken();
  const res = await fetch(`${GH_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GH_API_VERSION,
      "Content-Type": "application/json",
      // spread caller-provided headers last so they can override if needed
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(GH_TIMEOUT_MS),
  });

  if (!res.ok) {
    let msg = `GitHub HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = `GitHub ${res.status}: ${body.message}`;
    } catch {
      // body is not JSON — use status-only message
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as T;
  return { data, headers: res.headers };
}
```

#### 3.2.5 `ghGraphQL()` — GraphQL helper

```typescript
/**
 * Authenticated GitHub GraphQL call. Returns the `data` field of the response.
 *
 * Error contract:
 *   - HTTP non-2xx: same as ghFetch (reads body.message, throws).
 *   - GraphQL `errors` array present: joins error messages and throws.
 *     Messages are sanitized before throw (defense-in-depth — GraphQL errors
 *     can theoretically reflect query variables, and paranoia is cheap here).
 *   - Callers should treat null projectV2 as "project not found or no access"
 *     and set projectBoard: null without re-throwing.
 */
async function ghGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = ghToken();
  const res = await fetch(`${GH_API_BASE}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GH_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(GH_TIMEOUT_MS),
  });

  if (!res.ok) {
    let msg = `GitHub GraphQL HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = `GitHub GraphQL ${res.status}: ${body.message}`;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    // Sanitize before throw — defense in depth (GraphQL errors CAN reflect variables)
    const combined = body.errors.map((e) => e.message).join("; ");
    throw new Error(sanitize(`GitHub GraphQL errors: ${combined}`));
  }

  return body.data as T;
}
```

#### 3.2.6 `PROJECTS_V2_QUERY` constant

```typescript
/**
 * Polymorphic query — handles both User and Organization owners via
 * `repositoryOwner` interface fragments. Both fragments expose `projectV2`
 * at the same JSON key, so TypeScript can access it as
 * gqlData.repositoryOwner?.projectV2 regardless of owner type.
 *
 * items(first: 100): current board (2026-06-12) has 45 items — well under limit.
 * TODO: if board grows past 100, add pageInfo.hasNextPage + cursor pagination.
 */
const PROJECTS_V2_QUERY = `
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
`;
```

#### 3.2.7 `resolveLinkedGoal()`

```typescript
/**
 * Fetch a goal's GitHub link fields. Throws friendly errors on:
 *   - goal not found
 *   - no repo linked (suggests link_github_project)
 *
 * Kind check: does NOT hard-block fitness goals (unlike project-tools' schedule_item).
 * Rationale: GitHub tools are bound to the presence of a githubRepo link, not goal kind.
 * A goal with a linked repo implies deliberate intent regardless of kind. The tool
 * descriptions carry the "project goals primarily" routing hint. If the user links a
 * fitness goal to a repo, the tools work — that's a feature, not a bug.
 */
async function resolveLinkedGoal(goalId: string): Promise<{
  owner: string;
  repo: string;
  fullRepo: string;
  projectNumber: number | null;
}> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true, githubRepo: true, githubProjectNumber: true },
  });
  if (!goal) throw new Error(`Goal not found: ${goalId}`);
  if (!goal.githubRepo) {
    throw new Error(
      `No GitHub repo linked to goal ${goalId} — call link_github_project first.`,
    );
  }
  const [owner, repo] = goal.githubRepo.split("/");
  return {
    owner: owner!,
    repo: repo!,
    fullRepo: goal.githubRepo,
    projectNumber: goal.githubProjectNumber,
  };
}
```

---

## 4. Per-Tool Specs

### 4.1 `link_github_project`

**REQ-001 / Issue #30 / Complexity: S**

**Title**: "Link a goal to a GitHub repository and optional Projects v2 board"

**Description string** (exact, multi-sentence):
```
"Bind a goal to a GitHub repository (and optionally a GitHub Projects v2 board number) " +
"so the other GitHub tools can operate on it. This is the prerequisite step — call it " +
"before get_project_overview, list_project_issues, sync_github_milestones, or " +
"set_github_issue_status. Primarily for project goals (e.g. chewgether); fitness goals can " +
"be linked but GitHub tools are most useful for project-kind goals. " +
"repo must be in 'owner/repo' format (e.g. 'jronnomo/Chewgether'). " +
"Bare names ('Chewgether') and full URLs ('https://github.com/...') are rejected by the " +
"input schema. projectNumber, if provided, enables Projects v2 board column breakdown in " +
"get_project_overview — it is the integer from the project URL " +
"(github.com/users/{owner}/projects/{N}). " +
"This tool performs a database-only write and requires no GITHUB_TOKEN."
```

**Zod inputSchema**:
```typescript
{
  goalId: z
    .string()
    .describe(
      "ID of the goal to link. Use list_goals to discover ids.",
    ),
  repo: z
    .string()
    .regex(
      /^[\w.-]+\/[\w.-]+$/,
      "Must be owner/repo format (e.g. jronnomo/Chewgether). " +
        "Bare names and full GitHub URLs are rejected.",
    )
    .describe(
      "GitHub repository in 'owner/repo' format (e.g. 'jronnomo/Chewgether'). " +
        "Bare names and full URLs are rejected.",
    ),
  projectNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "GitHub Projects v2 board number (positive integer). " +
        "Found in the project URL: github.com/users/{owner}/projects/{N}. " +
        "When set, get_project_overview returns projectBoard column breakdown. " +
        "Omit to clear any previously set project number.",
    ),
}
```

**Handler pseudocode**:
```typescript
async (input) =>
  ghSafe(async () => {
    // Existence check (friendly error on bad goalId)
    const goal = await prisma.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true, objective: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

    // DB write — always set both fields; projectNumber null when omitted
    // (optional-field pattern: always write both because repo is required and
    // projectNumber defaults to null, so this is simpler than a conditional build)
    const updated = await prisma.goal.update({
      where: { id: input.goalId },
      data: {
        githubRepo: input.repo,
        githubProjectNumber: input.projectNumber ?? null,
      },
      select: { id: true, githubRepo: true, githubProjectNumber: true },
    });

    return {
      goalId: updated.id,
      githubRepo: updated.githubRepo,
      githubProjectNumber: updated.githubProjectNumber,
      message:
        `Goal linked to ${input.repo}` +
        (input.projectNumber ? ` (Projects v2 board #${input.projectNumber})` : "") +
        ".",
    };
  })
```

**No `ghToken()` call** — this tool is DB-only. Token gate only in API tools.

**Return shape**: `{ goalId: string, githubRepo: string, githubProjectNumber: number | null, message: string }`

---

### 4.2 `get_project_overview`

**REQ-002 / Issue #31 / Complexity: M**

**Title**: "One-call GitHub snapshot for a project goal"

**Description string**:
```
"Retrieve a comprehensive GitHub snapshot for a project goal in a single call: " +
"repo metadata (default branch), accurate open issue count (pull requests excluded), " +
"open PR count, all milestones (open and closed, with due dates and issue counts), " +
"last 5 commits, an optional Projects v2 board breakdown by status column, and the " +
"remaining GitHub API rate limit. Use at the start of a coaching session to ground " +
"project review without copy-paste. Requires the goal to have a GitHub repo linked " +
"via link_github_project. Projects v2 board columns are populated only when a " +
"projectNumber was set via link_github_project — otherwise projectBoard is null. " +
"IMPORTANT: open_issues_count from GitHub includes PRs; this tool subtracts openPRs " +
"for the accurate openIssues count. Requires GITHUB_TOKEN with 'repo' scope (plus " +
"'read:project' scope for Projects v2 board columns). rateLimitRemaining reflects " +
"the core bucket (5000/hr for authenticated users)."
```

**Zod inputSchema**:
```typescript
{
  goalId: z
    .string()
    .describe(
      "ID of a goal linked to a GitHub repo via link_github_project.",
    ),
}
```

**Handler pseudocode** (full detail):
```typescript
async (input) =>
  ghSafe(async () => {
    const { owner, repo, fullRepo, projectNumber } = await resolveLinkedGoal(input.goalId);
    ghToken(); // validates token before any network call

    // Parallel REST calls — all hit the core rate-limit bucket (5000/hr authed).
    // Commits call has a 409 guard: empty repos return 409 Conflict on /commits.
    // Wrap it so Promise.all doesn't reject on 409; recentCommits stays [].
    const commitsFetch = ghFetch<GhCommit[]>(
      `/repos/${owner}/${repo}/commits?per_page=5`,
    ).catch((e: unknown) => {
      if (e instanceof Error && e.message.includes("409")) {
        // Empty repo — not an error; return empty array with dummy headers
        return { data: [] as GhCommit[], headers: new Headers() };
      }
      return Promise.reject(e);
    });

    const [
      { data: repoData, headers: repoHeaders },
      { data: pulls },
      { data: milestones },
      { data: rawCommits },
    ] = await Promise.all([
      ghFetch<GhRepo>(`/repos/${owner}/${repo}`),
      ghFetch<GhPull[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`),
      // state=all: show both open and closed milestones for a complete snapshot
      ghFetch<GhMilestone[]>(`/repos/${owner}/${repo}/milestones?state=all&per_page=100`),
      commitsFetch,
    ]);

    // open_issues_count includes PRs — subtract for accurate issue count (R-1)
    const openPRs = pulls.length;
    const openIssues = repoData.open_issues_count - openPRs;
    const rateLimitRemaining = parseInt(
      repoHeaders.get("x-ratelimit-remaining") ?? "-1",
      10,
    );

    // Optional Projects v2 board via GraphQL (only when projectNumber is set)
    let projectBoard: { columns: Array<{ name: string; cardCount: number }> } | null = null;
    if (projectNumber !== null) {
      try {
        const gqlData = await ghGraphQL<GqlProjectResponse>(PROJECTS_V2_QUERY, {
          login: owner,
          number: projectNumber,
        });
        const pv2 = gqlData.repositoryOwner?.projectV2;
        if (pv2) {
          const nodes = pv2.items.nodes;
          // Aggregate by Status name; items with no Status → "(no status)" bucket
          // so the coach sees the complete card count, not just classified ones.
          const colMap: Record<string, number> = {};
          for (const node of nodes) {
            const name = node.fieldValueByName?.name ?? "(no status)";
            colMap[name] = (colMap[name] ?? 0) + 1;
          }
          projectBoard = {
            columns: Object.entries(colMap).map(([name, cardCount]) => ({
              name,
              cardCount,
            })),
          };
        }
        // pv2 === null means project not found / no access — projectBoard stays null
      } catch {
        // GraphQL errors are non-fatal for the overview; return null projectBoard.
        // The error is swallowed here (not re-thrown) so overview still succeeds.
        projectBoard = null;
      }
    }

    return {
      repo: fullRepo,
      defaultBranch: repoData.default_branch,
      openIssues,
      openPRs,
      milestones: milestones.map((m) => ({
        number: m.number,
        title: m.title,
        dueOn: m.due_on ? m.due_on.slice(0, 10) : null,  // yyyy-mm-dd or null
        openIssues: m.open_issues,
        closedIssues: m.closed_issues,
        state: m.state,
      })),
      recentCommits: rawCommits.map((c) => ({
        sha: c.sha.slice(0, 7),                           // 7-char short SHA
        message: c.commit.message.split("\n")[0] ?? "",   // first line only
        date: c.commit.author.date,                       // ISO instant; pass as-is
        author: c.commit.author.name,
      })),
      projectBoard,
      rateLimitRemaining,
    };
  })
```

**Return shape** (§4.2 canonical):
```typescript
{
  repo: string;
  defaultBranch: string;
  openIssues: number;
  openPRs: number;
  milestones: Array<{
    number: number;
    title: string;
    dueOn: string | null;   // yyyy-mm-dd or null
    openIssues: number;
    closedIssues: number;
    state: "open" | "closed";
  }>;
  recentCommits: Array<{
    sha: string;      // 7 chars
    message: string;  // first line only
    date: string;     // ISO 8601 UTC
    author: string;
  }>;
  projectBoard: { columns: Array<{ name: string; cardCount: number }> } | null;
  rateLimitRemaining: number;
}
```

**Design decisions recorded here**:
- `milestones?state=all`: shows both open and closed milestones. A partial snapshot (open only) would obscure just-closed milestones. Correct for a session-start briefing.
- `rawCommits` deferred outside `Promise.all` wrapping: the 409-catch `.catch()` creates a new Promise that resolves normally, so it CAN go inside `Promise.all` — the approach above uses this correctly.
- `projectBoard` GraphQL errors are swallowed (non-fatal) to keep the overview reliable. The coach gets a null board and can investigate separately.
- Items with no Status → `"(no status)"` column: included for complete card visibility, not silently dropped.

---

### 4.3 `list_project_issues`

**REQ-003 / Issue #32 / Complexity: S**

**Title**: "List GitHub issues for a project goal with optional filters"

**Description string**:
```
"List GitHub issues for a project goal, optionally filtered by state, label, and milestone. " +
"Pull requests are automatically excluded — the GitHub /issues endpoint returns both issues " +
"and PRs; this tool filters out entries with a pull_request field. " +
"IMPORTANT: the milestone filter requires the milestone NUMBER as a string (e.g. '42'), " +
"NOT the milestone title — passing a title silently returns 0 results. " +
"Use '*' to match any milestone, 'none' to match issues with no milestone. " +
"Labels are comma-separated when filtering by multiple (e.g. 'bug,ui'). " +
"Requires the goal to have a GitHub repo linked via link_github_project. " +
"Requires GITHUB_TOKEN with 'repo' scope. " +
"Use for weekly review, sprint planning, and issue triage in a coaching session."
```

**Zod inputSchema**:
```typescript
{
  goalId: z
    .string()
    .describe("ID of a goal linked to a GitHub repo via link_github_project."),
  state: z
    .enum(["open", "closed", "all"])
    .default("open")
    .describe("Issue state filter. Default: open."),
  label: z
    .string()
    .optional()
    .describe(
      "Filter by label. Comma-separated for multiple (e.g. 'bug,ui'). " +
        "Matches issues that have ALL specified labels. Omit to return all labels.",
    ),
  milestone: z
    .string()
    .optional()
    .describe(
      "Filter by milestone. MUST be the milestone NUMBER as a string (e.g. '42'), " +
        "NOT the milestone title — titles silently return 0 results. " +
        "Use '*' for any milestone, 'none' for issues with no milestone. " +
        "Omit to return all issues regardless of milestone.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe("Max issues to return (1–100). Default 30."),
}
```

**Handler pseudocode**:
```typescript
async (input) =>
  ghSafe(async () => {
    const { owner, repo } = await resolveLinkedGoal(input.goalId);
    ghToken();

    // Build query params — label and milestone are optional passthroughs
    const params = new URLSearchParams({
      state: input.state,
      per_page: String(input.limit),
    });
    if (input.label) params.set("labels", input.label);
    if (input.milestone) params.set("milestone", input.milestone);

    const { data: raw } = await ghFetch<GhIssue[]>(
      `/repos/${owner}/${repo}/issues?${params.toString()}`,
    );

    // Filter out pull requests — entries with pull_request key are PRs (R-4)
    const issues = raw.filter((i) => !i.pull_request);

    return {
      count: issues.length,
      issues: issues.map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: i.labels.map((l) => l.name),
        milestone: i.milestone?.title ?? null,   // human-readable title in OUTPUT
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        url: i.html_url,
      })),
    };
  })
```

**Note on milestone field**: The INPUT `milestone` param is a NUMBER-string (API requirement). The OUTPUT `milestone` is the human-readable `title` string. This is intentional and must be preserved.

**Return shape**:
```typescript
{
  count: number;
  issues: Array<{
    number: number;
    title: string;
    state: "open" | "closed";
    labels: string[];
    milestone: string | null;  // milestone title, or null
    createdAt: string;
    updatedAt: string;
    url: string;
  }>;
}
```

---

### 4.4 `sync_github_milestones`

**REQ-004 / Issue #33 / Complexity: M**

**Title**: "Idempotent sync of GitHub milestones into ScheduledItems"

**Description string**:
```
"Idempotent sync of GitHub milestones into ScheduledItems — mirrors milestone due dates " +
"onto the goal calendar and Today spine so coaching sessions can reason about deadlines " +
"without live GitHub API calls at query time. Run after creating or updating milestones " +
"in GitHub. Safe to re-run: creates 0 duplicate rows (upsert on goalId + externalRef key " +
"'gh:milestone:{number}'). " +
"Milestones with no due_on are skipped (counted in 'skipped' — they cannot be anchored " +
"to the calendar). Due dates are bucketed to USER_TZ midnight (Mountain Time) by slicing " +
"the UTC ISO string to yyyy-mm-dd and calling parseDateKey — never via new Date(due_on). " +
"closeCompleted: when true, also syncs closed milestones as status='done' with completedAt " +
"from GitHub's closed_at field (which IS a UTC instant — stored via new Date(closed_at)). " +
"Requires a GitHub repo linked via link_github_project. Requires GITHUB_TOKEN 'repo' scope."
```

**Zod inputSchema**:
```typescript
{
  goalId: z
    .string()
    .describe("ID of a goal linked to a GitHub repo via link_github_project."),
  closeCompleted: z
    .boolean()
    .default(false)
    .describe(
      "When true, also syncs closed GitHub milestones as ScheduledItems with " +
        "status='done' and completedAt from GitHub's closed_at timestamp. " +
        "Default false — only open milestones are synced.",
    ),
}
```

**Handler pseudocode** (full detail — this is the most complex tool):
```typescript
async (input) =>
  ghSafe(async () => {
    const { owner, repo } = await resolveLinkedGoal(input.goalId);
    ghToken();

    // Fetch milestones: state=all when closeCompleted (need open + closed);
    // state=open when closeCompleted=false (skip closed entirely — saves a round-trip)
    const state = input.closeCompleted ? "all" : "open";
    const { data: milestones } = await ghFetch<GhMilestone[]>(
      `/repos/${owner}/${repo}/milestones?state=${state}&per_page=100`,
    );

    // Pre-query existing externalRefs for this goal to compute synced vs updated counts.
    // prisma.upsert does not expose whether it performed a create or update — we infer
    // from whether the externalRef was in the DB before the loop.
    const existingRows = await prisma.scheduledItem.findMany({
      where: {
        goalId: input.goalId,
        externalRef: { startsWith: "gh:milestone:" },
      },
      select: { externalRef: true },
    });
    const existingRefs = new Set(existingRows.map((r) => r.externalRef));

    let synced = 0;  // newly created rows
    let updated = 0; // rows that already existed (updated in place)
    let skipped = 0; // milestones with null due_on — cannot be calendar-anchored
    const items: Array<{ externalRef: string; title: string; date: string }> = [];

    for (const m of milestones) {
      const externalRef = `gh:milestone:${m.number}`;

      // null due_on → skip. GitHub milestones without a due date cannot be placed
      // on the calendar spine. Per PRD §3.1.6: count in skipped, do not upsert.
      if (m.due_on === null) {
        skipped++;
        continue;
      }

      // due_on is UTC ISO like "2026-09-01T07:00:00Z".
      // slice(0,10) gives "2026-09-01". parseDateKey converts to USER_TZ midnight.
      // NEVER use new Date(m.due_on) directly — that gives UTC midnight (wrong TZ for MT).
      const dateKey = m.due_on.slice(0, 10);
      const date = parseDateKey(dateKey);

      // Determine status and completedAt for closed milestones
      const isClosed = input.closeCompleted && m.state === "closed";
      const status = isClosed ? "done" : "planned";
      // closed_at is a UTC instant — new Date() is correct here (not parseDateKey)
      const completedAt =
        isClosed && m.closed_at ? new Date(m.closed_at) : null;

      await prisma.scheduledItem.upsert({
        where: {
          goalId_externalRef: { goalId: input.goalId, externalRef },
        },
        create: {
          goalId: input.goalId,
          externalRef,
          date,
          type: "milestone",
          title: m.title,
          detail: m.description ?? null,
          status,
          completedAt,
          // Store full raw milestone object as payload for future reference
          payload: m as unknown as Prisma.InputJsonValue,
        },
        update: {
          title: m.title,
          detail: m.description ?? null,
          date,
          status,
          completedAt,
          payload: m as unknown as Prisma.InputJsonValue,
        },
      });

      // Count create vs update using pre-queried set
      if (existingRefs.has(externalRef)) {
        updated++;
      } else {
        synced++;
      }

      items.push({ externalRef, title: m.title, date: dateKey });
    }

    return { synced, updated, skipped, items };
  })
```

**Return shape**:
```typescript
{
  synced: number;   // newly created ScheduledItem rows
  updated: number;  // pre-existing rows updated in place
  skipped: number;  // milestones with null due_on (no calendar anchor)
  items: Array<{
    externalRef: string;  // "gh:milestone:42"
    title: string;
    date: string;         // yyyy-mm-dd in USER_TZ
  }>;
}
```

**Idempotency guarantee**: upsert on `goalId_externalRef` (@@unique in schema.prisma L225). A second run with the same milestones produces 0 new rows — all upserts hit the `update` path. `synced` would be 0, `updated` would equal the milestone count.

---

### 4.5 `set_github_issue_status`

**REQ-005 / Issue #34 / Complexity: S**

**Title**: "Open or close a GitHub issue"

**Description string**:
```
"Open or close a GitHub issue from a coaching session — enables triage during weekly " +
"reviews without leaving claude.ai. Idempotent: closing an already-closed issue returns " +
"success (GitHub returns 200). Requires the issue number (integer), NOT the issue title. " +
"Use list_project_issues to discover issue numbers. Requires a GitHub repo linked via " +
"link_github_project. Requires GITHUB_TOKEN with 'repo' scope. " +
"For project goals primarily — fitness goals should not have linked GitHub repos."
```

**Zod inputSchema**:
```typescript
{
  goalId: z
    .string()
    .describe(
      "ID of a goal linked to a GitHub repo via link_github_project.",
    ),
  issueNumber: z
    .number()
    .int()
    .positive()
    .describe(
      "GitHub issue number (positive integer from the issue URL or list_project_issues output).",
    ),
  state: z
    .enum(["open", "closed"])
    .describe(
      "'closed' to close the issue, 'open' to reopen it. " +
        "Closing an already-closed issue is idempotent (succeeds, returns 200).",
    ),
}
```

**Handler pseudocode**:
```typescript
async (input) =>
  ghSafe(async () => {
    const { owner, repo, fullRepo } = await resolveLinkedGoal(input.goalId);
    ghToken();

    // PATCH issue state. 404 → friendly error naming issue number and repo.
    // Already-closed → 200 success (GitHub is idempotent on state — PRD §4.2).
    let issueData: GhIssue;
    try {
      const { data } = await ghFetch<GhIssue>(
        `/repos/${owner}/${repo}/issues/${input.issueNumber}`,
        {
          method: "PATCH",
          body: JSON.stringify({ state: input.state }),
        },
      );
      issueData = data;
    } catch (e) {
      // Convert the ghFetch "GitHub 404: Not Found" throw into a context-rich message
      if (e instanceof Error && e.message.includes("404")) {
        throw new Error(
          `Issue #${input.issueNumber} not found in ${fullRepo}.`,
        );
      }
      throw e; // re-throw all other errors (sanitized by ghSafe's catch)
    }

    return {
      issueNumber: issueData.number,
      title: issueData.title,
      state: issueData.state,
      url: issueData.html_url,
      message: `Issue #${issueData.number} is now ${issueData.state}.`,
    };
  })
```

**Return shape**:
```typescript
{
  issueNumber: number;
  title: string;
  state: "open" | "closed";
  url: string;
  message: string;
}
```

---

## 5. Data Flow

```
claude.ai coaching session
       │
       ▼ MCP tools/call (HTTP POST /api/mcp, Bearer MCP_AUTH_TOKEN)
registerGitHubTools handler
       │
       ├─ resolveLinkedGoal(goalId)
       │       └─▶ prisma.goal.findUnique ──▶ { owner, repo, projectNumber }
       │
       ├─ ghToken()
       │       └─▶ process.env.GITHUB_TOKEN (throws if unset/empty)
       │
       ├─ ghFetch(path, init?)
       │       └─▶ fetch(api.github.com/...) ──▶ { data: T, headers: Headers }
       │               └─ non-2xx: throw Error("GitHub {N}: {msg}")
       │
       ├─ ghGraphQL(query, vars)  [get_project_overview only]
       │       └─▶ fetch(api.github.com/graphql) ──▶ data: T
       │               └─ errors[]: throw Error(sanitize("GitHub GraphQL errors: ..."))
       │
       └─ prisma write  [link, sync, set_status]
               └─▶ scheduledItem.upsert / goal.update
                        │
                        ▼
                 ghSafe catch boundary
                        │
                        ├─ sanitize(e.message)  →  "[REDACTED]" replaces token
                        └─ errorResult(sanitizedMsg)
```

---

## 6. Docs Deliverables (REQ-006)

### 6.1 `.env.example` — addition (append after `MCP_AUTH_TOKEN` line)

```
# GitHub Personal Access Token for the GitHub tool pack (Epic C).
# Required for: get_project_overview, list_project_issues,
#               sync_github_milestones, set_github_issue_status.
# NOT required for: link_github_project (DB write only).
# Scopes needed: repo (private repo read/write) + read:project (Projects v2 board).
# Local: run `gh auth token` and paste the output.
# Vercel: set via dashboard → Settings → Environment Variables (never paste in CLI).
# NEVER echo this value in scripts or commit it — .env is gitignored.
GITHUB_TOKEN="ghp_your_github_token_here"
```

### 6.2 `.claude/quality-tools.md` — new section (append at end of file)

```markdown
---

## Environment Variables

| Variable | Where set | Required for | Scope / Notes |
|----------|-----------|-------------|---------------|
| `DATABASE_URL` | `.env` / Vercel | All DB access | Neon Postgres connection string |
| `MCP_AUTH_TOKEN` | `.env` / Vercel | MCP endpoint auth (`/api/mcp`) | 32-byte hex; generate with `openssl rand -hex 32`; never echo in scripts |
| `GITHUB_TOKEN` | `.env` / Vercel | GitHub tool pack (Epic C) | PAT scopes: `repo` + `read:project`. Local: `gh auth token`. Vercel: set via dashboard, NOT CLI. `link_github_project` works without it. |

**Never-echo rule**: none of these values may appear in log output, curl commands, tool responses, captured artifacts, or committed files. The GitHub tool pack has a module-private `sanitize()` layer that redacts `GITHUB_TOKEN` from all error messages before surfacing them via MCP. `.env` is gitignored. `.env.example` contains placeholder strings only.

**Vercel note**: after adding `GITHUB_TOKEN` to Vercel environment variables, trigger a redeploy for the new env to be available to the running instance. The MCP connector in claude.ai caches tool lists — if tool count or names change, the connector may need a disconnect/reconnect to pick up the new tools.
```

---

## 7. Implementation Order

The single dev agent should follow this sequence:

1. **Scaffold `github-tools.ts`** — file header comment, all imports, all module-private helpers (`ghToken`, `sanitize`, `ghSafe`, `ghFetch`, `ghGraphQL`, `PROJECTS_V2_QUERY`, `resolveLinkedGoal`), and an empty `registerGitHubTools` function that compiles. Raw type definitions go here too.

2. **Wire `tools.ts`** — add the import line after L87, add the `registerGitHubTools(server)` call after L483. Verify `tsc --noEmit` passes before continuing (catches import path errors early).

3. **Implement `link_github_project`** — first tool because it requires no GITHUB_TOKEN and can be fully tested with a DB call. Smoke: create goal → link → verify DB fields via `get_goal`.

4. **Implement `get_project_overview`** — establishes the full `ghFetch` + `headers` + `ghGraphQL` + `Promise.all` + 409-guard pattern that all remaining tools build on. Most complex network logic; get it right here before copy-pasting anything.

5. **Implement `list_project_issues`** — straightforward REST + PR filter. Wire in the `ghFetch` pattern established in step 4.

6. **Implement `sync_github_milestones`** — most complex prisma logic (pre-query + upsert loop + date semantics). Implement date conversion carefully: `due_on.slice(0,10)` → `parseDateKey`, never `new Date(due_on)`. Verify the `existingRefs` Set counts are correct on a dry run before testing idempotency.

7. **Implement `set_github_issue_status`** — PATCH with 404 handler. Test the already-closed case to confirm GitHub returns 200 (not an error).

8. **Add docs** — edit `.env.example` (append GITHUB_TOKEN block) and `.claude/quality-tools.md` (append env-vars section). These are pure text edits with no risk of breaking TypeScript.

9. **Run QA gates** in order: `npx tsc --noEmit` → `npm run lint` → `npm run build`. Fix any errors before handing off.

10. **QA smoke** (separate QA-agent scope per REQ-007): PRD §10.2 runbook live against Chewgether — `tools/list` count 88; temp goal + milestones; double-sync idempotency; USER_TZ bucketing assert; token grep = 0 hits; full cleanup.

---

## 8. Critical Decisions

### D-1: Sanitize strategy — single boundary in `ghSafe`, defense-in-depth in `ghGraphQL`

**Decision**: `ghSafe` is the primary sanitization boundary. It catches every throw from the handler body and runs `sanitize(msg)` before `errorResult`. `ghGraphQL` also sanitizes before throw (second layer, GraphQL-path-only).

**Coverage proof**:
- `ghToken()` throws "GITHUB_TOKEN not configured…" — contains no token ✓
- `ghFetch()` non-2xx error message is built from `res.status` (number) + `body.message` (GitHub's error description, which does NOT echo the Authorization header — GitHub reflects request body values only, never headers) ✓
- `ghGraphQL()` error message is explicitly sanitized before throw ✓
- Timeout / AbortError: "signal timed out" — contains no token ✓
- Prisma errors (P2025/P2002): messages reference record IDs and field names — no token ✓
- `resolveLinkedGoal` throws: "Goal not found: {id}" or "No GitHub repo linked…" — no token ✓
- Zod validation errors: handled by MCP framework before handler body runs — never reach `ghSafe` ✓

Generic `safe()` from tool-helpers is NOT imported. Using it would bypass sanitization if a developer accidentally called it instead of `ghSafe`. Omitting the import makes the error surface at compile time.

### D-2: `milestones?state=all` in `get_project_overview`

**Decision**: Use `state=all` (not `state=open`).

**Rationale**: The overview is a session-start briefing for the coach. Showing only open milestones hides recently-closed milestones that are still visible in the coaching context (e.g., "we just shipped Sprint 2 — it should be closed"). `state=all` gives a complete snapshot. Each milestone object includes `state: "open" | "closed"` so the coach can filter mentally.

### D-3: Commit message truncation

**Decision**: `sha.slice(0, 7)` for SHA (7-char git short format); `commit.message.split('\n')[0]` for first line (no additional character truncation).

**Rationale**: First-line of a commit message is conventionally ≤72 chars. Truncating further (e.g., to 60 chars) loses information for no benefit. The coach sees the full first line.

### D-4: `synced`/`updated` counting — pre-query Set

**Decision**: Before the upsert loop, `findMany` existing externalRefs matching `gh:milestone:*` for this goalId into a `Set<string | null>`. In the loop, `existingRefs.has(externalRef)` → `updated++` else `synced++`.

**Rationale**: Prisma's `upsert` does not expose whether it performed a CREATE or UPDATE. The alternatives — `findUnique` per milestone (N+1 DB calls) or `upsertMany` with a return value (not supported in Prisma) — are worse. A single `findMany` before the loop is O(1) in DB round-trips and O(1) per-milestone in memory (Set lookup). The pre-query snapshot is taken before the loop starts, so new externalRefs created during the loop correctly count as `synced`.

### D-5: GraphQL no-Status items → `"(no status)"` column

**Decision**: Items with `fieldValueByName === null` (no Status set) are bucketed into a `"(no status)"` column in `projectBoard.columns`.

**Rationale**: Silently dropping unclassified items would misrepresent the board's total card count. The coach can see "N unclassified items" and decide to triage them. The `"(no status)"` string is self-documenting.

### D-6: `resolveLinkedGoal` does NOT hard-block by `kind`

**Decision**: `resolveLinkedGoal` checks only that the goal exists and has a `githubRepo` set — it does NOT throw if `kind !== 'project'`.

**Rationale**: GitHub tools are semantically bound to the presence of a GitHub repo link, not to the goal kind field. A fitness goal could theoretically track a training-app codebase. The `link_github_project` tool description says "primarily for project goals" (soft routing guidance). The distinction from `schedule_item` (which hard-blocks non-project kinds) is principled: `ScheduledItem` rows are project-domain objects that make no sense on a fitness goal; GitHub repo links are an orthogonal concern.

### D-7: `AbortSignal.timeout(10_000)` — 10 s, not 6 s

**Decision**: 10-second timeout for all GitHub calls.

**Rationale**: The codebase's existing fetch idiom uses 6 s (USDA/food-actions). GitHub's API, especially the GraphQL endpoint under load, can be slower. 10 s is GitHub's own recommended timeout for API consumers. Chewgether is a private repo on a free-tier org — no SLA. 10 s provides a meaningful timeout without false positives.

### D-8: `closeCompleted` milestone fetch strategy

**Decision**: When `closeCompleted=false`, fetch `state=open` (avoids fetching closed milestones that are immediately discarded). When `closeCompleted=true`, fetch `state=all` (single call, gets both open and closed). Do NOT make two separate calls.

**Rationale**: Minimizes API calls. When `closeCompleted=false`, the developer should not fetch-and-discard closed milestones — it wastes rate-limit and latency for the common case.

### D-9: `detail` field handling in `sync_github_milestones`

**Decision**: Map `m.description` → `detail` in both `create` and `update` paths. Use `m.description ?? null` (coerce empty string to null? No — keep empty string as-is; GitHub `description` is either a non-empty string or `null`).

**Rationale**: `description` is `string | null` per the API. Prisma `ScheduledItem.detail` is `String?` — null-safe. No special handling needed.

### D-10: `404` detection in `set_github_issue_status`

**Decision**: Detect 404 by checking `e.message.includes("404")` (ghFetch throws `"GitHub 404: Not Found"` or `"GitHub HTTP 404"`).

**Rationale**: Using a custom error class (`GhApiError extends Error`) would be cleaner but adds surface area. The string check on `"404"` is consistent, unambiguous (no other GitHub status code contains "404"), and readable. If a more robust approach is later needed, introducing `GhApiError` is a contained change.

---

## 9. Final Summary and Open Concerns

### What this blueprint specifies

Single new file `src/lib/mcp/tools/github-tools.ts` (+1 import line, +1 call line in tools.ts, +2 doc edits). Module exports only `registerGitHubTools`. All helpers are module-private. The 5 tools cover: DB-link, one-call snapshot, filtered issue list, idempotent milestone sync, and issue state patch.

Key architecture choices: `ghSafe` as single sanitization boundary; `{ data, headers }` tuple from `ghFetch` for rate-limit header access; `Promise.all` with 409-catch for parallel overview calls; pre-query Set for synced/updated counts; `state=all` for milestones in both overview and sync-with-closeCompleted; no kind hard-block in `resolveLinkedGoal`; `"(no status)"` bucket for unclassified board items; 10s timeout; no new dependencies.

### Open concerns (low risk, no action required before dev starts)

1. **GraphQL board pagination**: `items(first: 100)` is hardcoded. Chewgether board currently has 45 items. If the board grows past 100, columns will be silently under-counted. Add `// TODO: add cursor pagination if board exceeds 100 items` comment in code. The QA smoke test will catch if this is already a problem.

2. **Private-repo `pulls` pagination**: `?state=open&per_page=100` fetches up to 100 open PRs. Chewgether has 2 — no risk. If a future repo has >100 open PRs, `openPRs` (and thus `openIssues`) will be wrong. The description does not document this limit — the dev should add a code comment.

3. **gh CLI OAuth token scopes**: The orchestrator wrote the token to `.env` from `gh auth token`. The token must have `repo` + `read:project` scopes. If the orchestrator's token lacks `read:project`, the GraphQL call for board columns will fail with 403 and `projectBoard` will be null (non-fatal for the overview). The QA smoke test step 3 (projectNumber set → projectBoard.columns populated) will catch this.

4. **`null` externalRef in existingRefs Set**: `ScheduledItem.externalRef` is `String?` — Prisma returns `null` for items without an externalRef. The `findMany` pre-query filters `startsWith: "gh:milestone:"`, so `null` values are excluded by the Prisma filter and will not appear in `existingRows`. The Set will only contain non-null strings. No guard needed.

5. **Zod 4 regex validation**: `z.string().regex(...)` in Zod 4 — verify the Zod 4 API supports this form (it does, unchanged from Zod 3). No risk.
