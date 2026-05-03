-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "targetDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanDayOverride" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "workoutJson" JSONB,
    "nutritionText" TEXT,
    "mobilityText" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanDayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanDayOverride_planId_date_idx" ON "PlanDayOverride"("planId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDayOverride_planId_date_key" ON "PlanDayOverride"("planId", "date");

-- CreateIndex
CREATE INDEX "Note_targetDate_idx" ON "Note"("targetDate");

-- AddForeignKey
ALTER TABLE "PlanDayOverride" ADD CONSTRAINT "PlanDayOverride_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
