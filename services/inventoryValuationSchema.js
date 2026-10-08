"use strict";

// Declarative contract shared by the offline migration and read-only readiness.
// Importing this module never opens a connection or executes DDL.
const { canonical, fail } = require("./inventoryValuationMath");
const kinds = ["ACQUISITION", "COMPONENT", "COMPONENT_REVISION", "COST", "SUBMISSION", "APPROVAL", "REJECTION", "STOCK_CORRECTION", "CORRECTION_APPROVAL", "STOCK_REVERSAL", "STOCK_REPLACEMENT", "OPENING", "RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN", "COST_REVERSAL", "COST_REPLACEMENT", "BILL_LINK", "REPLAY"];
const col = (type, nullable = false) => ({ type, nullable });
const scope = { company_id: col("bigint unsigned"), product_id: col("bigint unsigned") };
const fk = (name, columns, table, references) => ({ name, columns, table, references });
const quantityColumns = [
  ["products", "stock"], ["products", "opening_stock"], ["bill_items", "quantity"],
  ["goods_receipt_items", "received_qty"], ["goods_receipt_items", "rejected_qty"], ["goods_receipt_items", "accepted_qty"],
  ["inventory_transactions", "quantity_in"], ["inventory_transactions", "quantity_out"], ["purchase_order_items", "quantity"],
];
const tables = {
  iv_operations: {
    columns: { company_id: col("bigint unsigned"), operation_key: col("varchar(128)"), actor_id: col("bigint unsigned"), action: col("varchar(40)"), fingerprint: col("char(64)"), result: col("json") },
    indexes: { PRIMARY: { unique: true, columns: ["company_id", "operation_key"] } }, foreign: [], immutable: true,
  },
  iv_product_locks: {
    columns: { ...scope }, indexes: { PRIMARY: { unique: true, columns: ["company_id", "product_id"] } }, foreign: [], immutable: false,
  },
  iv_date_sequences: {
    columns: { ...scope, effective_date: col("date"), last_sequence: col("bigint unsigned") },
    indexes: { PRIMARY: { unique: true, columns: ["company_id", "product_id", "effective_date"] } },
    foreign: [fk("iv_sequence_scope", ["company_id", "product_id"], "iv_product_locks", ["company_id", "product_id"])], immutable: false,
  },
  iv_records: {
    columns: { ...scope, id: col("char(36)"), kind: col(`enum(${kinds.map(x => `'${x}'`).join(",")})`), effective_date: col("date"), sequence: col("bigint unsigned"),
      source_id: col("char(36)", true), supersedes_id: col("char(36)", true), target_id: col("char(36)", true),
      document_type: col("varchar(30)"), document_id: col("varchar(100)"), source_line: col("varchar(100)"),
      acquisition_key: col("char(64)", true),
      idempotency_key: col("varchar(128)"), fingerprint: col("char(64)"), payload: col("json"), creator_id: col("bigint unsigned"), event_key: col("char(64)", true) },
    indexes: {
      PRIMARY: { unique: true, columns: ["company_id", "product_id", "id"] },
      iv_global_uuid: { unique: true, columns: ["id"] },
      iv_event_identity: { unique: true, columns: ["company_id", "product_id", "event_key"] },
      iv_record_key: { unique: true, columns: ["company_id", "product_id", "idempotency_key"] },
      iv_acquisition_identity: { unique: true, columns: ["company_id", "acquisition_key"] },
      iv_record_sequence: { unique: true, columns: ["company_id", "product_id", "effective_date", "sequence"] },
      iv_revision_successor: { unique: true, columns: ["company_id", "product_id", "supersedes_id"] },
      iv_source: { unique: false, columns: ["company_id", "product_id", "source_id"] },
      iv_target: { unique: false, columns: ["company_id", "product_id", "target_id"] },
    },
    foreign: [fk("iv_record_scope", ["company_id", "product_id"], "iv_product_locks", ["company_id", "product_id"]),
      ...["source", "supersedes", "target"].map(x => fk(`iv_record_${x}`, ["company_id", "product_id", `${x}_id`], "iv_records", ["company_id", "product_id", "id"]))],
    immutable: true,
  },
};
const quoted = s => `\`${s}\``;
const triggerBody = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IV_IMMUTABLE_EVIDENCE'";
const triggerName = event => `iv_records_no_${event.toLowerCase()}`;
const insertGuard = `BEGIN
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
END`;
const masterTriggers = [
  { name: "iv_users_protect_identity", table: "users", event: "UPDATE", body: "BEGIN IF (NOT(NEW.id <=> OLD.id) OR NOT(NEW.company_id <=> OLD.company_id)) AND (EXISTS (SELECT 1 FROM iv_records WHERE creator_id=OLD.id AND company_id=OLD.company_id) OR EXISTS (SELECT 1 FROM iv_operations WHERE actor_id=OLD.id AND company_id=OLD.company_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END" },
  { name: "iv_users_protect_delete", table: "users", event: "DELETE", body: "BEGIN IF EXISTS (SELECT 1 FROM iv_records WHERE creator_id=OLD.id AND company_id=OLD.company_id) OR EXISTS (SELECT 1 FROM iv_operations WHERE actor_id=OLD.id AND company_id=OLD.company_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END" },
  { name: "iv_companies_protect_identity", table: "companies", event: "UPDATE", body: "BEGIN IF NOT(NEW.id <=> OLD.id) AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END" },
  { name: "iv_products_protect_identity", table: "products", event: "UPDATE", body: "BEGIN IF (NOT(NEW.id <=> OLD.id) OR NOT(NEW.company_id <=> OLD.company_id)) AND EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.company_id AND product_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END" },
  { name: "iv_products_protect_delete", table: "products", event: "DELETE", body: "BEGIN IF EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.company_id AND product_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END" },
  { name: "iv_companies_protect_delete", table: "companies", event: "DELETE", body: "BEGIN IF EXISTS (SELECT 1 FROM iv_records WHERE company_id=OLD.id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_MASTER_REFERENCED'; END IF; END" },
];
const ownedTriggers = [
  { name: "iv_operations_validate_insert", table: "iv_operations", event: "INSERT", body: "BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE id=NEW.company_id) OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND company_id=NEW.company_id AND is_active=1) OR NEW.fingerprint NOT REGEXP '^[0-9a-f]{64}$' OR CHAR_LENGTH(TRIM(NEW.operation_key))=0 OR CHAR_LENGTH(TRIM(NEW.action))=0 OR JSON_TYPE(NEW.result)<>'OBJECT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_OPERATION_INVALID'; END IF; END" },
  ...["INSERT", "UPDATE"].map(event => ({ name: `iv_product_locks_validate_${event.toLowerCase()}`, table: "iv_product_locks", event, body: "BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE id=NEW.company_id) OR NOT EXISTS (SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_IDENTITY_INVALID'; END IF; END" })),
  ...["UPDATE", "DELETE"].map(event => ({ name: `iv_operations_no_${event.toLowerCase()}`, table: "iv_operations", event, body: triggerBody })),
  { name: "iv_records_validate_insert", table: "iv_records", event: "INSERT", body: insertGuard },
  ...["UPDATE", "DELETE"].map(event => ({ name: triggerName(event), table: "iv_records", event, body: triggerBody })),
  ...masterTriggers,
];
function createSQL(name) {
  const t = tables[name];
  const definitions = Object.entries(t.columns).map(([n, c]) => `${quoted(n)} ${c.type} ${c.nullable ? "NULL" : "NOT NULL"}`);
  for (const [n, i] of Object.entries(t.indexes)) definitions.push(`${n === "PRIMARY" ? "PRIMARY KEY" : `${i.unique ? "UNIQUE " : ""}KEY ${quoted(n)}`} (${i.columns.map(quoted).join(",")})`);
  for (const f of t.foreign) definitions.push(`CONSTRAINT ${quoted(f.name)} FOREIGN KEY (${f.columns.map(quoted).join(",")}) REFERENCES ${quoted(f.table)} (${f.references.map(quoted).join(",")}) ON DELETE RESTRICT ON UPDATE RESTRICT`);
  return `CREATE TABLE ${quoted(name)} (${definitions.join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
}
const norm = s => String(s).replace(/`/g, "").replace(/\s+/g, " ").trim();
async function inspect(executor, { allowMissing = false } = {}) {
  const missing = [], conflicts = [];
  for (const [table, column] of quantityColumns) {
    const [rows] = await executor.query("SELECT DATA_TYPE,NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?", [table, column]);
    if (rows.length !== 1 || rows[0].DATA_TYPE !== "decimal" || Number(rows[0].NUMERIC_SCALE) !== 2 || Number(rows[0].NUMERIC_PRECISION) < 10 || rows[0].EXTRA !== "") conflicts.push(`${table}.${column}:operational-quantity`);
  }
  for (const [name, expected] of Object.entries(tables)) {
    const [table] = await executor.query("SELECT ENGINE, TABLE_COLLATION, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [name]);
    if (!table.length) { missing.push(name); continue; }
    if (table.length !== 1 || table[0].ENGINE !== "InnoDB" || table[0].TABLE_COLLATION !== "utf8mb4_bin" || table[0].TABLE_TYPE !== "BASE TABLE") conflicts.push(`${name}:table`);
    const [columns] = await executor.query("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [name]);
    if (columns.length !== Object.keys(expected.columns).length) conflicts.push(`${name}:columns`);
    Object.entries(expected.columns).forEach(([key, c], index) => {
      const actual = columns[index], textual = /^(char|varchar|enum)\(/.test(c.type);
      if (!actual || actual.COLUMN_NAME !== key || actual.COLUMN_TYPE.replace(/bigint\(\d+\)/, "bigint") !== c.type ||
          actual.IS_NULLABLE !== (c.nullable ? "YES" : "NO") || actual.COLUMN_DEFAULT !== null || actual.EXTRA !== "" ||
          (actual.GENERATION_EXPRESSION || "") !== "" || actual.COLLATION_NAME !== (textual ? "utf8mb4_bin" : null)) conflicts.push(`${name}:${key}`);
    });
    const [indexes] = await executor.query("SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, SUB_PART, INDEX_TYPE, COLLATION, IS_VISIBLE, EXPRESSION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX", [name]);
    const actualIndexes = {};
    for (const i of indexes) {
      if (i.SUB_PART !== null || i.INDEX_TYPE !== "BTREE" || i.COLLATION !== "A" || i.IS_VISIBLE !== "YES" || i.EXPRESSION !== null) conflicts.push(`${name}:index-options`);
      actualIndexes[i.INDEX_NAME] ||= { unique: Number(i.NON_UNIQUE) === 0, columns: [] };
      actualIndexes[i.INDEX_NAME].columns.push(i.COLUMN_NAME);
    }
    if (canonical(actualIndexes) !== canonical(expected.indexes)) conflicts.push(`${name}:indexes`);
    const [constraints] = await executor.query("SELECT CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [name]);
    const expectedConstraints = Object.entries(expected.indexes).filter(([, i]) => i.unique).map(([n]) => `${n}:${n === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE"}`).concat(expected.foreign.map(f => `${f.name}:FOREIGN KEY`)).sort();
    if (canonical(constraints.map(c => `${c.CONSTRAINT_NAME}:${c.CONSTRAINT_TYPE}`).sort()) !== canonical(expectedConstraints)) conflicts.push(`${name}:constraints`);
    const [foreign] = await executor.query(`SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE,
      (k.REFERENCED_TABLE_SCHEMA=DATABASE()) LOCAL_REFERENCE
      FROM information_schema.KEY_COLUMN_USAGE k INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
      WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, [name]);
    const actualForeign = {};
    for (const f of foreign) {
      if (f.DELETE_RULE !== "RESTRICT" || f.UPDATE_RULE !== "RESTRICT" || Number(f.LOCAL_REFERENCE) !== 1) conflicts.push(`${name}:foreign-actions`);
      actualForeign[f.CONSTRAINT_NAME] ||= { name: f.CONSTRAINT_NAME, columns: [], table: f.REFERENCED_TABLE_NAME, references: [] };
      actualForeign[f.CONSTRAINT_NAME].columns.push(f.COLUMN_NAME); actualForeign[f.CONSTRAINT_NAME].references.push(f.REFERENCED_COLUMN_NAME);
    }
    if (canonical(Object.values(actualForeign).sort((a,b) => a.name.localeCompare(b.name))) !== canonical([...expected.foreign].sort((a,b) => a.name.localeCompare(b.name)))) conflicts.push(`${name}:foreign`);
    const [triggers] = await executor.query("SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORIENTATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=?", [name]);
    const expectedTriggers = ownedTriggers.filter(t => t.table === name);
    if (triggers.length !== expectedTriggers.length || expectedTriggers.some(e => !triggers.some(t => t.TRIGGER_NAME === e.name && t.EVENT_MANIPULATION === e.event && t.ACTION_TIMING === "BEFORE" && t.ACTION_ORIENTATION === "ROW" && norm(t.ACTION_STATEMENT) === norm(e.body)))) conflicts.push(`${name}:triggers`);
  }
  for (const expected of masterTriggers) {
    const [triggers] = await executor.query("SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORIENTATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [expected.name]);
    if (!triggers.length && allowMissing && missing.includes("iv_records")) continue;
    if (triggers.length !== 1 || triggers[0].EVENT_MANIPULATION !== expected.event || triggers[0].ACTION_TIMING !== "BEFORE" || triggers[0].ACTION_ORIENTATION !== "ROW" || norm(triggers[0].ACTION_STATEMENT) !== norm(expected.body)) conflicts.push(`${expected.name}:trigger`);
  }
  return { ready: !conflicts.length && (allowMissing || !missing.length), missing, conflicts };
}
async function assertReady(executor) {
  const state = await inspect(executor);
  if (!state.ready) fail(state.conflicts.length ? "IV_SCHEMA_INCOMPATIBLE" : "IV_SCHEMA_NOT_READY");
}
module.exports = { tables, createSQL, inspect, assertReady, triggerBody, triggerName, ownedTriggers, quantityColumns, kinds };
