-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completionSnapshot" JSONB,
ADD COLUMN     "retrospective" JSONB;

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");
