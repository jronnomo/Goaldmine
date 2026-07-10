# Research / premise-check — #232 (Explore agent, 2026-07-10, HEAD f0dc7ff)

## 1. layout.tsx meal pipeline
- Promise.all :142-165: nutritionLog.findMany {date gte startOfDay(now) lte endOfDay(now)} orderBy date asc, select id/date/mealType/items/notes/calories/proteinG/carbsG/fatG/fiberG/sodiumMg (:143-159); getQuickPickFoods() :160; listLibraryFoods() :161; resolveDay(now) :164. now :141; db=getDb() :140. goalCount separate statement :169 (#233 boundary comments :166-168, :73-75).
- Derivations :189-195: trackedTodayMacros = sumLoggedDayMacros(map macros); planTarget = sumPlanTargetMacros(today.nutritionPlan); dayTargetMacros = hasAnyMacros ? planTarget : null. Helpers in src/lib/nutrition-macros.ts (sumLoggedDayMacros:17, sumPlanTargetMacros:42, hasAnyMacros:73, DayMacros:5).
- Props to BottomNav :201-208: todaysMeals, quickPickFoods, libraryFoods, trackedSoFar, dayTarget, goalCount.
- TodayMealLite DEFINED layout.tsx:57-71 (exported; dateISO already string via .toISOString() :180; meal mapping :171-185). Importers: BottomNav.tsx:10 + LogLauncher.tsx:10 ONLY. MealEditButton has its own structural MealEditButtonMeal type (:20-35, adds plannedTarget?).

## 2. BottomNav → LogLauncher
- logOpen useState in BottomNav :89; toggled :142-150; force-closed on pathname change :98-102.
- LogLauncher props :178-186 (latestWeight={null}, onClose, meals/foods/macros). NO open&& guard — LogLauncher mounted whenever BottomNav renders. BottomSheet SSR guard is portal-only (BottomSheet.tsx:81 `typeof document === "undefined"` before createPortal; open drives dialog.showModal/close :55-66, not mount).

## 3. MealEditButton / mutations
- Edit renders MealComposer mode="edit" in its OWN BottomSheet (:69-96); save = updateNutrition (workout-actions.ts:279-314), delete = deleteNutrition (:336). logNutrition (:~269).
- ALL call revalidatePath("/", "layout") + "/" + "/nutrition" (:269-271, 310-312, 339-341) — but revalidatePath applies at NEXT navigation; the open sheet's layout-threaded props stay stale mid-session. Premise TRUE with that nuance.
- MealEditButton sits in LogLauncher's "Logged today" list (LogLauncher.tsx:198-201) and NutritionToday.tsx:196. Needs onMutated callback for in-sheet refetch (its inner sheet closes on save; the Log sheet stays open).

## 4. Route-handler auth
- API inventory: api/auth/[...nextauth], api/mcp (bearer/OAuth) ×2, api/render-jobs/peek (worker token). NO session-cookie-authed JSON route exists — #232 establishes it.
- Pattern: auth() → if (!session?.user?.id) 401 JSON → runWithUser(session.user.id, handler) (db.ts:327; getDb resolves ALS ?? getCurrentUserId, db.ts:380-382). getCurrentUserId REDIRECTS on no session (current-user.ts:25-30) → 307 in route handlers — never use it there.
- No 401-JSON precedent (peek returns 404 on bad auth). Middleware: matcher :146-148 covers all non-static; /api/log-sheet-data unlisted in isPublicPath (route-access.ts:20-42) → optimistic cookie gate :117-128 (presence-only) → 307 no-cookie. Leave OFF public list; handler auth() is authoritative.

## 5. Rate limiting
- Middleware limits only /oauth/* and /api/auth/signin* (middleware.ts:63-99; comment :61-62 excludes general /api). Buckets (rate-limit.ts:29-40): oauth, registerHour, signin-hour, accessRequestHour, invitePreviewHour. No general bucket; don't add one.

## 6. Serialization
- Payload fully JSON-safe: TodayMealLite.dateISO already string; LibraryFood (food-types.ts:36-51) no Dates; DayMacros = 4 numbers. ResolvedDay (has Dates) consumed server-side only.

## 7. Tests
- No LogLauncher/api-route tests. route-access.test.ts: table-driven PUBLIC_CASES/PROTECTED_CASES it.each (:40-64; /api/goals, /api/workouts precedent at :62-63) — add /api/log-sheet-data to PROTECTED.

## 8. #233
- Confirmed: prop/fetch removal story; layout comments reference it twice. Props optional on both components (BottomNav.tsx:80-87, LogLauncher.tsx:34-46) → self-fetch coexists until #233.
