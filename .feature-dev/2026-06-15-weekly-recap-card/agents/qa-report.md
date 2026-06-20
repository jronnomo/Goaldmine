# QA Report — Weekly Recap Card Feature
**Date:** 2026-06-15
**Auditor:** QA Agent (Claude Sonnet 4.6)
**Verdict:** MINOR FIXES
**Build gates:** `npx tsc --noEmit` → 0 errors ✓ | `npm run lint` → 0 errors ✓

---

## Requirements Status Table

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| REQ-001 | `computeWeeklyRecap()` aggregator in `src/lib/recap.ts` | PASS | Full implementation at lines 124–323; all required fields present; WeeklyRecap type matches addendum §A exactly |
| REQ-002 | Shared card render module `src/lib/recap-card.tsx` | PASS | Exports `RecapCard` (line 109) and `RecapStorySlide` (line 543); flex-only inline styles; no CSS vars or grid |
| REQ-003 | Image route handlers (PNG export) | PASS | `card/route.tsx` and `story/[slide]/route.tsx` both have `runtime="nodejs"` + `dynamic="force-dynamic"`; slide 400 guard present |
| REQ-004 | `/recap` page + client controls | PARTIAL | Page and RecapClient correctly implemented; entry link on Progress hub present; download UI is 4 links (1 card + 3 story) rather than 2 buttons per PRD AC9 (minor) |
| REQ-005 | `generate_recap_card` MCP tool | PASS | Registered at tools.ts:4751; correct title/description/schema; try/catch → errorResult; imageAndJsonResult returns image+text |

### PRD §8 Acceptance Criteria

| AC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| AC-1 | `npx tsc --noEmit` passes with 0 errors | PASS | Confirmed clean (no output) |
| AC-2 | `npm run lint` introduces no new errors | PASS | Lint exits clean |
| AC-3 | `npm run build` succeeds | UNVERIFIED | Build not run (no dev server); code structure correct, no obvious build blockers |
| AC-4 | MCP `tools/list` returns `generate_recap_card` with correct title + description | PASS | tools.ts:4753–4759 exactly matches PRD §4.2 wording |
| AC-5 | `tools/call generate_recap_card` returns image block + text block | PASS | `imageAndJsonResult(buf, recap)` returns `[{type:"image",data,mimeType:"image/png"},{type:"text",text:JSON}]` — tool-helpers.ts:43–57 |
| AC-6 | `progressPct` = `computeReadiness(...).score`; no "elbert" anywhere | PASS | recap.ts:216 calls `computeReadiness(targets, sunday, goal.id)`; `grep -ri "elbert" src/lib/recap*.ts recap-card.tsx` → empty |
| AC-7 | `GET /recap/card?weekOffset=0` → 1080×1920 PNG | PASS | route.tsx returns `renderRecapCard(recap, template)` which wraps `ImageResponse(width:1080, height:1920)` |
| AC-8 | `GET /recap/story/1|2|3` → 1080×1920 PNG; invalid slide → 400 | PASS | story route.tsx:24–26 validates slide ∈ {1,2,3}, returns 400 otherwise; renders via `renderRecapStorySlide` |
| AC-9 | `/recap` renders preview + week selector + template switch + 2 download buttons | PARTIAL | Preview, week selector, template toggle all present. Download count is 4 (1 card + 3 story links) vs spec's "2 buttons" — see Issue #2 |
| AC-10 | Header string = `Week N · Day M of totalProgramDays` | PASS (cosmetic) | recap-card.tsx:122 renders `WEEK ${n} · DAY ${m} OF ${t}` — uppercase per design; content matches spec |
| AC-11 | All Date math via `@/lib/calendar`; no raw `setHours`/`getDate` in new code | PASS | Only `getTime()` used (line 253–254): permitted §B numeric diff between two `startOfDay()` results |
| AC-12 | Empty-week + no-targets states render without crashing | PASS | All four goalState branches render (RecapCard:126–311); catch block returns safe fallback WeeklyRecap |

---

## CRIT/DC Fix Verification Table

| Item | Requirement | Status | File:Line |
|------|-------------|--------|-----------|
| CRIT-1 | `refDay = weekOffset===0 ? startOfDay(asOf) : startOfDay(sunday)` | PASS | recap.ts:249–250 — exact match |
| CRIT-1 | Numeric diff only between two `startOfDay()` results | PASS | recap.ts:253–254; no other `getTime()` in new code |
| CRIT-2 | `RecapClient` props are ONLY `{weeks:{offset,label}[]; defaultTemplate?}` | PASS | RecapClient.tsx:16–22 — exact match; no Date, no WeeklyRecap |
| CRIT-2 | No `getTime`/`setHours`/`getDate` in RecapClient.tsx | PASS | grep confirms none present |
| CRIT-2 | No `Date` or `WeeklyRecap` serialized from server to client | PASS | page.tsx passes only `weeks` (label string array) to RecapClient |
| CRIT-3 | `units` via `UNIT_FROM_PRIMARY` | PASS | recap.ts:87–91 defines the record; recap.ts:191 maps `s.primary` through it |
| CRIT-4 | `getBaselineSummaries()` NOT called | PASS | Not imported or called anywhere in recap.ts |
| CRIT-4 | `prs[]` = exercise PRs only, `source:"exercise"` | PASS | recap.ts:187 maps with `source: "exercise" as const` |
| DC-2 | `instagramHandle` from `process.env.INSTAGRAM_HANDLE ?? null` | PASS | recap.ts:272,318; card omits handle when null (recap-card.tsx:463) |
| DC-2 | No hardcoded Instagram handle anywhere in recap files | PASS | `grep -rwi "gabe|gronnmo"` → empty on all recap files |
| DC-4 | `goalState` is quad-state: `no-goal|no-targets|all-missing|has-data` | PASS | recap.ts:32; all four branches set correctly at lines 203–231 |
| DC-5 | Volume/elevation use `Intl.NumberFormat("en-US",{maximumFractionDigits:0})` | PASS | recap-card.tsx:13–14 `fmtComma()`, used by `fmtVolume` and `fmtElevation` |
| DC-5 | `progressPct`: `` `${n}%` `` when number; `"—"` when null | PASS | recap-card.tsx:25–27 `fmtPct()` |
| S-5 | `volumeLb` null when `rawVol===0` | PASS | recap.ts:181 `const volumeLb = rawVol === 0 ? null : rawVol` |

---

## USER_TZ Audit

| Check | Status | Evidence |
|-------|--------|----------|
| No raw `setHours`/`getDate`/`getMonth`/`getFullYear`/`getHours`/`setDate` in new app code | PASS | grep across all 8 audited files → zero hits in implementation code |
| Only `getTime()` usage is the §B-permitted day-diff between two `startOfDay()` values | PASS | recap.ts:253–254 — `refDay.getTime() - startOfDay(plan.startedOn).getTime()` |
| `weekRangeLabel()` uses `Intl.DateTimeFormat` with `timeZone: process.env.USER_TZ ?? "America/Denver"` | PASS | recap.ts:104–110 |
| RecapClient does NOT import `@/lib/calendar` | PASS | RecapClient.tsx imports: `useState` + `RecapTemplate` type only |
| Server builds `weeks` array with `weekRangeLabel(now, -i)` | PASS | page.tsx:14–17 — correct pattern |

---

## MCP Tool Audit

| Check | Status | Evidence |
|-------|--------|----------|
| Tool registered with title + description | PASS | tools.ts:4752–4759 |
| Input: `weekOffset` int `[-26,0]` default 0 | PASS | tools.ts:4761–4767 |
| Input: `goalId` optional string | PASS | tools.ts:4768–4771 |
| Input: `template` optional enum `["coal","parchment"]` | PASS | tools.ts:4772–4777 |
| Handler try/catch → `errorResult` on failure | PASS | tools.ts:4787–4789 |
| Returns `imageAndJsonResult` (image block + text JSON) | PASS | tools.ts:4786; tool-helpers.ts:43–57 |
| Image block: `{type:"image", data: base64-NO-prefix, mimeType:"image/png"}` | PASS | tool-helpers.ts:47–51 — `pngBuffer.toString("base64")` (no data-URI prefix) |
| No JSX in `tools.ts` (remains a `.ts` file) | PASS | tools.ts imports `renderRecapCard` from `recap-render.tsx`; no JSX syntax present |
| `imageAndJsonResult` helper added to `tool-helpers.ts` | PASS | tool-helpers.ts:43–57 |

---

## Satori Constraint Audit

| Constraint | Status | Evidence |
|------------|--------|----------|
| Flex-only layout — no CSS grid | PASS | All layouts use `display: "flex"` + `flexDirection`; no `grid` property anywhere |
| Inline styles only — no Tailwind classes or className | PASS | All JSX in recap-card.tsx uses `style={{...}}` |
| No CSS variables (`var(--…)`) in satori components | PASS | None found in recap-card.tsx or recap-render.tsx |
| No `<svg>` or `<img>` — Bullseye is div-stack | PASS | Bullseye (recap-card.tsx:38–72) is 4 nested `<div>` rings |
| Fonts loaded via ArrayBuffer with DC-1 safe slice | PASS | recap-render.tsx:20–22 — `raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)` |
| Font names in template tokens match `ImageResponse` font registration | PASS | `"GeistSans"` and `"DMSerifDisplay"` match in both recap-templates.ts and recap-render.tsx:60,64,68 |
| Font files bundled in repo | PASS | `src/app/recap/fonts/` contains Geist-Regular.ttf, Geist-SemiBold.ttf, DMSerifDisplay-Regular.ttf |
| `textAlign: "center"` in SlideThree | LOW RISK | recap-card.tsx:789 — satori supports textAlign per docs; not a hard constraint violation |
| `overflow: "hidden"` on goal objective | LOW RISK | recap-card.tsx:275 — satori supports this in recent versions; silently ignored if not (text overflows rather than clips, no crash) |

---

## Empty-State Audit

| Condition | Expected | Implemented | Status |
|-----------|----------|-------------|--------|
| `goalState==="no-goal"` (goal===null) | Muted "No focus goal" placeholder; empty Bullseye shell; zone keeps footprint | `hasGoal=false` → `goalObj="No focus goal"`, `mutedText` color; Bullseye shows empty shell; goal zone `height` fixed | PASS |
| `goalState==="no-targets"` | objective + "Set goal targets" CTA; empty Bullseye; no % | recap-card.tsx:300–311 renders "Set goal targets to track progress"; `progressPct=null` → "—"; ProgressBar hidden (condition line 282 excludes `no-targets`) | PASS |
| `goalState==="all-missing"` | objective + empty Bullseye + `progressPct` → `"—"` | `progressPct=null` → `fmtPct(null)` = `"—"` (line 239); Bullseye `hasData=false` → empty shell; ProgressBar shown but at 0% fill | PASS |
| `goalState==="has-data"` | full: objective + filled Bullseye + `${pct}%` + topMetricLabel | Bullseye fills rings by pct quartile; `fmtPct(pct)` shows `"${n}%"`; topMetricLabel rendered when non-null | PASS |
| `topMetricLabel===null` | omit bar sub-label | recap-card.tsx:285–298 — `{topMetricLabel && ...}` | PASS |
| `header.programWeek===null` | header omits program counter; shows dateRangeLabel only | recap-card.tsx:121–123 — `programLine` is null; recap-card.tsx:160 — `{programLine && ...}` | PASS |
| Slide 3 when `programWeek===null` | omit "On to Week N." line | recap-card.tsx:782 — `{recap.header.programWeek !== null && ...}` | PASS |
| `instagramHandle===null` | footer shows wordmark only | recap-card.tsx:463 — `{recap.instagramHandle !== null && ...}` | PASS |
| `volumeLb===null` / `hikeElevationFt===null` | `"—"` muted | `fmtVolume(null)` = `"—"` (line 18); `fmtElevation(null)` = `"—"` (line 22); `isNull` prop used for muted color | PASS |
| `emptyWeek===true` | card still renders all zones | catch block and normal path both return valid WeeklyRecap; no conditional zone removal | PASS |
| Cells never collapse | fixed heights on all zones | All zones use explicit `height: tok.zoneHeight.*` | PASS |

---

## Mobile/UI Audit

| Check | Status | Evidence |
|-------|--------|----------|
| Tap targets ≥ 44px — week selector buttons | PASS | RecapClient.tsx:66,81 — `min-h-[44px] min-w-[44px]` |
| Tap targets ≥ 44px — template toggle buttons | PASS | RecapClient.tsx:98 — `min-h-[44px]` |
| Tap targets ≥ 44px — Download Card link | PASS | RecapClient.tsx:113 — `min-h-[44px]` |
| Tap targets ≥ 44px — Story download links | PASS | RecapClient.tsx:125 — `min-h-[44px]` |
| CSS tokens only (no hardcoded hex) in controls | PASS | All colors use `var(--accent)`, `var(--border)`, `var(--muted)`, `var(--card)` tokens; `text-white` on Download Card is a Tailwind semantic token, not raw hex |
| Card canvas hex values documented exception | PASS | recap-templates.ts:1–5 header comment explicitly notes these are the only allowed hardcoded hex values |
| Loading state while preview loads | PASS | RecapClient.tsx:38–53 — conditional loading overlay |
| Preview image scaled to phone width | PASS | RecapClient.tsx:48–50 — `width={540} height={960}` + `className="w-full h-auto"` |
| Entry point from Progress hub | PASS | progress/page.tsx:67–74 — Share recap Link with `min-h-[44px]` |
| `/recap` activates Progress tab in BottomNav | PASS | BottomNav.tsx:57–62 — `match: (p) => p.startsWith("/progress") || ... || p.startsWith("/recap")` |
| Download buttons are real `<a download>` | PASS | RecapClient.tsx:110–128 — `<a href={cardUrl} download="recap-card.png">` and story links |

---

## Security Audit

| Check | Status | Evidence |
|-------|--------|----------|
| No `dangerouslySetInnerHTML` | PASS | grep across all 8 audited files → none found |
| `MCP_AUTH_TOKEN` never echoed | PASS | Not referenced in any recap file |
| `INSTAGRAM_HANDLE` sourced from env, not included in MCP output (only in the image/JSON stats) | ACCEPTABLE | instagramHandle appears in `recap` stats returned as text block — this is low-risk personal brand info, not a secret |
| Zod validation on all MCP tool inputs | PASS | tools.ts:4760–4778 — weekOffset range, goalId optional, template enum |
| Zod validation on all route params | PASS | CardParamsSchema (card/route.tsx:11–15), SlideParamsSchema (story route.tsx:12–16), slide ∈{1,2,3} guard |
| Routes unauthenticated (consistent w/ dashboard) | PASS | No auth guard added; matches existing dashboard convention |
| No raw SQL — Prisma only | PASS | recap.ts uses `prisma.goal.findFirst`, `prisma.workout.findMany`, `prisma.hike.findMany` |

---

## Code Quality Issues

| # | Severity | File:Line | Issue | Suggested Fix |
|---|----------|-----------|-------|---------------|
| 1 | MODERATE | recap-card.tsx:150–158 + recap-templates.ts:129 | **Header zone padding overflow**: `height: 150` with `paddingTop: igTopChrome=140` + `paddingBottom: 20` = 160px of padding. Under CSS `content-box` (satori default), total element height becomes 310px, leaving ~140px blank at bottom of card. Under yoga/border-box, content height = -10px and header text is invisible. The PRD marks all px values as "provisional (UXR-recap-17)". Needs visual smoke. | Either (a) increase `zoneHeight.header` to ≥160 to account for padding (e.g., 300), or (b) move `paddingTop: igTopChrome` to the root canvas div or a separate spacer div, and set `height: 150` to be content height only. Decide based on visual result. |
| 2 | LOW | RecapClient.tsx:119–130 | **Download UI shape**: PRD AC-9 specifies "2 download buttons" ("Download card" + "Download Stories"); implementation has 4 download actions (1 card link + 3 separate story links). Functionally equivalent or better, but deviates from spec literally. | No code change needed; just update PRD AC-9 to reflect the implemented design (3 story links is pragmatically cleaner). |
| 3 | LOW | recap-card.tsx:275 | **`overflow: "hidden"` on goal objective div**: Satori supports this in recent builds but silently ignores it in older versions. If ignored, long objectives may overflow the goal block zone rather than clip. | Acceptable as-is; verify visually with a long objective string. Add `textOverflow: "ellipsis"` and `whiteSpace: "nowrap"` to improve clipping robustness across satori versions. |
| 4 | LOW | recap-card.tsx:789 | **`textAlign: "center"` in SlideThree**: satori supports this property, but centered text in flex containers can sometimes misbehave. Low risk. | Verify slide 3 visually. Alternative: use `alignItems: "center"` + fixed width on the text container. |
| 5 | COSMETIC | recap-card.tsx:122 | **Header case**: code renders `WEEK N · DAY M OF N` (all caps); PRD AC-10 says `Week N · Day M of N` (mixed case). This is a visual design choice, not a bug. | Update PRD to reflect ALL_CAPS design if intentional, or change to mixed case in the string template. |
| 6 | NOTE | recap-render.tsx:27–50 | **Sync `fs.readFileSync` at module scope**: three blocking font reads occur once per cold start. This is the DC-1 pattern intentionally specified in the addendum. Acceptable. | No action needed; DC-1 explicitly specifies module-scope loading. Confirm font directory is included in Vercel deploy (add to `next.config.ts` if needed: `serverExternalPackages` or `outputFileTracingIncludes`). |

---

## Overall Verdict: MINOR FIXES

The implementation is clean and substantially correct. All five CRITs landed exactly as specified in the addendum. TypeScript and lint are clean. Security is sound. The MCP tool is properly structured and the server→client boundary is respected. The main action items before shipping are:

1. **(MODERATE, required before deploy)** Visual smoke of the header zone on the rendered card — the `height: 150 + paddingTop: 140 + paddingBottom: 20` combination must be verified to render header text correctly. If text is invisible, increase `zoneHeight.header` to ≥ 300 or restructure padding.
2. **(LOW, optional)** Decide whether to collapse the 3 story download links into one "Download Stories" button (zip bundle or UI accordion) to match PRD AC-9 literally, or document the 3-link design as intentional.
3. **(LOW, pre-deploy check)** Confirm Vercel's `outputFileTracingIncludes` or equivalent captures `src/app/recap/fonts/*.ttf` — font files not declared in `next.config.ts` may be excluded from the Vercel function bundle, causing silent satori font fallback.

---

## Fix Priority List

1. **[MODERATE] Verify/fix header zone padding** — visual smoke first; fix zone height or restructure padding if header text is invisible. `recap-card.tsx:150–158` + `recap-templates.ts:129`.
2. **[LOW] Add font directory to Vercel tracing config** — check `next.config.ts` for `outputFileTracingIncludes: {"./src/app/recap/fonts/**": ["**/*.ttf"]}` before first deploy.
3. **[LOW] Verify `overflow: "hidden"` behavior with long objective strings** — smoke the no-goal and long-text edge cases on both templates.
4. **[COSMETIC] Align header case with design intent** — update either the code or PRD to resolve the WEEK/Week case mismatch.
5. **[DOCS] Reconcile PRD AC-9 "2 download buttons"** — amend acceptance criterion to reflect the 4-action download UI or revert to 2-button design.

---

## Summary

All CRIT and most DC fixes from the architecture addendum landed correctly: the refDay formula (CRIT-1) is exact, the server→client boundary is clean with no Date objects reaching RecapClient (CRIT-2), UNIT_FROM_PRIMARY drives exercise PR units (CRIT-3), baseline summaries are correctly descoped (CRIT-4), the Instagram handle comes from env (DC-2), goalState is a proper quad-state type (DC-4), Intl.NumberFormat formats display numbers (DC-5), and volumeLb is null on zero-weight weeks (S-5). The MCP tool is properly wired: it stays in a `.ts` file with no JSX, calls `renderRecapCard` via `recap-render.tsx`, and returns `imageAndJsonResult` with a raw base64 image block plus JSON stats. TypeScript (`npx tsc --noEmit`) and lint (`npm run lint`) both exit clean. The one meaningful concern is the header zone's 150px height combined with 160px of vertical padding — this needs a visual smoke to confirm satori renders the header text correctly. Everything else is minor and post-ship fixable.
