# PRD: Sprint 5 — Chewgether MVP: Seed + Coaching

**Author**: Claude (Tech Lead) + Gabe · **Date**: 2026-06-12 · **Status**: Approved · **Branch**: main
**GitHub Issue**: #41–#46, #48 (ACs normative with the amendments below)
**UX-research**: skipped — data seeding + MCP instructions + docs; no UI changes.

## 1. Overview
Sprints 1–4 built the multi-domain stack; Sprint 5 instantiates the real chewgether vertical: the production Goal row, 7 GitHub-backed launch milestones, verified readiness scoring, a goal-kind-aware MCP instructions string, and a documented coaching prompt set. Most artifacts are **permanent production data**.

**Success**: list_goals shows both verticals; 7 milestones visible in items/burn-down/calendar/plan; readiness math verified (≈18/100 with test data, then cleaned); coaching routes by activeGoal.kind from the first turn; fitness coaching and UI byte-identical.

## 2. Amendments to issue ACs (user-decided)
1. **#42 superseded — GitHub-first milestones**: the 7 milestones are created ON jronnomo/Chewgether (real milestones with due dates) and mirrored via `sync_github_milestones` (gh: externalRefs). No local milestone seed (avoids future duplicate sources of truth). #42's observable ACs (7 items via list_scheduled_items, USER_TZ dates) still hold.
2. **Re-anchored dates** (issue dates were stale): Jun 19 Apple Dev/bundle-ID · Jun 28 monetization · Jul 12 TestFlight · Jul 19 store metadata · Jul 26 submit · **Aug 9 public launch** (after the Aug 1 Elbert summit) · Sep 30 $1k MRR. Goal targetDate = 2026-09-30. Milestone `due_on` values sent as `<date>T07:00:00Z` (USER_TZ-midnight-equivalent instant; sync buckets via slice+parseDateKey).
3. **active/focus translation** (post-focus-split): chewgether seeded active=true (tracked), `isFocus` untouched — Mt. Elbert keeps focus. #41's W7 guard wording is obsolete; the seed documents this.
4. **#44 expanded — consolidation**: TWO divergent instructions strings exist (`src/app/api/mcp/route.ts:27-34` short/stale; `src/app/api/mcp/[token]/route.ts:84-115` COACH_INSTRUCTIONS ~9.5k chars — the live connector one). Consolidate into `src/lib/mcp/instructions.ts` (single exported constant) imported by both routes; ALSO fix the stale "focus switching is app-UI only — no MCP tool exists" claim → `set_active_goal` exists with a propose-before-switching covenant.
5. **#46 cleanup**: the two test LogEntries (mrr=200, milestones_done=1) are deleted after verification (direct prisma — no MCP LogEntry-delete tool).
6. **#45/#48 claude.ai steps are user-manual**: prompts doc carries the validation checklist; issues close with "manual claude.ai validation pending (user)".

## 3. Requirements (full detail in run-dir requirements.md)
- REQ-001 (#41, code): `prisma/seed-chewgether.ts` idempotent goal seed per §2.3 (direct prisma.goal.create; targets log:mrr $1000 w0.6 + log:milestones_done 7 w0.4 with issue rationale strings; targets validated against GoalTargetSchema shape).
- REQ-002 (#44, code): instructions consolidation + kind-routing content (all #44 AC sentences present; fitness rules retained verbatim; no token refs).
- REQ-003 (#45, docs): `docs/coaching/project-goal-prompts.md` — 3 canonical prompts + tool sequences + prerequisites + user validation checklist.
- REQ-004 (#42/#43, ops): seed → gh milestones ×7 → link → sync ×2 (idempotent) → verify items.
- REQ-005 (#46, ops): readiness math verify (≈18) on /progress + fitness unchanged + cleanup.
- REQ-006 (#48, ops+user): E2E runbook incl. set_active_goal context-switch, all four project pages with real data, fitness regression, prod endpoint; claude.ai checks → user.

## 4–7. Technical/UI/Edge/Security
Data model: none (existing models). MCP surface: no tool changes — but the **instructions string changes ⇒ Vercel deploy + connector reload required** (#44 CRITICAL). UI: none. Edge: seed double-run prints id + skips; sync idempotent; seed run with goal already present in prod (it isn't — verified pre-run). Security: no secrets in seed/docs/instructions; token only via env.

## 8. Acceptance / 10. Test Plan
Gates (tsc/lint/build) + ops sequence in §3 REQ-004..006; fitness-focus restore verified at every flip; final state = permanent chewgether data, zero test residue, fitness focus.

## 11. References
Plan: `~/.claude/plans/smooth-mixing-garden.md` (Sprint 5 revision) · exploration findings folded into requirements.md · Epic B/C/Sprint-4 run dirs.
