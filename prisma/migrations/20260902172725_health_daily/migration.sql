-- CreateTable
CREATE TABLE "HealthDaily" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "activeKcal" DOUBLE PRECISION,
    "basalKcal" DOUBLE PRECISION,
    "steps" INTEGER,
    "exerciseMin" INTEGER,
    "standHours" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'apple_health',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthDaily_userId_date_idx" ON "HealthDaily"("userId", "date");

-- CreateIndex
CREATE INDEX "HealthDaily_date_idx" ON "HealthDaily"("date");

-- AddForeignKey
ALTER TABLE "HealthDaily" ADD CONSTRAINT "HealthDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
