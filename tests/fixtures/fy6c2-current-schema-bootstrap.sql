-- FY-6 disposable DB proof only; prepared 2026-09-13 from repository schema evidence.
-- NOT a production migration. NOT authoritative application migration history.
-- Contains no business data; represents expected schema immediately BEFORE FY-6 close foundation.
-- Source HEAD: 3cbfa1a477c0e2bc3510cdcf998bdcfff18edcca.
-- Legacy source: railway-backup-before-po-grn.sql (CREATE TABLE definitions only).
-- Later sources are identified beside each DDL block and in the companion manifest.
-- Review-only in R2. Database selection and execution require separate R3 authorization.
-- Empty MySQL 8 schema required; no FK checks are disabled and no table counters are copied.

-- Base: railway-backup-before-po-grn.sql:1410
CREATE TABLE `plans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `dashboard` tinyint(1) DEFAULT '1',
  `sales` tinyint(1) DEFAULT '0',
  `purchases` tinyint(1) DEFAULT '0',
  `inventory` tinyint(1) DEFAULT '0',
  `contacts` tinyint(1) DEFAULT '0',
  `banking` tinyint(1) DEFAULT '0',
  `accounting` tinyint(1) DEFAULT '0',
  `reports` tinyint(1) DEFAULT '0',
  `automation` tinyint(1) DEFAULT '0',
  `integrations` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:355
CREATE TABLE `companies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text,
  `gst_number` varchar(50) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `logo_url` varchar(255) DEFAULT NULL,
  `plan_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  CONSTRAINT `companies_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:996
CREATE TABLE `organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `plan_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  CONSTRAINT `organizations_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:1976
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `company_id` int DEFAULT NULL,
  `role` enum('owner','admin','staff') DEFAULT 'staff',
  `organization_id` int DEFAULT NULL,
  `access_role` varchar(30) NOT NULL DEFAULT 'sales',
  `permissions` longtext,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_login_at` datetime DEFAULT NULL,
  `must_change_password` tinyint(1) NOT NULL DEFAULT '0',
  `password_reset_token_hash` char(64) DEFAULT NULL,
  `password_reset_expires_at` datetime DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `fk_users_company` (`company_id`),
  KEY `organization_id` (`organization_id`),
  CONSTRAINT `fk_users_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:25
CREATE TABLE `accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_code` varchar(50) DEFAULT NULL,
  `account_name` varchar(255) NOT NULL,
  `account_type` enum('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY') NOT NULL,
  `parent_account_id` int DEFAULT NULL,
  `opening_balance` decimal(15,2) DEFAULT '0.00',
  `balance_type` enum('DEBIT','CREDIT') DEFAULT 'DEBIT',
  `description` text,
  `status` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `account_code` (`account_code`),
  KEY `parent_account_id` (`parent_account_id`),
  KEY `idx_accounts_company_id` (`company_id`),
  CONSTRAINT `accounts_ibfk_1` FOREIGN KEY (`parent_account_id`) REFERENCES `accounts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:280
CREATE TABLE `branches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_type` enum('HEAD_OFFICE','BRANCH','STORE','WAREHOUSE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BRANCH',
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pincode` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gstin` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_head_office` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_company_branch_code` (`company_id`,`code`),
  KEY `idx_branch_company_active` (`company_id`,`is_active`),
  KEY `fk_branch_creator` (`created_by`),
  CONSTRAINT `fk_branch_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_branch_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Base: railway-backup-before-po-grn.sql:527
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text,
  `company_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `gstin` varchar(15) DEFAULT NULL,
  `pan_number` varchar(10) DEFAULT NULL,
  `opening_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `opening_balance_type` varchar(20) NOT NULL DEFAULT 'to_collect',
  `party_category` varchar(100) DEFAULT NULL,
  `billing_address` text,
  `shipping_address` text,
  `credit_period_days` int NOT NULL DEFAULT '30',
  `credit_limit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `contact_person_name` varchar(150) DEFAULT NULL,
  `contact_person_dob` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `company_id` (`company_id`),
  CONSTRAINT `customers_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:2090
CREATE TABLE `vendors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `gst_number` varchar(50) DEFAULT NULL,
  `address` text,
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  `pan_number` varchar(10) DEFAULT NULL,
  `opening_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `opening_balance_type` varchar(20) NOT NULL DEFAULT 'to_pay',
  `party_category` varchar(100) DEFAULT NULL,
  `billing_address` text,
  `shipping_address` text,
  `credit_period_days` int NOT NULL DEFAULT '30',
  `credit_limit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `contact_person_name` varchar(150) DEFAULT NULL,
  `contact_person_dob` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vendors_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:1524
CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `sellingPrice` decimal(10,2) NOT NULL,
  `stock` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  `mrp` decimal(10,2) NOT NULL DEFAULT '0.00',
  `sku` varchar(100) DEFAULT NULL,
  `barcode` varchar(100) DEFAULT NULL,
  `hsn` varchar(30) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `unit` varchar(30) NOT NULL DEFAULT 'PCS',
  `gst` decimal(5,2) NOT NULL DEFAULT '18.00',
  `purchase_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `opening_stock` decimal(10,2) NOT NULL DEFAULT '0.00',
  `reorder_level` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) NOT NULL DEFAULT 'Active',
  `batch_no` varchar(100) DEFAULT NULL,
  `manufactured_date` date DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_products_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:808
CREATE TABLE `invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `created_by` int NOT NULL,
  `invoice_number` varchar(50) NOT NULL,
  `invoice_date` date NOT NULL,
  `customer_id` int DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'pending',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT '18.00',
  `cgst` decimal(10,2) DEFAULT '0.00',
  `sgst` decimal(10,2) DEFAULT '0.00',
  `igst` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice_number_per_company` (`company_id`,`invoice_number`),
  KEY `fk_invoice_user` (`created_by`),
  CONSTRAINT `fk_invoice_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_invoice_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:1023
CREATE TABLE `payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoice_id` int NOT NULL,
  `company_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_date` date NOT NULL,
  `payment_method` enum('cash','upi','bank','card','cheque') NOT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `receipt_entry_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_receipt_entry` (`receipt_entry_id`),
  KEY `fk_payment_invoice` (`invoice_id`),
  KEY `fk_payment_company` (`company_id`),
  CONSTRAINT `fk_payment_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:242
CREATE TABLE `bills` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bill_number` varchar(50) NOT NULL,
  `bill_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `total_amount` decimal(10,2) DEFAULT '0.00',
  `paid_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `due_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'Unpaid',
  `company_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `vendor_id` int DEFAULT NULL,
  `source_purchase_order_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_vendor` (`vendor_id`),
  KEY `idx_bills_company_id` (`company_id`),
  CONSTRAINT `bills_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:2052
CREATE TABLE `vendor_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vendor_id` int NOT NULL,
  `bill_id` int DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_date` date DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `paid_from_account_id` int DEFAULT NULL,
  `reference_number` varchar(120) DEFAULT NULL,
  `notes` text,
  `company_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `journal_entry_id` bigint DEFAULT NULL,
  `idempotency_key` varchar(100) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'SUCCESS',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_payment_submission` (`company_id`,`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:856
CREATE TABLE `journal_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `journal_no` varchar(50) DEFAULT NULL,
  `journal_date` date NOT NULL,
  `narration` text,
  `total_debit` decimal(15,2) DEFAULT '0.00',
  `total_credit` decimal(15,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  `vendor_id` int DEFAULT NULL,
  `source_type` varchar(50) DEFAULT NULL,
  `source_id` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `journal_no` (`journal_no`),
  UNIQUE KEY `uq_journal_source` (`company_id`,`source_type`,`source_id`),
  KEY `idx_journal_entries_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Base: railway-backup-before-po-grn.sql:895
CREATE TABLE `journal_entry_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `journal_entry_id` int NOT NULL,
  `account_id` int NOT NULL,
  `debit` decimal(15,2) DEFAULT '0.00',
  `credit` decimal(15,2) DEFAULT '0.00',
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `journal_entry_id` (`journal_entry_id`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `journal_entry_details_ibfk_1` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `journal_entry_details_ibfk_2` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Evolution: db/migrations/2026-08-10-purchase-orders-grn.sql:79
ALTER TABLE bills ADD COLUMN source_grn_id BIGINT UNSIGNED NULL, ADD COLUMN stock_posted TINYINT(1) NOT NULL DEFAULT 1;

-- Evolution: db/migrations/2026-08-10-purchase-orders-grn.sql:83
CREATE INDEX idx_bills_company_po ON bills(company_id, source_purchase_order_id);

-- Evolution: db/migrations/2026-08-10-purchase-orders-grn.sql:87
CREATE INDEX idx_bills_company_grn ON bills(company_id, source_grn_id);

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:22
ALTER TABLE plans ADD COLUMN code VARCHAR(50) NULL AFTER id;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:35
ALTER TABLE plans ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER price;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:48
ALTER TABLE plans ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:61
ALTER TABLE plans ADD COLUMN default_trial_days INT UNSIGNED NOT NULL DEFAULT 14 AFTER is_public;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:74
ALTER TABLE plans ADD COLUMN max_users INT UNSIGNED NULL AFTER default_trial_days;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:87
ALTER TABLE plans ADD COLUMN max_staff INT UNSIGNED NULL AFTER max_users;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:100
ALTER TABLE plans ADD COLUMN max_branches INT UNSIGNED NULL AFTER max_staff;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:113
ALTER TABLE plans ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER max_branches;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:126
ALTER TABLE plans ADD COLUMN metadata JSON NULL AFTER integrations;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:139
ALTER TABLE plans ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER metadata;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:152
ALTER TABLE plans ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- Evolution: db/migrations/2026-08-18-subscription-foundation.sql:215
CREATE UNIQUE INDEX uq_plans_code ON plans(code);

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:74
ALTER TABLE invoices ADD COLUMN overall_discount_type VARCHAR(10) NULL;

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:81
ALTER TABLE invoices ADD COLUMN overall_discount_value DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:88
ALTER TABLE invoices ADD COLUMN overall_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:95
ALTER TABLE invoices ADD COLUMN additional_discount_type VARCHAR(10) NULL;

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:102
ALTER TABLE invoices ADD COLUMN additional_discount_value DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:109
ALTER TABLE invoices ADD COLUMN additional_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Evolution: db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:116
ALTER TABLE invoices ADD COLUMN round_off_amount DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:15
ALTER TABLE invoices ADD COLUMN invoice_type VARCHAR(10) NULL AFTER invoice_date;

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:25
ALTER TABLE invoices ADD COLUMN cash_customer_name VARCHAR(255) NULL AFTER customer_phone;

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:35
ALTER TABLE invoices ADD COLUMN cash_customer_mobile VARCHAR(50) NULL AFTER cash_customer_name;

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:45
ALTER TABLE invoices ADD COLUMN credit_days INT UNSIGNED NULL AFTER due_date;

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:55
ALTER TABLE invoices ADD COLUMN shipping_address TEXT NULL AFTER cash_customer_mobile;

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:68
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_invoice_type CHECK (invoice_type IS NULL OR invoice_type IN ('CASH', 'CREDIT'));

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:81
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_credit_days CHECK (credit_days IS NULL OR credit_days BETWEEN 0 AND 3650);

-- Evolution: db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:101
ALTER TABLE invoices ADD INDEX idx_invoices_company_type_date (company_id, invoice_type, invoice_date);

-- Evolution: db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:25
ALTER TABLE invoices ADD COLUMN request_id VARCHAR(80) NULL AFTER id;

-- Evolution: db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:49
ALTER TABLE invoices ADD UNIQUE INDEX uq_invoices_company_request (company_id, request_id);

-- Evolution: db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:63
ALTER TABLE invoices ADD COLUMN payment_status VARCHAR(12) NULL AFTER status;

-- Evolution: db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:77
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_payment_status CHECK (payment_status IS NULL OR payment_status IN ('UNPAID', 'PARTIAL', 'PAID'));

-- Evolution: db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:116
ALTER TABLE payments MODIFY COLUMN payment_method VARCHAR(40) NOT NULL;

-- Evolution: db/migrations/2026-08-28-customer-receipt-multi-invoice-allocation.sql:11-33
ALTER TABLE payments DROP INDEX uq_payments_receipt_entry;
CREATE INDEX idx_payments_receipt_entry ON payments (receipt_entry_id);

-- Explicit opening-equity foundation requested for this proof (no event rows).
-- Source: db/migrations/2026-08-02-opening-balance-equity.sql:2-20
-- Schema-only migration. This intentionally does not backfill or modify historical balances.
CREATE TABLE IF NOT EXISTS opening_balance_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  entity_type ENUM('account','customer','vendor') NOT NULL,
  entity_id BIGINT NOT NULL,
  sequence_no INT NOT NULL,
  event_kind ENUM('initial','adjustment') NOT NULL,
  signed_delta DECIMAL(15,2) NOT NULL,
  target_account_id INT NOT NULL,
  journal_entry_id INT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_opening_event_sequence (company_id,entity_type,entity_id,sequence_no),
  UNIQUE KEY uq_opening_event_journal (journal_entry_id),
  KEY idx_opening_event_company_target (company_id,target_account_id),
  CONSTRAINT fk_opening_event_journal
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Source: db/migrations/2026-09-05-financial-year-foundation.sql:4-145
-- OPEN vocabulary evolution: db/migrations/2026-09-09-financial-year-lifecycle-open-event.sql:4-17
-- RevEx Books: Financial Year foundation (FY-1A)
-- Additive, tenant-scoped, and intentionally does not backfill legacy companies.

CREATE TABLE IF NOT EXISTS financial_years (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('DRAFT','OPEN','RECONCILIATION','CLOSING','CLOSED','LOCKED') NOT NULL DEFAULT 'DRAFT',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  default_company_id INT GENERATED ALWAYS AS (
    CASE WHEN is_default = 1 THEN company_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_financial_years_id_company (id, company_id),
  UNIQUE KEY uq_financial_years_company_code (company_id, code),
  UNIQUE KEY uq_financial_years_company_dates (company_id, start_date, end_date),
  UNIQUE KEY uq_financial_years_one_default (default_company_id),
  KEY idx_financial_years_company_dates (company_id, start_date, end_date),
  KEY idx_financial_years_company_status (company_id, status),
  KEY idx_financial_years_company_default (company_id, is_default),
  KEY idx_financial_years_created_by (created_by),
  CONSTRAINT fk_financial_years_company
    FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_financial_years_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_financial_years_dates CHECK (start_date <= end_date),
  CONSTRAINT chk_financial_years_is_default CHECK (is_default IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM(
    'CREATE',
    'SET_DEFAULT',
    'OPEN',
    'BEGIN_RECONCILIATION',
    'BEGIN_CLOSE',
    'CLOSE',
    'LOCK',
    'REOPEN',
    'MIGRATION_LINK',
    'ADJUSTMENT_AUTHORIZED'
  ) NOT NULL,
  previous_status ENUM('DRAFT','OPEN','RECONCILIATION','CLOSING','CLOSED','LOCKED') NULL,
  new_status ENUM('DRAFT','OPEN','RECONCILIATION','CLOSING','CLOSED','LOCKED') NULL,
  reason VARCHAR(500) NULL,
  actor_user_id INT NULL,
  metadata JSON NULL,
  occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_financial_year_events_company_time (company_id, occurred_at, id),
  KEY idx_financial_year_events_fy_time (financial_year_id, occurred_at, id),
  KEY idx_financial_year_events_type (company_id, event_type, occurred_at),
  KEY idx_financial_year_events_actor (actor_user_id),
  CONSTRAINT fk_financial_year_events_year_company
    FOREIGN KEY (financial_year_id, company_id)
    REFERENCES financial_years (id, company_id),
  CONSTRAINT fk_financial_year_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_financial_years_no_overlap_insert
BEFORE INSERT ON financial_years
FOR EACH ROW
BEGIN
  DECLARE locked_company_id INT;

  SELECT id INTO locked_company_id
    FROM companies
   WHERE id = NEW.company_id
   FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM financial_years fy
     WHERE fy.company_id = NEW.company_id
       AND NEW.start_date <= fy.end_date
       AND NEW.end_date >= fy.start_date
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Financial year dates overlap an existing financial year';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_financial_years_no_overlap_update
BEFORE UPDATE ON financial_years
FOR EACH ROW
BEGIN
  DECLARE locked_company_id INT;

  IF NEW.company_id <> OLD.company_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Financial year company cannot be changed';
  END IF;

  SELECT id INTO locked_company_id
    FROM companies
   WHERE id = NEW.company_id
   FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM financial_years fy
     WHERE fy.company_id = NEW.company_id
       AND fy.id <> OLD.id
       AND NEW.start_date <= fy.end_date
       AND NEW.end_date >= fy.start_date
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Financial year dates overlap an existing financial year';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_financial_year_events_no_update
BEFORE UPDATE ON financial_year_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Financial year events are append-only';
END$$

CREATE TRIGGER IF NOT EXISTS trg_financial_year_events_no_delete
BEFORE DELETE ON financial_year_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Financial year events are append-only';
END$$

DELIMITER ;


-- Schema-only expansion of add_core_transaction_fy_link, source:
-- db/migrations/2026-09-05-core-accounting-financial-year-links.sql:30-67.
ALTER TABLE invoices ADD COLUMN financial_year_id BIGINT UNSIGNED NULL;
ALTER TABLE invoices ADD INDEX idx_invoices_company_fy (company_id,financial_year_id);
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_company_fy
  FOREIGN KEY (financial_year_id,company_id) REFERENCES financial_years (id,company_id);

ALTER TABLE payments ADD COLUMN financial_year_id BIGINT UNSIGNED NULL;
ALTER TABLE payments ADD INDEX idx_payments_company_fy (company_id,financial_year_id);
ALTER TABLE payments ADD CONSTRAINT fk_payments_company_fy
  FOREIGN KEY (financial_year_id,company_id) REFERENCES financial_years (id,company_id);

ALTER TABLE bills ADD COLUMN financial_year_id BIGINT UNSIGNED NULL;
ALTER TABLE bills ADD INDEX idx_bills_company_fy (company_id,financial_year_id);
ALTER TABLE bills ADD CONSTRAINT fk_bills_company_fy
  FOREIGN KEY (financial_year_id,company_id) REFERENCES financial_years (id,company_id);

ALTER TABLE vendor_payments ADD COLUMN financial_year_id BIGINT UNSIGNED NULL;
ALTER TABLE vendor_payments ADD INDEX idx_vendor_payments_company_fy (company_id,financial_year_id);
ALTER TABLE vendor_payments ADD CONSTRAINT fk_vendor_payments_company_fy
  FOREIGN KEY (financial_year_id,company_id) REFERENCES financial_years (id,company_id);

ALTER TABLE journal_entries ADD COLUMN financial_year_id BIGINT UNSIGNED NULL;
ALTER TABLE journal_entries ADD INDEX idx_journal_entries_company_fy (company_id,financial_year_id);
ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_company_fy
  FOREIGN KEY (financial_year_id,company_id) REFERENCES financial_years (id,company_id);


