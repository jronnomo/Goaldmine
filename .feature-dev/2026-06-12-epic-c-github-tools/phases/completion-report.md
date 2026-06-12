# Completion Report — Epic C: GitHub Tool Pack (chewabl Sprint 3)

**Status**: Complete · 1 iteration · direct-to-main
**Roadmap issues**: #30 #31 #32 #33 #34 #53 #57 (closed on ship)

## What was built
5-tool GitHub pack in `src/lib/mcp/tools/github-tools.ts` (896 lines): `link_github_project`, `get_project_overview`, `list_project_issues`, `sync_github_milestones`, `set_github_issue_status`. Native fetch + GITHUB_TOKEN; module-private sanitize layer (`ghSafe`/`ghFetch`/`ghGraphQL`) guarantees the token never reaches output; Projects v2 board columns via one polymorphic GraphQL query; milestones mirror into ScheduledItems idempotently with USER_TZ-correct due dates and a status-preserving re-sync (never un-completes manual work). Tool surface: 83 → 88.

#53: GITHUB_TOKEN provisioned in `.env` (gh CLI token, by orchestrator — never echoed), `.env.example` now git-tracked with full template, `.claude/quality-tools.md` gained an Environment Variables section. **Vercel env remains a user action.**

## Files
| File | Change |
|------|--------|
| `src/lib/mcp/tools/github-tools.ts` | NEW — 5 tools + sanitize/fetch helpers |
| `src/lib/mcp/tools.ts` | +2 (import + registerAll wiring) |
| `.env.example` | now tracked; DATABASE_URL + MCP_AUTH_TOKEN + GITHUB_TOKEN template (orchestrator merged pre-existing untracked content) |
| `.claude/quality-tools.md` | +14 env-vars section |
| `docs/prds/PRD-epic-c-github-tools.md` | NEW (with v2 amendments) |
| `.feature-dev/2026-06-12-epic-c-github-tools/**` | run artifacts |

## Requirements
REQ-001..006 DONE (QA: SHIP IT, 36/36 ACs). REQ-007 QA gate executed live: 30/30 assertions vs jronnomo/Chewgether; full cleanup verified.

## Agent utilization
Research (Sonnet — live-verified GitHub API incl. the working Projects v2 GraphQL query; caught open_issues_count-includes-PRs, milestone-NUMBER-not-title, empty-repo 409) → Architect → Devil's Advocate (NEEDS REVISION: 4 medium — status clobbering, milestone regex, kind-gate gap, projectBoard diagnosability) → Architect v2 (all adopted) → single Dev (worktree, zero deviations) → QA (SHIP IT). Orchestrator resolved one merge wrinkle: `.env.example` was never git-tracked, dev created it fresh; contents combined and tracked (b418043).

## UX-research ledger
N/A — skipped (backend-only), recorded in PRD header.

## Known limitations / follow-ups
1. **User action**: add GITHUB_TOKEN to Vercel env (classic PAT: `repo` + `read:project`; or fine-grained equivalent) — production claude.ai sessions need it. Local uses the gh CLI token (rotates if `gh auth login` re-runs).
2. **User action**: reload claude.ai MCP connector (83 → 88 tools).
3. Pagination caps (pulls 100, board items 100) — code-commented fix paths.
4. Next: Sprint 4 project UI (#35–40 — runs /ux-research) or Sprint 5 chewgether seeding (#41–46, #48) which can now use link + sync against the real repo.
