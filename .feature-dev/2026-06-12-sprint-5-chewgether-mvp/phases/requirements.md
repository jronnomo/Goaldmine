# Requirements — Sprint 5: Chewgether MVP

PRD `docs/prds/PRD-sprint-5-chewgether-mvp.md` §2 amendments are normative on top of issues #41–46/#48.

## REQ-001 — seed-chewgether.ts (#41) · S · Dev
Idempotent: `prisma.goal.findFirst({ where: { kind: 'project', objective: { contains: 'Chewgether' } } })` → if found, print id + exit 0. Else `prisma.goal.create` with: kind 'project', objective "Ship Chewgether to the App Store + reach $1,000/mo MRR", status 'active', active true, isFocus false (explicit), githubRepo 'jronnomo/Chewgether', githubProjectNumber null, targetDate parseDateKey('2026-09-30'), targets (Json) = [
 { metric:'log:mrr', label:'Monthly recurring revenue', units:'$', direction:'increase', target:1000, weight:0.6, rationale:'Primary success metric — $1k/mo MRR validates product-market fit and self-sustainability.' },
 { metric:'log:milestones_done', label:'Launch milestones completed', units:'milestones', direction:'increase', target:7, weight:0.4, rationale:'7 gated milestones (Apple Dev ownership, monetization build, TestFlight, store metadata, submit, launch, growth to $1k) — completion rate is the leading indicator of shipping.' }
]. Imports: `{ prisma }` from '../src/lib/db' (singleton — runtime-consistent; documented deviation from seed.ts's standalone client), `{ parseDateKey }` from '../src/lib/calendar', 'dotenv/config' first. Header comment: focus-split context (active=tracked, isFocus untouched → Mt. Elbert keeps Today), GitHub-first milestones (#42 superseded — milestones live on GitHub, mirrored by sync_github_milestones; do NOT seed ScheduledItems here). Must run via `npx tsx prisma/seed-chewgether.ts`. Check Goal model for any other required non-default fields (read schema.prisma) — fill sensibly.

## REQ-002 — instructions consolidation (#44 expanded) · M · Dev
New `src/lib/mcp/instructions.ts` exporting `export const COACH_INSTRUCTIONS = "..."` — base text = current `src/app/api/mcp/[token]/route.ts` COACH_INSTRUCTIONS (~L84–115) with these edits:
1. Replace the stale "focus switching is app-UI only — no MCP tool exists" wording with: set_active_goal switches the focus goal; propose-before-switching covenant (show goals via list_goals, get explicit approval; warn when the user is mid-program on fitness).
2. ADD goal-kind routing block (early, near the top): "Read get_today_plan first on every session start. activeGoal.kind determines which tool pack to use." kind='fitness' → workout/hike/baseline/nutrition tools (existing rules apply unchanged); kind='project' → schedule_item/complete_item/update_scheduled_item/list_scheduled_items/log_metric/list_log_entries + GitHub pack (link_github_project/get_project_overview/list_project_issues/sync_github_milestones/set_github_issue_status).
3. ADD weekly project review cadence: "Weekly review = MRR trend (list_log_entries metric=mrr) + milestone burn (list_scheduled_items status=planned) + open PRs/issues (get_project_overview)." Plus: when a launch milestone completes, close it on GitHub (set_github_issue_status / gh) and re-sync, AND log_metric milestones_done with the new cumulative count so readiness moves.
4. RETAIN all existing fitness operating rules verbatim (the 13 rules; no deletions beyond the stale focus line).
5. No GITHUB_TOKEN value or acquisition references.
Both routes (`route.ts`, `[token]/route.ts`) import the constant; the short route.ts string is deleted. Byte-level care: this string is the live coaching contract.

## REQ-003 — coaching prompts doc (#45) · S · Dev
`docs/coaching/project-goal-prompts.md`: 3 canonical prompts with expected tool sequences + response shapes per issue AC (weekly launch review / MRR check-in / blocking-issue scan); prerequisites table (which need GitHub data vs seed-only); a "manual validation" checklist with blank Pass/Fail boxes + observed-tool-sequence column for the user to fill from claude.ai; the milestone-completion rhythm note (close on GitHub → sync → log_metric milestones_done). Project-vertical only.

## REQ-004/005/006 — ops (orchestrator; see PRD §3)
