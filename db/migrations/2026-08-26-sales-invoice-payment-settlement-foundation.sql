-- RevEx Books: Sales Invoice Payment & Settlement foundation
-- MySQL 8, additive and idempotent.
-- This migration does not change invoices.status or create accounting records.

SET @schema_name = DATABASE();
SET @invoice_count_before = (SELECT COUNT(*) FROM invoices);
SET @payment_count_before = (SELECT COUNT(*) FROM payments);

-- Preserve existing payment method spellings exactly; this is a pre-change audit.
SELECT payment_method, COUNT(*) AS row_count
FROM payments
GROUP BY payment_method
ORDER BY payment_method;

-- Nullable for existing rows. Future invoice creation will supply this value.
SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name
      AND TABLE_NAME='invoices'
      AND COLUMN_NAME='request_id'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN request_id VARCHAR(80) NULL AFTER id'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Detect an equivalent unique index by ordered composition, not by index name.
SET @invoice_request_index_exists = (
  SELECT EXISTS(
    SELECT 1
    FROM (
      SELECT INDEX_NAME,
             MIN(NON_UNIQUE) AS non_unique,
             GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=@schema_name
        AND TABLE_NAME='invoices'
      GROUP BY INDEX_NAME
    ) invoice_indexes
    WHERE invoice_indexes.non_unique=0
      AND invoice_indexes.indexed_columns='company_id,request_id'
  )
);
SET @ddl = IF(
  @invoice_request_index_exists=1,
  'DO 0',
  'ALTER TABLE invoices ADD UNIQUE INDEX uq_invoices_company_request (company_id, request_id)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Nullable until legacy status/payment inconsistencies have been reviewed.
SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name
      AND TABLE_NAME='invoices'
      AND COLUMN_NAME='payment_status'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN payment_status VARCHAR(12) NULL AFTER status'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=@schema_name
      AND TABLE_NAME='invoices'
      AND CONSTRAINT_NAME='chk_invoices_payment_status'
      AND CONSTRAINT_TYPE='CHECK'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD CONSTRAINT chk_invoices_payment_status CHECK (payment_status IS NULL OR payment_status IN (''UNPAID'', ''PARTIAL'', ''PAID''))'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill only unset rows. payments is the sole source of received amounts;
-- receipt_entries is intentionally not joined, preventing linked receipts from
-- being counted a second time. Legacy status='paid' remains authoritative.
UPDATE invoices i
LEFT JOIN (
  SELECT company_id, invoice_id, COALESCE(SUM(amount), 0) AS paid_amount
  FROM payments
  GROUP BY company_id, invoice_id
) payment_totals
  ON payment_totals.company_id=i.company_id
 AND payment_totals.invoice_id=i.id
SET i.payment_status = CASE
  WHEN LOWER(COALESCE(i.status, ''))='paid' THEN 'PAID'
  WHEN COALESCE(payment_totals.paid_amount, 0) <= 0 THEN 'UNPAID'
  WHEN COALESCE(payment_totals.paid_amount, 0) < i.total_amount THEN 'PARTIAL'
  ELSE 'PAID'
END
WHERE i.payment_status IS NULL;

-- Widen the legacy enum without rewriting or normalizing stored values.
SET @payment_method_is_target = (
  SELECT EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name
      AND TABLE_NAME='payments'
      AND COLUMN_NAME='payment_method'
      AND DATA_TYPE='varchar'
      AND CHARACTER_MAXIMUM_LENGTH=40
      AND IS_NULLABLE='NO'
  )
);
SET @ddl = IF(
  @payment_method_is_target=1,
  'DO 0',
  'ALTER TABLE payments MODIFY COLUMN payment_method VARCHAR(40) NOT NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @invoice_count_after = (SELECT COUNT(*) FROM invoices);
SET @payment_count_after = (SELECT COUNT(*) FROM payments);

-- Validation: row counts must remain unchanged.
SELECT
  @invoice_count_before AS invoice_count_before,
  @invoice_count_after AS invoice_count_after,
  @invoice_count_before=@invoice_count_after AS invoice_count_unchanged,
  @payment_count_before AS payment_count_before,
  @payment_count_after AS payment_count_after,
  @payment_count_before=@payment_count_after AS payment_count_unchanged;

-- Validation: payment status distribution and invalid values.
SELECT COALESCE(payment_status, 'NULL') AS payment_status, COUNT(*) AS row_count
FROM invoices
GROUP BY payment_status
ORDER BY payment_status;

SELECT COUNT(*) AS invalid_payment_status_rows
FROM invoices
WHERE payment_status IS NOT NULL
  AND payment_status NOT IN ('UNPAID', 'PARTIAL', 'PAID');

-- Validation: exact column definitions.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=@schema_name
  AND (
    (TABLE_NAME='invoices' AND COLUMN_NAME IN ('request_id', 'status', 'payment_status'))
    OR (TABLE_NAME='payments' AND COLUMN_NAME='payment_method')
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Validation: ordered index composition and uniqueness.
SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=@schema_name
  AND TABLE_NAME='invoices'
  AND INDEX_NAME IN (
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices'
    GROUP BY INDEX_NAME
    HAVING MIN(NON_UNIQUE)=0
       AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')='company_id,request_id'
  )
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- Validation: guarded payment-status CHECK constraint.
SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, cc.CHECK_CLAUSE
FROM information_schema.TABLE_CONSTRAINTS tc
INNER JOIN information_schema.CHECK_CONSTRAINTS cc
  ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
 AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA=@schema_name
  AND tc.TABLE_NAME='invoices'
  AND tc.CONSTRAINT_NAME='chk_invoices_payment_status';

-- Validation: existing spellings remain unchanged after enum widening.
SELECT payment_method, COUNT(*) AS row_count
FROM payments
GROUP BY payment_method
ORDER BY payment_method;
