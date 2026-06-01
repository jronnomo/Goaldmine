# Backlog Critique — Multi-Domain Goal Engine

**Author**: Backlog Critic (Claude) · **Date**: 2026-05-31 · **Input**: backlog.json (33 stories) + multi-domain-plan.md + plan-critique.md  
**Verdict at bottom.**

---

## 1. Completeness Gaps

### GAP-1 — No `prisma generate` / client-regen is a STANDALONE concern (not a gap, but confirm)

**Status: PRESENT.** Story A-1 (the migration story) has these ACs verbatim:
- `npx prisma migrate dev --name multi-domain-spine runs without error`
- `npx prisma generate succeeds and src/generated/prisma contains ScheduledItem and LogEntry types`

This is correctly co-located with the migration story. No separate story needed; the concern is satisfied.

---

### GAP-2 — Coaching-prompt / MCP server-instructions update lives in Sprint 5, but project tools ship in Sprint 2

**Status: PLACEMENT BUG.** Story E-4 ("Update MCP server instructions string for goal-kind-aware coaching routing") is in Sprint 5. But Epic B ships 7 new MCP tools in Sprint 2. From Sprint 2 through Sprint 4, `get_today_plan` will surface `activeGoal.kind`, project tools will be registered, but the MCP instructions Claude reads on connection will have no routing guidance for them. Claude will either hallucinate tool selection or fall through to fitness tools for a project goal.

**Fix**: Move E-4 to the end of Sprint 2 (after B-6), or at minimum Sprint 3 start. Its only real dependencies are `Expose Goal.kind` (A-4, Sprint 1) and `B-5` (Sprint 2) — both are complete well before Sprint 5. The E-1 dependency is incidental (seeding doesn't affect the instructions string).

**Proposed reordering**: E-4 → Sprint 2, after B-6, as B-7.

---

### GAP-3 — No GITHUB_TOKEN provisioning story; Sprint 3 smoke tests will silently fail

**Status: MISSING.** All 5 Sprint 3 stories include smoke tests that require `GITHUB_TOKEN` to be set in `.env.local` and on Vercel. The first formal provisioning of this token appears in E-3 (Sprint 5, AC: "GITHUB_TOKEN is set in .env.local... verified by curl"). Sprint 3 developers have no story telling them: generate a PAT with the correct scopes, add it to `.env.local`, add it to Vercel environment variables, and confirm it works before building.

**Risk**: The developer will hit 401 errors on all GitHub smoke tests in Sprint 3 with no story context, or will skip the smoke tests, shipping untested GitHub tool code.

**Proposed new story** (insert as C-0, Sprint 3, P0 - Critical, depends on nothing):

```json
{
  "epic": "GitHub-tracking integration",
  "title": "C-0: Provision GITHUB_TOKEN PAT in .env.local and Vercel before Sprint 3 builds",
  "value": "so that every Sprint 3 story's smoke tests can call the GitHub API without manual ad-hoc token setup and without risk of leaking a misconfigured token into committed files",
  "acceptanceCriteria": [
    "A GitHub Personal Access Token (classic or fine-grained) is created for the jronnomo account with scopes: repo (read + write) for jronnomo/Chewgether — or fine-grained: Contents:read, Issues:write, Pull Requests:read, Projects:read.",
    "The token is added to .env.local as GITHUB_TOKEN=<value> and .env.local is confirmed absent from git tracking (verify .gitignore covers .env.local).",
    "The token is added to Vercel environment variables for the production deployment via the Vercel dashboard or `vercel env add GITHUB_TOKEN`.",
    "Smoke verify: curl -H 'Authorization: Bearer $GITHUB_TOKEN' https://api.github.com/repos/jronnomo/Chewgether returns HTTP 200.",
    "The token value is NOT committed to any file in the repo — verify via `git log -p | grep GITHUB_TOKEN` returns no token value.",
    "Document the PAT expiry date and renewal process in a comment inside .env.local.example (not .env.local itself).",
    "No code changes to the app — this is an operator setup story."
  ],
  "touches": [
    ".env.local (GITHUB_TOKEN value — NOT committed)",
    ".env.local.example (add GITHUB_TOKEN=<your_pat_here> placeholder comment with scope instructions)",
    "Vercel environment variables (via dashboard or CLI)"
  ],
  "effort": "Small",
  "priority": "P0 - Critical",
  "dependsOn": [],
  "sprint": "Sprint 3 - GitHub integration"
}
```

---

### GAP-4 — No fitness-coexistence regression verification story

**Status: MISSING AS STANDALONE.** Fitness byte-identical constraints appear as individual ACs in almost every story, but there is no single story that: (a) runs the complete fitness vertical end-to-end after all epics are merged to verify nothing has regressed, and (b) serves as the pre-production gate before Sprint 5 creates real data. Individual-story ACs are developer-time checks; this gap is about the integration-level regression that only shows up when you run the full stack with real fitness data.

**Proposed new story** (insert as D-7 or as pre-Sprint-5 gate, Sprint 4, P0 - Critical):

```json
{
  "epic": "Goal-type-aware UI",
  "title": "D-7: Fitness vertical end-to-end regression check — byte-identical verification after Epics A–D",
  "value": "so that activating a project goal for the first time in Sprint 5 cannot silently break the fitness coaching path the user relies on daily for the Mt. Elbert program",
  "acceptanceCriteria": [
    "Active goal is the Mt. Elbert fitness goal (goal.kind='fitness'). Run the full fitness smoke: get_today_plan returns workout plan (not todayItems), list_goals returns kind='fitness' for Mt. Elbert.",
    "Today page (/) with fitness goal active: renders the workout hero (existing fitness body), NOT ProjectTodayShell or ProjectTodayView. No console errors.",
    "Calendar: all six existing legend kinds (trained, hike-completed, hike-planned, override, goal-date, baseline) render correctly. No 'scheduled-item' markers appear on a fitness-goal calendar. scheduledItemCount is 0 for all cells.",
    "Stats page (/stats): readiness score matches the value it showed before Epic A was merged (no LogEntry cross-contamination). computeReadiness is called with the fitness goal's id. No crash.",
    "Progress page (/progress): readiness chart loads. No milestone burn-down card visible (fitness goal has no ScheduledItems with type='milestone'). No crash.",
    "Goals page (/goals/[id]): fitness goal detail renders, readiness score intact, plan link works.",
    "All MCP read tools return fitness-correct data: recent_history, get_baseline_history, get_records_summary, get_exercise_history all return fitness data only.",
    "npx tsc --noEmit passes with zero errors (after all Epic A–D code is merged).",
    "npm run build passes.",
    "No new DB queries are issued for ScheduledItem or LogEntry when the fitness goal is active — verify by checking that the kind guard (goal.kind === 'project') is respected in page.tsx, getCalendarMonth, and progress/page.tsx."
  ],
  "touches": [
    "No code changes — verification-only story. Documents the runbook as a checklist."
  ],
  "effort": "Small",
  "priority": "P0 - Critical",
  "dependsOn": [
    "Active-context resolution: fetch active Goal in page.tsx and branch on kind",
    "Project Today body: ScheduledItems + LogEntry MRR + next milestone + recent commits",
    "Calendar legend: add 'scheduled-item' kind to LegendKindSchema + MarkerIcon variant + CalendarMonth render branch",
    "Calendar ScheduledItem source: query ScheduledItems in getCalendarMonth and populate scheduledItemCount on cells",
    "Project Progress view: log:* metric readiness + milestone burn-down on stats and progress pages"
  ],
  "sprint": "Sprint 4 - Goal-type UI"
}
```

---

### GAP-5 — CLAUDE.md / project docs update missing

**Status: MISSING.** No story updates `CLAUDE.md` (the project's AI-assistant instructions, checked into the codebase) to document:
- The two new Prisma models (`ScheduledItem`, `LogEntry`) and their purpose
- The new MCP tool packs (`registerProjectTools`, `registerGitHubTools`)
- The `Goal.kind` field and routing logic
- The `GITHUB_TOKEN` env var requirement

After this initiative ships, the next Claude Code session will read stale `CLAUDE.md` and may regenerate or misunderstand the architecture.

**Proposed new story** (insert as E-9 or final story of Sprint 5, P2 - Medium):

```json
{
  "epic": "Chewgether goal MVP + coaching",
  "title": "E-9: Update CLAUDE.md and AGENTS.md with multi-domain architecture, new models, and new env vars",
  "value": "so that future Claude Code sessions have accurate architecture context and do not re-invent or misunderstand the ScheduledItem/LogEntry spine, Goal.kind routing, or GitHub token requirement",
  "acceptanceCriteria": [
    "CLAUDE.md '## Key directories' section is updated to include: src/lib/mcp/tools/project-tools.ts, src/lib/mcp/github-tools.ts (or equivalent), prisma/seed-chewgether.ts.",
    "CLAUDE.md '## MCP server' section lists the new tools by pack: Project pack (schedule_item, complete_item, update_scheduled_item, delete_scheduled_item, list_scheduled_items, log_goal_metric, list_log_entries, set_active_goal) and GitHub pack (link_github_project, get_project_overview, list_project_issues, sync_github_milestones, set_github_issue_status).",
    "CLAUDE.md '## Stack' or a new '## Environment variables' section documents GITHUB_TOKEN with: purpose, required scopes (repo read+write for jronnomo/Chewgether), and that it must NOT be committed.",
    "CLAUDE.md documents Goal.kind routing: 'fitness = workout/hike/baseline tools; project = project+GitHub packs. get_today_plan.activeGoal.kind is the authoritative routing signal.'",
    "prisma/schema.prisma changes are briefly described: ScheduledItem (planned work items for project goals), LogEntry (metric observations for project goals), Goal.kind, Goal.githubRepo, Goal.githubProjectNumber.",
    "npx tsc --noEmit passes (no code changes; docs only).",
    "No secrets or token values appear in any committed file."
  ],
  "touches": [
    "CLAUDE.md"
  ],
  "effort": "Small",
  "priority": "P2 - Medium",
  "dependsOn": [
    "E-8: End-to-end Sprint 5 verification — chewgether goal is plannable, trackable, scorable, and coachable"
  ],
  "sprint": "Sprint 5 - Chewgether MVP"
}
```

---

### GAP-6 — Per-sprint QA gates missing for Sprints 1, 3, and 4

**Status: MISSING.** Sprint 2 has B-6 (QA gate). Sprint 5 has E-8 (end-to-end verification). But Sprints 1, 3, and 4 have no gate story. Each sprint should leave `main` deployable and verified before the next sprint starts. Without a gate, a broken migration or a half-wired calendar change can silently propagate into the next sprint.

**Proposed stories**:

Sprint 1 QA gate:
```json
{
  "epic": "Generic data spine",
  "title": "A-5: Sprint 1 QA gate — migration is additive, fitness readiness byte-identical, new tools discoverable",
  "value": "so that Sprint 2 begins from a verified, deployable main branch with the spine in place and no fitness regression",
  "acceptanceCriteria": [
    "npx prisma migrate status shows no pending migrations.",
    "prisma.scheduledItem.count() and prisma.logEntry.count() return 0 (tables exist, empty).",
    "curl tools/list returns create_goal with kind field in inputSchema.",
    "curl tools/call get_today_plan returns activeGoal field (may be null if no active goal).",
    "curl tools/call list_goals returns kind for each goal.",
    "Browser smoke: /stats and /progress pages load; fitness readiness score is non-zero and matches pre-migration value.",
    "npx tsc --noEmit passes. npm run build passes.",
    "Vercel preview deployment is live and reachable."
  ],
  "touches": ["No code changes — QA-only story."],
  "effort": "Small",
  "priority": "P0 - Critical",
  "dependsOn": [
    "Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration",
    "Add required goalId param to computeReadiness and computeReadinessSeries and update all 5 call sites so fitness readiness stays byte-identical",
    "Implement log:* metric namespace in resolveMetricValue, resolveMetricStart, and progressFor, and register log:mrr and log:milestones_done in the METRICS registry",
    "Expose Goal.kind on create_goal, list_goals, and get_today_plan MCP tools"
  ],
  "sprint": "Sprint 1 - Generic data spine"
}
```

Sprint 3 QA gate:
```json
{
  "epic": "GitHub-tracking integration",
  "title": "C-6: Sprint 3 QA gate — all 5 GitHub tools discoverable, token sanitized, fitness path untouched",
  "value": "so that Sprint 4 UI work begins from a verified, deployable main with all GitHub tools tested against the live API",
  "acceptanceCriteria": [
    "curl tools/list returns exactly these 5 GitHub tools: link_github_project, get_project_overview, list_project_issues, sync_github_milestones, set_github_issue_status.",
    "link_github_project({goalId, repo: 'jronnomo/Chewgether'}) succeeds and get_goal returns githubRepo='jronnomo/Chewgether'.",
    "get_project_overview({goalId}) returns real GitHub data (repo, openIssues, milestones, recentCommits). GITHUB_TOKEN value does NOT appear in the response payload.",
    "list_project_issues({goalId, state: 'open'}) returns issues array (may be empty). Count matches what GitHub UI shows.",
    "sync_github_milestones({goalId}) runs twice; second run produces synced=0 new rows (idempotent verified).",
    "set_github_issue_status with an invalid goalId returns a user-friendly errorResult (not 500).",
    "Fitness goal smoke: recent_history, get_today_plan, list_goals all return fitness-correct data. No GitHub tool response bleeds into fitness output.",
    "npx tsc --noEmit passes. npm run build passes.",
    "Vercel production deployment is live; tools/list from production URL returns all GitHub tools.",
    "claude.ai connector reload performed; all 5 GitHub tools visible in tool picker."
  ],
  "touches": ["No code changes — QA-only story."],
  "effort": "Small",
  "priority": "P0 - Critical",
  "dependsOn": [
    "C-0: Provision GITHUB_TOKEN PAT in .env.local and Vercel before Sprint 3 builds",
    "registerGitHubTools scaffold + link_github_project tool",
    "get_project_overview read tool — REST + GraphQL, rate-limit header, token sanitization",
    "list_project_issues read tool — paginated, state/label/milestone filters",
    "sync_github_milestones — idempotent UTC→USER_TZ upsert to ScheduledItem",
    "set_github_issue_status light write — open/close a GitHub issue"
  ],
  "sprint": "Sprint 3 - GitHub integration"
}
```

Sprint 4 QA gate: this is covered by the proposed D-7 (fitness regression check) above. If D-7 is accepted, Sprint 4 has its gate.

---

### GAP-7 — E-7 (set_active_goal) depends on E-1 but must precede E-1 to avoid the W7 landmine

**Status: ORDERING BUG.** W7 (from plan-critique.md) warns that `create_goal` (called in E-1) deactivates all other goals. E-7 adds `set_active_goal` so the user can re-enable the fitness goal after creating chewgether. But E-7 `dependsOn E-1` — meaning the tool that prevents the landmine ships after the landmine is triggered.

E-7's only real code dependencies are B-1 (project tools scaffold, Sprint 2) and A-1 (the schema, Sprint 1). The E-1 dependency in E-7 is narrative (the user has two goals to switch between) but not a build-time requirement. `set_active_goal` is a generic tool that works before any project goal exists.

**Fix**: Move E-7 to Sprint 2 (after B-1), removing the E-1 dependency. Update E-7's `dependsOn` to `["B-1: registerProjectTools scaffold + schedule_item + delete_scheduled_item"]`. Then E-1 in Sprint 5 can safely create the chewgether goal because the switching tool is already deployed.

---

### GAP-8 — Connector-reload reminder absent from Sprint 3 stories (C-1 through C-5 each have it, but Sprint 4 stories do not)

**Status: PARTIAL MISS.** Sprint 3 (GitHub tools) correctly notes connector reload in each story. Sprint 4 stories (D1–D6) only mention connector reload in D1's note section: "NOTE: No connector reload needed" for B-5. But D1, D3, D4 all modify UI-only (not MCP surface), so they correctly need no reload. However, E-7 (set_active_goal, moved to Sprint 2) needs a reload, and E-4 (instructions update, moved to Sprint 2) explicitly requires it. Verify that E-7 and E-4 both note connector reload in their ACs — E-4 already does, E-7 already does. This gap is minor and not blocking.

---

## 2. Dependency Integrity Issues

### DEP-1 — 44 broken `dependsOn` references (all using short-form aliases, not exact titles)

All 44 broken dependency references use abbreviated forms like `"A-1 (Goal.githubRepo...)"`, `"Epic A"`, `"D1 (...)"`, `"C-1 (...)"`, `"Epic B"` etc. These will not resolve to any story on the GitHub board and will leave the dependency graph empty in the project management tool.

**Root cause**: Stories in different epics were written by different agents using different naming conventions. Epic B stories use the full Sprint 1 story titles (which do match). Epics C, D, E use short-form aliases.

**Fix**: Every `dependsOn` entry must be an exact match of the target story's `title` field. The table below maps each broken alias to its correct canonical title:

| Broken alias | Correct canonical title |
|---|---|
| `"Add ScheduledItem + LogEntry Prisma models (Epic A)"` | `"Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration"` |
| `"Add ScheduledItem + LogEntry Prisma models and get_today_plan activeGoal field (Epic A)"` | `"Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration"` (A-4 adds activeGoal field, so this should also include A-4) |
| `"A-1 (Goal.githubRepo + Goal.githubProjectNumber fields exist in schema)"` | `"Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration"` |
| `"A-1 (Goal.githubRepo field)"` | same as above |
| `"A-1 (ScheduledItem schema with externalRef + @@unique constraint)"` | same as above |
| `"B-1 (registerProjectTools pattern — follow same module structure)"` | `"B-1: registerProjectTools scaffold + schedule_item + delete_scheduled_item"` |
| `"B-1 (ScheduledItem table + @@unique([goalId,externalRef]) constraint exist from Epic A/B; schedule_item write path available as a pattern)"` | same B-1 title |
| `"C-1 (registerGitHubTools scaffold, Goal.githubRepo readable)"` | `"registerGitHubTools scaffold + link_github_project tool"` |
| `"C-1 (link_github_project — Goal.githubRepo must be set)"` | same C-1 title |
| `"C-1 (link_github_project, Goal.githubRepo, safeGitHub pattern)"` | same C-1 title |
| `"C-2 (safeGitHub sanitization helper established, GITHUB_TOKEN pattern set)"` | `"get_project_overview read tool — REST + GraphQL, rate-limit header, token sanitization"` |
| `"C-2 (safeGitHub sanitization helper)"` | same C-2 title |
| `"D1 (active-context resolution must be in place)"` | `"Active-context resolution: fetch active Goal in page.tsx and branch on kind"` |
| `"D3 (CalendarDayCell.scheduledItemCount field + render branch must exist)"` | `"Calendar legend: add 'scheduled-item' kind to LegendKindSchema + MarkerIcon variant + CalendarMonth render branch"` |
| `"D1 (active-context pattern established)"` | `"Active-context resolution: fetch active Goal in page.tsx and branch on kind"` |
| `"D1 (active-context resolution)"` | same D1 title |
| `"Epic A — Generic data spine (Goal.kind column must exist)"` | `"Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration"` |
| `"Epic A — C1 goalId cascade fix (computeReadiness + computeReadinessSeries must accept goalId before this story can compile cleanly)"` | `"Add required goalId param to computeReadiness and computeReadinessSeries and update all 5 call sites so fitness readiness stays byte-identical"` |
| `"Epic A (ScheduledItem + LogEntry tables)"` | `"Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration"` |
| `"Epic A (LogEntry table for log:* metrics)"` | same as above |
| `"Epic A (ScheduledItem table must exist)"` | same as above |
| `"Epic A (ScheduledItem table)"` | same as above |
| `"Epic B (project MCP tool pack — ScheduledItems + LogEntries must be writable...)"` | `"B-1: registerProjectTools scaffold + schedule_item + delete_scheduled_item"` (minimum) |
| `"Epic B (ScheduledItems must be writable...)"` | same B-1 |
| `"Epic B (ScheduledItems writable)"` | same B-1 |
| `"Epic B (log_goal_metric tool must exist for data to be present during smoke)"` | `"B-4: log_metric + list_log_entries"` |
| `"link_github_project + get_project_overview + list_project_issues (Epic C)"` | should list C-1, C-2, C-3 exact titles individually |
| `"sync_github_milestones + set_github_issue_status (Epic C)"` | should list C-4, C-5 exact titles |
| `"Goal-type-aware UI — Today page kind-branch + ProjectTodayView (Epic D)"` | `"Active-context resolution: fetch active Goal in page.tsx and branch on kind"` + `"Project Today body: ScheduledItems + LogEntry MRR + next milestone + recent commits"` |
| `"Goal-type-aware UI — Calendar ScheduledItem source, LegendSchema, plan route (Epic D)"` | should list D3, D4, D5 exact titles |
| `"Goal-type-aware UI — Progress/readiness hub (Epic D)"` | `"Project Progress view: log:* metric readiness + milestone burn-down on stats and progress pages"` |
| `"Implement log:* metric namespace in resolveMetricValue, resolveMetricStart, and progressFor (Epic A)"` | `"Implement log:* metric namespace in resolveMetricValue, resolveMetricStart, and progressFor, and register log:mrr and log:milestones_done in the METRICS registry"` |
| `"Expose Goal.kind on create_goal, list_goals, and get_today_plan MCP tools (Epic A)"` | `"Expose Goal.kind on create_goal, list_goals, and get_today_plan MCP tools"` |
| `"B-1: registerProjectTools scaffold + schedule_item + delete_scheduled_item (Epic B)"` | `"B-1: registerProjectTools scaffold + schedule_item + delete_scheduled_item"` |
| `"B-3: list_scheduled_items (Epic B)"` | `"B-3: list_scheduled_items"` |
| `"B-4: log_metric + list_log_entries (Epic B)"` | `"B-4: log_metric + list_log_entries"` |
| `"B-5: get_today_plan project-goal branch (today's ScheduledItems in plan response) (Epic B)"` | `"B-5: get_today_plan project-goal branch (today's ScheduledItems in plan response)"` |
| `"D1 (active-context resolution establishes the goal.kind pattern; D3 may land in parallel if Epic A is done, but D1 is the logical predecessor for review)"` | `"Active-context resolution: fetch active Goal in page.tsx and branch on kind"` |

No cycles detected among the exact-title matches.

---

## 3. Field Sanity Issues

### FIELD-1 — Priority field is inconsistent across epics (3 different formats in use)

Valid board options per the task spec: `"P0 - Critical"`, `"P1 - High"`, `"P2 - Medium"`, `"P3 - Low"`.

**Violations**:

| Story | Current value | Correct value |
|---|---|---|
| B-1 through B-4 | `"High"` | `"P1 - High"` |
| B-5 | `"Medium"` | `"P2 - Medium"` |
| B-6 | `"High"` | `"P1 - High"` |
| C-1 (registerGitHubTools) | `"P0"` | `"P0 - Critical"` |
| C-2 (get_project_overview) | `"P0"` | `"P0 - Critical"` |
| C-3 (list_project_issues) | `"P1"` | `"P1 - High"` |
| C-4 (sync_github_milestones) | `"P0"` | `"P0 - Critical"` |
| C-5 (set_github_issue_status) | `"P2"` | `"P2 - Medium"` |
| D1 (active-context resolution) | `"P0"` | `"P0 - Critical"` |
| D2 (Project Today body) | `"P1"` | `"P1 - High"` |
| D3 (Calendar legend) | `"P1"` | `"P1 - High"` |
| D4 (Calendar ScheduledItem source) | `"P1"` | `"P1 - High"` |
| D5 (Project Plan view) | `"P2"` | `"P2 - Medium"` |
| D6 (Project Progress view) | `"P2"` | `"P2 - Medium"` |

17 stories (all of Epics B, C, D) have non-standard priority values.

---

### FIELD-2 — Effort field is inconsistent (uses `"S"` and `"M"` instead of `"Small"` and `"Medium"`)

All 6 Epic D stories use `"S"` or `"M"` instead of `"Small"` or `"Medium"`. Backlog stories use `"Unknown"` (acceptable since they're deliberately unestimated).

**Violations**: D1 (`"S"`→`"Small"`), D2 (`"M"`→`"Medium"`), D3 (`"S"`→`"Small"`), D4 (`"S"`→`"Small"`), D5 (`"M"`→`"Medium"`), D6 (`"M"`→`"Medium"`).

---

### FIELD-3 — `log_metric` vs `log_goal_metric` name inconsistency across stories

B-4 registers the tool as `log_metric`. Stories E-4, E-5, E-6 and the Epic A `log:mrr`/`log:milestones_done` story reference `log_goal_metric`. The Sprint 5 coaching instructions (E-4) will tell Claude to call `log_goal_metric`, but the actual registered tool name from B-4 is `log_metric`. This will cause tool-not-found errors in Sprint 5.

W5 from plan-critique.md explicitly recommended renaming to `log_goal_metric` for discoverability. The rename was applied inconsistently.

**Fix**: Either B-4 must be updated to register `log_goal_metric` (and `list_log_entries` can stay), OR all Sprint 5 references must be changed back to `log_metric`. Recommendation: adopt `log_goal_metric` (the W5 suggestion) and update B-4 and B-6 accordingly.

---

## 4. Right-Sizing: Splits and Merges

### SPLIT-1 — B-1 (Medium, 14 ACs) — split into scaffold + schedule_item and delete_scheduled_item

B-1 creates the module scaffold, registers `schedule_item` (complex, with parseDateInput, return shape, Zod schema), and registers `delete_scheduled_item`. 14 ACs is a Medium story that's actually Large. The two tools are independently shippable and testable.

**Proposed split**:
- B-1a: `registerProjectTools scaffold + schedule_item` (Medium, 9 ACs) — the module, register call, schedule_item full implementation
- B-1b: `delete_scheduled_item` (Small, 5 ACs) — depends on B-1a; adds delete with error handling

This is a nice-to-have split; not blocking. Proceed with original B-1 if timeline is tight.

---

### SPLIT-2 — B-4 (Medium, 14 ACs) — split into log_goal_metric and list_log_entries

`log_goal_metric` (write, Zod schema, error handling, date parsing) and `list_log_entries` (read, filters, pagination) are fully independent tools. Each would be 7 ACs as Small stories.

**Proposed split**:
- B-4a: `log_goal_metric` (Small, 7 ACs) — write tool
- B-4b: `list_log_entries` (Small, 7 ACs) — depends on B-4a (needs data to exist for smoke)

---

### SPLIT-3 — B-2 (Small, 13 ACs) — borderline; consider split

`complete_item` and `update_scheduled_item` are different operations (state transition vs. patch). 13 ACs at Small is the upper bound. Acceptable as-is because both tools touch the same file and are similar in complexity. No split required.

---

### SPLIT-4 — D2 (M, 12 ACs) + D6 (M, 10 ACs) — acceptable as-is

Both Medium stories have ACs that are mostly browser smoke checks, not code complexity. No split required but flag for the build agent to break into sub-tasks.

---

### MERGE CANDIDATES — None recommended

No two stories are so trivially small that merging would reduce overhead more than it would obscure scope. B-3 (11 ACs) and B-2 (13 ACs) might look like merge candidates with B-1, but their ACs are already at the upper bound; merging would create a Large story.

---

## 5. Sprint Balance and Shippability

### BALANCE-1 — Sprint 1 is under-gated (4 stories, no QA gate, most critical sprint)

Sprint 1 contains the migration — the single most dangerous story in the entire initiative (a failed migration can corrupt the Neon DB). It has 4 dev stories and no verification story. **See GAP-6 above** for the proposed A-5 QA gate.

### BALANCE-2 — Sprint 3 is under-gated (5 stories, no QA gate, GitHub token unprovisioned)

Sprint 3 has 5 dev stories that all require a live GitHub PAT to smoke test. Without C-0 (token provisioning) and C-6 (QA gate), Sprint 3 ends unverified. **See GAP-3 and GAP-6 above.**

### BALANCE-3 — Sprint 5 is overloaded (8 stories)

Sprint 5 has 8 stories: 2 seed scripts, 1 GitHub sync, 1 instructions update, 1 coaching prompt doc, 1 readiness verification, 1 set_active_goal tool, and 1 end-to-end gate. After moving E-4 and E-7 to Sprint 2 (see GAP-2, GAP-7), Sprint 5 drops to 6 stories — a more manageable load.

### BALANCE-4 — A→B→C→D ordering is correct; A-1→A-2→A-3 ordering is correct

The migration (A-1) precedes the signature cascade (A-2) which precedes the log:* resolver (A-3). This ordering is sound. No reordering needed in Sprint 1.

### BALANCE-5 — E-4 (MCP instructions) should move to Sprint 2

As noted in GAP-2: Sprint 2 adds 7 project tools but the routing instructions don't ship until Sprint 5. Sprint 2–4 builds will be tested by the developer who knows the tool names, but any coaching session attempted in Sprint 2–4 will have unguided Claude routing. Moving E-4 to Sprint 2 (as B-7) costs nothing and ensures every Sprint 3/4 smoke test has correct routing instructions.

### BALANCE-6 — E-7 (set_active_goal) should move to Sprint 2

As noted in GAP-7: E-7 only depends on B-1 (Sprint 2). Moving it to Sprint 2 (as B-8) ensures the switching tool is deployed before E-1 creates the chewgether goal in Sprint 5 and deactivates Mt. Elbert.

---

## 6. Revised Sprint Ordering (Changes Only)

| Action | Story | From | To | Reason |
|---|---|---|---|---|
| Move | E-7 (set_active_goal) | Sprint 5 | Sprint 2 (after B-6) | Must precede E-1 to prevent W7 landmine |
| Move | E-4 (MCP instructions update) | Sprint 5 | Sprint 2 (after E-7) | Project tools ship Sprint 2; routing must match |
| Add | C-0 (GITHUB_TOKEN provisioning) | N/A | Sprint 3 (first story) | Token needed for all Sprint 3 smoke tests |
| Add | A-5 (Sprint 1 QA gate) | N/A | Sprint 1 (last story) | Migration needs verification before Sprint 2 |
| Add | C-6 (Sprint 3 QA gate) | N/A | Sprint 3 (last story) | GitHub tools need verification before Sprint 4 |
| Add | D-7 (fitness regression check) | N/A | Sprint 4 (last story) | Fitness coexistence gate before Sprint 5 |
| Add | E-9 (CLAUDE.md update) | N/A | Sprint 5 (last story) | Architecture docs must reflect shipped state |

**Revised story counts**: Sprint 1: 5 | Sprint 2: 8 (+E-7, +E-4) | Sprint 3: 7 (+C-0, +C-6) | Sprint 4: 7 (+D-7) | Sprint 5: 7 (+E-9, -E-7, -E-4) | Backlog: 4 = 38 total

---

## Verdict

**17 gaps found.** The backlog is structurally sound (correct A→B→C→D→E chain, no logic cycles, right-sized for the most part), but has systemic field-sanity and completeness issues that must be fixed before materialization.

**Single highest-risk omission**: **E-7 (set_active_goal) depends on E-1 but must precede it** (GAP-7 / BALANCE-6). When E-1 runs `create_goal(kind='project')`, `createGoalCore` deactivates Mt. Elbert in a transaction. If E-7 isn't deployed yet, the developer has no MCP tool to re-activate the fitness goal — they must do a raw DB update or navigate the UI. With the fitness user mid-program (Mt. Elbert, week ~8), this is a jarring, potentially alarming UX break. E-7 depends only on B-1, which ships in Sprint 2. Moving E-7 to Sprint 2 eliminates the landmine entirely at zero cost.

**Summary of all gaps by category**:

| # | Category | Severity | Gap |
|---|---|---|---|
| GAP-1 | Completeness | None | `prisma generate` AC present in A-1 (not missing) |
| GAP-2 | Completeness | High | E-4 (MCP instructions) in Sprint 5 instead of Sprint 2 |
| GAP-3 | Completeness | P0 | GITHUB_TOKEN provisioning story missing (C-0) |
| GAP-4 | Completeness | P0 | Fitness regression verification story missing (D-7) |
| GAP-5 | Completeness | Medium | CLAUDE.md update story missing (E-9) |
| GAP-6 | Completeness | High | QA gates missing for Sprints 1, 3, 4 (A-5, C-6) |
| GAP-7 | Ordering | P0 Critical | E-7 must move to Sprint 2 to precede E-1 |
| GAP-8 | Completeness | Low | Connector-reload notes complete; minor |
| DEP-1 | Dependency | High | 44 broken `dependsOn` aliases — none resolve to exact titles |
| FIELD-1 | Field sanity | High | 17 stories with non-standard priority values |
| FIELD-2 | Field sanity | Medium | 6 Epic D stories use `"S"`/`"M"` instead of `"Small"`/`"Medium"` |
| FIELD-3 | Field sanity | P0 Critical | `log_metric` vs `log_goal_metric` inconsistency across B-4/E-4/E-5/E-6 |
| SPLIT-1 | Sizing | Low | B-1 (14 ACs, Medium) — optional split |
| SPLIT-2 | Sizing | Low | B-4 (14 ACs, Medium) — optional split |
| SPLIT-3 | Sizing | None | B-2 (13 ACs, Small) — acceptable |
| BALANCE-5 | Sprint | High | E-4 must move to Sprint 2 (same as GAP-2) |
| BALANCE-6 | Sprint | P0 | E-7 must move to Sprint 2 (same as GAP-7) |
