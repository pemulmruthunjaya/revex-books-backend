-- Frozen Q2 prerequisite; execute only through the SHA-pinned guarded runner.
-- No standalone execution: the runner validates, locks, fingerprints and resumes.
ALTER TABLE `products` MODIFY COLUMN `stock` DECIMAL(12,2) NULL DEFAULT 0;
ALTER TABLE `bill_items` MODIFY COLUMN `quantity` DECIMAL(12,2) NULL DEFAULT NULL;
