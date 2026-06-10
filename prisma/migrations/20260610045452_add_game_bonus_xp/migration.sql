-- CreateTable
CREATE TABLE "GameBonusXp" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "attribute" TEXT,
    "source" TEXT NOT NULL DEFAULT 'coach',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBonusXp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameBonusXp_date_idx" ON "GameBonusXp"("date");
