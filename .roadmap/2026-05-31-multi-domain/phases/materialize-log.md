# Materialize log

| # | Story | Issue | Sprint | item |
|---|---|---|---|---|
| 1 | Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link | #20 | Sprint 1 - Generic data spine | ok |
| 2 | Add required goalId param to computeReadiness and computeRea | #21 | Sprint 1 - Generic data spine | ok |
| 3 | Implement log:* metric namespace in resolveMetricValue, reso | #22 | Sprint 1 - Generic data spine | ok |
| 4 | Expose Goal.kind on create_goal, list_goals, and get_today_p | #23 | Sprint 1 - Generic data spine | ok |
| 5 | B-1: registerProjectTools scaffold + schedule_item + delete_ | #24 | Sprint 2 - Project tool pack | ok |
| 6 | B-2: complete_item + update_scheduled_item | #25 | Sprint 2 - Project tool pack | ok |
| 7 | B-3: list_scheduled_items | #26 | Sprint 2 - Project tool pack | ok |
| 8 | B-4: log_metric + list_log_entries | #27 | Sprint 2 - Project tool pack | ok |
| 9 | B-5: get_today_plan project-goal branch (today's ScheduledIt | #28 | Sprint 2 - Project tool pack | ok |
| 10 | B-6: Epic B integration smoke + Sprint 2 QA gate | #29 | Sprint 2 - Project tool pack | ok |
| 11 | registerGitHubTools scaffold + link_github_project tool | #30 | Sprint 3 - GitHub integration | ok |
| 12 | get_project_overview read tool — REST + GraphQL, rate-limit  | #31 | Sprint 3 - GitHub integration | ok |
| 13 | list_project_issues read tool — paginated, state/label/miles | #32 | Sprint 3 - GitHub integration | ok |
| 14 | sync_github_milestones — idempotent UTC→USER_TZ upsert to Sc | #33 | Sprint 3 - GitHub integration | ok |
| 15 | set_github_issue_status light write — open/close a GitHub is | #34 | Sprint 3 - GitHub integration | ok |
| 16 | Active-context resolution: fetch active Goal in page.tsx and | #35 | Sprint 4 - Goal-type UI | ok |
| 17 | Project Today body: ScheduledItems + LogEntry MRR + next mil | #36 | Sprint 4 - Goal-type UI | ok |
| 18 | Calendar legend: add 'scheduled-item' kind to LegendKindSche | #37 | Sprint 4 - Goal-type UI | ok |
| 19 | Calendar ScheduledItem source: query ScheduledItems in getCa | #38 | Sprint 4 - Goal-type UI | ok |
| 20 | Project Plan view: phases + milestones page at /goals/[id]/p | #39 | Sprint 4 - Goal-type UI | ok |
| 21 | Project Progress view: log:* metric readiness + milestone bu | #40 | Sprint 4 - Goal-type UI | ok |
| 22 | E-1: Seed the chewgether Goal row (kind=project, targets, Gi | #41 | Sprint 5 - Chewgether MVP | ok |
| 23 | E-2: Seed the 7 launch milestones as ScheduledItems for the  | #42 | Sprint 5 - Chewgether MVP | ok |
| 24 | E-3: Link chewgether goal to GitHub repo and run initial mil | #43 | Sprint 5 - Chewgether MVP | ok |
| 25 | E-4: Update MCP server instructions string for goal-kind-awa | #44 | Sprint 2 - Project tool pack | ok |
| 26 | E-5: Project-goal coaching prompt set — weekly launch review | #45 | Sprint 5 - Chewgether MVP | ok |
| 27 | E-6: Verify chewgether readiness scoring — log:mrr and log:m | #46 | Sprint 5 - Chewgether MVP | ok |
| 28 | E-7: add set_active_goal MCP tool and document goal-switchin | #47 | Sprint 2 - Project tool pack | ok |
| 29 | E-8: End-to-end Sprint 5 verification — chewgether goal is p | #48 | Sprint 5 - Chewgether MVP | ok |
| 30 | BACKLOG: Self-serve / in-app planner (Option B) for non-oper | #49 | Backlog | ok |
| 31 | BACKLOG: Fitness vertical convergence onto ScheduledItem / L | #50 | Backlog | ok |
| 32 | BACKLOG: Standalone personal-finance vertical | #51 | Backlog | ok |
| 33 | BACKLOG: Multi-tenancy / GitHub OAuth / per-user auth | #52 | Backlog | ok |
| 34 | Provision GITHUB_TOKEN env + document required scopes | #53 | Sprint 3 - GitHub integration | ok |
| 35 | Fitness-coexistence regression gate: verify fitness vertical | #54 | Sprint 4 - Goal-type UI | ok |
| 36 | Update CLAUDE.md + quality-tools for the multi-domain spine  | #55 | Sprint 5 - Chewgether MVP | ok |
| 37 | Sprint 1 QA gate: migration additive, fitness readiness iden | #56 | Sprint 1 - Generic data spine | ok |
| 38 | Sprint 3 QA gate: GitHub pack curl smoke + token non-leak +  | #57 | Sprint 3 - GitHub integration | ok |
| 39 | Sprint 4 QA gate: fitness + project UI at 390px, no regressi | #58 | Sprint 4 - Goal-type UI | ok |

**39 created, 0 failed.**
