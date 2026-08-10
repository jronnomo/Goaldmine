-- M1 (#268): retire the legacy Program table by renaming it to LegacyProgram.
--
-- HAND-WRITTEN as a pure, lossless rename — prisma migrate dev proposed
-- DROP TABLE + CREATE TABLE for the model rename, which would destroy the
-- founder's legacy row(s). ALTER ... RENAME preserves all data.
--
-- Dependent constraint/index renames follow so the physical names match what
-- Prisma generates for a fresh `LegacyProgram` model (keeps future
-- `migrate dev` runs drift-free):
--   Program_pkey                -> LegacyProgram_pkey
--   Program_userId_active_idx   -> LegacyProgram_userId_active_idx
--   Program_userId_fkey         -> LegacyProgram_userId_fkey
--
-- Deploy note (plan-critique #13): apply this migration to prod BEFORE the
-- code deploy merges — the build-time migration-status gate (#263) fails the
-- Vercel build while this migration is pending. See
-- docs/program-redesign/TOOL-DIFFS.md "M1 deploy note".

ALTER TABLE "Program" RENAME TO "LegacyProgram";

ALTER TABLE "LegacyProgram" RENAME CONSTRAINT "Program_pkey" TO "LegacyProgram_pkey";

ALTER INDEX "Program_userId_active_idx" RENAME TO "LegacyProgram_userId_active_idx";

ALTER TABLE "LegacyProgram" RENAME CONSTRAINT "Program_userId_fkey" TO "LegacyProgram_userId_fkey";
