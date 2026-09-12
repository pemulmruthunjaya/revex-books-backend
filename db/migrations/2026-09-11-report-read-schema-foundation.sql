-- REPORT-READ-DDL schema foundation.
--
-- This migration mirrors the current runtime readiness helpers. It is schema-only:
-- it does not backfill business data, alter financial-year assignments, or replace
-- the existing receipt-entry migrations. A read-only schema preflight must reject
-- incompatible existing definitions before this migration is applied.

CREATE TABLE IF NOT EXISTS petty_cash_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  fund_name VARCHAR(120) NOT NULL DEFAULT 'Main Petty Cash',
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  current_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  imprest_limit DECIMAL(15,2) NOT NULL DEFAULT 0,
  manager_approval_limit DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_petty_cash_settings_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS petty_cash_user_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  can_create TINYINT(1) NOT NULL DEFAULT 0,
  can_edit_own TINYINT(1) NOT NULL DEFAULT 0,
  can_submit TINYINT(1) NOT NULL DEFAULT 0,
  can_approve TINYINT(1) NOT NULL DEFAULT 0,
  can_reject TINYINT(1) NOT NULL DEFAULT 0,
  can_post TINYINT(1) NOT NULL DEFAULT 0,
  can_view_all TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_petty_cash_permission_user (company_id, user_id),
  KEY idx_petty_cash_permission_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  transaction_no VARCHAR(40) NOT NULL,
  transaction_type ENUM('EXPENSE','REPLENISHMENT') NOT NULL,
  transaction_date DATE NOT NULL,
  category VARCHAR(100) NULL,
  payee VARCHAR(160) NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(50) NULL,
  reference_no VARCHAR(100) NULL,
  status ENUM('DRAFT','SUBMITTED','MANAGER_APPROVED','ACCOUNTS_APPROVED','POSTED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  created_by BIGINT UNSIGNED NOT NULL,
  submitted_by BIGINT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  manager_approved_by BIGINT UNSIGNED NULL,
  manager_approved_at DATETIME NULL,
  accounts_approved_by BIGINT UNSIGNED NULL,
  accounts_approved_at DATETIME NULL,
  posted_by BIGINT UNSIGNED NULL,
  posted_at DATETIME NULL,
  rejected_by BIGINT UNSIGNED NULL,
  rejected_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_petty_cash_transaction_no (company_id, transaction_no),
  KEY idx_petty_cash_company_status (company_id, status),
  KEY idx_petty_cash_company_date (company_id, transaction_date),
  KEY idx_petty_cash_creator (company_id, created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS petty_cash_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  file_data LONGBLOB NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_petty_cash_attachment_transaction (company_id, transaction_id),
  CONSTRAINT fk_petty_cash_attachment_transaction
    FOREIGN KEY (transaction_id) REFERENCES petty_cash_transactions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS petty_cash_workflow_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  comments VARCHAR(500) NULL,
  action_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_petty_cash_history_transaction (company_id, transaction_id),
  CONSTRAINT fk_petty_cash_history_transaction
    FOREIGN KEY (transaction_id) REFERENCES petty_cash_transactions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The products table is base schema. Add only the columns currently provisioned
-- by report/product inventory readiness helpers, preserving existing values.
SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'mrp'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `mrp` DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;
SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'sku'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `sku` VARCHAR(100) NULL',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'hsn'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `hsn` VARCHAR(30) NULL',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'category'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `category` VARCHAR(100) NULL',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'batch_no'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `batch_no` VARCHAR(100) NULL',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'manufactured_date'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `manufactured_date` DATE NULL',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'expiry_date'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `expiry_date` DATE NULL',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'unit'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `unit` VARCHAR(30) NOT NULL DEFAULT ''PCS''',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'gst'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `gst` DECIMAL(5,2) NOT NULL DEFAULT 18',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'purchase_price'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `purchase_price` DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'opening_stock'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `opening_stock` DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'reorder_level'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `reorder_level` DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'status'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE products ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT ''Active''',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

CREATE TABLE IF NOT EXISTS product_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  type VARCHAR(20) NOT NULL,
  return_number VARCHAR(50) NOT NULL,
  return_date DATE NOT NULL,
  party_type VARCHAR(20) NOT NULL,
  party_id INT NULL,
  party_name VARCHAR(255) NOT NULL,
  reference_number VARCHAR(100) NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_product_returns_company_number (company_id, return_number)
);

CREATE TABLE IF NOT EXISTS return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id INT NOT NULL,
  company_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  batch_no VARCHAR(100) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  mrp DECIMAL(12,2) NOT NULL DEFAULT 0,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_return_items_return (return_id),
  INDEX idx_return_items_company_product (company_id, product_id)
);

CREATE TABLE IF NOT EXISTS delivery_challans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  type VARCHAR(10) NOT NULL,
  challan_number VARCHAR(50) NOT NULL,
  challan_date DATE NOT NULL,
  party_type VARCHAR(20) NOT NULL,
  party_id INT NULL,
  party_name VARCHAR(255) NOT NULL,
  address TEXT NULL,
  transport VARCHAR(255) NULL,
  vehicle_number VARCHAR(100) NULL,
  notes TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Created',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_delivery_challan_company_number (company_id, challan_number)
);

CREATE TABLE IF NOT EXISTS delivery_challan_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  challan_id INT NOT NULL,
  company_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  batch_no VARCHAR(100) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(30) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_delivery_challan_items_challan (challan_id),
  INDEX idx_delivery_challan_items_company_product (company_id, product_id)
);

CREATE TABLE IF NOT EXISTS payroll_employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  employee_code VARCHAR(80) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  designation VARCHAR(150) NULL,
  joining_date DATE NULL,
  monthly_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payroll_employee_company (company_id),
  INDEX idx_payroll_employee_code (company_id, employee_code),
  INDEX idx_payroll_employee_status (company_id, status)
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  employee_id INT NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  payroll_month VARCHAR(7) NOT NULL,
  payroll_date DATE NOT NULL,
  salary_mode VARCHAR(40) NOT NULL DEFAULT 'Manual',
  working_days DECIMAL(8,2) NOT NULL DEFAULT 0,
  present_days DECIMAL(8,2) NOT NULL DEFAULT 0,
  absent_days DECIMAL(8,2) NOT NULL DEFAULT 0,
  total_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  overtime_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  standard_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowances DECIMAL(12,2) NOT NULL DEFAULT 0,
  deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'Unpaid',
  payment_date DATE NULL,
  notes TEXT NULL,
  attendance_import_id INT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_payroll_employee_month (company_id, employee_id, payroll_month),
  INDEX idx_payroll_entries_company_month (company_id, payroll_month),
  INDEX idx_payroll_entries_status (company_id, status)
);

CREATE TABLE IF NOT EXISTS payroll_attendance_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  payroll_month VARCHAR(7) NOT NULL,
  file_name VARCHAR(255) NULL,
  row_count INT NOT NULL DEFAULT 0,
  created_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  standard_hours_per_day DECIMAL(8,2) NOT NULL DEFAULT 8,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payroll_attendance_import_company (company_id, created_at)
);

CREATE TABLE IF NOT EXISTS payroll_attendance_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  import_id INT NOT NULL,
  company_id INT NOT NULL,
  employee_id INT NULL,
  employee_code VARCHAR(80) NULL,
  employee_name VARCHAR(255) NULL,
  payroll_month VARCHAR(7) NOT NULL,
  working_days DECIMAL(8,2) NOT NULL DEFAULT 0,
  present_days DECIMAL(8,2) NOT NULL DEFAULT 0,
  absent_days DECIMAL(8,2) NOT NULL DEFAULT 0,
  total_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  overtime_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  allowances DECIMAL(12,2) NOT NULL DEFAULT 0,
  deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  calculated_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'Imported',
  message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payroll_attendance_lines_import (import_id),
  INDEX idx_payroll_attendance_lines_company (company_id, payroll_month)
);

-- These guarded additions match the evolution logic in ensurePayrollTables.
SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_employees' AND COLUMN_NAME = 'employee_code'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_employees` ADD COLUMN `employee_code` VARCHAR(80) NULL AFTER name',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'salary_mode'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `salary_mode` VARCHAR(40) NOT NULL DEFAULT ''Manual'' AFTER payroll_date',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'working_days'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `working_days` DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER salary_mode',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'present_days'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `present_days` DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER working_days',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'absent_days'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `absent_days` DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER present_days',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'total_hours'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `total_hours` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER absent_days',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'overtime_hours'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `overtime_hours` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total_hours',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'standard_hours'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `standard_hours` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER overtime_hours',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;

SET @rrsf_has_column = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_entries' AND COLUMN_NAME = 'attendance_import_id'
);
SET @rrsf_sql = IF(@rrsf_has_column = 0,
  'ALTER TABLE `payroll_entries` ADD COLUMN `attendance_import_id` INT NULL AFTER notes',
  'SELECT 1');
PREPARE rrsf_stmt FROM @rrsf_sql; EXECUTE rrsf_stmt; DEALLOCATE PREPARE rrsf_stmt;
