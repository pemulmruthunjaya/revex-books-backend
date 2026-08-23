const db = require("../db/connection");

const parsePage = (value, fallback = 1, maximum = 100) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
};

const asyncHandler = (handler, logger = console) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    logger.error("Platform portal request failed");
    return res.status(500).json({ message: "Unable to load platform data" });
  }
};

const createPlatformPortalController = ({ executor = db, logger = console } = {}) => {
  const dashboard = asyncHandler(async (req, res) => {
    const [[companyTotals], [subscriptionTotals], [recentCompanies], [recentActivity], [upcomingExpiries]] = await Promise.all([
      executor.query(`SELECT
        (SELECT COUNT(*) FROM companies) AS total_companies,
        (SELECT COUNT(*) FROM users) AS total_tenant_users`),
      executor.query(`SELECT
        COALESCE(SUM(status = 'active'), 0) AS active_subscriptions,
        COALESCE(SUM(status = 'trialing'), 0) AS trialing,
        COALESCE(SUM(status = 'expired'), 0) AS expired,
        COALESCE(SUM(status = 'suspended'), 0) AS suspended,
        COALESCE(SUM(current_period_end_at >= UTC_TIMESTAMP() AND current_period_end_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY)), 0) AS renewals_due_soon
        FROM company_subscriptions`),
      executor.query(`SELECT id, name, status, created_at FROM companies ORDER BY created_at DESC, id DESC LIMIT 6`),
      executor.query(`SELECT se.id, se.company_id, c.name AS company_name, se.event_type, se.from_status, se.to_status, se.effective_at
        FROM subscription_events se INNER JOIN companies c ON c.id = se.company_id
        ORDER BY se.effective_at DESC, se.id DESC LIMIT 8`),
      executor.query(`SELECT cs.company_id, c.name AS company_name, p.name AS plan_name, cs.status,
          COALESCE(cs.current_period_end_at, cs.trial_end_at) AS expires_at
        FROM company_subscriptions cs INNER JOIN companies c ON c.id = cs.company_id
        LEFT JOIN plans p ON p.id = cs.plan_id
        WHERE COALESCE(cs.current_period_end_at, cs.trial_end_at) >= UTC_TIMESTAMP()
          AND COALESCE(cs.current_period_end_at, cs.trial_end_at) < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY)
        ORDER BY expires_at ASC LIMIT 8`),
    ]);
    return res.json({
      kpis: { ...companyTotals[0], ...subscriptionTotals[0] },
      recent_companies: recentCompanies,
      recent_subscription_activity: recentActivity,
      upcoming_expiries: upcomingExpiries,
      generated_at: new Date().toISOString(),
    });
  }, logger);

  const companies = asyncHandler(async (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = parsePage(req.query.page_size, 20, 50);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const planId = Number(req.query.plan_id);
    const where = [];
    const params = [];
    if (search) {
      where.push("(c.name LIKE ? OR EXISTS (SELECT 1 FROM users ou WHERE ou.company_id = c.id AND ou.role = 'owner' AND ou.email LIKE ?))");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) { where.push("cs.status = ?"); params.push(status); }
    if (Number.isSafeInteger(planId) && planId > 0) { where.push("cs.plan_id = ?"); params.push(planId); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [[countRows], [rows], [plans]] = await Promise.all([
      executor.query(`SELECT COUNT(*) AS total FROM companies c LEFT JOIN company_subscriptions cs ON cs.company_id = c.id ${clause}`, params),
      executor.query(`SELECT c.id, c.name, c.status AS company_status, c.created_at,
          (SELECT ou.email FROM users ou WHERE ou.company_id = c.id AND ou.role = 'owner' ORDER BY ou.id LIMIT 1) AS owner_email,
          (SELECT COUNT(*) FROM users cu WHERE cu.company_id = c.id) AS user_count,
          p.id AS plan_id, p.name AS plan_name, p.code AS plan_code,
          cs.status AS subscription_status, cs.billing_cycle, cs.trial_end_at, cs.current_period_end_at
        FROM companies c LEFT JOIN company_subscriptions cs ON cs.company_id = c.id
        LEFT JOIN plans p ON p.id = cs.plan_id ${clause}
        ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
      executor.query("SELECT id, name, code FROM plans ORDER BY sort_order, name"),
    ]);
    return res.json({ data: rows, plans, pagination: { page, page_size: pageSize, total: Number(countRows[0].total), total_pages: Math.max(1, Math.ceil(Number(countRows[0].total) / pageSize)) } });
  }, logger);

  const companyDetail = asyncHandler(async (req, res) => {
    const companyId = Number(req.params.companyId);
    if (!Number.isSafeInteger(companyId) || companyId <= 0) return res.status(400).json({ message: "Invalid company ID" });
    const [[companiesFound], [users], [subscriptions], [periods], [events]] = await Promise.all([
      executor.query("SELECT id, name, email, phone, gst_number, address, status, created_at, updated_at FROM companies WHERE id = ? LIMIT 1", [companyId]),
      executor.query("SELECT id, name, email, role, access_role, is_active, last_login_at, created_at FROM users WHERE company_id = ? ORDER BY role = 'owner' DESC, name, id", [companyId]),
      executor.query(`SELECT cs.id, cs.company_id, cs.plan_id, p.name AS plan_name, p.code AS plan_code,
          cs.status, cs.billing_cycle, cs.trial_start_at, cs.trial_end_at, cs.subscription_start_at,
          cs.current_period_start_at, cs.current_period_end_at, cs.expired_at, cs.suspended_at,
          cs.cancelled_at, cs.auto_renew, cs.activation_source, cs.version
        FROM company_subscriptions cs LEFT JOIN plans p ON p.id = cs.plan_id WHERE cs.company_id = ? LIMIT 1`, [companyId]),
      executor.query(`SELECT sp.id, sp.period_type, sp.status, sp.starts_at, sp.ends_at, sp.billing_cycle,
          sp.source_key, p.name AS plan_name, p.code AS plan_code
        FROM subscription_periods sp LEFT JOIN plans p ON p.id = sp.plan_id
        WHERE sp.company_id = ? ORDER BY sp.starts_at DESC, sp.id DESC`, [companyId]),
      executor.query(`SELECT id, event_type, from_status, to_status, effective_at, request_id, actor_type, reason
        FROM subscription_events WHERE company_id = ? ORDER BY effective_at DESC, id DESC`, [companyId]),
    ]);
    if (!companiesFound.length) return res.status(404).json({ message: "Company not found" });
    return res.json({ company: companiesFound[0], users, subscription: subscriptions[0] || null, subscription_periods: periods, subscription_events: events });
  }, logger);

  const subscriptions = asyncHandler(async (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = parsePage(req.query.page_size, 20, 50);
    const status = String(req.query.status || "").trim();
    const planId = Number(req.query.plan_id);
    const where = [];
    const params = [];
    if (status) { where.push("cs.status = ?"); params.push(status); }
    if (Number.isSafeInteger(planId) && planId > 0) { where.push("cs.plan_id = ?"); params.push(planId); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [[countRows], [rows], [plans]] = await Promise.all([
      executor.query(`SELECT COUNT(*) AS total FROM company_subscriptions cs ${clause}`, params),
      executor.query(`SELECT cs.id, cs.company_id, c.name AS company_name, p.id AS plan_id, p.name AS plan_name,
          p.code AS plan_code, cs.status, cs.billing_cycle, cs.trial_end_at, cs.current_period_end_at,
          cs.auto_renew, cs.activation_source
        FROM company_subscriptions cs INNER JOIN companies c ON c.id = cs.company_id
        LEFT JOIN plans p ON p.id = cs.plan_id ${clause}
        ORDER BY COALESCE(cs.current_period_end_at, cs.trial_end_at) ASC, cs.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
      executor.query("SELECT id, name, code FROM plans ORDER BY sort_order, name"),
    ]);
    return res.json({ data: rows, plans, pagination: { page, page_size: pageSize, total: Number(countRows[0].total), total_pages: Math.max(1, Math.ceil(Number(countRows[0].total) / pageSize)) } });
  }, logger);

  return { dashboard, companies, companyDetail, subscriptions };
};

module.exports = { createPlatformPortalController, parsePage, ...createPlatformPortalController() };
