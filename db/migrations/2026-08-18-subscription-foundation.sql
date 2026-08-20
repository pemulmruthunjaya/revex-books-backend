-- RevEx Books subscription lifecycle foundation.
-- Additive only: preserves companies.plan_id and does not alter authentication
-- or accounting/business records.
--
-- REQUIRED BEFORE EXECUTION:
--   1. Take and verify a restorable production backup.
--   2. Run a schema preflight against information_schema and confirm that any
--      existing objects with these names match the definitions below.
--   3. Dry-run this complete file against a recent production-schema clone.
--   4. Use a low-traffic deployment window and monitor metadata-lock waits.
-- MySQL DDL commits implicitly. A failure can leave a partial schema; this file
-- is intentionally rerunnable where practical, but a partial failure must be
-- inspected and reconciled before retrying.

-- Extend the existing plans catalogue without changing existing feature flags.
SET @has_plan_code = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'code'
);
SET @add_plan_code = IF(
  @has_plan_code = 0,
  'ALTER TABLE plans ADD COLUMN code VARCHAR(50) NULL AFTER id',
  'SELECT 1'
);
PREPARE add_plan_code_stmt FROM @add_plan_code;
EXECUTE add_plan_code_stmt;
DEALLOCATE PREPARE add_plan_code_stmt;

SET @has_plan_active = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'is_active'
);
SET @add_plan_active = IF(
  @has_plan_active = 0,
  'ALTER TABLE plans ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER price',
  'SELECT 1'
);
PREPARE add_plan_active_stmt FROM @add_plan_active;
EXECUTE add_plan_active_stmt;
DEALLOCATE PREPARE add_plan_active_stmt;

SET @has_plan_public = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'is_public'
);
SET @add_plan_public = IF(
  @has_plan_public = 0,
  'ALTER TABLE plans ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active',
  'SELECT 1'
);
PREPARE add_plan_public_stmt FROM @add_plan_public;
EXECUTE add_plan_public_stmt;
DEALLOCATE PREPARE add_plan_public_stmt;

SET @has_default_trial_days = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'default_trial_days'
);
SET @add_default_trial_days = IF(
  @has_default_trial_days = 0,
  'ALTER TABLE plans ADD COLUMN default_trial_days INT UNSIGNED NOT NULL DEFAULT 14 AFTER is_public',
  'SELECT 1'
);
PREPARE add_default_trial_days_stmt FROM @add_default_trial_days;
EXECUTE add_default_trial_days_stmt;
DEALLOCATE PREPARE add_default_trial_days_stmt;

SET @has_max_users = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_users'
);
SET @add_max_users = IF(
  @has_max_users = 0,
  'ALTER TABLE plans ADD COLUMN max_users INT UNSIGNED NULL AFTER default_trial_days',
  'SELECT 1'
);
PREPARE add_max_users_stmt FROM @add_max_users;
EXECUTE add_max_users_stmt;
DEALLOCATE PREPARE add_max_users_stmt;

SET @has_max_staff = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_staff'
);
SET @add_max_staff = IF(
  @has_max_staff = 0,
  'ALTER TABLE plans ADD COLUMN max_staff INT UNSIGNED NULL AFTER max_users',
  'SELECT 1'
);
PREPARE add_max_staff_stmt FROM @add_max_staff;
EXECUTE add_max_staff_stmt;
DEALLOCATE PREPARE add_max_staff_stmt;

SET @has_max_branches = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_branches'
);
SET @add_max_branches = IF(
  @has_max_branches = 0,
  'ALTER TABLE plans ADD COLUMN max_branches INT UNSIGNED NULL AFTER max_staff',
  'SELECT 1'
);
PREPARE add_max_branches_stmt FROM @add_max_branches;
EXECUTE add_max_branches_stmt;
DEALLOCATE PREPARE add_max_branches_stmt;

SET @has_plan_sort_order = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'sort_order'
);
SET @add_plan_sort_order = IF(
  @has_plan_sort_order = 0,
  'ALTER TABLE plans ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER max_branches',
  'SELECT 1'
);
PREPARE add_plan_sort_order_stmt FROM @add_plan_sort_order;
EXECUTE add_plan_sort_order_stmt;
DEALLOCATE PREPARE add_plan_sort_order_stmt;

SET @has_plan_metadata = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'metadata'
);
SET @add_plan_metadata = IF(
  @has_plan_metadata = 0,
  'ALTER TABLE plans ADD COLUMN metadata JSON NULL AFTER integrations',
  'SELECT 1'
);
PREPARE add_plan_metadata_stmt FROM @add_plan_metadata;
EXECUTE add_plan_metadata_stmt;
DEALLOCATE PREPARE add_plan_metadata_stmt;

SET @has_plan_created_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'created_at'
);
SET @add_plan_created_at = IF(
  @has_plan_created_at = 0,
  'ALTER TABLE plans ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER metadata',
  'SELECT 1'
);
PREPARE add_plan_created_at_stmt FROM @add_plan_created_at;
EXECUTE add_plan_created_at_stmt;
DEALLOCATE PREPARE add_plan_created_at_stmt;

SET @has_plan_updated_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'updated_at'
);
SET @add_plan_updated_at = IF(
  @has_plan_updated_at = 0,
  'ALTER TABLE plans ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1'
);
PREPARE add_plan_updated_at_stmt FROM @add_plan_updated_at;
EXECUTE add_plan_updated_at_stmt;
DEALLOCATE PREPARE add_plan_updated_at_stmt;

-- Missing plan codes use the primary key and therefore cannot collide with one
-- another. Existing nonblank codes are preserved.
UPDATE plans
SET code = CONCAT('PLAN_', id)
WHERE code IS NULL OR TRIM(code) = '';

-- Do not guess how to rename pre-existing duplicate human-managed codes. Fail
-- clearly so they can be resolved in a controlled plan-administration step.
SET @has_duplicate_plan_codes = (
  SELECT COUNT(*)
  FROM (
    SELECT code
    FROM plans
    WHERE code IS NOT NULL AND TRIM(code) <> ''
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicate_plan_codes
);
SET @assert_unique_plan_codes = IF(
  @has_duplicate_plan_codes = 0,
  'SELECT 1',
  'SELECT * FROM migration_error_duplicate_nonblank_plan_codes'
);
PREPARE assert_unique_plan_codes_stmt FROM @assert_unique_plan_codes;
EXECUTE assert_unique_plan_codes_stmt;
DEALLOCATE PREPARE assert_unique_plan_codes_stmt;

-- If this index name already exists, require its exact unique single-column
-- definition. A conflicting object must stop the migration rather than pass.
SET @plan_code_index_rows = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
    AND INDEX_NAME = 'uq_plans_code'
);
SET @plan_code_index_is_valid = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
    AND INDEX_NAME = 'uq_plans_code' AND NON_UNIQUE = 0
    AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'code'
);
SET @assert_plan_code_index = IF(
  @plan_code_index_rows = 0 OR
    (@plan_code_index_rows = 1 AND @plan_code_index_is_valid = 1),
  'SELECT 1',
  'SELECT * FROM migration_error_uq_plans_code_definition_conflict'
);
PREPARE assert_plan_code_index_stmt FROM @assert_plan_code_index;
EXECUTE assert_plan_code_index_stmt;
DEALLOCATE PREPARE assert_plan_code_index_stmt;

SET @has_plan_code_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND INDEX_NAME = 'uq_plans_code'
);
SET @add_plan_code_index = IF(
  @has_plan_code_index = 0,
  'CREATE UNIQUE INDEX uq_plans_code ON plans(code)',
  'SELECT 1'
);
PREPARE add_plan_code_index_stmt FROM @add_plan_code_index;
EXECUTE add_plan_code_index_stmt;
DEALLOCATE PREPARE add_plan_code_index_stmt;

CREATE TABLE IF NOT EXISTS company_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  plan_id INT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'trialing',
  billing_cycle VARCHAR(30) NOT NULL DEFAULT 'none',
  trial_start_at DATETIME NULL,
  trial_end_at DATETIME NULL,
  trial_duration_days INT UNSIGNED NULL,
  subscription_start_at DATETIME NULL,
  current_period_start_at DATETIME NULL,
  current_period_end_at DATETIME NULL,
  cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
  cancelled_at DATETIME NULL,
  expired_at DATETIME NULL,
  suspended_at DATETIME NULL,
  suspension_reason TEXT NULL,
  activated_at DATETIME NULL,
  activation_source VARCHAR(30) NULL,
  staff_limit_override INT UNSIGNED NULL,
  user_limit_override INT UNSIGNED NULL,
  grace_period_end_at DATETIME NULL,
  auto_renew TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_subscriptions_company (company_id),
  UNIQUE KEY uq_company_subscriptions_id_company (id, company_id),
  KEY idx_company_subscriptions_plan (plan_id),
  KEY idx_company_subscriptions_status_end (status, current_period_end_at),
  KEY idx_company_subscriptions_trial_end (status, trial_end_at),
  CONSTRAINT fk_company_subscriptions_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_subscriptions_plan
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
  CONSTRAINT chk_company_subscriptions_trial_dates
    CHECK (trial_start_at IS NULL OR trial_end_at IS NULL OR trial_end_at > trial_start_at),
  CONSTRAINT chk_company_subscriptions_cancel_boolean
    CHECK (cancel_at_period_end IN (0, 1)),
  CONSTRAINT chk_company_subscriptions_renew_boolean
    CHECK (auto_renew IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  company_id INT NOT NULL,
  plan_id INT NULL,
  period_type VARCHAR(30) NOT NULL,
  billing_cycle VARCHAR(30) NOT NULL DEFAULT 'none',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  source_key VARCHAR(100) NULL,
  staff_limit_snapshot INT UNSIGNED NULL,
  user_limit_snapshot INT UNSIGNED NULL,
  price_snapshot DECIMAL(12,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_periods_source (subscription_id, source_key),
  KEY idx_subscription_periods_subscription_company (subscription_id, company_id),
  KEY idx_subscription_periods_subscription_start (subscription_id, starts_at),
  KEY idx_subscription_periods_company_status (company_id, status, ends_at),
  KEY idx_subscription_periods_plan (plan_id),
  CONSTRAINT fk_subscription_periods_subscription
    FOREIGN KEY (subscription_id, company_id)
    REFERENCES company_subscriptions(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_periods_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_periods_plan
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
  CONSTRAINT chk_subscription_periods_dates
    CHECK (ends_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  company_id INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NULL,
  old_plan_id INT NULL,
  new_plan_id INT NULL,
  effective_at DATETIME NOT NULL,
  actor_type VARCHAR(30) NOT NULL DEFAULT 'system',
  actor_user_id INT NULL,
  reason TEXT NULL,
  metadata JSON NULL,
  request_id VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_events_request (subscription_id, request_id),
  KEY idx_subscription_events_subscription_company (subscription_id, company_id),
  KEY idx_subscription_events_subscription (subscription_id, created_at),
  KEY idx_subscription_events_company (company_id, created_at),
  KEY idx_subscription_events_type (event_type, created_at),
  KEY idx_subscription_events_actor (actor_user_id, created_at),
  KEY idx_subscription_events_old_plan (old_plan_id),
  KEY idx_subscription_events_new_plan (new_plan_id),
  CONSTRAINT fk_subscription_events_subscription
    FOREIGN KEY (subscription_id, company_id)
    REFERENCES company_subscriptions(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_events_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_subscription_events_old_plan
    FOREIGN KEY (old_plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_events_new_plan
    FOREIGN KEY (new_plan_id) REFERENCES plans(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trial_extensions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  company_id INT NOT NULL,
  previous_trial_end_at DATETIME NOT NULL,
  new_trial_end_at DATETIME NOT NULL,
  extension_days INT UNSIGNED NOT NULL,
  reason TEXT NOT NULL,
  granted_by_type VARCHAR(30) NOT NULL DEFAULT 'system',
  granted_by_user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trial_extensions_subscription_company (subscription_id, company_id),
  KEY idx_trial_extensions_subscription (subscription_id, created_at),
  KEY idx_trial_extensions_company (company_id, created_at),
  KEY idx_trial_extensions_granted_by (granted_by_user_id, created_at),
  CONSTRAINT fk_trial_extensions_subscription
    FOREIGN KEY (subscription_id, company_id)
    REFERENCES company_subscriptions(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_extensions_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trial_extensions_granted_by
    FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_trial_extensions_dates
    CHECK (new_trial_end_at > previous_trial_end_at),
  CONSTRAINT chk_trial_extensions_days
    CHECK (extension_days > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Critical object validation. These assertions make an incompatible pre-existing
-- table/index/constraint fail visibly instead of being hidden by IF NOT EXISTS.
SET @valid_subscription_parent_key = (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'company_subscriptions'
      AND INDEX_NAME = 'uq_company_subscriptions_id_company'
      AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id,company_id'
      AND COUNT(*) = 2
  ) valid_index
);
SET @assert_subscription_parent_key = IF(
  @valid_subscription_parent_key = 1,
  'SELECT 1',
  'SELECT * FROM migration_error_subscription_parent_composite_key_conflict'
);
PREPARE assert_subscription_parent_key_stmt FROM @assert_subscription_parent_key;
EXECUTE assert_subscription_parent_key_stmt;
DEALLOCATE PREPARE assert_subscription_parent_key_stmt;

SET @valid_period_source_key = (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'subscription_periods'
      AND INDEX_NAME = 'uq_subscription_periods_source'
      AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'subscription_id,source_key'
      AND COUNT(*) = 2
  ) valid_index
);
SET @assert_period_source_key = IF(
  @valid_period_source_key = 1,
  'SELECT 1',
  'SELECT * FROM migration_error_subscription_period_source_key_conflict'
);
PREPARE assert_period_source_key_stmt FROM @assert_period_source_key;
EXECUTE assert_period_source_key_stmt;
DEALLOCATE PREPARE assert_period_source_key_stmt;

SET @valid_event_request_key = (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'subscription_events'
      AND INDEX_NAME = 'uq_subscription_events_request'
      AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'subscription_id,request_id'
      AND COUNT(*) = 2
  ) valid_index
);
SET @assert_event_request_key = IF(
  @valid_event_request_key = 1,
  'SELECT 1',
  'SELECT * FROM migration_error_subscription_event_request_key_conflict'
);
PREPARE assert_event_request_key_stmt FROM @assert_event_request_key;
EXECUTE assert_event_request_key_stmt;
DEALLOCATE PREPARE assert_event_request_key_stmt;

SET @valid_period_tenant_fk = (
  SELECT COUNT(*)
  FROM (
    SELECT k.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE k
    INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'subscription_periods'
      AND k.CONSTRAINT_NAME = 'fk_subscription_periods_subscription'
      AND k.REFERENCED_TABLE_NAME = 'company_subscriptions'
      AND r.DELETE_RULE = 'RESTRICT'
    GROUP BY k.CONSTRAINT_NAME
    HAVING GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) = 'subscription_id,company_id'
      AND GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) = 'id,company_id'
      AND COUNT(*) = 2
  ) valid_fk
);
SET @assert_period_tenant_fk = IF(
  @valid_period_tenant_fk = 1,
  'SELECT 1',
  'SELECT * FROM migration_error_subscription_period_tenant_fk_conflict'
);
PREPARE assert_period_tenant_fk_stmt FROM @assert_period_tenant_fk;
EXECUTE assert_period_tenant_fk_stmt;
DEALLOCATE PREPARE assert_period_tenant_fk_stmt;

SET @valid_event_tenant_fk = (
  SELECT COUNT(*)
  FROM (
    SELECT k.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE k
    INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'subscription_events'
      AND k.CONSTRAINT_NAME = 'fk_subscription_events_subscription'
      AND k.REFERENCED_TABLE_NAME = 'company_subscriptions'
      AND r.DELETE_RULE = 'RESTRICT'
    GROUP BY k.CONSTRAINT_NAME
    HAVING GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) = 'subscription_id,company_id'
      AND GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) = 'id,company_id'
      AND COUNT(*) = 2
  ) valid_fk
);
SET @assert_event_tenant_fk = IF(
  @valid_event_tenant_fk = 1,
  'SELECT 1',
  'SELECT * FROM migration_error_subscription_event_tenant_fk_conflict'
);
PREPARE assert_event_tenant_fk_stmt FROM @assert_event_tenant_fk;
EXECUTE assert_event_tenant_fk_stmt;
DEALLOCATE PREPARE assert_event_tenant_fk_stmt;

SET @valid_extension_tenant_fk = (
  SELECT COUNT(*)
  FROM (
    SELECT k.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE k
    INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'trial_extensions'
      AND k.CONSTRAINT_NAME = 'fk_trial_extensions_subscription'
      AND k.REFERENCED_TABLE_NAME = 'company_subscriptions'
      AND r.DELETE_RULE = 'RESTRICT'
    GROUP BY k.CONSTRAINT_NAME
    HAVING GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) = 'subscription_id,company_id'
      AND GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) = 'id,company_id'
      AND COUNT(*) = 2
  ) valid_fk
);
SET @assert_extension_tenant_fk = IF(
  @valid_extension_tenant_fk = 1,
  'SELECT 1',
  'SELECT * FROM migration_error_trial_extension_tenant_fk_conflict'
);
PREPARE assert_extension_tenant_fk_stmt FROM @assert_extension_tenant_fk;
EXECUTE assert_extension_tenant_fk_stmt;
DEALLOCATE PREPARE assert_extension_tenant_fk_stmt;

SET @valid_company_retention_fks = (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND DELETE_RULE = 'RESTRICT'
    AND CONSTRAINT_NAME IN (
      'fk_company_subscriptions_company',
      'fk_subscription_periods_company',
      'fk_subscription_events_company',
      'fk_trial_extensions_company'
    )
);
SET @assert_company_retention_fks = IF(
  @valid_company_retention_fks = 4,
  'SELECT 1',
  'SELECT * FROM migration_error_company_audit_retention_fk_conflict'
);
PREPARE assert_company_retention_fks_stmt FROM @assert_company_retention_fks;
EXECUTE assert_company_retention_fks_stmt;
DEALLOCATE PREPARE assert_company_retention_fks_stmt;

SET @valid_actor_retention_fks = (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND DELETE_RULE = 'SET NULL'
    AND CONSTRAINT_NAME IN (
      'fk_subscription_events_actor',
      'fk_trial_extensions_granted_by'
    )
);
SET @assert_actor_retention_fks = IF(
  @valid_actor_retention_fks = 2,
  'SELECT 1',
  'SELECT * FROM migration_error_actor_retention_fk_conflict'
);
PREPARE assert_actor_retention_fks_stmt FROM @assert_actor_retention_fks;
EXECUTE assert_actor_retention_fks_stmt;
DEALLOCATE PREPARE assert_actor_retention_fks_stmt;

SET @valid_plan_retention_fks = (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND DELETE_RULE = 'RESTRICT'
    AND CONSTRAINT_NAME IN (
      'fk_company_subscriptions_plan',
      'fk_subscription_periods_plan',
      'fk_subscription_events_old_plan',
      'fk_subscription_events_new_plan'
    )
);
SET @assert_plan_retention_fks = IF(
  @valid_plan_retention_fks = 4,
  'SELECT 1',
  'SELECT * FROM migration_error_plan_retention_fk_conflict'
);
PREPARE assert_plan_retention_fks_stmt FROM @assert_plan_retention_fks;
EXECUTE assert_plan_retention_fks_stmt;
DEALLOCATE PREPARE assert_plan_retention_fks_stmt;

-- Protect existing tenants: create one non-expiring active subscription per
-- current company without changing companies.plan_id or any existing record.
INSERT INTO company_subscriptions (
  company_id,
  plan_id,
  status,
  billing_cycle,
  subscription_start_at,
  activated_at,
  activation_source,
  auto_renew
)
SELECT
  c.id,
  c.plan_id,
  'active',
  'none',
  COALESCE(c.created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  'legacy_migration',
  0
FROM companies c
ON DUPLICATE KEY UPDATE company_id = VALUES(company_id);

-- Record the initial legacy-active period once. A NULL end date intentionally
-- means the migration itself does not expire or suspend any existing company.
INSERT INTO subscription_periods (
  subscription_id,
  company_id,
  plan_id,
  period_type,
  billing_cycle,
  starts_at,
  ends_at,
  status,
  source_key,
  staff_limit_snapshot,
  user_limit_snapshot,
  price_snapshot,
  currency
)
SELECT
  cs.id,
  cs.company_id,
  cs.plan_id,
  'paid',
  'none',
  cs.subscription_start_at,
  NULL,
  'active',
  'legacy-foundation',
  p.max_staff,
  p.max_users,
  p.price,
  'INR'
FROM company_subscriptions cs
LEFT JOIN plans p ON p.id = cs.plan_id
WHERE cs.activation_source = 'legacy_migration'
  AND NOT EXISTS (
    SELECT 1
    FROM subscription_periods sp
    WHERE sp.subscription_id = cs.id
      AND sp.source_key = 'legacy-foundation'
  );

INSERT INTO subscription_events (
  subscription_id,
  company_id,
  event_type,
  from_status,
  to_status,
  old_plan_id,
  new_plan_id,
  effective_at,
  actor_type,
  reason,
  metadata,
  request_id
)
SELECT
  cs.id,
  cs.company_id,
  'legacy_subscription_created',
  NULL,
  'active',
  NULL,
  cs.plan_id,
  cs.activated_at,
  'system',
  'Existing company protected during subscription foundation migration',
  JSON_OBJECT('non_expiring', TRUE, 'source', 'legacy_migration'),
  CONCAT('subscription-foundation-company-', cs.company_id)
FROM company_subscriptions cs
WHERE cs.activation_source = 'legacy_migration'
  AND NOT EXISTS (
    SELECT 1
    FROM subscription_events se
    WHERE se.subscription_id = cs.id
      AND se.request_id = CONCAT('subscription-foundation-company-', cs.company_id)
  );
