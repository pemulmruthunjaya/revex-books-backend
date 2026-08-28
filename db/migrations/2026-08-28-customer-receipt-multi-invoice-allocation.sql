-- Allow one receipt to own multiple invoice payment allocations.
-- This migration changes indexes only; it does not rewrite payment data.

SET @has_old_unique = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'uq_payments_receipt_entry'
);
SET @drop_old_unique_sql = IF(
  @has_old_unique > 0,
  'DROP INDEX uq_payments_receipt_entry ON payments',
  'SELECT 1'
);
PREPARE drop_old_unique_stmt FROM @drop_old_unique_sql;
EXECUTE drop_old_unique_stmt;
DEALLOCATE PREPARE drop_old_unique_stmt;

SET @has_receipt_index = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'idx_payments_receipt_entry'
);
SET @add_receipt_index_sql = IF(
  @has_receipt_index = 0,
  'CREATE INDEX idx_payments_receipt_entry ON payments (receipt_entry_id)',
  'SELECT 1'
);
PREPARE add_receipt_index_stmt FROM @add_receipt_index_sql;
EXECUTE add_receipt_index_stmt;
DEALLOCATE PREPARE add_receipt_index_stmt;
