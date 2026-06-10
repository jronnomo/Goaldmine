# Issues — Iteration 1 (QA verdict: MINOR FIXES)

Gates: tsc CLEAN · scoped lint CLEAN (repo-wide noise pre-existing in generated files) · build OK · MCP smoke OK (tools listed, real state L7/3898, idempotency, invalid-attr error, cleanup done) · pages 200 with testids, single quest-card.

| # | Sev | File | Issue | Fix |
|---|-----|------|-------|-----|
| 1 | P1 | src/lib/game/engine.ts:867–900 | questToday.projectedXp computed inline, misses planned-hike hikeXp(); complete flag can fire early | Replace inline computation with quest.ts projectQuestXp() |
| 2 | P2 | src/lib/game/quest.ts | Dead code — never imported (engine inlines its own version) | Resolved by fix #1 (engine imports it) |
| 3 | P3 | src/components/game/CharacterHeader.tsx:48–53 | Overall XpBar missing "320/450" tabular-nums label per PRD §9.Q1 | Pass label prop; verify 390px no overflow |
