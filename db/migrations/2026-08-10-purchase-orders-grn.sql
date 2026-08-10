SET @has_po_branch = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_orders' AND COLUMN_NAME='branch_id');
SET @add_po_columns = IF(@has_po_branch=0,'ALTER TABLE purchase_orders ADD COLUMN branch_id INT NULL AFTER company_id, ADD COLUMN terms TEXT NULL AFTER notes','SELECT 1');
PREPARE add_po_columns_stmt FROM @add_po_columns; EXECUTE add_po_columns_stmt; DEALLOCATE PREPARE add_po_columns_stmt;

SET @has_po_item_company = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_order_items' AND COLUMN_NAME='company_id');
SET @add_po_item_columns = IF(@has_po_item_company=0,'ALTER TABLE purchase_order_items ADD COLUMN company_id INT NULL AFTER id, ADD COLUMN description VARCHAR(500) NULL AFTER product_name, ADD COLUMN unit VARCHAR(30) NULL AFTER description, ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER price, ADD COLUMN taxable_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER discount_percent, ADD COLUMN igst DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER sgst','SELECT 1');
PREPARE add_po_item_columns_stmt FROM @add_po_item_columns; EXECUTE add_po_item_columns_stmt; DEALLOCATE PREPARE add_po_item_columns_stmt;

UPDATE purchase_order_items poi
INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
SET poi.company_id = po.company_id
WHERE poi.company_id IS NULL;

CREATE TABLE IF NOT EXISTS goods_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  branch_id INT NULL,
  grn_number VARCHAR(100) NOT NULL,
  purchase_order_id INT NOT NULL,
  vendor_id INT NOT NULL,
  grn_date DATE NOT NULL,
  challan_number VARCHAR(100) NULL,
  challan_date DATE NULL,
  status ENUM('Draft','Posted','Cancelled') NOT NULL DEFAULT 'Draft',
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_by INT NULL,
  posted_by INT NULL,
  posted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_company_number (company_id, grn_number),
  KEY idx_grn_company_po (company_id, purchase_order_id),
  KEY idx_grn_company_vendor (company_id, vendor_id),
  KEY idx_grn_company_status (company_id, status)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  goods_receipt_id BIGINT UNSIGNED NOT NULL,
  purchase_order_item_id INT NOT NULL,
  product_id INT NOT NULL,
  received_qty DECIMAL(12,2) NOT NULL,
  rejected_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
  accepted_qty DECIMAL(12,2) NOT NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_grn_items_receipt (company_id, goods_receipt_id),
  KEY idx_grn_items_po_item (company_id, purchase_order_item_id),
  KEY idx_grn_items_product (company_id, product_id)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  branch_id INT NULL,
  product_id INT NOT NULL,
  transaction_type VARCHAR(30) NOT NULL,
  reference_type VARCHAR(30) NOT NULL,
  reference_id BIGINT UNSIGNED NOT NULL,
  quantity_in DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity_out DECIMAL(12,2) NOT NULL DEFAULT 0,
  transaction_date DATE NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_reference_product (company_id, reference_type, reference_id, product_id),
  KEY idx_inventory_company_product_date (company_id, product_id, transaction_date)
);

SET @has_bill_po = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bills' AND COLUMN_NAME='source_purchase_order_id');
SET @add_bill_po = IF(@has_bill_po=0,'ALTER TABLE bills ADD COLUMN source_purchase_order_id INT NULL','SELECT 1');
PREPARE add_bill_po_stmt FROM @add_bill_po; EXECUTE add_bill_po_stmt; DEALLOCATE PREPARE add_bill_po_stmt;

SET @has_bill_grn = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bills' AND COLUMN_NAME='source_grn_id');
SET @add_bill_grn = IF(@has_bill_grn=0,'ALTER TABLE bills ADD COLUMN source_grn_id BIGINT UNSIGNED NULL, ADD COLUMN stock_posted TINYINT(1) NOT NULL DEFAULT 1','SELECT 1');
PREPARE add_bill_grn_stmt FROM @add_bill_grn; EXECUTE add_bill_grn_stmt; DEALLOCATE PREPARE add_bill_grn_stmt;

SET @has_bill_po_index = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bills' AND INDEX_NAME='idx_bills_company_po');
SET @add_bill_po_index = IF(@has_bill_po_index=0,'CREATE INDEX idx_bills_company_po ON bills(company_id, source_purchase_order_id)','SELECT 1');
PREPARE add_bill_po_index_stmt FROM @add_bill_po_index; EXECUTE add_bill_po_index_stmt; DEALLOCATE PREPARE add_bill_po_index_stmt;

SET @has_bill_grn_index = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bills' AND INDEX_NAME='idx_bills_company_grn');
SET @add_bill_grn_index = IF(@has_bill_grn_index=0,'CREATE INDEX idx_bills_company_grn ON bills(company_id, source_grn_id)','SELECT 1');
PREPARE add_bill_grn_index_stmt FROM @add_bill_grn_index; EXECUTE add_bill_grn_index_stmt; DEALLOCATE PREPARE add_bill_grn_index_stmt;
