-- CreateTable
CREATE TABLE "PlanRevision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "triggerNoteId" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'manual',
    "summary" TEXT NOT NULL,
    "reasoning" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanRevision_planId_createdAt_idx" ON "PlanRevision"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanRevision_triggerNoteId_idx" ON "PlanRevision"("triggerNoteId");

-- AddForeignKey
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_triggerNoteId_fkey" FOREIGN KEY ("triggerNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
