-- Immutable inventory valuation v1. Review artifact; do not SOURCE directly.
-- The explicit SHA-pinned runner performs compatibility preflight before DDL.

-- IV_OBJECT table iv_operations
CREATE TABLE `iv_operations` (`company_id` bigint unsigned NOT NULL,
`operation_key` varchar(128) NOT NULL,
`actor_id` bigint unsigned NOT NULL,
`action` varchar(40) NOT NULL,
`fingerprint` char(64) NOT NULL,
`result` json NOT NULL,
PRIMARY KEY (`company_id`,`operation_key`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- IV_OBJECT table iv_product_locks
CREATE TABLE `iv_product_locks` (`company_id` bigint unsigned NOT NULL,
`product_id` bigint unsigned NOT NULL,
PRIMARY KEY (`company_id`,`product_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- IV_OBJECT table iv_date_sequences
CREATE TABLE `iv_date_sequences` (`company_id` bigint unsigned NOT NULL,
`product_id` bigint unsigned NOT NULL,
`effective_date` date NOT NULL,
`last_sequence` bigint unsigned NOT NULL,
PRIMARY KEY (`company_id`,`product_id`,`effective_date`),
CONSTRAINT `iv_sequence_scope` FOREIGN KEY (`company_id`,`product_id`) REFERENCES `iv_product_locks` (`company_id`,`product_id`) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- IV_OBJECT table iv_records
CREATE TABLE `iv_records` (`company_id` bigint unsigned NOT NULL,
`product_id` bigint unsigned NOT NULL,
`id` char(36) NOT NULL,
`kind` enum('ACQUISITION','COMPONENT','COMPONENT_REVISION','COST','SUBMISSION','APPROVAL','REJECTION','STOCK_CORRECTION','CORRECTION_APPROVAL','STOCK_REVERSAL','STOCK_REPLACEMENT','OPENING','RECEIPT','ISSUE','CUSTOMER_RETURN','VENDOR_RETURN','COST_REVERSAL','COST_REPLACEMENT','BILL_LINK','REPLAY') NOT NULL,
`effective_date` date NOT NULL,
`sequence` bigint unsigned NOT NULL,
`source_id` char(36) NULL,
`supersedes_id` char(36) NULL,
`target_id` char(36) NULL,
`document_type` varchar(30) NOT NULL,
`document_id` varchar(100) NOT NULL,
`source_line` varchar(100) NOT NULL,
`acquisition_key` char(64) NULL,
`idempotency_key` varchar(128) NOT NULL,
`fingerprint` char(64) NOT NULL,
`payload` json NOT NULL,
`creator_id` bigint unsigned NOT NULL,
`event_key` char(64) NULL,
PRIMARY KEY (`company_id`,`product_id`,`id`),
UNIQUE KEY `iv_global_uuid` (`id`),
UNIQUE KEY `iv_event_identity` (`company_id`,`product_id`,`event_key`),
UNIQUE KEY `iv_record_key` (`company_id`,`product_id`,`idempotency_key`),
UNIQUE KEY `iv_acquisition_identity` (`company_id`,`acquisition_key`),
UNIQUE KEY `iv_record_sequence` (`company_id`,`product_id`,`effective_date`,`sequence`),
UNIQUE KEY `iv_revision_successor` (`company_id`,`product_id`,`supersedes_id`),
KEY `iv_source` (`company_id`,`product_id`,`source_id`),
KEY `iv_target` (`company_id`,`product_id`,`target_id`),
CONSTRAINT `iv_record_scope` FOREIGN KEY (`company_id`,`product_id`) REFERENCES `iv_product_locks` (`company_id`,`product_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `iv_record_source` FOREIGN KEY (`company_id`,`product_id`,`source_id`) REFERENCES `iv_records` (`company_id`,`product_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `iv_record_supersedes` FOREIGN KEY (`company_id`,`product_id`,`supersedes_id`) REFERENCES `iv_records` (`company_id`,`product_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `iv_record_target` FOREIGN KEY (`company_id`,`product_id`,`target_id`) REFERENCES `iv_records` (`company_id`,`product_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- IV_OBJECT trigger iv_operations_validate_insert
CREATE TRIGGER iv_operations_validate_insert BEFORE INSERT ON iv_operations FOR EACH ROW BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE id=NEW.company_id) OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND company_id=NEW.company_id AND is_active=1) OR NEW.fingerprint NOT REGEXP '^[0-9a-f]{64}$' OR CHAR_LENGTH(TRIM(NEW.operation_key))=0 OR CHAR_LENGTH(TRIM(NEW.action))=0 OR JSON_TYPE(NEW.result)<>'OBJECT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OPERATION_INVALID'; END IF; END;

-- IV_OBJECT trigger iv_product_locks_validate_insert
CREATE TRIGGER iv_product_locks_validate_insert BEFORE INSERT ON iv_product_locks FOR EACH ROW BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE id=NEW.company_id) OR NOT EXISTS (SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_IDENTITY_INVALID'; END IF; END;

-- IV_OBJECT trigger iv_product_locks_validate_update
CREATE TRIGGER iv_product_locks_validate_update BEFORE UPDATE ON iv_product_locks FOR EACH ROW BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE id=NEW.company_id) OR NOT EXISTS (SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_IDENTITY_INVALID'; END IF; END;

-- IV_OBJECT trigger iv_operations_no_update
CREATE TRIGGER iv_operations_no_update BEFORE UPDATE ON iv_operations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IV_IMMUTABLE_EVIDENCE';

-- IV_OBJECT trigger iv_operations_no_delete
CREATE TRIGGER iv_operations_no_delete BEFORE DELETE ON iv_operations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IV_IMMUTABLE_EVIDENCE';

-- IV_OBJECT trigger iv_records_validate_insert
CREATE TRIGGER iv_records_validate_insert BEFORE INSERT ON iv_records FOR EACH ROW BEGIN
  DECLARE source_kind VARCHAR(30);
  DECLARE target_kind VARCHAR(30);
  DECLARE prior_kind VARCHAR(30);
  DECLARE prior_source CHAR(36);
  DECLARE locked_company BIGINT UNSIGNED;
  DECLARE applied_revision CHAR(36);
  SELECT id INTO locked_company FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id)
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id=NEW.company_id)
     OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.creator_id AND company_id=NEW.company_id AND is_active=1)
     OR NEW.id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR NEW.sequence=0 OR CHAR_LENGTH(TRIM(NEW.document_type))=0 OR CHAR_LENGTH(TRIM(NEW.document_id))=0 OR CHAR_LENGTH(TRIM(NEW.source_line))=0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_IDENTITY_INVALID';
  END IF;
  IF NEW.kind IN ('ACQUISITION','COMPONENT') THEN
    IF NEW.source_id IS NOT NULL OR NEW.target_id IS NOT NULL OR NEW.supersedes_id IS NOT NULL OR NEW.acquisition_key IS NULL
       OR NEW.acquisition_key <> SHA2(CONCAT(HEX(NEW.document_type),':',HEX(NEW.document_id),':',HEX(NEW.source_line)),256)
       OR (NEW.kind='ACQUISITION' AND NEW.document_type NOT IN ('GRN','SUPPLIER','OPENING'))
       OR (NEW.kind='COMPONENT' AND NEW.document_type<>'COST_COMPONENT') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_ACQUISITION_IDENTITY_INVALID';
    END IF;
  ELSEIF NEW.acquisition_key IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_ACQUISITION_IDENTITY_INVALID';
  END IF;
  IF NEW.source_id IS NOT NULL THEN
    SELECT kind INTO source_kind FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND id=NEW.source_id;
    IF source_kind IS NULL OR (NEW.kind='COMPONENT_REVISION' AND source_kind<>'COMPONENT') OR (NEW.kind<>'COMPONENT_REVISION' AND source_kind<>'ACQUISITION') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SOURCE_TYPE_INVALID'; END IF;
  END IF;
  IF NEW.kind IN ('COMPONENT_REVISION','COST','SUBMISSION','APPROVAL','REJECTION','STOCK_CORRECTION','CORRECTION_APPROVAL','STOCK_REVERSAL','STOCK_REPLACEMENT','OPENING','RECEIPT','COST_REVERSAL','COST_REPLACEMENT','BILL_LINK') AND NEW.source_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SOURCE_REQUIRED';
  END IF;
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT kind,source_id INTO prior_kind,prior_source FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND id=NEW.supersedes_id;
    IF prior_kind IS NULL OR NEW.id=NEW.supersedes_id
       OR (NEW.kind='COMPONENT_REVISION' AND (prior_kind NOT IN ('COMPONENT','COMPONENT_REVISION') OR NOT(COALESCE(prior_source,NEW.supersedes_id) <=> NEW.source_id)))
       OR (NEW.kind<>'COMPONENT_REVISION' AND (prior_kind <> NEW.kind OR (NEW.kind='COST' AND NOT(prior_source <=> NEW.source_id)) OR NEW.kind NOT IN ('COST','BILL_LINK'))) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVISION_SOURCE_MISMATCH';
    END IF;
  END IF;
  IF NEW.target_id IS NOT NULL THEN
    SELECT kind INTO target_kind FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND id=NEW.target_id;
    IF target_kind IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_REQUIRED'; END IF;
  END IF;
  IF NEW.kind IN ('SUBMISSION','APPROVAL','REJECTION','OPENING','RECEIPT','COST_REVERSAL','BILL_LINK') THEN
    IF NEW.target_id IS NULL OR target_kind <> 'COST'
       OR NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.target_id AND source_id=NEW.source_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID';
    END IF;
  END IF;
  IF NEW.kind='COST_REPLACEMENT' AND (NEW.target_id IS NULL OR target_kind NOT IN ('OPENING','RECEIPT')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
  IF NEW.kind='COST_REPLACEMENT' OR (NEW.kind='COST_REVERSAL' AND JSON_EXTRACT(NEW.payload,'$.movement_id') IS NOT NULL) THEN
    SELECT COALESCE((SELECT JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.revision_id')) FROM iv_records c WHERE c.company_id=NEW.company_id AND c.product_id=NEW.product_id AND c.target_id=r.id AND c.kind IN ('COST_REPLACEMENT','STOCK_REPLACEMENT') ORDER BY c.effective_date DESC,c.sequence DESC,c.id DESC LIMIT 1),JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revision_id')))
      INTO applied_revision FROM iv_records r WHERE r.company_id=NEW.company_id AND r.product_id=NEW.product_id AND r.kind IN ('OPENING','RECEIPT') AND r.id=IF(NEW.kind='COST_REPLACEMENT',NEW.target_id,JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.movement_id')));
    IF applied_revision IS NULL OR NOT EXISTS (SELECT 1 FROM iv_records WHERE id=applied_revision AND kind='COST' AND source_id=NEW.source_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVISION_SOURCE_MISMATCH'; END IF;
    IF NEW.kind='COST_REVERSAL' AND NEW.target_id<>applied_revision THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVISION_CONFLICT'; END IF;
  END IF;
  IF NEW.kind='COST_REVERSAL' AND JSON_EXTRACT(NEW.payload,'$.movement_id') IS NULL AND NOT EXISTS (SELECT 1 FROM iv_records r WHERE r.company_id=NEW.company_id AND r.product_id=NEW.product_id AND r.source_id=NEW.source_id AND r.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.bill_link_id')) AND r.kind='BILL_LINK' AND r.target_id=NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVERSAL_REQUIRED'; END IF;
  IF NEW.kind IN ('STOCK_CORRECTION','STOCK_REVERSAL','STOCK_REPLACEMENT') AND (NEW.target_id IS NULL OR target_kind<>'RECEIPT' OR NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.target_id AND source_id=NEW.source_id AND document_type='SUPPLIER')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
  IF NEW.kind='CORRECTION_APPROVAL' AND (NEW.target_id IS NULL OR target_kind<>'STOCK_CORRECTION' OR NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.target_id AND source_id=NEW.source_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
  IF NEW.kind='CUSTOMER_RETURN' AND (NEW.target_id IS NULL OR target_kind<>'ISSUE') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
  IF NEW.kind='VENDOR_RETURN' AND (NEW.target_id IS NULL OR target_kind<>'RECEIPT') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
  IF NEW.kind IN ('APPROVAL','REJECTION','CORRECTION_APPROVAL') AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.creator_id AND company_id=NEW.company_id AND is_active=1 AND role='owner') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OWNER_APPROVAL_REQUIRED'; END IF;
  IF NEW.kind IN ('APPROVAL','REJECTION') AND NOT EXISTS (SELECT 1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND kind='SUBMISSION' AND target_id=NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SUBMISSION_REQUIRED'; END IF;
  IF NEW.kind='APPROVAL' AND EXISTS (SELECT 1 FROM iv_records c INNER JOIN iv_records a ON a.id=c.source_id WHERE c.id=NEW.target_id AND a.document_type='OPENING' AND c.creator_id=NEW.creator_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SEPARATE_OPENING_APPROVER_REQUIRED'; END IF;
  IF NEW.kind IN ('OPENING','RECEIPT','BILL_LINK') AND NOT EXISTS (SELECT 1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND kind='APPROVAL' AND target_id=NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COST_NOT_APPROVED'; END IF;
  IF NEW.kind IN ('OPENING','BILL_LINK') AND NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.target_id AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.state'))='FINAL') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_FINAL_COST_REQUIRED'; END IF;
  IF NEW.kind IN ('COST','SUBMISSION','APPROVAL','REJECTION','OPENING','RECEIPT','COST_REVERSAL','COST_REPLACEMENT','STOCK_CORRECTION','CORRECTION_APPROVAL','STOCK_REVERSAL','STOCK_REPLACEMENT') AND NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.source_id AND document_type=NEW.document_type AND document_id=NEW.document_id AND source_line=NEW.source_line) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SOURCE_LINE_MISMATCH'; END IF;
  IF NEW.kind='BILL_LINK' AND (NEW.document_type<>'BILL' OR JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.revision_id'))<>NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SOURCE_LINE_MISMATCH'; END IF;
  IF NEW.kind IN ('OPENING','RECEIPT','BILL_LINK') AND NOT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.revision_id')),'') <=> NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REQUIRED_REFERENCE'; END IF;
  IF NEW.kind='COST' AND NEW.supersedes_id IS NULL AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND source_id=NEW.source_id AND kind='COST') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVISION_CONFLICT'; END IF;
  IF NEW.kind='ACQUISITION' AND NEW.document_type='GRN' AND NOT EXISTS (SELECT 1 FROM goods_receipt_items gri INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id WHERE gri.company_id=NEW.company_id AND gri.product_id=NEW.product_id AND CAST(gri.id AS CHAR)=NEW.source_line AND CAST(gr.id AS CHAR)=NEW.document_id AND gr.status='Draft') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_GRN_LINE_NOT_DRAFT'; END IF;
  IF NEW.kind='BILL_LINK' AND NOT EXISTS (SELECT 1 FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=NEW.company_id AND bi.product_id=NEW.product_id AND CAST(b.id AS CHAR)=NEW.document_id AND CAST(bi.id AS CHAR)=NEW.source_line AND bi.quantity=CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.quantity')) AS DECIMAL(14,6))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_BILL_LINE_MISMATCH'; END IF;
  IF NEW.kind='BILL_LINK' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.quantity')),'') NOT REGEXP '^(0|[1-9][0-9]{0,7})([.][0-9]{1,2}0{0,4})?$' OR NOT EXISTS (SELECT 1 FROM iv_records c WHERE c.id=NEW.target_id AND c.kind='COST' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.quantity')) AS DECIMAL(14,6))=CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.quantity')) AS DECIMAL(14,6)))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_BILL_COST_QUANTITY_MISMATCH'; END IF;
  IF NEW.kind='BILL_LINK' AND NEW.supersedes_id IS NULL AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND kind='BILL_LINK' AND source_id=NEW.source_id AND document_id=NEW.document_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVISION_CONFLICT'; END IF;
  IF NEW.kind='BILL_LINK' AND NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.supersedes_id AND document_id=NEW.document_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVISION_SOURCE_MISMATCH'; END IF;
  IF NEW.kind='BILL_LINK' AND NEW.supersedes_id IS NOT NULL AND NOT(prior_source <=> NEW.source_id) AND NOT EXISTS (SELECT 1 FROM iv_records c INNER JOIN iv_records a ON a.target_id=c.id AND a.kind='CORRECTION_APPROVAL' WHERE c.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.correction_id')) AND c.company_id=NEW.company_id AND c.product_id=NEW.product_id AND c.kind='STOCK_CORRECTION' AND JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.previous_bill_link_id'))=NEW.supersedes_id AND JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.new_source_id'))=NEW.source_id AND JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.new_revision_id'))=NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_CORRECTION_NOT_APPROVED'; END IF;
  IF NEW.kind='RECEIPT' AND NOT EXISTS (SELECT 1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND kind='OPENING' AND effective_date<=NEW.effective_date) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OPENING_EVIDENCE_REQUIRED'; END IF;
  IF NEW.kind='OPENING' AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND kind IN ('OPENING','RECEIPT','ISSUE')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OPENING_NOT_FIRST'; END IF;
  IF NEW.kind='OPENING' AND NOT EXISTS (SELECT 1 FROM iv_records a INNER JOIN iv_records c ON c.id=NEW.target_id AND c.source_id=a.id WHERE a.id=NEW.source_id AND a.document_type='OPENING' AND JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.basis'))='OPENING') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OPENING_SOURCE_INVALID'; END IF;
  IF NEW.kind='COST' THEN
    IF COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.state')),'') NOT IN ('PROVISIONAL','FINAL')
       OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.currency')),'') <> 'INR'
       OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.quantity')),'') NOT REGEXP '^(0|[1-9][0-9]{0,7})([.][0-9]{1,2}0{0,4})?$' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COST_EVIDENCE_REQUIRED';
    END IF;
    IF NEW.target_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
    IF COALESCE(JSON_TYPE(JSON_EXTRACT(NEW.payload,'$.taxes')),'')<>'ARRAY' OR COALESCE(JSON_TYPE(JSON_EXTRACT(NEW.payload,'$.allocations')),'')<>'ARRAY' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_EXPLICIT_COST_COMPONENTS_REQUIRED'; END IF;
    IF COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.purchase_minor')),'') NOT REGEXP '^(0|[1-9][0-9]{0,29})$' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.total_minor')),'') NOT REGEXP '^(0|[1-9][0-9]{0,29})$' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COST_EVIDENCE_REQUIRED'; END IF;
    IF EXISTS (SELECT 1 FROM JSON_TABLE(NEW.payload,'$.taxes[*]' COLUMNS(classification VARCHAR(30) PATH '$.recoverability')) t WHERE COALESCE(t.classification,'') NOT IN ('RECOVERABLE','NON_RECOVERABLE','UNKNOWN') OR (t.classification='UNKNOWN' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.state'))='FINAL')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TAX_CLASSIFICATION_REQUIRED'; END IF;
    IF EXISTS (
      SELECT 1 FROM JSON_TABLE(JSON_MERGE_PRESERVE(JSON_EXTRACT(NEW.payload,'$.taxes'),JSON_EXTRACT(NEW.payload,'$.allocations')), '$[*]' COLUMNS(component_id CHAR(36) PATH '$.component_id' NULL ON EMPTY)) refs
      LEFT JOIN iv_records c ON c.id=refs.component_id AND c.company_id=NEW.company_id AND c.kind IN ('COMPONENT','COMPONENT_REVISION')
      WHERE c.id IS NULL OR NOT EXISTS (SELECT 1 FROM JSON_TABLE(c.payload,'$.calculated[*]' COLUMNS(acquisition_id CHAR(36) PATH '$.line')) shares WHERE shares.acquisition_id=NEW.source_id)
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_REFERENCE_REQUIRED'; END IF;
    IF (SELECT COUNT(*) FROM JSON_TABLE(JSON_MERGE_PRESERVE(JSON_EXTRACT(NEW.payload,'$.taxes'),JSON_EXTRACT(NEW.payload,'$.allocations')), '$[*]' COLUMNS(component_id CHAR(36) PATH '$.component_id')) refs)
      <> (SELECT COUNT(DISTINCT COALESCE(c.source_id,c.id)) FROM JSON_TABLE(JSON_MERGE_PRESERVE(JSON_EXTRACT(NEW.payload,'$.taxes'),JSON_EXTRACT(NEW.payload,'$.allocations')), '$[*]' COLUMNS(component_id CHAR(36) PATH '$.component_id')) refs INNER JOIN iv_records c ON c.id=refs.component_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_DUPLICATE_COST_COMPONENT'; END IF;
    IF EXISTS (SELECT 1 FROM JSON_TABLE(NEW.payload,'$.taxes[*]' COLUMNS(component_id CHAR(36) PATH '$.component_id',amount_minor VARCHAR(100) PATH '$.amount_minor',recoverability VARCHAR(30) PATH '$.recoverability')) refs INNER JOIN iv_records c ON c.id=refs.component_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.kind'))<>'TAX' OR NOT(COALESCE(refs.recoverability,'') <=> JSON_UNQUOTE(JSON_EXTRACT(c.payload,'$.recoverability'))) OR NOT EXISTS (SELECT 1 FROM JSON_TABLE(c.payload,'$.calculated[*]' COLUMNS(line_id CHAR(36) PATH '$.line',amount_minor VARCHAR(100) PATH '$.amount_minor')) share WHERE share.line_id=NEW.source_id AND share.amount_minor=refs.amount_minor)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_ALLOCATION_MISMATCH'; END IF;
  END IF;
  IF NEW.kind IN ('COMPONENT','COMPONENT_REVISION') THEN
    IF NEW.document_type<>'COST_COMPONENT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_IDENTITY_CONFLICT'; END IF;
    IF COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.basis')),'') NOT IN ('LINE_VALUE','QUANTITY','WEIGHT')
       OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.total_minor')),'') NOT REGEXP '^(0|[1-9][0-9]{0,29})$'
       OR COALESCE(JSON_LENGTH(JSON_EXTRACT(NEW.payload,'$.calculated')),0)=0
       OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.kind')),'') NOT IN ('TRADE_DISCOUNT','SUPPLIER_COST_CREDIT','FREIGHT_INWARD','HANDLING','DIRECT_ACQUISITION','TAX') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_EVIDENCE_REQUIRED';
    END IF;
    IF JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.kind'))='TAX' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.recoverability')),'') NOT IN ('RECOVERABLE','NON_RECOVERABLE','UNKNOWN') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TAX_CLASSIFICATION_REQUIRED'; END IF;
    IF COALESCE(JSON_TYPE(JSON_EXTRACT(NEW.payload,'$.lines')),'')<>'ARRAY' OR JSON_LENGTH(JSON_EXTRACT(NEW.payload,'$.lines'))<>JSON_LENGTH(JSON_EXTRACT(NEW.payload,'$.calculated')) OR JSON_LENGTH(JSON_EXTRACT(NEW.payload,'$.lines'))>500 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_ALLOCATION_MISMATCH'; END IF;
    IF EXISTS (SELECT 1 FROM JSON_TABLE(NEW.payload,'$.lines[*]' COLUMNS(line_id CHAR(36) PATH '$.line',weight VARCHAR(100) PATH '$.weight')) weights WHERE COALESCE(weights.weight,'') NOT REGEXP '^(0|[1-9][0-9]{0,29})$' OR NOT EXISTS (SELECT 1 FROM JSON_TABLE(NEW.payload,'$.calculated[*]' COLUMNS(line_id CHAR(36) PATH '$.line')) share WHERE share.line_id=weights.line_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_ALLOCATION_MISMATCH'; END IF;
    IF (SELECT COUNT(DISTINCT line_id) FROM JSON_TABLE(NEW.payload,'$.lines[*]' COLUMNS(line_id CHAR(36) PATH '$.line')) weights)<>JSON_LENGTH(JSON_EXTRACT(NEW.payload,'$.lines')) OR (SELECT SUM(CAST(weight AS DECIMAL(30,0))) FROM JSON_TABLE(NEW.payload,'$.lines[*]' COLUMNS(weight VARCHAR(100) PATH '$.weight')) weights)<=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_ALLOCATION_MISMATCH'; END IF;
    IF EXISTS (
      SELECT 1 FROM JSON_TABLE(NEW.payload,'$.calculated[*]' COLUMNS(acquisition_id CHAR(36) PATH '$.line',amount_text VARCHAR(100) PATH '$.amount_minor')) shares
      LEFT JOIN iv_records a ON a.id=shares.acquisition_id AND a.company_id=NEW.company_id AND a.kind='ACQUISITION'
      WHERE a.id IS NULL OR shares.amount_text IS NULL OR shares.amount_text NOT REGEXP '^(0|[1-9][0-9]{0,29})$'
    ) OR (SELECT COUNT(*) FROM JSON_TABLE(NEW.payload,'$.calculated[*]' COLUMNS(acquisition_id CHAR(36) PATH '$.line')) shares)
       <> (SELECT COUNT(DISTINCT acquisition_id) FROM JSON_TABLE(NEW.payload,'$.calculated[*]' COLUMNS(acquisition_id CHAR(36) PATH '$.line')) shares)
       OR (SELECT SUM(amount_minor) FROM JSON_TABLE(NEW.payload,'$.calculated[*]' COLUMNS(amount_minor DECIMAL(30,0) PATH '$.amount_minor')) shares) <> CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.total_minor')) AS DECIMAL(30,0)) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_ALLOCATION_MISMATCH';
    END IF;
    IF NEW.kind='COMPONENT_REVISION' AND (NEW.supersedes_id IS NULL OR NEW.target_id IS NULL OR NEW.target_id<>NEW.supersedes_id OR target_kind NOT IN ('COMPONENT','COMPONENT_REVISION')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_REVERSAL_REQUIRED'; END IF;
    IF NEW.kind='COMPONENT_REVISION' AND NOT EXISTS (SELECT 1 FROM iv_records WHERE id=NEW.supersedes_id AND document_id=NEW.document_id AND source_line=NEW.source_line AND JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.reversal.revision_id'))=id AND JSON_EXTRACT(NEW.payload,'$.reversal.calculated')=JSON_EXTRACT(payload,'$.calculated')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_COMPONENT_REVERSAL_REQUIRED'; END IF;
  END IF;
  IF NEW.kind='STOCK_CORRECTION' AND NOT EXISTS (
    SELECT 1 FROM iv_records old_link INNER JOIN iv_records new_cost ON new_cost.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.new_revision_id'))
    INNER JOIN iv_records new_source ON new_source.id=new_cost.source_id
    WHERE old_link.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.previous_bill_link_id')) AND old_link.kind='BILL_LINK'
      AND old_link.company_id=NEW.company_id AND old_link.product_id=NEW.product_id
      AND old_link.target_id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.old_revision_id'))
      AND old_link.document_id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.bill_id'))
      AND new_cost.kind='COST' AND new_cost.company_id=NEW.company_id AND new_cost.product_id=NEW.product_id
      AND new_source.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.new_source_id')) AND new_source.document_type='SUPPLIER'
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_CORRECTION_SOURCE_INVALID'; END IF;
  IF NEW.kind IN ('STOCK_REVERSAL','STOCK_REPLACEMENT') AND NOT EXISTS (SELECT 1 FROM iv_records c INNER JOIN iv_records a ON a.target_id=c.id AND a.kind='CORRECTION_APPROVAL' WHERE c.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.correction_id')) AND c.kind='STOCK_CORRECTION' AND c.company_id=NEW.company_id AND c.product_id=NEW.product_id AND c.target_id=NEW.target_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_CORRECTION_NOT_APPROVED'; END IF;
  IF NEW.kind IN ('COST_REPLACEMENT','STOCK_REPLACEMENT') AND NOT EXISTS (SELECT 1 FROM iv_records r WHERE r.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.reversal_id')) AND r.company_id=NEW.company_id AND r.product_id=NEW.product_id AND r.kind=IF(NEW.kind='STOCK_REPLACEMENT','STOCK_REVERSAL','COST_REVERSAL')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_REVERSAL_REQUIRED'; END IF;
  IF NEW.kind='COST_REPLACEMENT' AND NOT EXISTS (
    SELECT 1 FROM iv_records cost INNER JOIN iv_records reversal ON reversal.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.reversal_id'))
    INNER JOIN iv_records approved ON approved.kind='APPROVAL' AND approved.target_id=cost.id
    WHERE cost.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.revision_id')) AND cost.kind='COST' AND cost.source_id=NEW.source_id
      AND cost.company_id=NEW.company_id AND cost.product_id=NEW.product_id AND cost.supersedes_id=reversal.target_id AND reversal.target_id=applied_revision
      AND JSON_UNQUOTE(JSON_EXTRACT(cost.payload,'$.state'))='FINAL'
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_FINALIZATION_INVALID'; END IF;
  IF NEW.kind IN ('STOCK_REVERSAL','STOCK_REPLACEMENT') AND NOT EXISTS (
    SELECT 1 FROM iv_records correction INNER JOIN iv_records cost ON cost.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.revision_id'))
    WHERE correction.id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.correction_id')) AND correction.kind='STOCK_CORRECTION'
      AND cost.kind='COST' AND cost.company_id=NEW.company_id AND cost.product_id=NEW.product_id
      AND cost.id=JSON_UNQUOTE(JSON_EXTRACT(correction.payload,IF(NEW.kind='STOCK_REVERSAL','$.old_revision_id','$.new_revision_id')))
      AND JSON_EXTRACT(NEW.payload,'$.quantity')=JSON_EXTRACT(cost.payload,'$.quantity')
      AND JSON_EXTRACT(NEW.payload,'$.total_minor')=JSON_EXTRACT(cost.payload,'$.total_minor')
      AND (NEW.kind='STOCK_REVERSAL' OR JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.new_source_id'))=cost.source_id)
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_CORRECTION_SOURCE_INVALID'; END IF;
  IF NEW.kind IN ('ACQUISITION','COMPONENT','COST','REPLAY','ISSUE') AND NEW.target_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_TARGET_TYPE_INVALID'; END IF;
  IF NEW.kind='REPLAY' AND (NEW.source_id IS NOT NULL OR NEW.supersedes_id IS NOT NULL OR NEW.document_type<>'VALUATION') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SOURCE_TYPE_INVALID'; END IF;
  IF NEW.kind IN ('ISSUE','CUSTOMER_RETURN','VENDOR_RETURN') AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.quantity')),'') NOT REGEXP '^(0|[1-9][0-9]{0,7})([.][0-9]{1,2}0{0,4})?$' OR CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.quantity')) AS DECIMAL(14,6))<=0) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='INVENTORY_QUANTITY_PRECISION_UNSUPPORTED'; END IF;
  IF NEW.kind IN ('CUSTOMER_RETURN','VENDOR_RETURN') AND NOT EXISTS (SELECT 1 FROM iv_records r WHERE r.id=NEW.target_id AND (r.source_id <=> NEW.source_id) AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.source_line')),'')=r.source_line) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_RETURN_LINK_REQUIRED'; END IF;
  IF (SELECT COUNT(*) FROM financial_years WHERE company_id=NEW.company_id AND NEW.effective_date BETWEEN start_date AND end_date AND status='OPEN')<>1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OPEN_FY_REQUIRED'; END IF;
  IF NEW.sequence<>(SELECT COALESCE(MAX(sequence),0)+1 FROM iv_records WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND effective_date=NEW.effective_date)
    OR NOT EXISTS (SELECT 1 FROM iv_date_sequences WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND effective_date=NEW.effective_date AND last_sequence=NEW.sequence) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_SEQUENCE_INVALID'; END IF;
  SET NEW.event_key=CASE
    WHEN NEW.kind IN ('APPROVAL','REJECTION') THEN SHA2(CONCAT('REVIEW:',NEW.target_id),256)
    WHEN NEW.kind IN ('SUBMISSION','CORRECTION_APPROVAL') THEN SHA2(CONCAT(NEW.kind,':',NEW.target_id),256)
    WHEN NEW.kind='OPENING' THEN SHA2('OPENING',256)
    WHEN NEW.kind='RECEIPT' THEN SHA2(CONCAT('RECEIPT:',NEW.source_id),256)
    WHEN NEW.kind='COST_REVERSAL' THEN SHA2(CONCAT('COST_REVERSAL:',NEW.target_id,':',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.movement_id')),JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.bill_link_id')))),256)
    WHEN NEW.kind='COST_REPLACEMENT' THEN SHA2(CONCAT('COST_REPLACEMENT:',JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.reversal_id'))),256)
    WHEN NEW.kind='BILL_LINK' THEN SHA2(CONCAT('BILL_LINK:',NEW.document_id,':',NEW.source_id,':',NEW.target_id),256)
    WHEN NEW.kind IN ('STOCK_REVERSAL','STOCK_REPLACEMENT') THEN SHA2(CONCAT(NEW.kind,':',(SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.previous_bill_link_id')) FROM iv_records WHERE id=JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.correction_id')))),256)
    WHEN NEW.kind IN ('ISSUE','CUSTOMER_RETURN','VENDOR_RETURN') THEN SHA2(CONCAT(NEW.kind,':',HEX(NEW.document_type),':',HEX(NEW.document_id),':',HEX(NEW.source_line)),256)
    ELSE NULL END;
END;

-- IV_OBJECT trigger iv_records_no_update
CREATE TRIGGER iv_records_no_update BEFORE UPDATE ON iv_records FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IV_IMMUTABLE_EVIDENCE';

-- IV_OBJECT trigger iv_records_no_delete
CREATE TRIGGER iv_records_no_delete BEFORE DELETE ON iv_records FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IV_IMMUTABLE_EVIDENCE';

-- IV_OBJECT trigger iv_users_protect_identity
CREATE TRIGGER iv_users_protect_identity BEFORE UPDATE ON users FOR EACH ROW BEGIN IF (NOT(NEW.id <=> OLD.id) OR NOT(NEW.company_id <=> OLD.company_id)) AND (EXISTS (SELECT 1 FROM iv_records WHERE creator_id=OLD.id AND company_id=OLD.company_id) OR EXISTS (SELECT 1 FROM iv_operations WHERE actor_id=OLD.id AND company_id=OLD.company_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END;

-- IV_OBJECT trigger iv_users_protect_delete
CREATE TRIGGER iv_users_protect_delete BEFORE DELETE ON users FOR EACH ROW BEGIN IF EXISTS (SELECT 1 FROM iv_records WHERE creator_id=OLD.id AND company_id=OLD.company_id) OR EXISTS (SELECT 1 FROM iv_operations WHERE actor_id=OLD.id AND company_id=OLD.company_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END;

-- IV_OBJECT trigger iv_companies_protect_identity
CREATE TRIGGER iv_companies_protect_identity BEFORE UPDATE ON companies FOR EACH ROW BEGIN IF NOT(NEW.id <=> OLD.id) AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END;

-- IV_OBJECT trigger iv_products_protect_identity
CREATE TRIGGER iv_products_protect_identity BEFORE UPDATE ON products FOR EACH ROW BEGIN IF (NOT(NEW.id <=> OLD.id) OR NOT(NEW.company_id <=> OLD.company_id)) AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.company_id AND product_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END;

-- IV_OBJECT trigger iv_products_protect_delete
CREATE TRIGGER iv_products_protect_delete BEFORE DELETE ON products FOR EACH ROW BEGIN IF EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.company_id AND product_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END;

-- IV_OBJECT trigger iv_companies_protect_delete
CREATE TRIGGER iv_companies_protect_delete BEFORE DELETE ON companies FOR EACH ROW BEGIN IF EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END;
