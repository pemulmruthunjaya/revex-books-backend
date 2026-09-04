const financialYearService = require("../services/financialYearService");

const CREATE_FIELDS = new Set([
  "code",
  "name",
  "start_date",
  "end_date",
  "status",
  "is_default",
]);

const ERROR_RESPONSES = {
  INVALID_ID: [400, "Invalid identifier"],
  INVALID_DATE: [400, "Invalid accounting date"],
  INVALID_DATE_RANGE: [400, "Financial year start date must be on or before end date"],
  INVALID_INPUT: [400, "Invalid financial year details"],
  INVALID_STATUS: [400, "Invalid financial year status"],
  COMPANY_NOT_FOUND: [404, "Company not found"],
  FINANCIAL_YEAR_NOT_FOUND: [404, "Financial year not found"],
  ACTOR_COMPANY_MISMATCH: [403, "User is not authorized for this company"],
  FINANCIAL_YEAR_OVERLAP: [409, "Financial year dates overlap an existing financial year"],
  DUPLICATE_FINANCIAL_YEAR_CODE: [409, "Financial year code already exists"],
  DUPLICATE_FINANCIAL_YEAR_DATES: [409, "Financial year date range already exists"],
  DEFAULT_FINANCIAL_YEAR_CONFLICT: [409, "Unable to change the default financial year"],
};

const companyContext = (req) => {
  const companyId = Number(req.user?.company_id);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return null;
  return companyId;
};

const actorContext = (req) => {
  const actorId = Number(req.user?.user_id || req.user?.id);
  return Number.isSafeInteger(actorId) && actorId > 0 ? actorId : null;
};

const sendError = (res, error, logger) => {
  const safe = ERROR_RESPONSES[error?.code];
  if (safe) {
    return res.status(safe[0]).json({ success: false, code: error.code, message: safe[1] });
  }
  logger.error("Financial year API error", error);
  return res.status(500).json({
    success: false,
    code: "FINANCIAL_YEAR_OPERATION_FAILED",
    message: "Unable to complete the financial year operation",
  });
};

const createFinancialYearController = ({ service = financialYearService, logger = console } = {}) => {
  const requireCompany = (req, res) => {
    const companyId = companyContext(req);
    if (companyId) return companyId;
    res.status(401).json({
      success: false,
      code: "COMPANY_CONTEXT_REQUIRED",
      message: "Authenticated company context is required",
    });
    return null;
  };

  const list = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
      const years = await service.listFinancialYears(companyId);
      return res.json({ success: true, data: years });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const getOne = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
      const year = await service.getFinancialYear(companyId, req.params.id);
      if (!year) {
        return res.status(404).json({ success: false, code: "FINANCIAL_YEAR_NOT_FOUND", message: "Financial year not found" });
      }
      return res.json({ success: true, data: year });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const getDefault = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
      const year = await service.getDefaultFinancialYear(companyId);
      if (!year) {
        return res.status(404).json({ success: false, code: "DEFAULT_FINANCIAL_YEAR_NOT_FOUND", message: "Default financial year not found" });
      }
      return res.json({ success: true, data: year });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const resolve = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
      const year = await service.resolveFinancialYearForDate(companyId, req.query.date);
      if (!year) {
        return res.status(404).json({
          success: false,
          code: "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE",
          message: "No financial year contains the supplied accounting date",
        });
      }
      return res.json({ success: true, data: year });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const create = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const unsupported = Object.keys(body).filter((key) => !CREATE_FIELDS.has(key));
    if (unsupported.length) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_FIELD",
        message: "Request contains unsupported financial year fields",
      });
    }
    try {
      const year = await service.createFinancialYear({
        companyId,
        code: body.code,
        name: body.name,
        startDate: body.start_date,
        endDate: body.end_date,
        status: body.status,
        isDefault: body.is_default === true,
        source: "API",
        actorUserId: actorContext(req),
        reason: "Financial year created",
      });
      return res.status(201).json({ success: true, data: year });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const setDefault = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (req.body && Object.keys(req.body).length) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_FIELD",
        message: "Setting the default financial year does not accept request fields",
      });
    }
    try {
      const year = await service.setDefaultFinancialYear({
        companyId,
        financialYearId: req.params.id,
        actorUserId: actorContext(req),
        reason: "Default financial year changed",
      });
      return res.json({ success: true, data: year });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const events = async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
      const year = await service.getFinancialYear(companyId, req.params.id);
      if (!year) {
        return res.status(404).json({ success: false, code: "FINANCIAL_YEAR_NOT_FOUND", message: "Financial year not found" });
      }
      const history = await service.listFinancialYearEvents(companyId, req.params.id);
      return res.json({ success: true, data: history });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  return { create, events, getDefault, getOne, list, resolve, setDefault };
};

module.exports = {
  CREATE_FIELDS,
  createFinancialYearController,
  ...createFinancialYearController(),
};
