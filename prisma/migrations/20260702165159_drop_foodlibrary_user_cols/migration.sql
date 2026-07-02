-- DropIndex
DROP INDEX "FoodLibrary_usageCount_lastUsedAt_idx";

-- DropIndex
DROP INDEX "FoodLibrary_isFavorite_usageCount_lastUsedAt_idx";

-- AlterTable
ALTER TABLE "FoodLibrary"
    DROP COLUMN "isFavorite",
    DROP COLUMN "lastAmount",
    DROP COLUMN "lastUnit",
    DROP COLUMN "lastUsedAt",
    DROP COLUMN "usageCount";
