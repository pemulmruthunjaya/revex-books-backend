-- RevEx Books: Cash/Credit Sales Invoice foundation
-- MySQL 8, additive and idempotent.
-- Legacy invoice_type values intentionally remain NULL (LEGACY / UNSPECIFIED).
-- This migration does not classify historical invoices or change accounting/payment state.

SET @schema_name = DATABASE();
SET @invoice_count_before = (SELECT COUNT(*) FROM invoices);

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='invoice_type'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN invoice_type VARCHAR(10) NULL AFTER invoice_date'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='cash_customer_name'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN cash_customer_name VARCHAR(255) NULL AFTER customer_phone'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='cash_customer_mobile'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN cash_customer_mobile VARCHAR(50) NULL AFTER cash_customer_name'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='credit_days'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN credit_days INT UNSIGNED NULL AFTER due_date'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='shipping_address'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN shipping_address TEXT NULL AFTER cash_customer_mobile'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=@schema_name
      AND TABLE_NAME='invoices'
      AND CONSTRAINT_NAME='chk_invoices_invoice_type'
      AND CONSTRAINT_TYPE='CHECK'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD CONSTRAINT chk_invoices_invoice_type CHECK (invoice_type IS NULL OR invoice_type IN (''CASH'', ''CREDIT''))'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=@schema_name
      AND TABLE_NAME='invoices'
      AND CONSTRAINT_NAME='chk_invoices_credit_days'
      AND CONSTRAINT_TYPE='CHECK'
  ),
  'DO 0',
  'ALTER TABLE invoices ADD CONSTRAINT chk_invoices_credit_days CHECK (credit_days IS NULL OR credit_days BETWEEN 0 AND 3650)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cash_credit_index_exists = (
  SELECT EXISTS(
    SELECT 1
    FROM (
      SELECT INDEX_NAME,
             GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices'
      GROUP BY INDEX_NAME
    ) invoice_indexes
    WHERE invoice_indexes.indexed_columns='company_id,invoice_type,invoice_date'
  )
);
SET @ddl = IF(
  @cash_credit_index_exists=1,
  'DO 0',
  'ALTER TABLE invoices ADD INDEX idx_invoices_company_type_date (company_id, invoice_type, invoice_date)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @invoice_count_after = (SELECT COUNT(*) FROM invoices);

SELECT
  @invoice_count_before AS invoice_count_before,
  @invoice_count_after AS invoice_count_after,
  @invoice_count_before=@invoice_count_after AS invoice_count_unchanged,
  (SELECT COUNT(*) FROM invoices WHERE invoice_type IS NOT NULL) AS classified_invoice_rows,
  (SELECT COUNT(*) FROM invoices WHERE invoice_type IS NULL) AS legacy_unspecified_rows;

SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=@schema_name
  AND TABLE_NAME='invoices'
  AND COLUMN_NAME IN (
    'invoice_type',
    'cash_customer_name',
    'cash_customer_mobile',
    'credit_days',
    'shipping_address'
  )
ORDER BY ORDINAL_POSITION;
