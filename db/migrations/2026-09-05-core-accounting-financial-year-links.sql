-- FY-2B.1: nullable financial-year links for core accounting transactions.
-- Existing rows intentionally remain NULL; no historical mapping is inferred.

DELIMITER $$

DROP PROCEDURE IF EXISTS add_core_transaction_fy_link$$
CREATE PROCEDURE add_core_transaction_fy_link(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_constraint VARCHAR(64)
)
BEGIN
  DECLARE v_table_company_type VARCHAR(255);
  DECLARE v_fy_company_type VARCHAR(255);

  SELECT COLUMN_TYPE INTO v_table_company_type
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = 'company_id';
  SELECT COLUMN_TYPE INTO v_fy_company_type
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'financial_years' AND COLUMN_NAME = 'company_id';

  IF v_table_company_type IS NULL OR v_fy_company_type IS NULL OR v_table_company_type <> v_fy_company_type THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'financial year company_id type mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = 'financial_year_id'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table,
      '` ADD COLUMN `financial_year_id` BIGINT UNSIGNED NULL');
    PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index,
      '` (`company_id`,`financial_year_id`)');
    PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND CONSTRAINT_NAME = p_constraint
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_constraint,
      '` FOREIGN KEY (`financial_year_id`,`company_id`) REFERENCES `financial_years` (`id`,`company_id`)');
    PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
  END IF;
END$$

CALL add_core_transaction_fy_link('invoices','idx_invoices_company_fy','fk_invoices_company_fy')$$
CALL add_core_transaction_fy_link('payments','idx_payments_company_fy','fk_payments_company_fy')$$
CALL add_core_transaction_fy_link('bills','idx_bills_company_fy','fk_bills_company_fy')$$
CALL add_core_transaction_fy_link('vendor_payments','idx_vendor_payments_company_fy','fk_vendor_payments_company_fy')$$
CALL add_core_transaction_fy_link('ledger_entries','idx_ledger_entries_company_fy','fk_ledger_entries_company_fy')$$
CALL add_core_transaction_fy_link('expenses','idx_expenses_company_fy','fk_expenses_company_fy')$$
CALL add_core_transaction_fy_link('journal_entries','idx_journal_entries_company_fy','fk_journal_entries_company_fy')$$

DROP PROCEDURE IF EXISTS add_core_transaction_fy_link$$

DELIMITER ;
