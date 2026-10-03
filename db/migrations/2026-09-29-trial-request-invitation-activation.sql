-- TR-1B trial request, approval, invitation and activation foundation.
-- Additive only. No request, company, user, subscription or invitation rows are created.
-- Any incompatible pre-existing object is rejected by the final schema assertions.
SET @schema_name = DATABASE();

SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='activation_required'), 'DO 0', 'ALTER TABLE users ADD COLUMN activation_required TINYINT(1) NOT NULL DEFAULT 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='users' AND COLUMN_NAME='activated_at'), 'DO 0', 'ALTER TABLE users ADD COLUMN activated_at DATETIME(6) NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS trial_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_reference VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  company_name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NOT NULL,
  mobile VARCHAR(16) NOT NULL,
  city VARCHAR(100) NOT NULL,
  country CHAR(2) NOT NULL,
  business_type VARCHAR(40) NOT NULL,
  note VARCHAR(500) NULL,
  privacy_communications_consent TINYINT(1) NOT NULL,
  privacy_policy_version VARCHAR(40) NOT NULL,
  consented_at DATETIME(6) NOT NULL,
  client_ip_hash BINARY(32) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  approved_by_platform_admin_id BIGINT UNSIGNED NULL,
  approved_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_trial_requests_reference (public_reference),
  UNIQUE KEY uq_trial_requests_email (email), UNIQUE KEY uq_trial_requests_mobile (mobile),
  KEY idx_trial_requests_status_created (status,created_at),
  CONSTRAINT fk_trial_requests_approver FOREIGN KEY (approved_by_platform_admin_id) REFERENCES platform_admins(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_trial_requests_status CHECK (status IN ('pending','approved','suppressed')),
  CONSTRAINT chk_trial_requests_consent CHECK (privacy_communications_consent=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trial_request_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  intent_hash BINARY(32) NOT NULL,
  response_reference VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  trial_request_id BIGINT UNSIGNED NULL,
  client_ip_hash BINARY(32) NOT NULL,
  result_code VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_trial_request_submission_key (idempotency_key),
  UNIQUE KEY uq_trial_request_submission_response (response_reference),
  KEY idx_trial_request_submission_ip_time (client_ip_hash,created_at),
  KEY idx_trial_request_submission_request (trial_request_id),
  CONSTRAINT fk_trial_request_submission_request FOREIGN KEY (trial_request_id) REFERENCES trial_requests(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_trial_request_submission_status CHECK (status IN ('in_flight','accepted','suppressed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trial_request_rate_buckets (
  client_ip_hash BINARY(32) NOT NULL,
  bucket_number BIGINT UNSIGNED NOT NULL,
  request_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (client_ip_hash,bucket_number),
  CONSTRAINT chk_trial_request_rate_count CHECK (request_count<=5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trial_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trial_request_id BIGINT UNSIGNED NOT NULL,
  company_id INT NOT NULL,
  owner_user_id INT NOT NULL,
  approved_by_platform_admin_id BIGINT UNSIGNED NOT NULL,
  approval_idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approval_intent_hash BINARY(32) NOT NULL,
  status VARCHAR(30) NOT NULL,
  token_hash BINARY(32) NULL,
  token_generation INT UNSIGNED NOT NULL DEFAULT 1,
  token_generated_at DATETIME(6) NOT NULL,
  token_expires_at DATETIME(6) NOT NULL,
  trial_start_at DATETIME(6) NOT NULL,
  trial_end_at DATETIME(6) NOT NULL,
  approved_at DATETIME(6) NOT NULL,
  activated_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  last_sent_at DATETIME(6) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_trial_invitation_request (trial_request_id),
  UNIQUE KEY uq_trial_invitation_company (company_id), UNIQUE KEY uq_trial_invitation_owner (owner_user_id),
  UNIQUE KEY uq_trial_invitation_approval_key (approval_idempotency_key), UNIQUE KEY uq_trial_invitation_token_hash (token_hash),
  CONSTRAINT fk_trial_invitation_request FOREIGN KEY (trial_request_id) REFERENCES trial_requests(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_trial_invitation_company FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_trial_invitation_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_trial_invitation_approver FOREIGN KEY (approved_by_platform_admin_id) REFERENCES platform_admins(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_trial_invitation_status CHECK (status IN ('pending_activation','activated','revoked')),
  CONSTRAINT chk_trial_invitation_expiry CHECK (token_expires_at<=trial_end_at AND token_expires_at>token_generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trial_invitation_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trial_invitation_id BIGINT UNSIGNED NOT NULL,
  operation_type VARCHAR(20) NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  intent_hash BINARY(32) NOT NULL,
  token_generation INT UNSIGNED NOT NULL,
  actor_type VARCHAR(30) NOT NULL,
  platform_admin_id BIGINT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL,
  error_code VARCHAR(60) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_trial_invitation_operation_key (idempotency_key),
  KEY idx_trial_invitation_operations_invitation (trial_invitation_id,created_at),
  CONSTRAINT fk_trial_invitation_operation_invitation FOREIGN KEY (trial_invitation_id) REFERENCES trial_invitations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_trial_invitation_operation_admin FOREIGN KEY (platform_admin_id) REFERENCES platform_admins(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_trial_invitation_operation_type CHECK (operation_type IN ('approve','resend','activate')),
  CONSTRAINT chk_trial_invitation_operation_status CHECK (status IN ('in_flight','accepted','failed','unknown','completed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @required_objects = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@schema_name AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME IN ('trial_requests','trial_request_submissions','trial_request_rate_buckets','trial_invitations','trial_invitation_operations'));
SET @new_table_column_count = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME IN ('trial_requests','trial_request_submissions','trial_request_rate_buckets','trial_invitations','trial_invitation_operations'));
SET @required_columns = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND (
  (TABLE_NAME='users' AND COLUMN_NAME='activation_required' AND COLUMN_TYPE='tinyint(1)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='0' AND EXTRA='') OR
  (TABLE_NAME='users' AND COLUMN_NAME='activated_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='') OR
  (TABLE_NAME='trial_requests' AND (
    (COLUMN_NAME='id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO' AND EXTRA='auto_increment') OR
    (COLUMN_NAME='public_reference' AND COLUMN_TYPE='varchar(32)' AND IS_NULLABLE='NO' AND CHARACTER_SET_NAME='ascii' AND COLLATION_NAME='ascii_bin') OR
    (COLUMN_NAME='full_name' AND COLUMN_TYPE='varchar(100)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='company_name' AND COLUMN_TYPE='varchar(150)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='email' AND COLUMN_TYPE='varchar(254)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='mobile' AND COLUMN_TYPE='varchar(16)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='city' AND COLUMN_TYPE='varchar(100)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='country' AND COLUMN_TYPE='char(2)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='business_type' AND COLUMN_TYPE='varchar(40)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='note' AND COLUMN_TYPE='varchar(500)' AND IS_NULLABLE='YES') OR
    (COLUMN_NAME='privacy_communications_consent' AND COLUMN_TYPE='tinyint(1)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='privacy_policy_version' AND COLUMN_TYPE='varchar(40)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='consented_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='client_ip_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='status' AND COLUMN_TYPE='varchar(30)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='pending') OR (COLUMN_NAME='version' AND COLUMN_TYPE='int unsigned' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='1') OR
    (COLUMN_NAME='approved_by_platform_admin_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES') OR (COLUMN_NAME='approved_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='YES') OR
    (COLUMN_NAME='created_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO' AND EXTRA='DEFAULT_GENERATED') OR (COLUMN_NAME='updated_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO' AND EXTRA LIKE '%on update CURRENT_TIMESTAMP(6)%')
  )) OR
  (TABLE_NAME='trial_request_submissions' AND (
    (COLUMN_NAME='id' AND COLUMN_TYPE='bigint unsigned' AND EXTRA='auto_increment') OR (COLUMN_NAME='idempotency_key' AND COLUMN_TYPE='char(36)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='intent_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='response_reference' AND COLUMN_TYPE='varchar(32)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='trial_request_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES') OR (COLUMN_NAME='client_ip_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='result_code' AND COLUMN_TYPE='varchar(50)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='status' AND COLUMN_TYPE='varchar(20)' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='created_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='updated_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO')
  )) OR
  (TABLE_NAME='trial_request_rate_buckets' AND (
    (COLUMN_NAME='client_ip_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='bucket_number' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO') OR
    (COLUMN_NAME='request_count' AND COLUMN_TYPE='tinyint unsigned' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='0') OR
    (COLUMN_NAME='created_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='updated_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO')
  )) OR
  (TABLE_NAME='trial_invitations' AND COLUMN_NAME IN ('id','trial_request_id','company_id','owner_user_id','approved_by_platform_admin_id','approval_idempotency_key','approval_intent_hash','status','token_hash','token_generation','token_generated_at','token_expires_at','trial_start_at','trial_end_at','approved_at','activated_at','revoked_at','last_sent_at','version','created_at','updated_at')) OR
  (TABLE_NAME='trial_invitation_operations' AND COLUMN_NAME IN ('id','trial_invitation_id','operation_type','idempotency_key','intent_hash','token_generation','actor_type','platform_admin_id','status','error_code','created_at','completed_at','updated_at'))
));
SET @required_indexes = (SELECT COUNT(*) FROM (
  SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(CONCAT(SEQ_IN_INDEX,':',COLUMN_NAME,':',COALESCE(SUB_PART,0)) ORDER BY SEQ_IN_INDEX SEPARATOR ',') cols
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE
) i WHERE (TABLE_NAME,INDEX_NAME,NON_UNIQUE,cols) IN (
  ('trial_requests','PRIMARY',0,'1:id:0'),('trial_requests','uq_trial_requests_reference',0,'1:public_reference:0'),('trial_requests','uq_trial_requests_email',0,'1:email:0'),('trial_requests','uq_trial_requests_mobile',0,'1:mobile:0'),('trial_requests','idx_trial_requests_status_created',1,'1:status:0,2:created_at:0'),('trial_requests','fk_trial_requests_approver',1,'1:approved_by_platform_admin_id:0'),
  ('trial_request_submissions','PRIMARY',0,'1:id:0'),('trial_request_submissions','uq_trial_request_submission_key',0,'1:idempotency_key:0'),('trial_request_submissions','idx_trial_request_submission_ip_time',1,'1:client_ip_hash:0,2:created_at:0'),('trial_request_submissions','idx_trial_request_submission_request',1,'1:trial_request_id:0'),
  ('trial_request_submissions','uq_trial_request_submission_response',0,'1:response_reference:0'),
  ('trial_request_rate_buckets','PRIMARY',0,'1:client_ip_hash:0,2:bucket_number:0'),
  ('trial_invitations','PRIMARY',0,'1:id:0'),('trial_invitations','uq_trial_invitation_request',0,'1:trial_request_id:0'),('trial_invitations','uq_trial_invitation_company',0,'1:company_id:0'),('trial_invitations','uq_trial_invitation_owner',0,'1:owner_user_id:0'),('trial_invitations','uq_trial_invitation_approval_key',0,'1:approval_idempotency_key:0'),('trial_invitations','uq_trial_invitation_token_hash',0,'1:token_hash:0'),('trial_invitations','fk_trial_invitation_approver',1,'1:approved_by_platform_admin_id:0'),
  ('trial_invitation_operations','PRIMARY',0,'1:id:0'),('trial_invitation_operations','uq_trial_invitation_operation_key',0,'1:idempotency_key:0'),('trial_invitation_operations','idx_trial_invitation_operations_invitation',1,'1:trial_invitation_id:0,2:created_at:0'),('trial_invitation_operations','fk_trial_invitation_operation_admin',1,'1:platform_admin_id:0')
));
SET @actual_index_count = (SELECT COUNT(*) FROM (SELECT TABLE_NAME,INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME IN ('trial_requests','trial_request_submissions','trial_request_rate_buckets','trial_invitations','trial_invitation_operations') GROUP BY TABLE_NAME,INDEX_NAME) indexes_present);
SET @required_foreign_keys = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=@schema_name AND (k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE) IN (
 ('trial_requests','fk_trial_requests_approver','approved_by_platform_admin_id','platform_admins','id','RESTRICT','RESTRICT'),('trial_request_submissions','fk_trial_request_submission_request','trial_request_id','trial_requests','id','RESTRICT','RESTRICT'),
 ('trial_invitations','fk_trial_invitation_request','trial_request_id','trial_requests','id','RESTRICT','RESTRICT'),('trial_invitations','fk_trial_invitation_company','company_id','companies','id','RESTRICT','RESTRICT'),('trial_invitations','fk_trial_invitation_owner','owner_user_id','users','id','RESTRICT','RESTRICT'),('trial_invitations','fk_trial_invitation_approver','approved_by_platform_admin_id','platform_admins','id','RESTRICT','RESTRICT'),
 ('trial_invitation_operations','fk_trial_invitation_operation_invitation','trial_invitation_id','trial_invitations','id','RESTRICT','RESTRICT'),('trial_invitation_operations','fk_trial_invitation_operation_admin','platform_admin_id','platform_admins','id','RESTRICT','RESTRICT')
));
SET @actual_foreign_keys = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=@schema_name AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN ('trial_requests','trial_request_submissions','trial_request_rate_buckets','trial_invitations','trial_invitation_operations'));
SET @required_invitation_types = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND (
 (TABLE_NAME='trial_invitations' AND (
  (COLUMN_NAME='id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO' AND EXTRA='auto_increment') OR (COLUMN_NAME='trial_request_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME IN ('company_id','owner_user_id') AND COLUMN_TYPE='int' AND IS_NULLABLE='NO') OR (COLUMN_NAME='approved_by_platform_admin_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='approval_idempotency_key' AND COLUMN_TYPE='char(36)' AND IS_NULLABLE='NO' AND CHARACTER_SET_NAME='ascii' AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='approval_intent_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='status' AND COLUMN_TYPE='varchar(30)' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='token_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='YES') OR (COLUMN_NAME='token_generation' AND COLUMN_TYPE='int unsigned' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='1') OR
  (COLUMN_NAME IN ('token_generated_at','token_expires_at','trial_start_at','trial_end_at','approved_at','last_sent_at') AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME IN ('activated_at','revoked_at') AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='YES') OR (COLUMN_NAME='version' AND COLUMN_TYPE='int unsigned' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='1') OR
  (COLUMN_NAME='created_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='CURRENT_TIMESTAMP(6)') OR
  (COLUMN_NAME='updated_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='CURRENT_TIMESTAMP(6)' AND EXTRA LIKE '%on update CURRENT_TIMESTAMP(6)%')
 )) OR
 (TABLE_NAME='trial_invitation_operations' AND (
  (COLUMN_NAME='id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO' AND EXTRA='auto_increment') OR (COLUMN_NAME='trial_invitation_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='operation_type' AND COLUMN_TYPE='varchar(20)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='idempotency_key' AND COLUMN_TYPE='char(36)' AND IS_NULLABLE='YES' AND CHARACTER_SET_NAME='ascii' AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='intent_hash' AND COLUMN_TYPE='binary(32)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='token_generation' AND COLUMN_TYPE='int unsigned' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='actor_type' AND COLUMN_TYPE='varchar(30)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='platform_admin_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='status' AND COLUMN_TYPE='varchar(20)' AND IS_NULLABLE='NO') OR (COLUMN_NAME='error_code' AND COLUMN_TYPE='varchar(60)' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='created_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='CURRENT_TIMESTAMP(6)') OR (COLUMN_NAME='completed_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='updated_at' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='CURRENT_TIMESTAMP(6)' AND EXTRA LIKE '%on update CURRENT_TIMESTAMP(6)%')
 ))
));
SET @required_checks = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@schema_name AND (
 (CONSTRAINT_NAME='chk_trial_requests_status' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='statusin''pending'',''approved'',''suppressed''') OR
 (CONSTRAINT_NAME='chk_trial_requests_consent' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='privacy_communications_consent=1') OR
 (CONSTRAINT_NAME='chk_trial_request_submission_status' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='statusin''in_flight'',''accepted'',''suppressed''') OR
 (CONSTRAINT_NAME='chk_trial_request_rate_count' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='request_count<=5') OR
 (CONSTRAINT_NAME='chk_trial_invitation_status' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='statusin''pending_activation'',''activated'',''revoked''') OR
 (CONSTRAINT_NAME='chk_trial_invitation_expiry' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='token_expires_at<=trial_end_atandtoken_expires_at>token_generated_at') OR
 (CONSTRAINT_NAME='chk_trial_invitation_operation_type' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='operation_typein''approve'',''resend'',''activate''') OR
 (CONSTRAINT_NAME='chk_trial_invitation_operation_status' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE,CONCAT(CHAR(92),CHAR(39)),CHAR(39)),'_utf8mb4',''),'`',''),' ',''),'(',''),')',''))='statusin''in_flight'',''accepted'',''failed'',''unknown'',''completed''')
));
SET @actual_checks = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@schema_name AND CONSTRAINT_TYPE='CHECK' AND TABLE_NAME IN ('trial_requests','trial_request_submissions','trial_request_rate_buckets','trial_invitations','trial_invitation_operations'));
SET @ddl = IF(@required_objects=5 AND @new_table_column_count=69 AND @required_columns=71 AND @required_indexes=23 AND @actual_index_count=23 AND @required_foreign_keys=8 AND @actual_foreign_keys=8 AND @required_invitation_types=34 AND @required_checks=8 AND @actual_checks=8, 'DO 0', 'SELECT * FROM migration_error_tr1b_schema_incompatible');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
