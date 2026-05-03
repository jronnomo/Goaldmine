-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "references" JSONB;

-- AlterTable
ALTER TABLE "Hike" ADD COLUMN     "rpe" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'completed';

-- CreateIndex
CREATE INDEX "Hike_status_idx" ON "Hike"("status");
