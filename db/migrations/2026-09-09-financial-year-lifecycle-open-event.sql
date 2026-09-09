-- FY-4B-1: add the explicit DRAFT -> OPEN lifecycle event.
-- Existing events and append-only protections are preserved.

ALTER TABLE financial_year_events
  MODIFY COLUMN event_type ENUM(
    'CREATE',
    'SET_DEFAULT',
    'OPEN',
    'BEGIN_RECONCILIATION',
    'BEGIN_CLOSE',
    'CLOSE',
    'LOCK',
    'REOPEN',
    'MIGRATION_LINK',
    'ADJUSTMENT_AUTHORIZED'
  ) NOT NULL;
