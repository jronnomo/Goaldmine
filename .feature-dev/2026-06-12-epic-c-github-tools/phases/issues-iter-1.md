# Issues — Iteration 1 (Epic C)

**Converged in one iteration. No fix pass required.**

- QA agent verdict: SHIP IT — all 36 ACs across REQ-001..006 PASS; token-leak audit CLEAN; USER_TZ audit CORRECT.
- Gates: tsc 0 errors · lint clean · build success.
- Live smoke (qa-runbook.md executed by orchestrator vs jronnomo/Chewgether, dev server :3199): **30/30 assertions**.
  - Highlights: openIssues=72/openPRs=2 (PR subtraction proven against research's empirical 74 split); projectBoard columns from Projects v2 GraphQL (user project #8); USER_TZ bucketing (due_on 2026-07-15T07:00:00Z → date 2026-07-15, not 07-14); idempotent re-sync (0 new rows); manual-completion preserved across re-sync (v2 ISSUE-1); closeCompleted → done + completedAt; issue #317 close→reopen→close round-trip + friendly 404; token absent from all captured bodies; fitness goal untouched.
  - Cleanup verified: 3 temp milestones deleted (Chewgether back to 0), test issue closed, temp goal cascade-deleted (0 orphans), fitness focus intact.

## Deferred (non-blocking)
1. `includes("404")`/`includes("409")` substring status detection in error routing — deterministic given ghFetch's message format; style-only.
2. Pagination caps: pulls per_page=100 (openPRs undercount if >100 open PRs), GraphQL items(first:100) — code-commented with fix path; fine at current scale.
3. Step 14 kind-gate live test limited to the not-linked error (refused to link the real fitness goal); the kind gate itself is code-reviewed + unit-of-logic verified (fires post-resolve, pre-token).
