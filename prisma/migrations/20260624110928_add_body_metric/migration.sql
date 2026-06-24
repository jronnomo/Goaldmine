-- CreateTable
CREATE TABLE "BodyMetric" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BodyMetric_key_date_idx" ON "BodyMetric"("key", "date");

-- CreateIndex
CREATE INDEX "BodyMetric_date_idx" ON "BodyMetric"("date");
