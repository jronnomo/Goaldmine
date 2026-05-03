-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "weeks" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "planJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plan_goalId_idx" ON "Plan"("goalId");

-- CreateIndex
CREATE INDEX "Plan_active_idx" ON "Plan"("active");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
