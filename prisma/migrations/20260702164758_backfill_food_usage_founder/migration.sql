-- Migration: backfill_food_usage_founder
-- Idempotent: ON CONFLICT DO NOTHING prevents double-inserts on re-run.
-- 'usr_founder' is hardcoded — matches FOUNDER_USER_ID constant (stable historical artifact).
-- gen_random_uuid() is available natively in Neon (PostgreSQL 16 — no pgcrypto extension required).
-- The id column is TEXT; UUID strings are valid (no cuid format requirement — uniqueness only).

-- Step 1: Ensure the founder User row exists (idempotent; already exists on dev and prod).
INSERT INTO "User" ("id", "name", "createdAt", "updatedAt")
VALUES ('usr_founder', 'Founder', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- Step 2: Backfill — one FoodUsage row per existing FoodLibrary row, founder-owned.
-- Copies the 5 per-user fields from FoodLibrary so founder's favorites/usage/last-portion survive.
INSERT INTO "FoodUsage" (
    "id", "userId", "foodId",
    "usageCount", "lastUsedAt", "isFavorite", "lastAmount", "lastUnit",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    'usr_founder',
    fl."id",
    fl."usageCount",
    fl."lastUsedAt",
    fl."isFavorite",
    fl."lastAmount",
    fl."lastUnit",
    NOW(),
    NOW()
FROM "FoodLibrary" fl
ON CONFLICT ("userId", "foodId") DO NOTHING;
