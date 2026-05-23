-- AlterTable
ALTER TABLE "Note" ADD COLUMN "lastAcknowledgedAt" TIMESTAMP(3);

-- Backfill: high-confidence auto-promotion of existing feedback notes to
-- the new "standing_rule" type. Only promote notes whose body starts with
-- an explicit marker ("RULE:" or "STANDING:"), case-insensitive, with any
-- leading whitespace. Everything else stays as "feedback" — the coach uses
-- the new list_promotable_notes tool to review and propose promotions for
-- the rest via promote_note. lastAcknowledgedAt is stamped to NOW() so the
-- freshness signal starts from the migration moment.
UPDATE "Note"
SET "type" = 'standing_rule',
    "lastAcknowledgedAt" = NOW()
WHERE "type" = 'feedback'
  AND "body" ~* '^[[:space:]]*(RULE|STANDING)[[:space:]]*[:.-]';
