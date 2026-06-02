-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "githubProjectNumber" INTEGER,
ADD COLUMN     "githubRepo" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'fitness';

-- CreateTable
CREATE TABLE "ScheduledItem" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "completedAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "text" TEXT,
    "payload" JSONB,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledItem_goalId_date_idx" ON "ScheduledItem"("goalId", "date");

-- CreateIndex
CREATE INDEX "ScheduledItem_goalId_status_idx" ON "ScheduledItem"("goalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledItem_goalId_externalRef_key" ON "ScheduledItem"("goalId", "externalRef");

-- CreateIndex
CREATE INDEX "LogEntry_goalId_metric_date_idx" ON "LogEntry"("goalId", "metric", "date");

-- CreateIndex
CREATE INDEX "LogEntry_goalId_date_idx" ON "LogEntry"("goalId", "date");

-- CreateIndex
CREATE INDEX "Goal_kind_idx" ON "Goal"("kind");

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
