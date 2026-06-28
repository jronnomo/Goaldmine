-- AlterTable
ALTER TABLE "FoodLibrary" ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAmount" DOUBLE PRECISION,
ADD COLUMN     "lastUnit" TEXT;

-- CreateIndex
CREATE INDEX "FoodLibrary_isFavorite_usageCount_lastUsedAt_idx" ON "FoodLibrary"("isFavorite" DESC, "usageCount" DESC, "lastUsedAt" DESC);
