# Research / premise-check — #231 (Explore agent, 2026-07-09, HEAD 4cf6825)

## page.tsx
- Server component, nodejs, force-dynamic (:6-7). weeks = 13 {offset:-i,label} (:19-22); mondays via addDays(startOfWeekMonday(now), -i*7) (:16, 27-29).
- postedWeeks: db.note.findMany type=shared_recap targetDate in [mondays[12], mondays[0]] select targetDate (:34-43) → offsets via dateKey equality vs mondays, Set-deduped (:48-57). Only {offset,label}[] + number[] cross to client (:64, CRIT-2 comments).
- NO empty-week detection at page level.

## What the recap actually reads (recap.ts computeWeeklyRecap :295-733)
- workout.findMany completed (:345-348), hike completed (:352-355), exercise PRs via getExerciseSummaries bestDate (:350,410), baseline (highlights, :615), game state badges (:359), computeReadiness (:446), project logEntry/scheduledItem groupBy (:370-390).
- nutritionLog + measurement: NEVER read (grep zero hits).
- emptyWeek bool = workoutsCompleted===0 && hikeElevationFt===null ONLY (:538). Never throws (try/catch fallback :299, 686-732).

## RecapClient.tsx
- "use client". weekIdx useState(0) (:27); navigateToWeek (:83-93); prev/next (:220-240). cardUrl = /recap/card?weekOffset&template&format&highlight (:105); <img> (:207-215) with onLoadStart/onLoad only (:213-214) → NO onError; Loading overlay (:201-205) hangs forever on failure. Empty week today = 200 zero-card, onLoad fires.

## Card route (src/app/recap/card/route.tsx)
- GET; zod-parse (400 only for invalid params :24-26); computeWeeklyRecap → renderRecapCard → next/og ImageResponse (satori+resvg; recap-render.tsx:12,113). force-dynamic (:6), NO caching (fonts module-cached only, recap-render.tsx:25-50). Empty week = 200 PNG zero-card.

## Helpers / scoping
- startOfWeekMonday/endOfWeekSunday/addDays/dateKey in calendar-core (USER_TZ Intl); page already imports them (:10). getDb() at page (:11,33) and recap.ts (:307).

## Tests
- recap.test.ts (statSlots invariants incl. "zero ≠ null"), recap-caption.test.ts (emptyWeek precedence :111,143-145,219). No RecapClient/card-route tests.

## Verdict
Plumbing premises TRUE. AC's 4-model set FALSE-ish (adds never-read nutritionLog; misses logEntry/scheduledItem). onError not operative for empty weeks (200s) — skip-mount is; onError covers genuine render failures. Corrected set: workout, hike, baseline, logEntry, scheduledItem.
