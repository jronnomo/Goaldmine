# Requirements — Epic C: GitHub Tool Pack

Source of truth: `docs/prds/PRD-epic-c-github-tools.md` + roadmap issues #30–#34, #53, #57 (ACs normative, verbatim).

---

## REQ-001 — registerGitHubTools scaffold + link_github_project
**Issue:** #30 · **Complexity:** S · **Depends:** —
New `src/lib/mcp/tools/github-tools.ts` exporting `registerGitHubTools(server: McpServer): void`; `registerAll()` calls it after `registerProjectTools(server)`. Implement `link_github_project(goalId, repo, projectNumber?)`: repo regex `^[\w.-]+\/[\w.-]+$`, writes `Goal.githubRepo`/`githubProjectNumber` via prisma update, works with no GITHUB_TOKEN, friendly goal-not-found error, token never in any return path.
**Files:** `src/lib/mcp/tools/github-tools.ts` (new), `src/lib/mcp/tools.ts` (import + registerAll call)

## REQ-002 — get_project_overview
**Issue:** #31 · **Complexity:** M · **Depends:** REQ-001
Parallel REST (repo meta, open issues count, milestones, last-5 commits, open PRs) + optional single Projects v2 GraphQL POST when `githubProjectNumber` set. Return shape per PRD §4.2 incl. `rateLimitRemaining` from `X-RateLimit-Remaining`. Establishes the `ghFetch` + sanitize pattern (token replaceAll → [REDACTED]; generic safe() NOT relied upon). Sanitized friendly errors for 401/403/404/timeout.
**Files:** `src/lib/mcp/tools/github-tools.ts`

## REQ-003 — list_project_issues
**Issue:** #32 · **Complexity:** S · **Depends:** REQ-002 (ghFetch/sanitize pattern)
state enum open|closed|all default open; label/milestone passthrough query params; limit 1..100 default 30; filter out `pull_request` entries; return shape per PRD §4.2.
**Files:** `src/lib/mcp/tools/github-tools.ts`

## REQ-004 — sync_github_milestones
**Issue:** #33 · **Complexity:** M · **Depends:** REQ-002
Fetch open (+closed when closeCompleted) milestones; upsert on `goalId_externalRef` with `externalRef='gh:milestone:<n>'`; UTC→USER_TZ via `due_on.slice(0,10)` → `parseDateKey` → `startOfDay`; null due_on SKIPPED (counted, code-commented); raw milestone object → `payload` Json; closeCompleted → status='done' + completedAt=closed_at; return `{synced, updated, skipped, items}`; idempotent re-run.
**Files:** `src/lib/mcp/tools/github-tools.ts`

## REQ-005 — set_github_issue_status
**Issue:** #34 · **Complexity:** S · **Depends:** REQ-002
PATCH issue state; success on already-closed; sanitized 404/403 errors; return `{issueNumber, title, state, url, message}`.
**Files:** `src/lib/mcp/tools/github-tools.ts`

## REQ-006 — Token provisioning + docs
**Issue:** #53 · **Complexity:** S · **Depends:** —
`.env` GITHUB_TOKEN (DONE — orchestrator, gh CLI token; never echoed). Dev agent: `.env.example` placeholder + scope comment; `.claude/quality-tools.md` env-vars section (MCP_AUTH_TOKEN + GITHUB_TOKEN, scopes repo+read:project, never-echo rule, Vercel note). Vercel env = user action (final report).
**Files:** `.env` (done), `.env.example`, `.claude/quality-tools.md`

## REQ-007 — Sprint 3 QA gate (QA-only)
**Issue:** #57 · **Complexity:** S · **Depends:** REQ-001..006
Execute PRD §10.2 live vs Chewgether: 5 tools in tools/list (88 total); temp goal + temp milestones + throwaway issue; double-sync 0 dupes; USER_TZ bucketing assert; token non-leak grep over every captured body; full cleanup (milestones deleted, issue closed, goal cascade-deleted, 0 orphans).
**Files:** `.feature-dev/2026-06-12-epic-c-github-tools/phases/qa-runbook.md` (artifact)
