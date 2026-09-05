const db = require("../db/connection");

const FY_STATUSES = new Set([
  "DRAFT",
  "OPEN",
  "RECONCILIATION",
  "CLOSING",
  "CLOSED",
  "LOCKED",
]);

class FinancialYearServiceError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "FinancialYearServiceError";
    this.code = code;
    this.status = status;
  }
}

const fail = (code, message, status) => {
  throw new FinancialYearServiceError(code, message, status);
};

const positiveId = (value, label) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    fail("INVALID_ID", `${label} must be a positive integer`, 400);
  }
  return id;
};

const accountingDate = (value, label) => {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) fail("INVALID_DATE", `${label} must use YYYY-MM-DD`, 400);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    fail("INVALID_DATE", `${label} is not a valid calendar date`, 400);
  }
  return text;
};

const normalizeStatus = (value = "DRAFT") => {
  const status = String(value || "").trim().toUpperCase();
  if (!FY_STATUSES.has(status)) {
    fail("INVALID_STATUS", "Unsupported financial year status", 400);
  }
  return status;
};

const normalizeText = (value, label, max, required = false) => {
  if (value === null || value === undefined) {
    if (required) fail("INVALID_INPUT", `${label} is required`, 400);
    return null;
  }
  const text = String(value).trim();
  if (required && !text) fail("INVALID_INPUT", `${label} is required`, 400);
  if (!text) return null;
  if (text.length > max) fail("INVALID_INPUT", `${label} exceeds ${max} characters`, 400);
  return text;
};

const rowShape = (row) => row ? ({
  id: Number(row.id),
  company_id: Number(row.company_id),
  code: row.code,
  name: row.name,
  start_date: row.start_date,
  end_date: row.end_date,
  status: row.status,
  is_default: Number(row.is_default) === 1,
  source: row.source,
  created_by: row.created_by === null ? null : Number(row.created_by),
  created_at: row.created_at,
  updated_at: row.updated_at,
}) : null;

const FY_SELECT = `SELECT id,company_id,code,name,
  DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,
  DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date,
  status,is_default,source,created_by,created_at,updated_at
  FROM financial_years`;

const withTransaction = async (executor, work) => {
  const connection = typeof executor.getConnection === "function"
    ? await executor.getConnection()
    : executor;
  const release = typeof connection.release === "function";
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    if (release) connection.release();
  }
};

const lockCompany = async (connection, companyId) => {
  const [companies] = await connection.query(
    "SELECT id FROM companies WHERE id=? LIMIT 1 FOR UPDATE",
    [companyId]
  );
  if (!companies.length) fail("COMPANY_NOT_FOUND", "Company not found", 404);
};

const validateActor = async (connection, companyId, actorUserId) => {
  if (actorUserId === null) return;
  const [memberships] = await connection.query(
    `SELECT 1 FROM user_company_memberships
      WHERE user_id=? AND company_id=? AND is_active=1 LIMIT 1`,
    [actorUserId, companyId]
  );
  if (!memberships.length) {
    fail("ACTOR_COMPANY_MISMATCH", "Actor does not belong to the company", 403);
  }
};

const insertEvent = async (connection, event) => {
  await connection.query(
    `INSERT INTO financial_year_events
      (company_id,financial_year_id,event_type,previous_status,new_status,
       reason,actor_user_id,metadata)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      event.companyId,
      event.financialYearId,
      event.eventType,
      event.previousStatus,
      event.newStatus,
      event.reason,
      event.actorUserId,
      JSON.stringify(event.metadata || {}),
    ]
  );
};

const mapDatabaseError = (error) => {
  if (error instanceof FinancialYearServiceError) return error;
  const message = String(error?.sqlMessage || error?.message || "");
  if (message.includes("overlap")) {
    return new FinancialYearServiceError("FINANCIAL_YEAR_OVERLAP", message);
  }
  if (error?.code === "ER_DUP_ENTRY") {
    if (message.includes("uq_financial_years_company_code")) {
      return new FinancialYearServiceError("DUPLICATE_FINANCIAL_YEAR_CODE", "Financial year code already exists");
    }
    if (message.includes("uq_financial_years_company_dates")) {
      return new FinancialYearServiceError("DUPLICATE_FINANCIAL_YEAR_DATES", "Financial year date range already exists");
    }
    if (message.includes("uq_financial_years_one_default")) {
      return new FinancialYearServiceError("DEFAULT_FINANCIAL_YEAR_CONFLICT", "Company already has a default financial year");
    }
  }
  return error;
};

const listFinancialYears = async (companyId, executor = db) => {
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const [rows] = await executor.query(
    `${FY_SELECT} WHERE company_id=? ORDER BY start_date DESC,id DESC`,
    [normalizedCompanyId]
  );
  return rows.map(rowShape);
};

const getFinancialYear = async (companyId, financialYearId, executor = db) => {
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const normalizedYearId = positiveId(financialYearId, "financialYearId");
  const [rows] = await executor.query(
    `${FY_SELECT} WHERE company_id=? AND id=? LIMIT 1`,
    [normalizedCompanyId, normalizedYearId]
  );
  return rowShape(rows[0]);
};

const getDefaultFinancialYear = async (companyId, executor = db) => {
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const [rows] = await executor.query(
    `${FY_SELECT} WHERE company_id=? AND is_default=1 LIMIT 1`,
    [normalizedCompanyId]
  );
  return rowShape(rows[0]);
};

const resolveFinancialYearForDate = async (companyId, businessDate, executor = db) => {
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const normalizedDate = accountingDate(businessDate, "businessDate");
  const [rows] = await executor.query(
    `${FY_SELECT} WHERE company_id=? AND ? BETWEEN start_date AND end_date LIMIT 1`,
    [normalizedCompanyId, normalizedDate]
  );
  return rowShape(rows[0]);
};

const requireFinancialYearForDate = async (companyId, businessDate, executor = db) => {
  const financialYear = await resolveFinancialYearForDate(companyId, businessDate, executor);
  if (!financialYear) {
    fail(
      "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE",
      "No financial year covers the transaction date for this company",
      409
    );
  }
  return financialYear;
};

const rejectClientFinancialYear = (input) => {
  if (input && Object.prototype.hasOwnProperty.call(input, "financial_year_id")) {
    fail(
      "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED",
      "financial_year_id is assigned by the server from the transaction date",
      400
    );
  }
};

const eventShape = (row) => {
  let metadata = {};
  if (row.metadata && typeof row.metadata === "object") {
    metadata = row.metadata;
  } else if (row.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch { metadata = {}; }
  }
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    financial_year_id: Number(row.financial_year_id),
    event_type: row.event_type,
    previous_status: row.previous_status,
    new_status: row.new_status,
    reason: row.reason,
    actor_user_id: row.actor_user_id === null ? null : Number(row.actor_user_id),
    metadata,
    occurred_at: row.occurred_at,
  };
};

const listFinancialYearEvents = async (companyId, financialYearId, executor = db) => {
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const normalizedYearId = positiveId(financialYearId, "financialYearId");
  const [rows] = await executor.query(
    `SELECT e.id,e.company_id,e.financial_year_id,e.event_type,e.previous_status,
            e.new_status,e.reason,e.actor_user_id,e.metadata,e.occurred_at
       FROM financial_year_events e
       INNER JOIN financial_years fy
         ON fy.id=e.financial_year_id AND fy.company_id=e.company_id
      WHERE e.company_id=? AND e.financial_year_id=?
      ORDER BY e.occurred_at ASC,e.id ASC`,
    [normalizedCompanyId, normalizedYearId]
  );
  return rows.map(eventShape);
};

const createFinancialYear = async (input, executor = db) => {
  const values = {
    companyId: positiveId(input?.companyId, "companyId"),
    code: normalizeText(input?.code, "code", 40, true),
    name: normalizeText(input?.name, "name", 120),
    startDate: accountingDate(input?.startDate, "startDate"),
    endDate: accountingDate(input?.endDate, "endDate"),
    status: normalizeStatus(input?.status),
    isDefault: input?.isDefault === true,
    source: normalizeText(input?.source || "MANUAL", "source", 40, true),
    actorUserId: input?.actorUserId === null || input?.actorUserId === undefined
      ? null
      : positiveId(input.actorUserId, "actorUserId"),
    reason: normalizeText(input?.reason, "reason", 500),
  };
  if (values.startDate > values.endDate) {
    fail("INVALID_DATE_RANGE", "startDate must be on or before endDate", 400);
  }

  try {
    return await withTransaction(executor, async (connection) => {
      await lockCompany(connection, values.companyId);
      await validateActor(connection, values.companyId, values.actorUserId);

      const [overlaps] = await connection.query(
        `SELECT id FROM financial_years
          WHERE company_id=? AND ? <= end_date AND ? >= start_date
          LIMIT 1 FOR UPDATE`,
        [values.companyId, values.startDate, values.endDate]
      );
      if (overlaps.length) {
        fail("FINANCIAL_YEAR_OVERLAP", "Financial year dates overlap an existing financial year");
      }

      let previousDefaultId = null;
      if (values.isDefault) {
        const [defaults] = await connection.query(
          "SELECT id FROM financial_years WHERE company_id=? AND is_default=1 FOR UPDATE",
          [values.companyId]
        );
        previousDefaultId = defaults[0]?.id || null;
        await connection.query(
          "UPDATE financial_years SET is_default=0 WHERE company_id=? AND is_default=1",
          [values.companyId]
        );
      }

      const [result] = await connection.query(
        `INSERT INTO financial_years
          (company_id,code,name,start_date,end_date,status,is_default,source,created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [values.companyId, values.code, values.name, values.startDate, values.endDate,
          values.status, values.isDefault ? 1 : 0, values.source, values.actorUserId]
      );

      await insertEvent(connection, {
        companyId: values.companyId,
        financialYearId: result.insertId,
        eventType: "CREATE",
        previousStatus: null,
        newStatus: values.status,
        reason: values.reason,
        actorUserId: values.actorUserId,
        metadata: { source: values.source },
      });
      if (values.isDefault) {
        await insertEvent(connection, {
          companyId: values.companyId,
          financialYearId: result.insertId,
          eventType: "SET_DEFAULT",
          previousStatus: values.status,
          newStatus: values.status,
          reason: values.reason,
          actorUserId: values.actorUserId,
          metadata: { previous_default_financial_year_id: previousDefaultId },
        });
      }
      const [created] = await connection.query(`${FY_SELECT} WHERE id=? AND company_id=?`, [result.insertId, values.companyId]);
      return rowShape(created[0]);
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
};

const setDefaultFinancialYear = async ({ companyId, financialYearId, actorUserId = null, reason = null }, executor = db) => {
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const normalizedYearId = positiveId(financialYearId, "financialYearId");
  const normalizedActorId = actorUserId === null ? null : positiveId(actorUserId, "actorUserId");
  const normalizedReason = normalizeText(reason, "reason", 500);

  try {
    return await withTransaction(executor, async (connection) => {
      await lockCompany(connection, normalizedCompanyId);
      await validateActor(connection, normalizedCompanyId, normalizedActorId);
      const [years] = await connection.query(
        `${FY_SELECT} WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE`,
        [normalizedYearId, normalizedCompanyId]
      );
      if (!years.length) fail("FINANCIAL_YEAR_NOT_FOUND", "Financial year not found", 404);
      const selected = rowShape(years[0]);
      if (selected.is_default) return selected;

      const [defaults] = await connection.query(
        "SELECT id FROM financial_years WHERE company_id=? AND is_default=1 FOR UPDATE",
        [normalizedCompanyId]
      );
      // Clear first, then set, so MySQL never observes a transient second value
      // in the generated-column unique key while changing the default.
      await connection.query(
        "UPDATE financial_years SET is_default=0 WHERE company_id=? AND is_default=1",
        [normalizedCompanyId]
      );
      await connection.query(
        "UPDATE financial_years SET is_default=1 WHERE id=? AND company_id=?",
        [normalizedYearId, normalizedCompanyId]
      );
      await insertEvent(connection, {
        companyId: normalizedCompanyId,
        financialYearId: normalizedYearId,
        eventType: "SET_DEFAULT",
        previousStatus: selected.status,
        newStatus: selected.status,
        reason: normalizedReason,
        actorUserId: normalizedActorId,
        metadata: { previous_default_financial_year_id: defaults[0]?.id || null },
      });
      const [updated] = await connection.query(`${FY_SELECT} WHERE id=? AND company_id=?`, [normalizedYearId, normalizedCompanyId]);
      return rowShape(updated[0]);
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
};

module.exports = {
  FinancialYearServiceError,
  FY_STATUSES,
  accountingDate,
  createFinancialYear,
  getDefaultFinancialYear,
  getFinancialYear,
  listFinancialYears,
  listFinancialYearEvents,
  resolveFinancialYearForDate,
  requireFinancialYearForDate,
  rejectClientFinancialYear,
  setDefaultFinancialYear,
};
