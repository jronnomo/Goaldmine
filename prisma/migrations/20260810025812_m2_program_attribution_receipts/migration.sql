-- AlterTable
ALTER TABLE "Baseline" ADD COLUMN     "capped" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "programId" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "programId" TEXT;

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startedOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "notes" TEXT,
    "attributionRules" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityGoalLink" (
    "id" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "note" TEXT,
    "activityDate" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityGoalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteReceipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedMeal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "macros" JSONB,
    "defaultServings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedMeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Program_userId_status_idx" ON "Program"("userId", "status");

-- CreateIndex
CREATE INDEX "Program_userId_startedOn_idx" ON "Program"("userId", "startedOn");

-- CreateIndex
CREATE INDEX "ActivityGoalLink_userId_goalId_activityDate_idx" ON "ActivityGoalLink"("userId", "goalId", "activityDate");

-- CreateIndex
CREATE INDEX "ActivityGoalLink_activityType_activityId_idx" ON "ActivityGoalLink"("activityType", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityGoalLink_activityType_activityId_goalId_key" ON "ActivityGoalLink"("activityType", "activityId", "goalId");

-- CreateIndex
CREATE INDEX "WriteReceipt_userId_toolName_createdAt_idx" ON "WriteReceipt"("userId", "toolName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WriteReceipt_userId_requestId_key" ON "WriteReceipt"("userId", "requestId");

-- CreateIndex
CREATE INDEX "SavedMeal_userId_name_idx" ON "SavedMeal"("userId", "name");

-- CreateIndex
CREATE INDEX "Goal_programId_idx" ON "Goal"("programId");

-- CreateIndex
CREATE INDEX "Plan_programId_idx" ON "Plan"("programId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityGoalLink" ADD CONSTRAINT "ActivityGoalLink_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityGoalLink" ADD CONSTRAINT "ActivityGoalLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteReceipt" ADD CONSTRAINT "WriteReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMeal" ADD CONSTRAINT "SavedMeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-appended (Prisma cannot express partial indexes in the schema):
-- DB-level one-active-Program-per-user constraint — the invariant Goal.isFocus
-- never had (program-redesign blockers B3/G1). A second Program with
-- status='active' for the same userId is rejected by the database itself.
CREATE UNIQUE INDEX "program_one_active_per_user" ON "Program"("userId") WHERE status = 'active';
