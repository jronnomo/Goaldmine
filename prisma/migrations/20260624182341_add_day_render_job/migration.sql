-- CreateTable
CREATE TABLE "DayRenderJob" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "goalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3),
    "draftRef" TEXT,
    "approvedAt" TIMESTAMP(3),
    "renderedAt" TIMESTAMP(3),
    "outputRef" TEXT,
    "errorMessage" TEXT,
    "clipforgeProjectId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayRenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DayRenderJob_goalId_status_date_idx" ON "DayRenderJob"("goalId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DayRenderJob_goalId_date_key" ON "DayRenderJob"("goalId", "date");

-- AddForeignKey
ALTER TABLE "DayRenderJob" ADD CONSTRAINT "DayRenderJob_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
