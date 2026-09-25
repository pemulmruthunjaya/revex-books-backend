-- RevEx Books TR-1A: user access and password-reset schema prerequisite.
-- MySQL 8; additive and idempotent. Run only through the controlled migration process.
-- Owns only columns consumed by authentication, staff access, and password reset.

SET @schema_name = DATABASE();
SET @users_before = (SELECT COUNT(*) FROM users);

SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='access_role'), 'DO 0', 'ALTER TABLE users ADD COLUMN access_role VARCHAR(30) NOT NULL DEFAULT ''sales''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='permissions'), 'DO 0', 'ALTER TABLE users ADD COLUMN permissions LONGTEXT NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='is_active'), 'DO 0', 'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='last_login_at'), 'DO 0', 'ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='must_change_password'), 'DO 0', 'ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='password_reset_token_hash'), 'DO 0', 'ALTER TABLE users ADD COLUMN password_reset_token_hash CHAR(64) NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='password_reset_expires_at'), 'DO 0', 'ALTER TABLE users ADD COLUMN password_reset_expires_at DATETIME NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='password_changed_at'), 'DO 0', 'ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @reset_hash_index_exists = (SELECT EXISTS(
  SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users'
    AND COLUMN_NAME='password_reset_token_hash'
));
SET @ddl = IF(@reset_hash_index_exists=1, 'DO 0', 'ALTER TABLE users ADD INDEX idx_users_password_reset_token_hash (password_reset_token_hash)');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @users_after = (SELECT COUNT(*) FROM users);
SELECT @users_before AS users_before, @users_after AS users_after,
       @users_before=@users_after AS users_unchanged;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users'
  AND COLUMN_NAME IN (
    'access_role','permissions','is_active','last_login_at','must_change_password',
    'password_reset_token_hash','password_reset_expires_at','password_changed_at'
  )
ORDER BY ORDINAL_POSITION;
