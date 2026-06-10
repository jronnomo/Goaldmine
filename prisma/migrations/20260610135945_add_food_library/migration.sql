-- CreateTable
CREATE TABLE "FoodLibrary" (
    "id" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "servingSize" TEXT,
    "basis" TEXT NOT NULL DEFAULT 'serving',
    "calories" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'openfoodfacts',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodLibrary_barcode_key" ON "FoodLibrary"("barcode");

-- CreateIndex
CREATE INDEX "FoodLibrary_usageCount_lastUsedAt_idx" ON "FoodLibrary"("usageCount" DESC, "lastUsedAt" DESC);
