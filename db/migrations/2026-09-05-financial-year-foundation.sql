-- RevEx Books: Financial Year foundation (FY-1A)
-- Additive, tenant-scoped, and intentionally does not backfill legacy companies.

CREATE TABLE IF NOT EXISTS financial_years (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('DRAFT','OPEN','RECONCILIATION','CLOSING','CLOSED','LOCKED') NOT NULL DEFAULT 'DRAFT',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  default_company_id INT GENERATED ALWAYS AS (
    CASE WHEN is_default = 1 THEN company_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_financial_years_id_company (id, company_id),
  UNIQUE KEY uq_financial_years_company_code (company_id, code),
  UNIQUE KEY uq_financial_years_company_dates (company_id, start_date, end_date),
  UNIQUE KEY uq_financial_years_one_default (default_company_id),
  KEY idx_financial_years_company_dates (company_id, start_date, end_date),
  KEY idx_financial_years_company_status (company_id, status),
  KEY idx_financial_years_company_default (company_id, is_default),
  KEY idx_financial_years_created_by (created_by),
  CONSTRAINT fk_financial_years_company
    FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_financial_years_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_financial_years_dates CHECK (start_date <= end_date),
  CONSTRAINT chk_financial_years_is_default CHECK (is_default IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_year_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM(
    'CREATE',
    'SET_DEFAULT',
    'BEGIN_RECONCILIATION',
    'BEGIN_CLOSE',
    'CLOSE',
    'LOCK',
    'REOPEN',
    'MIGRATION_LINK',
    'ADJUSTMENT_AUTHORIZED'
  ) NOT NULL,
  previous_status ENUM('DRAFT','OPEN','RECONCILIATION','CLOSING','CLOSED','LOCKED') NULL,
  new_status ENUM('DRAFT','OPEN','RECONCILIATION','CLOSING','CLOSED','LOCKED') NULL,
  reason VARCHAR(500) NULL,
  actor_user_id INT NULL,
  metadata JSON NULL,
  occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_financial_year_events_company_time (company_id, occurred_at, id),
  KEY idx_financial_year_events_fy_time (financial_year_id, occurred_at, id),
  KEY idx_financial_year_events_type (company_id, event_type, occurred_at),
  KEY idx_financial_year_events_actor (actor_user_id),
  CONSTRAINT fk_financial_year_events_year_company
    FOREIGN KEY (financial_year_id, company_id)
    REFERENCES financial_years (id, company_id),
  CONSTRAINT fk_financial_year_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_financial_years_no_overlap_insert
BEFORE INSERT ON financial_years
FOR EACH ROW
BEGIN
  DECLARE locked_company_id INT;

  SELECT id INTO locked_company_id
    FROM companies
   WHERE id = NEW.company_id
   FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM financial_years fy
     WHERE fy.company_id = NEW.company_id
       AND NEW.start_date <= fy.end_date
       AND NEW.end_date >= fy.start_date
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Financial year dates overlap an existing financial year';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_financial_years_no_overlap_update
BEFORE UPDATE ON financial_years
FOR EACH ROW
BEGIN
  DECLARE locked_company_id INT;

  IF NEW.company_id <> OLD.company_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Financial year company cannot be changed';
  END IF;

  SELECT id INTO locked_company_id
    FROM companies
   WHERE id = NEW.company_id
   FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM financial_years fy
     WHERE fy.company_id = NEW.company_id
       AND fy.id <> OLD.id
       AND NEW.start_date <= fy.end_date
       AND NEW.end_date >= fy.start_date
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Financial year dates overlap an existing financial year';
  END IF;
END$$

CREATE TRIGGER IF NOT EXISTS trg_financial_year_events_no_update
BEFORE UPDATE ON financial_year_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Financial year events are append-only';
END$$

CREATE TRIGGER IF NOT EXISTS trg_financial_year_events_no_delete
BEFORE DELETE ON financial_year_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Financial year events are append-only';
END$$

DELIMITER ;
