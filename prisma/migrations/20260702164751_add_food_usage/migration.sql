-- CreateTable
CREATE TABLE "FoodUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "foodId" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "lastAmount" DOUBLE PRECISION,
    "lastUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodUsage_userId_isFavorite_usageCount_lastUsedAt_idx" ON "FoodUsage"("userId", "isFavorite" DESC, "usageCount" DESC, "lastUsedAt" DESC);

-- CreateIndex
CREATE INDEX "FoodUsage_userId_usageCount_lastUsedAt_idx" ON "FoodUsage"("userId", "usageCount" DESC, "lastUsedAt" DESC);

-- CreateIndex
CREATE INDEX "FoodUsage_foodId_idx" ON "FoodUsage"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodUsage_userId_foodId_key" ON "FoodUsage"("userId", "foodId");

-- AddForeignKey
ALTER TABLE "FoodUsage" ADD CONSTRAINT "FoodUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodUsage" ADD CONSTRAINT "FoodUsage_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
