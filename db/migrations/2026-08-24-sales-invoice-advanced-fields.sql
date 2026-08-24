-- RevEx Books: Sales Invoice Settings + Dynamic Line-Item Fields, Phase 1
-- MySQL 8, idempotent. Run only against an explicitly selected local/disposable database.

-- Read-only invoice_settings audit. The unique company key is added only when
-- there are no duplicate, NULL, or orphan company references.
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT company_id) AS companies_represented,
  SUM(company_id IS NULL) AS null_company_id_rows,
  SUM(c.id IS NULL AND s.company_id IS NOT NULL) AS orphan_company_id_rows
FROM invoice_settings s
LEFT JOIN companies c ON c.id = s.company_id;

SELECT company_id, COUNT(*) AS row_count
FROM invoice_settings
WHERE company_id IS NOT NULL
GROUP BY company_id
HAVING COUNT(*) > 1;

SET @schema_name = DATABASE();

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND COLUMN_NAME='product_id'),
  'DO 0',
  'ALTER TABLE invoice_items ADD COLUMN product_id INT NULL AFTER company_id'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND COLUMN_NAME='unit'),
  'DO 0',
  'ALTER TABLE invoice_items ADD COLUMN unit VARCHAR(30) NULL AFTER quantity'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND COLUMN_NAME='serial_numbers_json'),
  'DO 0',
  'ALTER TABLE invoice_items ADD COLUMN serial_numbers_json JSON NULL AFTER unit'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND COLUMN_NAME='batch_no'),
  'DO 0',
  'ALTER TABLE invoice_items ADD COLUMN batch_no VARCHAR(100) NULL AFTER serial_numbers_json'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND COLUMN_NAME='manufactured_date'),
  'DO 0',
  'ALTER TABLE invoice_items ADD COLUMN manufactured_date DATE NULL AFTER batch_no'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND COLUMN_NAME='expiry_date'),
  'DO 0',
  'ALTER TABLE invoice_items ADD COLUMN expiry_date DATE NULL AFTER manufactured_date'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_items' AND INDEX_NAME='idx_invoice_items_company_product'),
  'DO 0',
  'ALTER TABLE invoice_items ADD INDEX idx_invoice_items_company_product (company_id, product_id)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='overall_discount_type'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN overall_discount_type VARCHAR(10) NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='overall_discount_value'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN overall_discount_value DECIMAL(12,2) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='overall_discount_amount'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN overall_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='additional_discount_type'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN additional_discount_type VARCHAR(10) NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='additional_discount_value'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN additional_discount_value DECIMAL(12,2) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='additional_discount_amount'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN additional_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoices' AND COLUMN_NAME='round_off_amount'),
  'DO 0',
  'ALTER TABLE invoices ADD COLUMN round_off_amount DECIMAL(12,2) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @settings_duplicates = (
  SELECT COUNT(*) FROM (
    SELECT company_id FROM invoice_settings
    WHERE company_id IS NOT NULL GROUP BY company_id HAVING COUNT(*) > 1
  ) duplicate_companies
);
SET @settings_nulls = (SELECT COUNT(*) FROM invoice_settings WHERE company_id IS NULL);
SET @settings_orphans = (
  SELECT COUNT(*) FROM invoice_settings s
  LEFT JOIN companies c ON c.id=s.company_id
  WHERE s.company_id IS NOT NULL AND c.id IS NULL
);
SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_settings' AND INDEX_NAME='uq_invoice_settings_company'),
  'DO 0',
  IF(@settings_duplicates=0 AND @settings_nulls=0 AND @settings_orphans=0,
    'ALTER TABLE invoice_settings ADD UNIQUE KEY uq_invoice_settings_company (company_id)',
    'DO 0')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT
  @settings_duplicates AS duplicate_company_ids,
  @settings_nulls AS null_company_id_rows,
  @settings_orphans AS orphan_company_id_rows,
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='invoice_settings'
      AND INDEX_NAME='uq_invoice_settings_company'
  ) AS unique_company_index_present;
