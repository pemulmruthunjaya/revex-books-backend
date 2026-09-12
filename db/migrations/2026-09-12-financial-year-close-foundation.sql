-- RevEx Books FY-6C-1: additive financial-year close/carry-forward schema foundation.
-- Schema only: no role assignment, close generation, opening generation, or business-data DML.

DELIMITER $$

DROP PROCEDURE IF EXISTS fy6c1_ensure_identity_scope_index$$
CREATE PROCEDURE fy6c1_ensure_identity_scope_index(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_scope_column VARCHAR(64)
)
BEGIN
  DECLARE v_rows INT DEFAULT 0;
  DECLARE v_exact INT DEFAULT 0;

  SELECT COUNT(*),
         COALESCE(SUM(
           NON_UNIQUE = 0 AND
           ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'id') OR
            (SEQ_IN_INDEX = 2 AND COLUMN_NAME = p_scope_column))
         ), 0)
    INTO v_rows, v_exact
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = p_table_name
     AND INDEX_NAME = p_index_name;

  IF v_rows = 0 THEN
    SET @fy6c1_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD UNIQUE INDEX `', REPLACE(p_index_name, '`', '``'),
      '` (`id`,`', REPLACE(p_scope_column, '`', '``'), '`)'
    );
    PREPARE fy6c1_stmt FROM @fy6c1_sql;
    EXECUTE fy6c1_stmt;
    DEALLOCATE PREPARE fy6c1_stmt;
  ELSEIF NOT (v_rows = 2 AND v_exact = 2) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'FY-6C-1 prerequisite index name collision';
  END IF;
END$$

DELIMITER ;

CALL fy6c1_ensure_identity_scope_index('users', 'uq_fy6_users_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('accounts', 'uq_fy6_accounts_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('branches', 'uq_fy6_branches_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('customers', 'uq_fy6_customers_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('vendors', 'uq_fy6_vendors_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('products', 'uq_fy6_products_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('invoices', 'uq_fy6_invoices_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('bills', 'uq_fy6_bills_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('payments', 'uq_fy6_payments_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('vendor_payments', 'uq_fy6_vendor_payments_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index('journal_entries', 'uq_fy6_journal_entries_id_company', 'company_id');
CALL fy6c1_ensure_identity_scope_index(
  'journal_entry_details', 'uq_fy6_journal_details_id_journal', 'journal_entry_id'
);

DROP PROCEDURE IF EXISTS fy6c1_ensure_identity_scope_index;

DELIMITER $$

DROP PROCEDURE IF EXISTS fy6c1_ensure_journal_source_index$$
CREATE PROCEDURE fy6c1_ensure_journal_source_index()
BEGIN
  DECLARE v_rows INT DEFAULT 0;
  DECLARE v_exact INT DEFAULT 0;

  SELECT COUNT(*),
         COALESCE(SUM(
           NON_UNIQUE = 0 AND
           ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'company_id') OR
            (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'source_type') OR
            (SEQ_IN_INDEX = 3 AND COLUMN_NAME = 'source_id'))
         ), 0)
    INTO v_rows, v_exact
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'journal_entries'
     AND INDEX_NAME = 'uq_journal_source';

  IF v_rows = 0 THEN
    CREATE UNIQUE INDEX uq_journal_source
      ON journal_entries (company_id, source_type, source_id);
  ELSEIF NOT (v_rows = 3 AND v_exact = 3) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'FY-6C-1 journal source index collision';
  END IF;
END$$

DELIMITER ;

CALL fy6c1_ensure_journal_source_index();
DROP PROCEDURE IF EXISTS fy6c1_ensure_journal_source_index;

CREATE TABLE IF NOT EXISTS financial_year_close_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  source_financial_year_id BIGINT UNSIGNED NOT NULL,
  destination_financial_year_id BIGINT UNSIGNED NOT NULL,
  generation_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  algorithm_version VARCHAR(40) NOT NULL,
  source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM(
    'DRAFT','VALIDATING','READY','GENERATING','GENERATED',
    'RECONCILED','FINALIZED','FAILED','ROLLED_BACK'
  ) NOT NULL DEFAULT 'DRAFT',
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INR',
  currency_scale TINYINT UNSIGNED NOT NULL DEFAULT 2,
  attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
  supersedes_run_id BIGINT UNSIGNED NULL,
  reversal_of_run_id BIGINT UNSIGNED NULL,
  started_by INT NOT NULL,
  validated_by INT NULL,
  finalized_by INT NULL,
  rolled_back_by INT NULL,
  validation_started_at TIMESTAMP(6) NULL,
  validated_at TIMESTAMP(6) NULL,
  generation_started_at TIMESTAMP(6) NULL,
  generated_at TIMESTAMP(6) NULL,
  reconciled_at TIMESTAMP(6) NULL,
  finalized_at TIMESTAMP(6) NULL,
  failed_at TIMESTAMP(6) NULL,
  rolled_back_at TIMESTAMP(6) NULL,
  failure_code VARCHAR(80) NULL,
  failure_reason VARCHAR(500) NULL,
  closing_journal_entry_id INT NULL,
  opening_journal_entry_id INT NULL,
  source_gl_total_debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  source_gl_total_credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  permanent_total_debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  permanent_total_credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  net_profit_loss DECIMAL(15,2) NOT NULL DEFAULT 0,
  ar_control_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  ar_open_item_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  ar_variance DECIMAL(15,2) NOT NULL DEFAULT 0,
  ap_control_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  ap_open_item_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  ap_variance DECIMAL(15,2) NOT NULL DEFAULT 0,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  active_pair_guard TINYINT GENERATED ALWAYS AS (
    CASE WHEN status IN (
      'DRAFT','VALIDATING','READY','GENERATING','GENERATED',
      'RECONCILED','FINALIZED'
    ) THEN 1 ELSE NULL END
  ) STORED,
  finalized_pair_guard TINYINT GENERATED ALWAYS AS (
    CASE WHEN status = 'FINALIZED' THEN 1 ELSE NULL END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_close_runs_id_company (id, company_id),
  UNIQUE KEY uq_fy_close_runs_generation_uuid (generation_uuid),
  UNIQUE KEY uq_fy_close_runs_pair_attempt (
    company_id, source_financial_year_id, destination_financial_year_id, attempt_no
  ),
  UNIQUE KEY uq_fy_close_runs_active_pair (
    company_id, source_financial_year_id, destination_financial_year_id, active_pair_guard
  ),
  UNIQUE KEY uq_fy_close_runs_finalized_pair (
    company_id, source_financial_year_id, destination_financial_year_id, finalized_pair_guard
  ),
  UNIQUE KEY uq_fy_close_runs_closing_journal (closing_journal_entry_id),
  UNIQUE KEY uq_fy_close_runs_opening_journal (opening_journal_entry_id),
  KEY idx_fy_close_runs_company_status (company_id, status, created_at),
  KEY idx_fy_close_runs_source (company_id, source_financial_year_id, status),
  KEY idx_fy_close_runs_destination (company_id, destination_financial_year_id, status),
  KEY idx_fy_close_runs_fingerprint (company_id, source_fingerprint),
  KEY idx_fy_close_runs_supersedes (supersedes_run_id, company_id),
  KEY idx_fy_close_runs_reversal (reversal_of_run_id, company_id),
  CONSTRAINT fk_fy_close_runs_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_fy_close_runs_source_fy
    FOREIGN KEY (source_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_fy_close_runs_destination_fy
    FOREIGN KEY (destination_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_fy_close_runs_supersedes
    FOREIGN KEY (supersedes_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_close_runs_reversal
    FOREIGN KEY (reversal_of_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_close_runs_started_by
    FOREIGN KEY (started_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT fk_fy_close_runs_validated_by
    FOREIGN KEY (validated_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT fk_fy_close_runs_finalized_by
    FOREIGN KEY (finalized_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT fk_fy_close_runs_rolled_back_by
    FOREIGN KEY (rolled_back_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT fk_fy_close_runs_closing_journal
    FOREIGN KEY (closing_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT fk_fy_close_runs_opening_journal
    FOREIGN KEY (opening_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT chk_fy_close_runs_distinct_years
    CHECK (source_financial_year_id <> destination_financial_year_id),
  CONSTRAINT chk_fy_close_runs_currency_scale CHECK (currency_scale <= 6),
  CONSTRAINT chk_fy_close_runs_distinct_journals CHECK (
    closing_journal_entry_id IS NULL OR opening_journal_entry_id IS NULL OR
    closing_journal_entry_id <> opening_journal_entry_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_account_role_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  role ENUM(
    'OPENING_BALANCE_EQUITY','RETAINED_EARNINGS','ACCOUNTS_RECEIVABLE',
    'ACCOUNTS_PAYABLE','CUSTOMER_CREDITS','VENDOR_ADVANCES','CASH','BANK',
    'INVENTORY','INPUT_TAX','OUTPUT_TAX'
  ) NOT NULL,
  account_id INT NOT NULL,
  effective_from_financial_year_id BIGINT UNSIGNED NOT NULL,
  effective_to_financial_year_id BIGINT UNSIGNED NULL,
  protected_at TIMESTAMP(6) NULL,
  protected_by_close_run_id BIGINT UNSIGNED NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  singleton_active_role VARCHAR(40) GENERATED ALWAYS AS (
    CASE
      WHEN role NOT IN ('CASH','BANK') AND effective_to_financial_year_id IS NULL
      THEN role
      ELSE NULL
    END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_account_roles_id_company (id, company_id),
  UNIQUE KEY uq_system_account_roles_assignment (
    company_id, role, account_id, effective_from_financial_year_id
  ),
  UNIQUE KEY uq_system_account_roles_singleton_active (company_id, singleton_active_role),
  KEY idx_system_account_roles_role_lookup (
    company_id, role, effective_from_financial_year_id, effective_to_financial_year_id
  ),
  KEY idx_system_account_roles_account (company_id, account_id),
  KEY idx_system_account_roles_protected_run (protected_by_close_run_id),
  CONSTRAINT fk_system_account_roles_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_system_account_roles_account
    FOREIGN KEY (account_id, company_id) REFERENCES accounts(id, company_id),
  CONSTRAINT fk_system_account_roles_from_fy
    FOREIGN KEY (effective_from_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_system_account_roles_to_fy
    FOREIGN KEY (effective_to_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_system_account_roles_created_by
    FOREIGN KEY (created_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT fk_system_account_roles_protected_run
    FOREIGN KEY (protected_by_close_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subledger_opening_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  party_type ENUM('CUSTOMER','VENDOR') NOT NULL,
  customer_id INT NULL,
  vendor_id INT NULL,
  origin ENUM('ONBOARDING','HISTORICAL_MIGRATION') NOT NULL,
  entry_kind ENUM('ORIGINAL','REVERSAL') NOT NULL DEFAULT 'ORIGINAL',
  reversal_of_opening_item_id BIGINT UNSIGNED NULL,
  reference VARCHAR(120) NOT NULL,
  effective_date DATE NOT NULL,
  due_date DATE NULL,
  original_amount DECIMAL(15,2) NOT NULL,
  direction ENUM('DEBIT','CREDIT') NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  migration_batch_reference VARCHAR(120) NULL,
  opening_journal_entry_id INT NULL,
  source_identity VARCHAR(160) NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_subledger_opening_id_company (id, company_id),
  UNIQUE KEY uq_subledger_opening_source (company_id, source_identity),
  UNIQUE KEY uq_subledger_opening_reversal (reversal_of_opening_item_id),
  KEY idx_subledger_opening_journal (opening_journal_entry_id),
  KEY idx_subledger_opening_customer (company_id, customer_id, effective_date),
  KEY idx_subledger_opening_vendor (company_id, vendor_id, effective_date),
  KEY idx_subledger_opening_fy (company_id, financial_year_id, effective_date),
  CONSTRAINT fk_subledger_opening_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_subledger_opening_customer
    FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id),
  CONSTRAINT fk_subledger_opening_vendor
    FOREIGN KEY (vendor_id, company_id) REFERENCES vendors(id, company_id),
  CONSTRAINT fk_subledger_opening_fy
    FOREIGN KEY (financial_year_id, company_id) REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_subledger_opening_journal
    FOREIGN KEY (opening_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT fk_subledger_opening_created_by
    FOREIGN KEY (created_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT fk_subledger_opening_reversal_of
    FOREIGN KEY (reversal_of_opening_item_id, company_id)
    REFERENCES subledger_opening_items(id, company_id),
  CONSTRAINT chk_subledger_opening_party CHECK (
    (party_type = 'CUSTOMER' AND customer_id IS NOT NULL AND vendor_id IS NULL) OR
    (party_type = 'VENDOR' AND vendor_id IS NOT NULL AND customer_id IS NULL)
  ),
  CONSTRAINT chk_subledger_opening_kind CHECK (
    (entry_kind = 'ORIGINAL' AND reversal_of_opening_item_id IS NULL) OR
    (entry_kind = 'REVERSAL' AND reversal_of_opening_item_id IS NOT NULL)
  ),
  CONSTRAINT chk_subledger_opening_amount CHECK (original_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_close_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  close_run_id BIGINT UNSIGNED NOT NULL,
  account_id INT NOT NULL,
  account_type ENUM('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY') NOT NULL,
  system_role ENUM(
    'OPENING_BALANCE_EQUITY','RETAINED_EARNINGS','ACCOUNTS_RECEIVABLE',
    'ACCOUNTS_PAYABLE','CUSTOMER_CREDITS','VENDOR_ADVANCES','CASH','BANK',
    'INVENTORY','INPUT_TAX','OUTPUT_TAX'
  ) NULL,
  branch_id INT NULL,
  classification ENUM('PERMANENT','PNL_INCOME','PNL_EXPENSE','RETAINED_EARNINGS') NOT NULL,
  source_closing_signed_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  closing_journal_debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  closing_journal_credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  post_close_signed_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  destination_opening_signed_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  opening_journal_debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  opening_journal_credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  closing_journal_entry_id INT NULL,
  closing_journal_detail_id INT NULL,
  opening_journal_entry_id INT NULL,
  opening_journal_detail_id INT NULL,
  fingerprint_component CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  normalized_branch_scope INT GENERATED ALWAYS AS (COALESCE(branch_id, 0)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_close_lines_id_company (id, company_id),
  UNIQUE KEY uq_fy_close_lines_scope (close_run_id, account_id, normalized_branch_scope),
  UNIQUE KEY uq_fy_close_lines_closing_detail (closing_journal_detail_id),
  UNIQUE KEY uq_fy_close_lines_opening_detail (opening_journal_detail_id),
  KEY idx_fy_close_lines_company_run (company_id, close_run_id),
  KEY idx_fy_close_lines_company_account (company_id, account_id),
  KEY idx_fy_close_lines_branch (company_id, branch_id),
  CONSTRAINT fk_fy_close_lines_run
    FOREIGN KEY (close_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_close_lines_account
    FOREIGN KEY (account_id, company_id) REFERENCES accounts(id, company_id),
  CONSTRAINT fk_fy_close_lines_branch
    FOREIGN KEY (branch_id, company_id) REFERENCES branches(id, company_id),
  CONSTRAINT fk_fy_close_lines_closing_journal
    FOREIGN KEY (closing_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT fk_fy_close_lines_closing_detail
    FOREIGN KEY (closing_journal_detail_id, closing_journal_entry_id)
    REFERENCES journal_entry_details(id, journal_entry_id),
  CONSTRAINT fk_fy_close_lines_opening_journal
    FOREIGN KEY (opening_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT fk_fy_close_lines_opening_detail
    FOREIGN KEY (opening_journal_detail_id, opening_journal_entry_id)
    REFERENCES journal_entry_details(id, journal_entry_id),
  CONSTRAINT chk_fy_close_lines_closing_nonnegative
    CHECK (closing_journal_debit >= 0 AND closing_journal_credit >= 0),
  CONSTRAINT chk_fy_close_lines_opening_nonnegative
    CHECK (opening_journal_debit >= 0 AND opening_journal_credit >= 0),
  CONSTRAINT chk_fy_close_lines_closing_side
    CHECK (closing_journal_debit = 0 OR closing_journal_credit = 0),
  CONSTRAINT chk_fy_close_lines_opening_side
    CHECK (opening_journal_debit = 0 OR opening_journal_credit = 0),
  CONSTRAINT chk_fy_close_lines_closing_link CHECK (
    (closing_journal_entry_id IS NULL AND closing_journal_detail_id IS NULL) OR
    (closing_journal_entry_id IS NOT NULL AND closing_journal_detail_id IS NOT NULL)
  ),
  CONSTRAINT chk_fy_close_lines_opening_link CHECK (
    (opening_journal_entry_id IS NULL AND opening_journal_detail_id IS NULL) OR
    (opening_journal_entry_id IS NOT NULL AND opening_journal_detail_id IS NOT NULL)
  ),
  CONSTRAINT chk_fy_close_lines_classification CHECK (
    (classification = 'PERMANENT' AND account_type IN ('ASSET','LIABILITY','EQUITY')) OR
    (classification = 'PNL_INCOME' AND account_type = 'INCOME') OR
    (classification = 'PNL_EXPENSE' AND account_type = 'EXPENSE') OR
    (classification = 'RETAINED_EARNINGS' AND account_type = 'EQUITY')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_close_reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  close_run_id BIGINT UNSIGNED NOT NULL,
  reconciliation_type ENUM(
    'GL_BALANCE','PNL_ZERO','PERMANENT_BALANCE','AR_CONTROL','AP_CONTROL',
    'INVENTORY','OPENING_JOURNAL','FINGERPRINT','FY_PAIR'
  ) NOT NULL,
  attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
  expected_amount DECIMAL(15,2) NULL,
  actual_amount DECIMAL(15,2) NULL,
  variance DECIMAL(15,2) NULL,
  status ENUM('PASSED','FAILED','WARNING') NOT NULL,
  evidence_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  algorithm_version VARCHAR(40) NOT NULL,
  checked_by INT NOT NULL,
  checked_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reason_code VARCHAR(80) NULL,
  reason VARCHAR(500) NULL,
  details JSON NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_close_recon_id_company (id, company_id),
  UNIQUE KEY uq_fy_close_recon_attempt (close_run_id, reconciliation_type, attempt_no),
  KEY idx_fy_close_recon_company_run (company_id, close_run_id, status),
  KEY idx_fy_close_recon_fingerprint (company_id, evidence_fingerprint),
  CONSTRAINT fk_fy_close_recon_run
    FOREIGN KEY (close_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_close_recon_checked_by
    FOREIGN KEY (checked_by, company_id) REFERENCES users(id, company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_subledger_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  close_run_id BIGINT UNSIGNED NOT NULL,
  source_financial_year_id BIGINT UNSIGNED NOT NULL,
  cutoff_date DATE NOT NULL,
  snapshot_type ENUM('AR','AP') NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_subledger_snap_id_company_type (id, company_id, snapshot_type),
  UNIQUE KEY uq_fy_subledger_snap_run_type (close_run_id, snapshot_type),
  KEY idx_fy_subledger_snap_company_fy (
    company_id, source_financial_year_id, snapshot_type, cutoff_date
  ),
  CONSTRAINT fk_fy_subledger_snap_run
    FOREIGN KEY (close_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_subledger_snap_source_fy
    FOREIGN KEY (source_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_subledger_snapshot_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  snapshot_type ENUM('AR','AP') NOT NULL,
  party_type ENUM('CUSTOMER','VENDOR') NOT NULL,
  customer_id INT NULL,
  vendor_id INT NULL,
  source_document_type ENUM('INVOICE','BILL','LEGACY_OPENING_ITEM') NOT NULL,
  invoice_id INT NULL,
  bill_id INT NULL,
  subledger_opening_item_id BIGINT UNSIGNED NULL,
  original_amount DECIMAL(15,2) NOT NULL,
  allocated_amount_through_cutoff DECIMAL(15,2) NOT NULL DEFAULT 0,
  reversal_amount_through_cutoff DECIMAL(15,2) NOT NULL DEFAULT 0,
  residual_amount DECIMAL(15,2) NOT NULL,
  effective_date DATE NOT NULL,
  due_date DATE NULL,
  fingerprint_component CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_subledger_item_id_company (id, company_id),
  UNIQUE KEY uq_fy_subledger_item_invoice (snapshot_id, invoice_id),
  UNIQUE KEY uq_fy_subledger_item_bill (snapshot_id, bill_id),
  UNIQUE KEY uq_fy_subledger_item_opening (snapshot_id, subledger_opening_item_id),
  KEY idx_fy_subledger_item_party_customer (company_id, customer_id),
  KEY idx_fy_subledger_item_party_vendor (company_id, vendor_id),
  CONSTRAINT fk_fy_subledger_item_snapshot
    FOREIGN KEY (snapshot_id, company_id, snapshot_type)
    REFERENCES financial_year_subledger_snapshots(id, company_id, snapshot_type),
  CONSTRAINT fk_fy_subledger_item_customer
    FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id),
  CONSTRAINT fk_fy_subledger_item_vendor
    FOREIGN KEY (vendor_id, company_id) REFERENCES vendors(id, company_id),
  CONSTRAINT fk_fy_subledger_item_invoice
    FOREIGN KEY (invoice_id, company_id) REFERENCES invoices(id, company_id),
  CONSTRAINT fk_fy_subledger_item_bill
    FOREIGN KEY (bill_id, company_id) REFERENCES bills(id, company_id),
  CONSTRAINT fk_fy_subledger_item_opening
    FOREIGN KEY (subledger_opening_item_id, company_id)
    REFERENCES subledger_opening_items(id, company_id),
  CONSTRAINT chk_fy_subledger_item_identity CHECK (
    (snapshot_type = 'AR' AND party_type = 'CUSTOMER' AND customer_id IS NOT NULL AND
      vendor_id IS NULL AND source_document_type = 'INVOICE' AND invoice_id IS NOT NULL AND
      bill_id IS NULL AND subledger_opening_item_id IS NULL) OR
    (snapshot_type = 'AP' AND party_type = 'VENDOR' AND vendor_id IS NOT NULL AND
      customer_id IS NULL AND source_document_type = 'BILL' AND bill_id IS NOT NULL AND
      invoice_id IS NULL AND subledger_opening_item_id IS NULL) OR
    (snapshot_type = 'AR' AND party_type = 'CUSTOMER' AND customer_id IS NOT NULL AND
      vendor_id IS NULL AND source_document_type = 'LEGACY_OPENING_ITEM' AND
      invoice_id IS NULL AND bill_id IS NULL AND subledger_opening_item_id IS NOT NULL) OR
    (snapshot_type = 'AP' AND party_type = 'VENDOR' AND vendor_id IS NOT NULL AND
      customer_id IS NULL AND source_document_type = 'LEGACY_OPENING_ITEM' AND
      invoice_id IS NULL AND bill_id IS NULL AND subledger_opening_item_id IS NOT NULL)
  ),
  CONSTRAINT chk_fy_subledger_item_amounts CHECK (
    original_amount >= 0 AND allocated_amount_through_cutoff >= 0 AND
    reversal_amount_through_cutoff >= 0 AND residual_amount >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_inventory_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  close_run_id BIGINT UNSIGNED NOT NULL,
  source_financial_year_id BIGINT UNSIGNED NOT NULL,
  cutoff_date DATE NOT NULL,
  valuation_mode ENUM('REQUIRED','OPTIONAL','NOT_AVAILABLE') NOT NULL,
  valuation_method VARCHAR(40) NULL,
  valuation_provenance VARCHAR(255) NULL,
  total_quantity DECIMAL(18,3) NOT NULL DEFAULT 0,
  total_valuation DECIMAL(15,2) NULL,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_inventory_snap_id_company (id, company_id),
  UNIQUE KEY uq_fy_inventory_snap_run (close_run_id),
  KEY idx_fy_inventory_snap_company_fy (company_id, source_financial_year_id, cutoff_date),
  CONSTRAINT fk_fy_inventory_snap_run
    FOREIGN KEY (close_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_inventory_snap_source_fy
    FOREIGN KEY (source_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_inventory_snapshot_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  inventory_snapshot_id BIGINT UNSIGNED NOT NULL,
  product_id INT NOT NULL,
  quantity_at_cutoff DECIMAL(18,3) NOT NULL,
  valuation_amount DECIMAL(15,2) NULL,
  valuation_method VARCHAR(40) NULL,
  valuation_provenance VARCHAR(255) NULL,
  movement_min_id BIGINT UNSIGNED NULL,
  movement_max_id BIGINT UNSIGNED NULL,
  input_version VARCHAR(80) NULL,
  fingerprint_component CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_inventory_item_id_company (id, company_id),
  UNIQUE KEY uq_fy_inventory_item_product (inventory_snapshot_id, product_id),
  KEY idx_fy_inventory_item_company_product (company_id, product_id),
  CONSTRAINT fk_fy_inventory_item_snapshot
    FOREIGN KEY (inventory_snapshot_id, company_id)
    REFERENCES financial_year_inventory_snapshots(id, company_id),
  CONSTRAINT fk_fy_inventory_item_product
    FOREIGN KEY (product_id, company_id) REFERENCES products(id, company_id),
  CONSTRAINT chk_fy_inventory_item_movement_range CHECK (
    movement_min_id IS NULL OR movement_max_id IS NULL OR movement_min_id <= movement_max_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_close_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  close_run_id BIGINT UNSIGNED NOT NULL,
  source_financial_year_id BIGINT UNSIGNED NOT NULL,
  destination_financial_year_id BIGINT UNSIGNED NOT NULL,
  generation_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_sequence INT UNSIGNED NOT NULL,
  event_type ENUM(
    'REQUESTED','VALIDATION_STARTED','VALIDATION_FAILED','READY',
    'GENERATION_STARTED','GENERATED','RECONCILIATION_PASSED',
    'RECONCILIATION_FAILED','FINALIZED','ROLLED_BACK','REVERSAL_LINKED',
    'ADJUSTMENT_REQUIRED'
  ) NOT NULL,
  previous_status ENUM(
    'DRAFT','VALIDATING','READY','GENERATING','GENERATED',
    'RECONCILED','FINALIZED','FAILED','ROLLED_BACK'
  ) NULL,
  new_status ENUM(
    'DRAFT','VALIDATING','READY','GENERATING','GENERATED',
    'RECONCILED','FINALIZED','FAILED','ROLLED_BACK'
  ) NULL,
  actor_user_id INT NULL,
  occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reason_code VARCHAR(80) NULL,
  reason VARCHAR(500) NULL,
  request_identity VARCHAR(160) NULL,
  source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  algorithm_version VARCHAR(40) NULL,
  metadata JSON NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fy_close_events_id_company (id, company_id),
  UNIQUE KEY uq_fy_close_events_sequence (close_run_id, event_sequence),
  UNIQUE KEY uq_fy_close_events_request (close_run_id, event_type, request_identity),
  KEY idx_fy_close_events_company_time (company_id, occurred_at, id),
  KEY idx_fy_close_events_run_time (close_run_id, occurred_at, id),
  KEY idx_fy_close_events_type (company_id, event_type, occurred_at),
  CONSTRAINT fk_fy_close_events_run
    FOREIGN KEY (close_run_id, company_id)
    REFERENCES financial_year_close_runs(id, company_id),
  CONSTRAINT fk_fy_close_events_source_fy
    FOREIGN KEY (source_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_fy_close_events_destination_fy
    FOREIGN KEY (destination_financial_year_id, company_id)
    REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_fy_close_events_actor
    FOREIGN KEY (actor_user_id, company_id) REFERENCES users(id, company_id),
  CONSTRAINT chk_fy_close_events_distinct_years
    CHECK (source_financial_year_id <> destination_financial_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_reversals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  original_payment_id INT NOT NULL,
  reversal_amount DECIMAL(15,2) NOT NULL,
  reversal_date DATE NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  reversal_journal_entry_id INT NULL,
  reason VARCHAR(500) NOT NULL,
  created_by INT NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  replacement_reference VARCHAR(120) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_reversals_id_company (id, company_id),
  UNIQUE KEY uq_payment_reversals_original (company_id, original_payment_id),
  UNIQUE KEY uq_payment_reversals_idempotency (company_id, idempotency_key),
  UNIQUE KEY uq_payment_reversals_journal (reversal_journal_entry_id),
  KEY idx_payment_reversals_company_date (company_id, reversal_date),
  KEY idx_payment_reversals_fy (company_id, financial_year_id),
  CONSTRAINT fk_payment_reversals_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_payment_reversals_original
    FOREIGN KEY (original_payment_id, company_id) REFERENCES payments(id, company_id),
  CONSTRAINT fk_payment_reversals_fy
    FOREIGN KEY (financial_year_id, company_id) REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_payment_reversals_journal
    FOREIGN KEY (reversal_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT fk_payment_reversals_created_by
    FOREIGN KEY (created_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT chk_payment_reversals_amount CHECK (reversal_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_payment_reversals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  original_vendor_payment_id INT NOT NULL,
  reversal_amount DECIMAL(15,2) NOT NULL,
  reversal_date DATE NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  reversal_journal_entry_id INT NULL,
  reason VARCHAR(500) NOT NULL,
  created_by INT NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  replacement_reference VARCHAR(120) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendor_payment_reversals_id_company (id, company_id),
  UNIQUE KEY uq_vendor_payment_reversals_original (company_id, original_vendor_payment_id),
  UNIQUE KEY uq_vendor_payment_reversals_idempotency (company_id, idempotency_key),
  UNIQUE KEY uq_vendor_payment_reversals_journal (reversal_journal_entry_id),
  KEY idx_vendor_payment_reversals_company_date (company_id, reversal_date),
  KEY idx_vendor_payment_reversals_fy (company_id, financial_year_id),
  CONSTRAINT fk_vendor_payment_reversals_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_vendor_payment_reversals_original
    FOREIGN KEY (original_vendor_payment_id, company_id)
    REFERENCES vendor_payments(id, company_id),
  CONSTRAINT fk_vendor_payment_reversals_fy
    FOREIGN KEY (financial_year_id, company_id) REFERENCES financial_years(id, company_id),
  CONSTRAINT fk_vendor_payment_reversals_journal
    FOREIGN KEY (reversal_journal_entry_id, company_id)
    REFERENCES journal_entries(id, company_id),
  CONSTRAINT fk_vendor_payment_reversals_created_by
    FOREIGN KEY (created_by, company_id) REFERENCES users(id, company_id),
  CONSTRAINT chk_vendor_payment_reversals_amount CHECK (reversal_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_runs_no_delete
BEFORE DELETE ON financial_year_close_runs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close runs cannot be deleted';
END$$

CREATE TRIGGER IF NOT EXISTS trg_system_account_roles_no_delete
BEFORE DELETE ON system_account_role_assignments
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'System account role assignments must be retired, not deleted';
END$$

CREATE TRIGGER IF NOT EXISTS trg_system_account_roles_validate_insert
BEFORE INSERT ON system_account_role_assignments
FOR EACH ROW
BEGIN
  DECLARE v_new_start DATE;
  DECLARE v_new_end DATE;

  SELECT start_date INTO v_new_start
    FROM financial_years
   WHERE id = NEW.effective_from_financial_year_id AND company_id = NEW.company_id;

  IF NEW.effective_to_financial_year_id IS NULL THEN
    SET v_new_end = '9999-12-31';
  ELSE
    SELECT end_date INTO v_new_end
      FROM financial_years
     WHERE id = NEW.effective_to_financial_year_id AND company_id = NEW.company_id;
  END IF;

  IF v_new_end < v_new_start THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'System account role effective range is invalid';
  END IF;

  IF NEW.role NOT IN ('CASH','BANK') AND EXISTS (
    SELECT 1
      FROM system_account_role_assignments existing_role
      JOIN financial_years existing_from
        ON existing_from.id = existing_role.effective_from_financial_year_id
       AND existing_from.company_id = existing_role.company_id
      LEFT JOIN financial_years existing_to
        ON existing_to.id = existing_role.effective_to_financial_year_id
       AND existing_to.company_id = existing_role.company_id
     WHERE existing_role.company_id = NEW.company_id
       AND existing_role.role = NEW.role
       AND v_new_start <= COALESCE(existing_to.end_date, '9999-12-31')
       AND v_new_end >= existing_from.start_date
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Singleton system account role effective ranges cannot overlap';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_system_account_roles_validate_update
BEFORE UPDATE ON system_account_role_assignments
FOR EACH ROW
BEGIN
  DECLARE v_new_start DATE;
  DECLARE v_new_end DATE;

  SELECT start_date INTO v_new_start
    FROM financial_years
   WHERE id = NEW.effective_from_financial_year_id AND company_id = NEW.company_id;

  IF NEW.effective_to_financial_year_id IS NULL THEN
    SET v_new_end = '9999-12-31';
  ELSE
    SELECT end_date INTO v_new_end
      FROM financial_years
     WHERE id = NEW.effective_to_financial_year_id AND company_id = NEW.company_id;
  END IF;

  IF v_new_end < v_new_start THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'System account role effective range is invalid';
  END IF;

  IF NEW.role NOT IN ('CASH','BANK') AND EXISTS (
    SELECT 1
      FROM system_account_role_assignments existing_role
      JOIN financial_years existing_from
        ON existing_from.id = existing_role.effective_from_financial_year_id
       AND existing_from.company_id = existing_role.company_id
      LEFT JOIN financial_years existing_to
        ON existing_to.id = existing_role.effective_to_financial_year_id
       AND existing_to.company_id = existing_role.company_id
     WHERE existing_role.id <> OLD.id
       AND existing_role.company_id = NEW.company_id
       AND existing_role.role = NEW.role
       AND v_new_start <= COALESCE(existing_to.end_date, '9999-12-31')
       AND v_new_end >= existing_from.start_date
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Singleton system account role effective ranges cannot overlap';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_lines_no_update
BEFORE UPDATE ON financial_year_close_lines
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close lines are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_lines_no_delete
BEFORE DELETE ON financial_year_close_lines
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close lines are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_recon_no_update
BEFORE UPDATE ON financial_year_close_reconciliations
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close reconciliations are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_recon_no_delete
BEFORE DELETE ON financial_year_close_reconciliations
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close reconciliations are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_subledger_snap_no_update
BEFORE UPDATE ON financial_year_subledger_snapshots
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year subledger snapshots are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_subledger_snap_no_delete
BEFORE DELETE ON financial_year_subledger_snapshots
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year subledger snapshots are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_subledger_items_no_update
BEFORE UPDATE ON financial_year_subledger_snapshot_items
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year subledger snapshot items are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_subledger_items_no_delete
BEFORE DELETE ON financial_year_subledger_snapshot_items
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year subledger snapshot items are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_inventory_snap_no_update
BEFORE UPDATE ON financial_year_inventory_snapshots
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year inventory snapshots are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_inventory_snap_no_delete
BEFORE DELETE ON financial_year_inventory_snapshots
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year inventory snapshots are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_inventory_items_no_update
BEFORE UPDATE ON financial_year_inventory_snapshot_items
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year inventory snapshot items are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_inventory_items_no_delete
BEFORE DELETE ON financial_year_inventory_snapshot_items
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year inventory snapshot items are immutable';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_events_no_update
BEFORE UPDATE ON financial_year_close_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close events are append-only';
END$$

CREATE TRIGGER IF NOT EXISTS trg_fy_close_events_no_delete
BEFORE DELETE ON financial_year_close_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial year close events are append-only';
END$$

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_restricted_update
BEFORE UPDATE ON payment_reversals
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.reversal_journal_entry_id IS NULL AND NEW.reversal_journal_entry_id IS NOT NULL AND
    NEW.id = OLD.id AND NEW.company_id = OLD.company_id AND
    NEW.original_payment_id = OLD.original_payment_id AND
    NEW.reversal_amount = OLD.reversal_amount AND NEW.reversal_date = OLD.reversal_date AND
    NEW.financial_year_id = OLD.financial_year_id AND NEW.reason = OLD.reason AND
    NEW.created_by = OLD.created_by AND NEW.idempotency_key = OLD.idempotency_key AND
    NEW.replacement_reference <=> OLD.replacement_reference AND NEW.created_at = OLD.created_at
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment reversals are append-only except for one-time journal linkage';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_no_delete
BEFORE DELETE ON payment_reversals
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment reversals are append-only';
END$$

CREATE TRIGGER IF NOT EXISTS trg_vendor_payment_reversals_restricted_update
BEFORE UPDATE ON vendor_payment_reversals
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.reversal_journal_entry_id IS NULL AND NEW.reversal_journal_entry_id IS NOT NULL AND
    NEW.id = OLD.id AND NEW.company_id = OLD.company_id AND
    NEW.original_vendor_payment_id = OLD.original_vendor_payment_id AND
    NEW.reversal_amount = OLD.reversal_amount AND NEW.reversal_date = OLD.reversal_date AND
    NEW.financial_year_id = OLD.financial_year_id AND NEW.reason = OLD.reason AND
    NEW.created_by = OLD.created_by AND NEW.idempotency_key = OLD.idempotency_key AND
    NEW.replacement_reference <=> OLD.replacement_reference AND NEW.created_at = OLD.created_at
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vendor payment reversals are append-only except for one-time journal linkage';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_vendor_payment_reversals_no_delete
BEFORE DELETE ON vendor_payment_reversals
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vendor payment reversals are append-only';
END$$

CREATE TRIGGER IF NOT EXISTS trg_subledger_opening_restricted_update
BEFORE UPDATE ON subledger_opening_items
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.opening_journal_entry_id IS NULL AND NEW.opening_journal_entry_id IS NOT NULL AND
    NEW.id = OLD.id AND NEW.company_id = OLD.company_id AND
    NEW.party_type = OLD.party_type AND NEW.customer_id <=> OLD.customer_id AND
    NEW.vendor_id <=> OLD.vendor_id AND NEW.origin = OLD.origin AND
    NEW.entry_kind = OLD.entry_kind AND
    NEW.reversal_of_opening_item_id <=> OLD.reversal_of_opening_item_id AND
    NEW.reference = OLD.reference AND NEW.effective_date = OLD.effective_date AND
    NEW.due_date <=> OLD.due_date AND NEW.original_amount = OLD.original_amount AND
    NEW.direction = OLD.direction AND NEW.financial_year_id = OLD.financial_year_id AND
    NEW.migration_batch_reference <=> OLD.migration_batch_reference AND
    NEW.source_identity = OLD.source_identity AND NEW.created_by = OLD.created_by AND
    NEW.created_at = OLD.created_at
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subledger opening items are append-only except for one-time journal linkage';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_subledger_opening_no_delete
BEFORE DELETE ON subledger_opening_items
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subledger opening items are append-only';
END$$

DELIMITER ;
