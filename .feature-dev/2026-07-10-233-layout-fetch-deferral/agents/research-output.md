# Research / premise-check — #233 (Explore agent, 2026-07-10, HEAD c26edc8)

## 1. layout.tsx (post-#232)
- Signed-in block :108-128. getLogSheetData() call :109 (the deletion target); fulfilled #233 boundary comment :110-112; getGoalCount :113 (SURVIVES); BottomNav props :119-126 = 5 meal props from logSheet.* + goalCount.
- TodayMealLite re-export :10 `export type { TodayMealLite } from "@/lib/log-sheet-data";` — sole purpose was BottomNav's unchanged import; dies when BottomNav's import dies (zero other consumers, grep-verified).
- Survivors: session try/auth :86-93; signed-out guard :99-106; AppHeader user :117; main children :118; htmlClass :81. Import :7 getLogSheetData dies; :5 auth, :6 getGoalCount, :3/:4 components stay.
- Post-#233: Shell → AppHeader + main + BottomNav(goalCount only).

## 2. BottomNav.tsx (post-#232)
- Props :73-87: 5 optional meal props + required goalCount. Pure pass-through — BottomNav renders NO macro/badge UI itself (Log tab :135-165 plain).
- LogLauncher forwarding :178-187 incl. latestWeight={null} :179, open={logOpen} :181 (KEEP), 5 meal props :182-186 (DELETE).
- TodayMealLite import :10 from "@/app/layout" (the re-export); LibraryFood/DayMacros imports :11-12 — all die. Type collapses to { goalCount: number }.
- MoreSheet goalCount :196 untouched.

## 3. LogLauncher.tsx (post-#232)
- Props :31-48: latestWeight? :33 (KEEP — feeds LogMeasurementForm :262, default null :148; always-null is pre-existing by design "BottomNav cannot query Prisma"), onClose :34 (required), open? :40, 5 meal props :41-47 (DELETE).
- Prop-seed initializer :159-181 (hasProps :164-169; ready-seed :171-180; comment :159-162 "until #233") → collapses to useState({phase:"idle", data:null}).
- Destructure :151-155 loses the 5; effect guard (fetch only on closed→open, prevOpenRef) at :222-225 MUST survive.
- TodayMealLite import :10 from "@/lib/log-sheet-data" (canonical — stays).

## 4. page.tsx dead query
- :90-92 latestMeasurement = slot 0 of 9-element Promise.all (db.measurement.findFirst orderBy date desc); :130-131 void + "kept for future Log sheet prop" comment. No render reference. Positional re-destructure needed. db binding shared (stays). db.measurement.findFirst used legitimately in goal-targets.ts (unrelated).

## 5. Hydration fragility
- BottomSheet.tsx :78-81: null on server AND initial hydration pass ("all sheets start closed, no flash; portal renders next client commit"); createPortal :83; showModal/close via useEffect. No suppressHydrationWarning outside layout's <html> :58.
- Watch: layout awaits less → earlier RSC flush on /compare + /days (known pre-existing warning per memory) — criterion = no NEW warnings vs before-baseline. LogLauncher initializer becomes deterministic idle (server null-portal anyway).

## 6. Type home
- Canonical: log-sheet-data.ts:23. Importers: LogLauncher (canonical), BottomNav (via layout re-export — dies), layout re-export :10 (dies). Post-#233 only LogLauncher + lib self-use remain.

## 7. Tests
- log-sheet-data.test.ts: 7 tests on the lib fn (shared with API route) — unaffected. No test imports @/app/layout or BottomNav (grep empty). No LogLauncher/BottomNav test files.
