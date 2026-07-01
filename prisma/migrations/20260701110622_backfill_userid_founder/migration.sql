-- Migration 2: backfill_userid_founder
-- Idempotent: ON CONFLICT DO NOTHING + WHERE "userId" IS NULL guards all statements.
-- 'usr_founder' is hardcoded (stable historical artifact; matches FOUNDER_USER_ID constant).
-- DO NOT read env vars in SQL — this file is a fixed historical migration.

-- Step 1: Ensure the founder User row exists (self-contained on prod; idempotent on dev).
INSERT INTO "User" ("id", "name", "createdAt", "updatedAt")
VALUES ('usr_founder', 'Founder', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- Step 2: Backfill OWNED tables (12) — direct update, no join needed.
UPDATE "Workout"         SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "Measurement"     SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "FootageMarker"   SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "Baseline"        SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "Note"            SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "Hike"            SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "NutritionLog"    SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "MobilityCheckin" SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "Goal"            SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "Program"         SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "GameBonusXp"     SET "userId" = 'usr_founder' WHERE "userId" IS NULL;
UPDATE "BodyMetric"      SET "userId" = 'usr_founder' WHERE "userId" IS NULL;

-- Step 3: Backfill CHILD-denormalized tables (4) — derive userId from parent Goal.
-- Goal is fully backfilled in step 2, so all Goal.userId = 'usr_founder' before these run.
-- All 4 have required (non-null) goalId FKs — no child can have a null parent (confirmed research §5).

UPDATE "ScheduledItem" si
  SET "userId" = g."userId"
  FROM "Goal" g
  WHERE si."goalId" = g."id"
    AND si."userId" IS NULL;

UPDATE "LogEntry" le
  SET "userId" = g."userId"
  FROM "Goal" g
  WHERE le."goalId" = g."id"
    AND le."userId" IS NULL;

UPDATE "Plan" p
  SET "userId" = g."userId"
  FROM "Goal" g
  WHERE p."goalId" = g."id"
    AND p."userId" IS NULL;

UPDATE "DayRenderJob" drj
  SET "userId" = g."userId"
  FROM "Goal" g
  WHERE drj."goalId" = g."id"
    AND drj."userId" IS NULL;
