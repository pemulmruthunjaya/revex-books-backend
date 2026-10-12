-- Annual carry-forward: additive provenance and immutable manual settlements.
-- Prerequisites: FY close foundation, receipt and core-accounting FY migrations.
-- No historical document or balance is backfilled or rewritten.
DELIMITER $$
CREATE PROCEDURE annual_cf_add_column(IN p_name VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='subledger_opening_items' AND COLUMN_NAME=p_name) THEN
    SET @annual_cf_sql=CONCAT('ALTER TABLE subledger_opening_items ADD COLUMN ',p_name,' ',p_definition);
    PREPARE annual_cf_stmt FROM @annual_cf_sql;
    EXECUTE annual_cf_stmt;
    DEALLOCATE PREPARE annual_cf_stmt;
  END IF;
END$$
CALL annual_cf_add_column('original_invoice_id','INT NULL')$$
CALL annual_cf_add_column('original_bill_id','INT NULL')$$
CALL annual_cf_add_column('original_opening_item_id','BIGINT UNSIGNED NULL')$$
CALL annual_cf_add_column('original_financial_year_id','BIGINT UNSIGNED NULL')$$
CALL annual_cf_add_column('predecessor_opening_item_id','BIGINT UNSIGNED NULL')$$
CALL annual_cf_add_column('close_run_id','BIGINT UNSIGNED NULL')$$
CALL annual_cf_add_column('carry_source_financial_year_id','BIGINT UNSIGNED NULL')$$
DROP PROCEDURE annual_cf_add_column$$
DELIMITER ;

ALTER TABLE subledger_opening_items
  MODIFY COLUMN origin ENUM('ONBOARDING','HISTORICAL_MIGRATION','ANNUAL_CARRY_FORWARD') NOT NULL,
  ADD UNIQUE KEY uq_annual_opening_scope (id,company_id,financial_year_id),
  ADD UNIQUE KEY uq_annual_invoice_destination (company_id,financial_year_id,original_invoice_id),
  ADD UNIQUE KEY uq_annual_bill_destination (company_id,financial_year_id,original_bill_id),
  ADD UNIQUE KEY uq_annual_legacy_destination (company_id,financial_year_id,original_opening_item_id);
ALTER TABLE financial_year_close_runs
  ADD UNIQUE KEY uq_annual_close_pair (id,company_id,source_financial_year_id,destination_financial_year_id);
ALTER TABLE invoices ADD UNIQUE KEY uq_annual_invoice_origin (id,company_id,financial_year_id);
ALTER TABLE bills ADD UNIQUE KEY uq_annual_bill_origin (id,company_id,financial_year_id);
ALTER TABLE journal_entries ADD UNIQUE KEY uq_annual_journal_scope (id,company_id,financial_year_id);
-- Preserve the historical BIGINT UNSIGNED receipt identity contract.
ALTER TABLE receipt_entries ADD UNIQUE KEY uq_annual_receipt_scope (id,company_id,journal_entry_id);
ALTER TABLE vendor_payments ADD UNIQUE KEY uq_annual_vendor_payment_scope (id,company_id,financial_year_id);

ALTER TABLE subledger_opening_items
  ADD CONSTRAINT fk_annual_opening_invoice FOREIGN KEY (original_invoice_id,company_id,original_financial_year_id)
    REFERENCES invoices(id,company_id,financial_year_id),
  ADD CONSTRAINT fk_annual_opening_bill FOREIGN KEY (original_bill_id,company_id,original_financial_year_id)
    REFERENCES bills(id,company_id,financial_year_id),
  ADD CONSTRAINT fk_annual_opening_root FOREIGN KEY (original_opening_item_id,company_id,original_financial_year_id)
    REFERENCES subledger_opening_items(id,company_id,financial_year_id),
  ADD CONSTRAINT fk_annual_opening_predecessor FOREIGN KEY (predecessor_opening_item_id,company_id,carry_source_financial_year_id)
    REFERENCES subledger_opening_items(id,company_id,financial_year_id),
  ADD CONSTRAINT fk_annual_opening_run FOREIGN KEY (close_run_id,company_id,carry_source_financial_year_id,financial_year_id)
    REFERENCES financial_year_close_runs(id,company_id,source_financial_year_id,destination_financial_year_id),
  ADD CONSTRAINT chk_annual_opening_lineage CHECK (
    (origin <> 'ANNUAL_CARRY_FORWARD' AND original_invoice_id IS NULL AND original_bill_id IS NULL
      AND original_opening_item_id IS NULL AND original_financial_year_id IS NULL
      AND predecessor_opening_item_id IS NULL AND close_run_id IS NULL AND carry_source_financial_year_id IS NULL)
    OR (origin='ANNUAL_CARRY_FORWARD' AND entry_kind='ORIGINAL' AND close_run_id IS NOT NULL
      AND carry_source_financial_year_id IS NOT NULL AND original_financial_year_id IS NOT NULL
      AND ((original_invoice_id IS NOT NULL)+(original_bill_id IS NOT NULL)+(original_opening_item_id IS NOT NULL))=1
      AND ((party_type='CUSTOMER' AND original_bill_id IS NULL AND direction='DEBIT')
        OR (party_type='VENDOR' AND original_invoice_id IS NULL AND direction='CREDIT'))
      AND financial_year_id <> carry_source_financial_year_id)
  );

CREATE TABLE annual_subledger_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  opening_item_id BIGINT UNSIGNED NOT NULL,
  party_type ENUM('CUSTOMER','VENDOR') NOT NULL,
  customer_id INT NULL,
  vendor_id INT NULL,
  amount DECIMAL(15,2) NOT NULL,
  settlement_date DATE NOT NULL,
  receipt_entry_id BIGINT UNSIGNED NULL,
  receipt_company_id BIGINT UNSIGNED NULL,
  receipt_journal_entry_id BIGINT UNSIGNED NULL,
  vendor_payment_id INT NULL,
  journal_entry_id INT NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id),
  UNIQUE KEY uq_annual_allocation_scope(id,company_id,financial_year_id),
  UNIQUE KEY uq_annual_allocation_request(company_id,idempotency_key,opening_item_id),
  UNIQUE KEY uq_annual_allocation_receipt(receipt_entry_id,opening_item_id),
  UNIQUE KEY uq_annual_allocation_vendor_payment(vendor_payment_id,opening_item_id),
  CONSTRAINT fk_annual_allocation_opening FOREIGN KEY(opening_item_id,company_id,financial_year_id)
    REFERENCES subledger_opening_items(id,company_id,financial_year_id),
  CONSTRAINT fk_annual_allocation_receipt FOREIGN KEY(receipt_entry_id,receipt_company_id,receipt_journal_entry_id)
    REFERENCES receipt_entries(id,company_id,journal_entry_id),
  CONSTRAINT fk_annual_allocation_vendor_payment FOREIGN KEY(vendor_payment_id,company_id,financial_year_id)
    REFERENCES vendor_payments(id,company_id,financial_year_id),
  CONSTRAINT fk_annual_allocation_journal FOREIGN KEY(journal_entry_id,company_id,financial_year_id)
    REFERENCES journal_entries(id,company_id,financial_year_id),
  CONSTRAINT fk_annual_allocation_customer FOREIGN KEY(customer_id,company_id) REFERENCES customers(id,company_id),
  CONSTRAINT fk_annual_allocation_vendor FOREIGN KEY(vendor_id,company_id) REFERENCES vendors(id,company_id),
  CONSTRAINT fk_annual_allocation_actor FOREIGN KEY(created_by,company_id) REFERENCES users(id,company_id),
  CONSTRAINT chk_annual_allocation_amount CHECK(amount>0),
  CONSTRAINT chk_annual_allocation_payment CHECK (
    (party_type='CUSTOMER' AND customer_id IS NOT NULL AND vendor_id IS NULL AND vendor_payment_id IS NULL
      AND receipt_entry_id IS NOT NULL AND receipt_company_id IS NOT NULL AND receipt_journal_entry_id IS NOT NULL
      AND receipt_company_id=company_id AND receipt_journal_entry_id=journal_entry_id)
    OR (party_type='VENDOR' AND vendor_id IS NOT NULL AND customer_id IS NULL AND vendor_payment_id IS NOT NULL
      AND receipt_entry_id IS NULL AND receipt_company_id IS NULL AND receipt_journal_entry_id IS NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE annual_subledger_allocation_reversals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  allocation_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  reversal_date DATE NOT NULL,
  reversal_journal_entry_id INT NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id),
  UNIQUE KEY uq_annual_reversal_allocation(company_id,allocation_id),
  UNIQUE KEY uq_annual_reversal_request(company_id,idempotency_key,allocation_id),
  CONSTRAINT fk_annual_reversal_allocation FOREIGN KEY(allocation_id,company_id,financial_year_id)
    REFERENCES annual_subledger_allocations(id,company_id,financial_year_id),
  CONSTRAINT fk_annual_reversal_journal FOREIGN KEY(reversal_journal_entry_id,company_id,financial_year_id)
    REFERENCES journal_entries(id,company_id,financial_year_id),
  CONSTRAINT fk_annual_reversal_actor FOREIGN KEY(created_by,company_id) REFERENCES users(id,company_id),
  CONSTRAINT chk_annual_reversal_amount CHECK(amount>0),
  CONSTRAINT chk_annual_reversal_reason CHECK(CHAR_LENGTH(TRIM(reason))>0)
) ENGINE=InnoDB;

DELIMITER $$
CREATE TRIGGER trg_annual_opening_lineage_immutable BEFORE UPDATE ON subledger_opening_items FOR EACH ROW
BEGIN
  IF (OLD.origin='ANNUAL_CARRY_FORWARD' OR NEW.origin='ANNUAL_CARRY_FORWARD') AND NOT (
    NEW.company_id <=> OLD.company_id AND NEW.party_type <=> OLD.party_type
    AND NEW.customer_id <=> OLD.customer_id AND NEW.vendor_id <=> OLD.vendor_id
    AND NEW.origin <=> OLD.origin AND NEW.entry_kind <=> OLD.entry_kind
    AND NEW.reversal_of_opening_item_id <=> OLD.reversal_of_opening_item_id
    AND NEW.reference <=> OLD.reference AND NEW.effective_date <=> OLD.effective_date
    AND NEW.due_date <=> OLD.due_date AND NEW.original_amount <=> OLD.original_amount
    AND NEW.direction <=> OLD.direction AND NEW.financial_year_id <=> OLD.financial_year_id
    AND NEW.migration_batch_reference <=> OLD.migration_batch_reference
    AND NEW.opening_journal_entry_id <=> OLD.opening_journal_entry_id
    AND NEW.source_identity <=> OLD.source_identity AND NEW.created_by <=> OLD.created_by
    AND NEW.original_invoice_id <=> OLD.original_invoice_id AND NEW.original_bill_id <=> OLD.original_bill_id
    AND NEW.original_opening_item_id <=> OLD.original_opening_item_id
    AND NEW.original_financial_year_id <=> OLD.original_financial_year_id
    AND NEW.predecessor_opening_item_id <=> OLD.predecessor_opening_item_id
    AND NEW.close_run_id <=> OLD.close_run_id AND NEW.carry_source_financial_year_id <=> OLD.carry_source_financial_year_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Annual opening lineage is immutable';
  END IF;
END$$
CREATE TRIGGER trg_annual_opening_no_delete BEFORE DELETE ON subledger_opening_items FOR EACH ROW
BEGIN
  IF OLD.origin='ANNUAL_CARRY_FORWARD' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Annual opening evidence is immutable';
  END IF;
END$$
CREATE TRIGGER trg_annual_allocations_no_update BEFORE UPDATE ON annual_subledger_allocations FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Annual allocations are immutable'; END$$
CREATE TRIGGER trg_annual_allocations_no_delete BEFORE DELETE ON annual_subledger_allocations FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Annual allocations are immutable'; END$$
CREATE TRIGGER trg_annual_reversals_no_update BEFORE UPDATE ON annual_subledger_allocation_reversals FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Annual reversals are immutable'; END$$
CREATE TRIGGER trg_annual_reversals_no_delete BEFORE DELETE ON annual_subledger_allocation_reversals FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Annual reversals are immutable'; END$$
DELIMITER ;
