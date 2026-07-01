-- AlterTable
ALTER TABLE "Baseline" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "BodyMetric" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "DayRenderJob" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "FootageMarker" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "GameBonusXp" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Hike" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "LogEntry" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Measurement" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "MobilityCheckin" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "NutritionLog" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledItem" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Baseline_userId_testName_date_idx" ON "Baseline"("userId", "testName", "date");

-- CreateIndex
CREATE INDEX "BodyMetric_userId_key_date_idx" ON "BodyMetric"("userId", "key", "date");

-- CreateIndex
CREATE INDEX "DayRenderJob_userId_status_idx" ON "DayRenderJob"("userId", "status");

-- CreateIndex
CREATE INDEX "FootageMarker_userId_date_idx" ON "FootageMarker"("userId", "date");

-- CreateIndex
CREATE INDEX "GameBonusXp_userId_date_idx" ON "GameBonusXp"("userId", "date");

-- CreateIndex
CREATE INDEX "Goal_userId_isFocus_idx" ON "Goal"("userId", "isFocus");

-- CreateIndex
CREATE INDEX "Goal_userId_active_idx" ON "Goal"("userId", "active");

-- CreateIndex
CREATE INDEX "Hike_userId_goalId_date_idx" ON "Hike"("userId", "goalId", "date");

-- CreateIndex
CREATE INDEX "LogEntry_userId_goalId_date_idx" ON "LogEntry"("userId", "goalId", "date");

-- CreateIndex
CREATE INDEX "Measurement_userId_date_idx" ON "Measurement"("userId", "date");

-- CreateIndex
CREATE INDEX "MobilityCheckin_userId_date_idx" ON "MobilityCheckin"("userId", "date");

-- CreateIndex
CREATE INDEX "Note_userId_type_date_idx" ON "Note"("userId", "type", "date");

-- CreateIndex
CREATE INDEX "NutritionLog_userId_date_idx" ON "NutritionLog"("userId", "date");

-- CreateIndex
CREATE INDEX "Plan_userId_active_idx" ON "Plan"("userId", "active");

-- CreateIndex
CREATE INDEX "Program_userId_active_idx" ON "Program"("userId", "active");

-- CreateIndex
CREATE INDEX "ScheduledItem_userId_goalId_idx" ON "ScheduledItem"("userId", "goalId");

-- CreateIndex
CREATE INDEX "Workout_userId_startedAt_idx" ON "Workout"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FootageMarker" ADD CONSTRAINT "FootageMarker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hike" ADD CONSTRAINT "Hike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionLog" ADD CONSTRAINT "NutritionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilityCheckin" ADD CONSTRAINT "MobilityCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBonusXp" ADD CONSTRAINT "GameBonusXp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMetric" ADD CONSTRAINT "BodyMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayRenderJob" ADD CONSTRAINT "DayRenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
