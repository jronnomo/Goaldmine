-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedReason" TEXT;

-- CreateIndex
CREATE INDEX "Note_resolvedAt_idx" ON "Note"("resolvedAt");

-- Backfill: notes that were already "non-pending" under the old
-- date-cutoff logic (date <= most recent active-plan revision) are
-- marked resolved at that revision's timestamp. Notes newer than the
-- cutoff remain unresolved, preserving the pre-migration pending set.
UPDATE "Note"
SET "resolvedAt" = sub."cutoff",
    "resolvedReason" = 'backfill: folded into prior plan revision'
FROM (
  SELECT MAX(pr."createdAt") AS "cutoff"
  FROM "PlanRevision" pr
  JOIN "Plan" p ON pr."planId" = p."id"
  WHERE p."active" = TRUE
) sub
WHERE "Note"."resolvedAt" IS NULL
  AND sub."cutoff" IS NOT NULL
  AND "Note"."date" <= sub."cutoff";
