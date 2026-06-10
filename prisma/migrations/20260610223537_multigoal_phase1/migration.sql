-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "isFocus" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "targetDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Hike" ADD COLUMN     "goalId" TEXT;

-- CreateIndex
CREATE INDEX "Goal_isFocus_idx" ON "Goal"("isFocus");

-- CreateIndex
CREATE INDEX "Hike_goalId_idx" ON "Hike"("goalId");

-- AddForeignKey
ALTER TABLE "Hike" ADD CONSTRAINT "Hike_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: set isFocus=true on the most-recently-updated active goal.
-- Runs as a single targeted row update — safe under concurrent reads (Neon/PG).
UPDATE "Goal" SET "isFocus" = true
WHERE "id" = (
  SELECT "id" FROM "Goal"
  WHERE "active" = true
  ORDER BY "updatedAt" DESC
  LIMIT 1
);
