-- Explicit guarded runner only. No data updates and no opening-event changes.
-- @statement
ALTER TABLE accounts ADD UNIQUE KEY uq_accounts_company_code (company_id,account_code), DROP INDEX account_code;
-- @statement
ALTER TABLE accounts DROP INDEX account_code;
