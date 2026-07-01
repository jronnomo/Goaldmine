// src/lib/mcp/tools/github-tools.ts
// GitHub tool pack — link, overview, list, sync, patch.
// Module-private sanitize layer: GITHUB_TOKEN is NEVER surfaced in any output.
// See PRD §3.1.3 and §7 for the token-sanitization contract.

import { z } from "zod";
// McpServer: server.registerTool() — same import as project-tools.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Prisma: ScheduledItemUpdateInput, InputJsonValue (payload cast), JsonNull not needed here
import { Prisma } from "@/generated/prisma/client";
// getDb — user-scoped Prisma client for all DB access
import { getDb } from "@/lib/db";
// parseDateKey: yyyy-mm-dd → USER_TZ midnight Date (used for milestone due dates)
import { parseDateKey } from "@/lib/calendar";
// jsonResult, errorResult: format MCP tool responses
// NOTE: safe() from tool-helpers is NOT used in this module —
//       ghSafe() is the module-private replacement that sanitizes before errorResult.
import { jsonResult, errorResult } from "@/lib/mcp/tool-helpers";

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

// --- Module-private helpers --------------------------------------------------

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

/**
 * Fetch a goal's GitHub link fields. Throws friendly errors on:
 *   - goal not found
 *   - no repo linked (suggests link_github_project)
 *
 * [v2] Returns `kind` so sync_github_milestones can enforce kind='project'.
 * link_github_project and all read tools are kind-agnostic (only sync writes
 * ScheduledItems, which is the concern that warrants the kind check).
 *
 * Kind check: does NOT hard-block here. The caller (sync_github_milestones)
 * checks kind after resolving. link_github_project, get_project_overview,
 * list_project_issues, and set_github_issue_status do NOT check kind — GitHub
 * tools are bound to the presence of a githubRepo link, not goal kind. Only
 * sync, which writes ScheduledItems, enforces kind='project' (per D-6 addendum).
 */
async function resolveLinkedGoal(goalId: string): Promise<{
  owner: string;
  repo: string;
  fullRepo: string;
  projectNumber: number | null;
  kind: string; // [v2] returned so sync_github_milestones can enforce kind='project'
}> {
  const db = await getDb();
  const goal = await db.goal.findUnique({
    where: { id: goalId },
    select: { id: true, githubRepo: true, githubProjectNumber: true, kind: true }, // [v2] added kind
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
    kind: goal.kind, // [v2]
  };
}

// --- Tool registration -------------------------------------------------------

export function registerGitHubTools(server: McpServer): void {
  // --------------------------------------------------------------------------
  // link_github_project
  // --------------------------------------------------------------------------
  server.registerTool(
    "link_github_project",
    {
      title: "Link a goal to a GitHub repository and optional Projects v2 board",
      description:
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
        "This tool performs a database-only write and requires no GITHUB_TOKEN.",
      inputSchema: {
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
      },
    },
    async (input) =>
      ghSafe(async () => {
        const db = await getDb();

        // Existence check (friendly error on bad goalId)
        const goal = await db.goal.findUnique({
          where: { id: input.goalId },
          select: { id: true, objective: true },
        });
        if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

        // DB write — always set both fields; projectNumber null when omitted
        // (optional-field pattern: always write both because repo is required and
        // projectNumber defaults to null, so this is simpler than a conditional build)
        const updated = await db.goal.update({
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
      }),
  );

  // --------------------------------------------------------------------------
  // get_project_overview
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_project_overview",
    {
      title: "One-call GitHub snapshot for a project goal",
      description:
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
        "the core bucket (5000/hr for authenticated users). " +
        "projectBoardError is null when the board fetch succeeded or no projectNumber is " +
        "configured; it contains a sanitized error message when the GraphQL call failed — " +
        "the rest of the overview is still valid in that case.",
      inputSchema: {
        goalId: z
          .string()
          .describe(
            "ID of a goal linked to a GitHub repo via link_github_project.",
          ),
      },
    },
    async (input) =>
      ghSafe(async () => {
        const { owner, repo, fullRepo, projectNumber } = await resolveLinkedGoal(input.goalId);
        // [v2] kind not checked here — link and read tools are kind-agnostic (D-6 addendum)

        // Pre-validate token before any network IO — ghFetch checks too, but this gives
        // a clean early exit before committing 5 parallel request slots. [v2: S-1 comment]
        ghToken();

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
          // LIMIT: per_page=100 — if the repo has >100 open PRs, openPRs is undercounted
          // and openIssues is overcounted. Acceptable at Chewgether scale (2 open PRs).
          // Fix: paginate pulls endpoint until empty page if this repo grows. [v2: S-5 comment]
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
        let projectBoardError: string | null = null; // [v2] ISSUE-4: diagnostic for failed board fetch
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
            // pv2 === null means project not found / no access — projectBoard stays null,
            // projectBoardError stays null (this is a valid "not found" state, not a failure)
          } catch (e) {
            // [v2] ISSUE-4: GraphQL errors are non-fatal for the overview, but we surface
            // a diagnostic in projectBoardError so the coach can distinguish "not configured"
            // from "fetch failed". sanitize() ensures no token leakage.
            projectBoard = null;
            projectBoardError =
              e instanceof Error ? sanitize(e.message) : "Projects v2 board fetch failed.";
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
          projectBoardError, // [v2] null when OK or not configured; sanitized message on failure
          rateLimitRemaining,
        };
      }),
  );

  // --------------------------------------------------------------------------
  // list_project_issues
  // --------------------------------------------------------------------------
  server.registerTool(
    "list_project_issues",
    {
      title: "List GitHub issues for a project goal with optional filters",
      description:
        "List GitHub issues for a project goal, optionally filtered by state, label, and milestone. " +
        "Pull requests are automatically excluded — the GitHub /issues endpoint returns both issues " +
        "and PRs; this tool filters out entries with a pull_request field. " +
        "IMPORTANT: the milestone filter requires the milestone NUMBER as a string (e.g. '42'), " +
        "NOT the milestone title — passing a title silently returns 0 results. " +
        "Use '*' to match any milestone, 'none' to match issues with no milestone. " +
        "Labels are comma-separated when filtering by multiple (e.g. 'bug,ui'). " +
        "Requires the goal to have a GitHub repo linked via link_github_project. " +
        "Requires GITHUB_TOKEN with 'repo' scope. " +
        "Use for weekly review, sprint planning, and issue triage in a coaching session.",
      inputSchema: {
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
        // [v2] ISSUE-2: regex added to convert silent wrong-result into an early validation error.
        // The GitHub /issues API treats milestone as a NUMBER string, '*', or 'none' — titles
        // produce HTTP 200 with 0 results and no diagnostic signal. The regex enforces the correct
        // form at schema validation time, before the handler runs.
        milestone: z
          .string()
          .regex(
            /^\d+$|^\*$|^none$/,
            "milestone must be a milestone NUMBER as string, '*', or 'none' — titles are not accepted by the GitHub API",
          )
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
      },
    },
    async (input) =>
      ghSafe(async () => {
        const { owner, repo } = await resolveLinkedGoal(input.goalId);
        // kind not checked — read tools are kind-agnostic (D-6 addendum)
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
      }),
  );

  // --------------------------------------------------------------------------
  // sync_github_milestones
  // --------------------------------------------------------------------------
  server.registerTool(
    "sync_github_milestones",
    {
      title: "Idempotent sync of GitHub milestones into ScheduledItems",
      description:
        "Idempotent sync of GitHub milestones into ScheduledItems — mirrors milestone due dates " +
        "onto the goal calendar and Today spine so coaching sessions can reason about deadlines " +
        "without live GitHub API calls at query time. Run after creating or updating milestones " +
        "in GitHub. Safe to re-run: creates 0 duplicate rows (upsert on goalId + externalRef key " +
        "'gh:milestone:{number}'). Re-sync updates title, detail, and date but never un-completes " +
        "an item — open milestone re-syncs never overwrite status or completedAt, so manual " +
        "completions on mirrored items stick. " +
        "Milestones with no due_on are skipped (counted in 'skipped' — they cannot be anchored " +
        "to the calendar). Due dates are bucketed to USER_TZ midnight (Mountain Time) by slicing " +
        "the UTC ISO string to yyyy-mm-dd and calling parseDateKey — never via new Date(due_on). " +
        "closeCompleted: when true, also syncs closed milestones as status='done' with completedAt " +
        "from GitHub's closed_at field (which IS a UTC instant — stored via new Date(closed_at)). " +
        "Requires goal.kind='project' — fitness goals cannot have ScheduledItems written to them. " +
        "Requires a GitHub repo linked via link_github_project. Requires GITHUB_TOKEN 'repo' scope.",
      inputSchema: {
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
      },
    },
    async (input) =>
      ghSafe(async () => {
        const db = await getDb();
        const { owner, repo, kind } = await resolveLinkedGoal(input.goalId); // [v2] destructure kind

        // [v2] ISSUE-3: hard-require kind='project' — sync writes ScheduledItems, which is
        // the exact write that schedule_item (project-tools.ts) enforces kind='project' for.
        // Epic B D-12 precedent: ScheduledItem-writing tools enforce kind; reads don't.
        // Friendly error mirrors schedule_item's wording.
        if (kind !== "project") {
          throw new Error(
            `Goal ${input.goalId} is kind='${kind}'. sync_github_milestones writes ScheduledItems and is only supported for kind='project' goals.`,
          );
        }

        ghToken();

        // Fetch milestones: state=all when closeCompleted (need open + closed);
        // state=open when closeCompleted=false (skip closed entirely — saves a round-trip)
        const state = input.closeCompleted ? "all" : "open";
        const { data: milestones } = await ghFetch<GhMilestone[]>(
          `/repos/${owner}/${repo}/milestones?state=${state}&per_page=100`,
        );

        // Pre-query existing externalRefs for this goal to compute synced vs updated counts.
        // db.scheduledItem.upsert does not expose whether it performed a create or update — we
        // infer from whether the externalRef was in the DB before the loop.
        const existingRows = await db.scheduledItem.findMany({
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

          // [v2] S-3: defensive format check — parseDateKey silently produces an Invalid Date
          // on malformed input. GitHub's API is reliable, but the guard is cheap.
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            skipped++; // treat malformed due_on as undatable
            continue;
          }

          const date = parseDateKey(dateKey);

          // Determine whether this is a closed milestone being synced as 'done'
          const isClosed = input.closeCompleted && m.state === "closed";
          // closed_at is a UTC instant — new Date() is correct here (not parseDateKey)
          const completedAt =
            isClosed && m.closed_at ? new Date(m.closed_at) : null;

          // [v2] ISSUE-1: Split upsert update block by open vs closed.
          //
          // OPEN milestones: update block contains ONLY { title, detail, date, payload }.
          //   status and completedAt are intentionally omitted — a manually-completed item
          //   (e.g. via complete_scheduled_item or update_scheduled_item) keeps its 'done'
          //   status across re-syncs. GitHub source-of-truth applies only to closed→done,
          //   never to un-completing a manually-done item. A GitHub-reopened milestone does
          //   NOT reset a local 'done' status (see D-11).
          //
          // CLOSED milestones (closeCompleted=true): update block sets status='done' +
          //   completedAt from GitHub's closed_at. This propagates GitHub closures into DB.
          await db.scheduledItem.upsert({
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
              status: isClosed ? "done" : "planned",
              completedAt,
              // Store full raw milestone object as payload for future reference
              payload: m as unknown as Prisma.InputJsonValue,
            },
            update: isClosed
              ? {
                  // [v2] CLOSED: sync status, completedAt, and content fields
                  title: m.title,
                  detail: m.description ?? null,
                  date,
                  status: "done",
                  completedAt,
                  payload: m as unknown as Prisma.InputJsonValue,
                }
              : {
                  // [v2] OPEN: sync content fields only — never touch status or completedAt
                  title: m.title,
                  detail: m.description ?? null,
                  date,
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
      }),
  );

  // --------------------------------------------------------------------------
  // set_github_issue_status
  // --------------------------------------------------------------------------
  server.registerTool(
    "set_github_issue_status",
    {
      title: "Open or close a GitHub issue",
      description:
        "Open or close a GitHub issue from a coaching session — enables triage during weekly " +
        "reviews without leaving claude.ai. Idempotent: closing an already-closed issue returns " +
        "success (GitHub returns 200). Requires the issue number (integer), NOT the issue title. " +
        "Use list_project_issues to discover issue numbers. Requires a GitHub repo linked via " +
        "link_github_project. Requires GITHUB_TOKEN with 'repo' scope. " +
        "For project goals primarily — fitness goals should not have linked GitHub repos.",
      inputSchema: {
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
      },
    },
    async (input) =>
      ghSafe(async () => {
        const { owner, repo, fullRepo } = await resolveLinkedGoal(input.goalId);
        // kind not checked — read/patch tools are kind-agnostic (D-6 addendum)
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
      }),
  );
}
