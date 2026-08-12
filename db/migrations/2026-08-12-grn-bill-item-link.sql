SET @has_source_grn_item = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bill_items'
    AND COLUMN_NAME = 'source_grn_item_id'
);
SET @add_source_grn_item = IF(
  @has_source_grn_item = 0,
  'ALTER TABLE bill_items ADD COLUMN source_grn_item_id BIGINT UNSIGNED NULL AFTER bill_id',
  'SELECT 1'
);
PREPARE add_source_grn_item_stmt FROM @add_source_grn_item;
EXECUTE add_source_grn_item_stmt;
DEALLOCATE PREPARE add_source_grn_item_stmt;

SET @has_source_grn_item_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bill_items'
    AND INDEX_NAME = 'idx_bill_items_source_grn_item'
);
SET @add_source_grn_item_index = IF(
  @has_source_grn_item_index = 0,
  'CREATE INDEX idx_bill_items_source_grn_item ON bill_items(source_grn_item_id)',
  'SELECT 1'
);
PREPARE add_source_grn_item_index_stmt FROM @add_source_grn_item_index;
EXECUTE add_source_grn_item_index_stmt;
DEALLOCATE PREPARE add_source_grn_item_index_stmt;
