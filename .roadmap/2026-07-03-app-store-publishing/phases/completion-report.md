# /roadmap completion report — App Store publishing (2026-07-03)

## Outcome

25 stories + 5 epic issues materialized on GitHub Project #8, all Sprint=Backlog / Status=Todo with Priority+Effort set. Planning docs committed to `feature/phase1-auth`.

## Run summary

- **Phase 1:** scope locked from this session's App Store audit. User AFK on the three scope questions — defaults taken and flagged: (1) AS-0 kept as a gate with the full backlog materialized; (2) Sprint=Backlog for everything (no Sprint-option edits); (3) P2 stories included.
- **Phase 2:** Plan Architect + Devil's Advocate (Sonnet). DA verdict: REVISE — key findings: initiative jumps ahead of open web-go-live P0s (#187/#188); #103 miscast as justification (it's a deferred P3 stub); Apple sign-in will re-trigger the founder-cutover account-duplication bug; session handoff was underspecified; Invite.redeemedByUserId dangles after deletion. Architect nailed: remote-URL Capacitor is the only mode (→ offline SW promoted P0), single-use exchange-code session handoff, runtime-signed Apple clientSecret, deletion = user.delete (31 cascade FKs verified), PushToken spec, C1a/C1b split. All reconciled into plan v2.
- **Phase 3:** 23-story backlog drafted (backlog.json).
- **Phase 4:** Backlog Critic found 5 fixes, all applied → 25 stories: added AS-A6 (/terms — #188's own AC), reclassified AS-A1 to Track 1 (gate-exemption), added AS-D4→AS-B2b edge, split AS-C1a into C1a-1/C1a-2, folded CLAUDE.md-doc ACs into B1/B3/C1a-2/C1b.
- **Phase 5:** materialized. Incident: `gh project field-list` and the pre-snapshot served STALE data (old Sprint option IDs, missing Sprints 10–13 and 13 recent items) → first Sprint field-write failed on every item; repaired with GraphQL-fetched live option IDs (Backlog=e45369f8), 30/30 clean. Verified via post-snapshot: zero pre-existing items modified (all apparent diffs were stale-read artifacts, null→value only).
- **Phase 6:** this report + commit.

## Gate conditions for Track 2 (native shell)

1. AS-0 records GO (push-value assessment + Web Push spike), and
2. #187 (F-1) and #188 (F-2) are closed.

Track 1 (AS-A2/A3/A4/A5/A6 + A1) is startable immediately.

## Lessons for the skill

- `gh project field-list` / `item-list` can serve stale option IDs and item lists; fetch single-select option IDs via GraphQL (`node(id:){ fields }`) before item-edit, and treat snapshot diffs showing null→value as read-staleness, not damage.
- Setting Sprint to an EXISTING option (Backlog) avoided the option-regeneration wipe entirely — the "add new sprint options" path was never needed.

## Artifacts

- `docs/roadmap/app-store-publishing-plan.md` (v2) · `docs/roadmap/app-store-publishing-backlog.md`
- `agents/plan-blueprint.md` · `agents/plan-critique.md` · `agents/backlog-critique.md`
- `coordination/backlog.json` · `phases/materialize-log.md` · board pre/post snapshots
