-- Canonical backend storage for demo requests submitted through revexbooks.com.
-- This table intentionally has no company_id: website leads exist before a
-- SaaS company/customer account is created and later provisioned.

CREATE TABLE IF NOT EXISTS demo_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(100) NOT NULL,
  company_name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NOT NULL,
  mobile VARCHAR(30) NOT NULL,
  city VARCHAR(100) NULL,
  business_type VARCHAR(100) NULL,
  preferred_demo_date DATE NULL,
  preferred_time TIME NULL,
  number_of_users INT UNSIGNED NULL,
  message TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  source VARCHAR(32) NOT NULL DEFAULT 'website',
  notification_email_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  acknowledgement_email_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  notification_email_error VARCHAR(500) NULL,
  acknowledgement_email_error VARCHAR(500) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_demo_requests_created_at (created_at),
  KEY idx_demo_requests_status (status),
  KEY idx_demo_requests_email (email),
  CONSTRAINT chk_demo_requests_notification_email_status
    CHECK (notification_email_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT chk_demo_requests_acknowledgement_email_status
    CHECK (acknowledgement_email_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT chk_demo_requests_number_of_users
    CHECK (number_of_users IS NULL OR number_of_users BETWEEN 1 AND 100000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CREATE TABLE IF NOT EXISTS alone can silently accept an incompatible table.
-- Validate the complete contract required by the website before continuing.
DROP PROCEDURE IF EXISTS revex_validate_demo_requests;
DELIMITER $$
CREATE PROCEDURE revex_validate_demo_requests()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'demo_requests'
      AND ENGINE = 'InnoDB'
      AND TABLE_COLLATION = 'utf8mb4_unicode_ci'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Incompatible demo_requests table engine or collation';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'demo_requests'
  ) <> 19 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Incompatible demo_requests column count';
  END IF;

  IF EXISTS (
    SELECT expected.COLUMN_NAME
    FROM (
      SELECT 'id' COLUMN_NAME, 'bigint unsigned' COLUMN_TYPE, 'NO' IS_NULLABLE, NULL COLUMN_DEFAULT, 'auto_increment' EXTRA, NULL DATETIME_PRECISION
      UNION ALL SELECT 'full_name', 'varchar(100)', 'NO', NULL, '', NULL
      UNION ALL SELECT 'company_name', 'varchar(150)', 'NO', NULL, '', NULL
      UNION ALL SELECT 'email', 'varchar(254)', 'NO', NULL, '', NULL
      UNION ALL SELECT 'mobile', 'varchar(30)', 'NO', NULL, '', NULL
      UNION ALL SELECT 'city', 'varchar(100)', 'YES', NULL, '', NULL
      UNION ALL SELECT 'business_type', 'varchar(100)', 'YES', NULL, '', NULL
      UNION ALL SELECT 'preferred_demo_date', 'date', 'YES', NULL, '', NULL
      UNION ALL SELECT 'preferred_time', 'time', 'YES', NULL, '', 0
      UNION ALL SELECT 'number_of_users', 'int unsigned', 'YES', NULL, '', NULL
      UNION ALL SELECT 'message', 'text', 'YES', NULL, '', NULL
      UNION ALL SELECT 'status', 'varchar(32)', 'NO', 'new', '', NULL
      UNION ALL SELECT 'source', 'varchar(32)', 'NO', 'website', '', NULL
      UNION ALL SELECT 'notification_email_status', 'varchar(16)', 'NO', 'pending', '', NULL
      UNION ALL SELECT 'acknowledgement_email_status', 'varchar(16)', 'NO', 'pending', '', NULL
      UNION ALL SELECT 'notification_email_error', 'varchar(500)', 'YES', NULL, '', NULL
      UNION ALL SELECT 'acknowledgement_email_error', 'varchar(500)', 'YES', NULL, '', NULL
      UNION ALL SELECT 'created_at', 'timestamp(3)', 'NO', 'CURRENT_TIMESTAMP(3)', 'DEFAULT_GENERATED', 3
      UNION ALL SELECT 'updated_at', 'timestamp(3)', 'NO', 'CURRENT_TIMESTAMP(3)', 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)', 3
    ) expected
    LEFT JOIN information_schema.COLUMNS actual
      ON actual.TABLE_SCHEMA = DATABASE()
     AND actual.TABLE_NAME = 'demo_requests'
     AND actual.COLUMN_NAME = expected.COLUMN_NAME
    WHERE actual.COLUMN_NAME IS NULL
       OR LOWER(actual.COLUMN_TYPE) <> LOWER(expected.COLUMN_TYPE)
       OR actual.IS_NULLABLE <> expected.IS_NULLABLE
       OR NOT (actual.COLUMN_DEFAULT <=> expected.COLUMN_DEFAULT)
       OR LOWER(actual.EXTRA) <> LOWER(expected.EXTRA)
       OR NOT (actual.DATETIME_PRECISION <=> expected.DATETIME_PRECISION)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Incompatible demo_requests column definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'id' AND SEQ_IN_INDEX = 1 AND NON_UNIQUE = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND INDEX_NAME = 'idx_demo_requests_created_at' AND COLUMN_NAME = 'created_at' AND SEQ_IN_INDEX = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND INDEX_NAME = 'idx_demo_requests_status' AND COLUMN_NAME = 'status' AND SEQ_IN_INDEX = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND INDEX_NAME = 'idx_demo_requests_email' AND COLUMN_NAME = 'email' AND SEQ_IN_INDEX = 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Incompatible or missing demo_requests index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND CONSTRAINT_NAME = 'chk_demo_requests_notification_email_status' AND CONSTRAINT_TYPE = 'CHECK'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND CONSTRAINT_NAME = 'chk_demo_requests_acknowledgement_email_status' AND CONSTRAINT_TYPE = 'CHECK'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
      AND CONSTRAINT_NAME = 'chk_demo_requests_number_of_users' AND CONSTRAINT_TYPE = 'CHECK'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Incompatible or missing demo_requests check constraint';
  END IF;
END$$
DELIMITER ;

CALL revex_validate_demo_requests();
DROP PROCEDURE revex_validate_demo_requests;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests';

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
ORDER BY ORDINAL_POSITION;

SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_requests'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
