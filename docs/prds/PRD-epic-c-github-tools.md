# PRD: Epic C — GitHub Tool Pack (chewabl Sprint 3)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-12
**Status**: Approved
**GitHub Issue**: #30–#34, #53, #57 (roadmap stories; closed on ship)
**Branch**: main
**UX-research**: skipped — pure MCP-tool/backend feature, no UI surface.

---

## 1. Overview

### 1.1 Problem Statement
Epic B made project goals plannable (ScheduledItems/LogEntries), but the chewgether vertical lives in GitHub (jronnomo/Chewgether: 74 open issues). Claude cannot see repo state, mirror milestones onto the calendar spine, or triage issues from a coaching session — every GitHub fact requires the user to copy-paste.

### 1.2 Proposed Solution
A 5-tool GitHub pack in `src/lib/mcp/tools/github-tools.ts` (mirroring the Epic B `project-tools.ts` module pattern), using native `fetch` + `GITHUB_TOKEN` (no new deps):
- `link_github_project` — bind a goal to `owner/repo` (+ optional Projects v2 number). DB-only.
- `get_project_overview` — one-call snapshot: repo meta, open issues/PRs, milestones, last-5 commits, optional Projects v2 board columns, `rateLimitRemaining`.
- `list_project_issues` — filtered issue enumeration (state/label/milestone/limit).
- `sync_github_milestones` — idempotent upsert of milestones into ScheduledItems via `externalRef='gh:milestone:<n>'`, with UTC→USER_TZ due-date bucketing.
- `set_github_issue_status` — open/close an issue (light write).

Token sanitization is a first-class requirement: a module-private sanitize layer guarantees `GITHUB_TOKEN` never appears in any tool output or error, independent of the generic `safe()` wrapper.

### 1.3 Success Criteria
- All 5 tools discoverable; surface 83 → 88.
- Live against Chewgether: overview shape correct incl. `rateLimitRemaining`; issues listed without pull-request contamination; double-run milestone sync creates 0 duplicates; due dates bucket to the correct USER_TZ day; issue close/reopen round-trips.
- Literal token absent from every captured response body (grep = 0 hits).
- tsc/lint/build clean; fitness vertical untouched.

---

## 2. User Stories

| ID | As... | I want to... | So that... | Priority |
|----|-------|--------------|------------|----------|
| US-001 | Gabe via Claude | link the chewgether goal to jronnomo/Chewgether | GitHub becomes the source of truth the coach can read | Must Have |
| US-002 | Gabe via Claude | get a one-call repo snapshot at session start | coaching opens grounded without copy-paste | Must Have |
| US-003 | Gabe via Claude | list open issues by label/milestone | weekly review and sprint planning from chat | Must Have |
| US-004 | Gabe via Claude | mirror milestones into ScheduledItems | the calendar/Today spine shows launch deadlines without live API calls | Must Have |
| US-005 | Gabe via Claude | close/reopen an issue from chat | triage during reviews without leaving claude.ai | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. New module `src/lib/mcp/tools/github-tools.ts` exporting `registerGitHubTools(server: McpServer): void`; called in `registerAll()` after `registerProjectTools(server)` (instance-level decodeArgsDeep patch covers it).
2. The 5 tools per §4.2; issue ACs #30–34 are normative, verbatim.
3. **Token sanitization layer** (module-private): `ghFetch` sends `Authorization: Bearer` header (never token-in-URL); every handler body is wrapped so any thrown message passes `message.replaceAll(process.env.GITHUB_TOKEN ?? "", "[REDACTED]")` (no-op safe when token unset) before `safe()` converts it to `errorResult`. The generic `safe()` is NOT the sanitization layer.
4. Friendly errors: missing goal, repo-not-linked ("No GitHub repo linked — call link_github_project first."), token unset (API tools only), GitHub 401/403/404 (status-specific, sanitized), timeout.
5. `link_github_project` works with no token (DB-only write); repo validated `^[\w.-]+\/[\w.-]+$` (rejects bare names and full URLs).
6. UTC→USER_TZ: milestone `due_on.slice(0,10)` → `parseDateKey` → `startOfDay`. Never `new Date(due_on)`. Milestones with null `due_on` are **skipped** (counted in `skipped`), documented in code.
7. Idempotent sync: `prisma.scheduledItem.upsert` on `goalId_externalRef`; re-run creates 0 rows. `closeCompleted=true` also upserts closed milestones with `status='done'`, `completedAt` = GitHub `closed_at`. **(v2)** The update path for OPEN milestones touches only `{title, detail, date, payload}` — never `status`/`completedAt` — so a manually-completed mirrored item is never un-completed by a re-sync. **(v2)** `sync_github_milestones` hard-requires `goal.kind === 'project'` (it writes ScheduledItems — same enforcement as `schedule_item`); `link_github_project` and the read tools are kind-agnostic.
8. `/repos/{owner}/{repo}/issues` returns PRs too — filter out entries with a `pull_request` key in `list_project_issues`.

### 3.2 Secondary Requirements
1. `.env.example` gains `GITHUB_TOKEN` placeholder with scope comment; `.claude/quality-tools.md` gains an env-vars note (MCP_AUTH_TOKEN, GITHUB_TOKEN + scopes + never-echo rule).
2. Tool descriptions state project/non-fitness scope (claude.ai routing) and mention prerequisite ordering (link first).

### 3.3 Out of Scope
- Project UI (#35–40), chewgether goal seeding (#41–48), webhooks/polling, GitHub write ops beyond issue state (no comments, labels, PR ops), OAuth (single-user PAT model), Octokit/SDK deps.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
N/A — uses existing `Goal.githubRepo`/`githubProjectNumber` and `ScheduledItem` (incl. `@@unique([goalId, externalRef])`, compound key `goalId_externalRef`). No migration.

### 4.2 MCP Tool Surface

| Tool | Purpose | R/W | GitHub calls |
|------|---------|-----|--------------|
| `link_github_project` | Bind goal → repo/project | W (DB only) | none |
| `get_project_overview` | One-call snapshot | R | parallel REST ×~5 + optional 1 GraphQL |
| `list_project_issues` | Filtered issues | R | 1 REST |
| `sync_github_milestones` | Mirror milestones → ScheduledItems | W | 1–2 REST |
| `set_github_issue_status` | Open/close issue | W | 1 REST PATCH |

Input schemas (Zod plain-shape, all `.describe()`d):
- `link_github_project`: `{ goalId: string, repo: string.regex(^[\w.-]+\/[\w.-]+$), projectNumber?: int.positive }` → `{ goalId, githubRepo, githubProjectNumber, message }`
- `get_project_overview`: `{ goalId: string }` → `{ repo, defaultBranch, openIssues, openPRs, milestones: [{number,title,dueOn,openIssues,closedIssues,state}], recentCommits: [{sha,message,date,author}] (last 5), projectBoard: {columns:[{name,cardCount}]}|null, projectBoardError: string|null (v2: sanitized reason when the board GraphQL call fails — board failure never fails the whole overview), rateLimitRemaining: number }`
- `list_project_issues`: `{ goalId, state?: enum(open|closed|all).default(open), label?: string, milestone?: string, limit?: int 1..100 default 30 }` → `{ count, issues: [{number,title,state,labels:string[],milestone:string|null,createdAt,updatedAt,url}] }` (PRs filtered out)
- `sync_github_milestones`: `{ goalId, closeCompleted?: boolean.default(false) }` → `{ synced, updated, skipped, items: [{externalRef,title,date}] }`
- `set_github_issue_status`: `{ goalId, issueNumber: int.positive, state: enum(open|closed) }` → `{ issueNumber, title, state, url, message }`; closing an already-closed issue is success.

Sample curl: standard `tools/call` pattern (see PRD-epic-b §4.2).

### 4.3 Server Actions
N/A.

### 4.4 Pages / Components
N/A.

### 4.5 Date / Time Semantics
Milestone `due_on` (UTC ISO) → `slice(0,10)` → `parseDateKey` → `startOfDay` (USER_TZ midnight). `completedAt` from GitHub `closed_at` stored as instant (`new Date(closed_at)` is correct here — it IS an instant, not a calendar date).

### 4.6 Override-Awareness
N/A — orthogonal to PlanDayOverride.

### 4.7 Third-Party Dependencies
None. Native `fetch` with `AbortSignal.timeout` (codebase idiom: usda.ts:249, food-actions.ts:242). `GITHUB_TOKEN` env (gh CLI OAuth token locally; user-provisioned on Vercel).

---

## 5. UI/UX Specifications
N/A — MCP-only (skip recorded in header).

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| Goal not found / repo not linked | friendly errorResult; suggests link_github_project |
| GITHUB_TOKEN unset (API tools) | friendly "GITHUB_TOKEN not configured" — link tool still works |
| Bad token / private repo (401/403) | sanitized status-specific friendly error |
| Repo or issue 404 | sanitized friendly error naming repo/issue |
| Timeout / network failure | sanitized friendly error (AbortError message included) |
| Token appears in any GitHub error body | replaced with [REDACTED] before surfacing |
| Milestone with null due_on | skipped, counted in `skipped` |
| Sync re-run | 0 new rows (upsert); updated count reflects changes |
| `/issues` PR contamination | entries with `pull_request` key excluded |
| Closing an already-closed issue | success (GitHub 200) |
| repo input "Chewgether" or "https://github.com/x/y" | Zod regex rejects |
| GraphQL errors array (Projects v2) | treated as error, sanitized; `projectBoard` only on clean response |

---

## 7. Security Considerations
- `GITHUB_TOKEN` only in env; header-only auth; sanitize layer on every output path; never logged; `.env` gitignored; `.env.example` placeholder only.
- All inputs Zod-validated; no raw SQL; no new routes (existing bearer-token gate).
- QA gate includes a literal-token grep over every captured response (must be 0 hits).

---

## 8. Acceptance Criteria
Roadmap issue ACs are normative, verbatim: **#30, #31, #32, #33, #34, #53, #57**. Summary gates:
1. [ ] tsc/lint/build clean
2. [ ] `tools/list` includes exactly the 5 new tools (surface 88)
3. [ ] §4.2 shapes verified live vs Chewgether; §6 edge cases verified
4. [ ] Double-sync idempotency; UTC→USER_TZ bucketing assert (due_on `T07:00:00Z` lands same-day in MT)
5. [ ] Token non-leak grep = 0 hits across all captured responses
6. [ ] `.env` + `.env.example` + quality-tools.md updated (#53); Vercel env documented as user action
7. [ ] Smoke artifacts cleaned: temp milestones deleted, test issue closed, temp goal cascade-deleted

---

## 9. Open Questions
None — resolved in discovery (scope: full Sprint 3; token: gh CLI; smoke repo: Chewgether with temp artifacts + cleanup).

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
Standard three gates.

### 10.2 MCP curl smoke (the #57 runbook — orchestrator executes)
1. `tools/list` → 5 new names present.
2. Create temp project goal → `link_github_project` happy path + regex rejects (bare name, URL) + bad goalId.
3. `get_project_overview` → shape + `rateLimitRemaining:number` + `projectBoard:null`; link `projectNumber` (user project 8) → `projectBoard.columns` populated via single GraphQL call.
4. `list_project_issues` default/state/label/limit; assert no `pull_request` entries.
5. `gh api` create 2 temp milestones on Chewgether (one `due_on: <future>T07:00:00Z`, one no-due) → `sync_github_milestones` → assert synced/skipped counts + USER_TZ date; run again → 0 new (verify via `list_scheduled_items` count + externalRefs `gh:milestone:*`); `closeCompleted` path: close a temp milestone via gh → sync with `closeCompleted:true` → status done + completedAt set.
6. `gh api` create throwaway issue → `set_github_issue_status` closed → verify → open → closed (cleanup); 404 issue number → friendly error.
7. Token non-leak: grep all captured bodies for the literal token → 0.
8. Cleanup: delete temp milestones (gh), `delete_goal` (cascade), confirm 0 orphan ScheduledItems, Chewgether back to 0 milestones, test issue closed.

### 10.3 Browser smoke
N/A; sanity-load `/` once.

### 10.4 Migration verification
N/A.

---

## 11. Appendix

### 11.1 Discovery Notes
gh CLI authed as jronnomo (scopes: repo, project, read:org) — token written to `.env` by orchestrator. Chewgether: private, 74 open issues, 0 milestones (smoke creates/deletes its own). No repo currently has milestones. `get_goal` already returns githubRepo/githubProjectNumber (full-row spread).

### 11.2 References
- Epic B PRD + run dir (module pattern, helper extraction, smoke approach)
- Fetch idiom: `src/lib/usda.ts:249`, `src/lib/food-actions.ts:242` (AbortSignal.timeout(6000), res.ok checks)
- Upsert key: `goalId_externalRef` (verified in `src/generated/prisma/models/ScheduledItem.ts`)
- Plan: `~/.claude/plans/smooth-mixing-garden.md`
