-- CreateTable
CREATE TABLE "FootageMarker" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "kind" TEXT NOT NULL DEFAULT 'video',
    "filename" TEXT,
    "externalRef" TEXT,
    "label" TEXT NOT NULL,
    "workoutId" TEXT,
    "exerciseName" TEXT,
    "taskType" TEXT,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FootageMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FootageMarker_date_idx" ON "FootageMarker"("date");

-- CreateIndex
CREATE INDEX "FootageMarker_workoutId_idx" ON "FootageMarker"("workoutId");

-- AddForeignKey
ALTER TABLE "FootageMarker" ADD CONSTRAINT "FootageMarker_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
