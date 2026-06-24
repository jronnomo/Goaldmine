-- restingHr was migrated into BodyMetric(key="rhr") and all write paths cut.
-- Audit confirmed every non-null restingHr value is represented in BodyMetric
-- (0 values lost). Safe, intentional drop of the now-dead column.
ALTER TABLE "Measurement" DROP COLUMN "restingHr";
