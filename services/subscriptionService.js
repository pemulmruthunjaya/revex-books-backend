const db = require("../db/connection");

const MAX_TRIAL_DAYS = 365;
const MAX_IDEMPOTENCY_KEY_LENGTH = 64;
const DEFAULT_EXPIRY_BATCH_SIZE = 100;
const MAX_EXPIRY_BATCH_SIZE = 500;
const BILLING_CYCLES = new Set(["monthly", "annual", "custom"]);

class SubscriptionServiceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SubscriptionServiceError";
    this.code = code;
    this.status = code === "COMPANY_NOT_FOUND" || code === "PLAN_NOT_FOUND" ? 404 : 409;
    if (details !== undefined) this.details = details;
  }
}

const serviceError = (code, message, details) =>
  new SubscriptionServiceError(code, message, details);

const asPositiveInteger = (value, code, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw serviceError(code, `${label} must be a positive integer`);
  }
  return number;
};

const normalizeIdempotencyKey = (value) => {
  const key = String(value || "").trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw serviceError(
      "INVALID_IDEMPOTENCY_KEY",
      `idempotencyKey is required and must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`
    );
  }
  return key;
};

const normalizeActor = (actor = {}) => ({
  type: String(actor.type || "system").trim().slice(0, 30) || "system",
  userId: actor.userId === null || actor.userId === undefined
    ? null
    : asPositiveInteger(actor.userId, "INVALID_ACTOR", "actor.userId"),
  reason: actor.reason ? String(actor.reason).trim() : null,
  metadata: actor.metadata && typeof actor.metadata === "object" ? actor.metadata : {},
});

const parseJson = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const canonicalDateInput = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw serviceError("INVALID_PERIOD", "Invalid period date");
    }
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  const text = String(value).trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    throw serviceError("INVALID_PERIOD", "Invalid period date");
  }
  return new Date(text).toISOString().slice(0, 19).replace("T", " ");
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalJson(value[key]);
        return result;
      }, {});
  }
  return value;
};

const sameIntent = (storedMetadata, expectedIntent) => {
  const stored = parseJson(storedMetadata).intent;
  if (!stored) return false;
  return JSON.stringify(canonicalJson(stored))
    === JSON.stringify(canonicalJson(expectedIntent));
};

const formatCompany = (row) => ({
  id: Number(row.company_id),
  status: row.company_status,
});

const formatSubscription = (row) => row.subscription_id ? {
  id: Number(row.subscription_id),
  company_id: Number(row.company_id),
  plan_id: row.subscription_plan_id === null ? null : Number(row.subscription_plan_id),
  status: row.subscription_status,
  billing_cycle: row.billing_cycle,
  trial_start_at: row.trial_start_at,
  trial_end_at: row.trial_end_at,
  trial_duration_days: row.trial_duration_days,
  subscription_start_at: row.subscription_start_at,
  current_period_start_at: row.current_period_start_at,
  current_period_end_at: row.current_period_end_at,
  cancel_at_period_end: Number(row.cancel_at_period_end || 0) === 1,
  cancelled_at: row.cancelled_at,
  expired_at: row.expired_at,
  suspended_at: row.suspended_at,
  activation_source: row.activation_source,
} : null;

const formatPlan = (row) => row.plan_id ? {
  id: Number(row.plan_id),
  code: row.plan_code,
  name: row.plan_name,
} : null;

const evaluateAccess = (row) => {
  if (String(row.company_status || "").toLowerCase() !== "active") {
    return { valid: false, reason: "COMPANY_INACTIVE", expires_at: null };
  }
  if (!row.subscription_id) {
    return { valid: false, reason: "SUBSCRIPTION_NOT_PROVISIONED", expires_at: null };
  }

  const status = String(row.subscription_status || "").toLowerCase();
  if (status === "active") {
    if (!row.current_period_end_at) {
      return { valid: true, reason: "SUBSCRIPTION_ACTIVE", expires_at: null };
    }
    return Number(row.paid_period_is_current) === 1
      ? { valid: true, reason: "SUBSCRIPTION_ACTIVE", expires_at: row.current_period_end_at }
      : { valid: false, reason: "PAID_PERIOD_EXPIRED", expires_at: row.current_period_end_at };
  }
  if (status === "trialing") {
    if (!row.trial_end_at) {
      return { valid: false, reason: "TRIAL_END_MISSING", expires_at: null };
    }
    return Number(row.trial_is_current) === 1
      ? { valid: true, reason: "TRIAL_ACTIVE", expires_at: row.trial_end_at }
      : { valid: false, reason: "TRIAL_EXPIRED", expires_at: row.trial_end_at };
  }

  const invalidReasons = {
    expired: "SUBSCRIPTION_EXPIRED",
    suspended: "SUBSCRIPTION_SUSPENDED",
    cancelled: "SUBSCRIPTION_CANCELLED",
    past_due: "SUBSCRIPTION_PAST_DUE",
  };
  return {
    valid: false,
    reason: invalidReasons[status] || "SUBSCRIPTION_STATE_INVALID",
    expires_at: row.current_period_end_at || row.trial_end_at || null,
  };
};

const getEffectiveSubscription = async (companyId, options = {}) => {
  const normalizedCompanyId = asPositiveInteger(companyId, "COMPANY_NOT_FOUND", "companyId");
  const executor = options.connection || db;
  const [rows] = await executor.query(
    `SELECT
       c.id AS company_id,
       c.status AS company_status,
       cs.id AS subscription_id,
       cs.plan_id AS subscription_plan_id,
       cs.status AS subscription_status,
       cs.billing_cycle,
       cs.trial_start_at,
       cs.trial_end_at,
       cs.trial_duration_days,
       cs.subscription_start_at,
       cs.current_period_start_at,
       cs.current_period_end_at,
       cs.cancel_at_period_end,
       cs.cancelled_at,
       cs.expired_at,
       cs.suspended_at,
       cs.activation_source,
       p.id AS plan_id,
       p.code AS plan_code,
       p.name AS plan_name,
       UTC_TIMESTAMP() AS database_now,
       CASE
         WHEN cs.trial_end_at IS NOT NULL AND cs.trial_end_at > UTC_TIMESTAMP() THEN 1
         ELSE 0
       END AS trial_is_current,
       CASE
         WHEN cs.current_period_end_at IS NOT NULL
          AND cs.current_period_end_at > UTC_TIMESTAMP() THEN 1
         ELSE 0
       END AS paid_period_is_current
     FROM companies c
     LEFT JOIN company_subscriptions cs ON cs.company_id = c.id
     LEFT JOIN plans p ON p.id = cs.plan_id
     WHERE c.id = ?
     LIMIT 1`,
    [normalizedCompanyId]
  );

  if (!rows.length) {
    throw serviceError("COMPANY_NOT_FOUND", "Company not found");
  }
  const row = rows[0];
  return {
    company: formatCompany(row),
    subscription: formatSubscription(row),
    plan: formatPlan(row),
    access: evaluateAccess(row),
  };
};

const withMutationTransaction = async (callerConnection, work) => {
  if (callerConnection) return work(callerConnection);

  const connection = await db.getConnection();
  let started = false;
  try {
    await connection.beginTransaction();
    started = true;
    const result = await work(connection);
    await connection.commit();
    started = false;
    return result;
  } catch (error) {
    if (started) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lockCompany = async (connection, companyId) => {
  const [rows] = await connection.query(
    `SELECT id, status, plan_id
       FROM companies
      WHERE id = ?
      FOR UPDATE`,
    [companyId]
  );
  if (!rows.length) throw serviceError("COMPANY_NOT_FOUND", "Company not found");
  if (String(rows[0].status || "").toLowerCase() !== "active") {
    throw serviceError("COMPANY_INACTIVE", "Company is inactive");
  }
  return rows[0];
};

const lockSubscription = async (connection, companyId) => {
  const [rows] = await connection.query(
    `SELECT *
       FROM company_subscriptions
      WHERE company_id = ?
      FOR UPDATE`,
    [companyId]
  );
  return rows[0] || null;
};

const lockPlan = async (connection, planId) => {
  const [rows] = await connection.query(
    `SELECT id, code, name, price, is_active, default_trial_days,
            max_users, max_staff
       FROM plans
      WHERE id = ?
      FOR UPDATE`,
    [planId]
  );
  if (!rows.length) throw serviceError("PLAN_NOT_FOUND", "Plan not found");
  if (Number(rows[0].is_active) !== 1) {
    throw serviceError("PLAN_INACTIVE", "Plan is inactive");
  }
  return rows[0];
};

const findRequestEvent = async (connection, subscriptionId, requestId) => {
  const [rows] = await connection.query(
    `SELECT id, event_type, new_plan_id, metadata, request_id
       FROM subscription_events
      WHERE subscription_id = ? AND request_id = ?
      LIMIT 1`,
    [subscriptionId, requestId]
  );
  return rows[0] || null;
};

const idempotentResultOrConflict = async ({
  connection,
  companyId,
  subscriptionId,
  requestId,
  eventType,
  intent,
}) => {
  const event = await findRequestEvent(connection, subscriptionId, requestId);
  if (!event) return null;
  if (event.event_type !== eventType || !sameIntent(event.metadata, intent)) {
    throw serviceError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used with different subscription parameters"
    );
  }
  return getEffectiveSubscription(companyId, { connection });
};

const insertEvent = async (connection, data) => {
  await connection.query(
    `INSERT INTO subscription_events
      (subscription_id, company_id, event_type, from_status, to_status,
       old_plan_id, new_plan_id, effective_at, actor_type, actor_user_id,
       reason, metadata, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.subscriptionId,
      data.companyId,
      data.eventType,
      data.fromStatus,
      data.toStatus,
      data.oldPlanId,
      data.newPlanId,
      data.effectiveAt,
      data.actor.type,
      data.actor.userId,
      data.actor.reason,
      JSON.stringify(data.metadata),
      data.requestId,
    ]
  );
};

const createTrialCompany = async ({
  companyId,
  planId,
  trialDays,
  actor,
  idempotencyKey,
  connection: callerConnection,
} = {}) => {
  const normalizedCompanyId = asPositiveInteger(companyId, "COMPANY_NOT_FOUND", "companyId");
  const normalizedPlanId = asPositiveInteger(planId, "PLAN_NOT_FOUND", "planId");
  const key = normalizeIdempotencyKey(idempotencyKey);
  const normalizedActor = normalizeActor(actor);
  const requestId = `trial-created:${key}`;
  const sourceKey = `trial:${key}`;

  return withMutationTransaction(callerConnection, async (connection) => {
    const company = await lockCompany(connection, normalizedCompanyId);
    let subscription = await lockSubscription(connection, normalizedCompanyId);
    const plan = await lockPlan(connection, normalizedPlanId);
    const resolvedTrialDays = trialDays === null || trialDays === undefined || trialDays === ""
      ? Number(plan.default_trial_days)
      : Number(trialDays);
    if (!Number.isSafeInteger(resolvedTrialDays)
      || resolvedTrialDays <= 0
      || resolvedTrialDays > MAX_TRIAL_DAYS) {
      throw serviceError(
        "INVALID_TRIAL_DURATION",
        `trialDays must be between 1 and ${MAX_TRIAL_DAYS}`
      );
    }

    const intent = {
      operation: "create_trial",
      plan_id: normalizedPlanId,
      trial_days: resolvedTrialDays,
    };

    if (subscription) {
      const retryResult = await idempotentResultOrConflict({
        connection,
        companyId: normalizedCompanyId,
        subscriptionId: subscription.id,
        requestId,
        eventType: "trial_created",
        intent,
      });
      if (retryResult) return retryResult;

      if (String(subscription.status).toLowerCase() === "active") {
        throw serviceError(
          "SUBSCRIPTION_ALREADY_ACTIVE",
          "An active subscription cannot be converted to a trial"
        );
      }
      if (!["demo", "provisioning"].includes(String(subscription.status).toLowerCase())) {
        throw serviceError(
          "INVALID_SUBSCRIPTION_TRANSITION",
          `Cannot create a trial from subscription status ${subscription.status}`
        );
      }
    }

    const [clockRows] = await connection.query(
      `SELECT UTC_TIMESTAMP() AS starts_at,
              DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) AS ends_at`,
      [resolvedTrialDays]
    );
    const startsAt = clockRows[0].starts_at;
    const endsAt = clockRows[0].ends_at;
    const previousStatus = subscription ? subscription.status : null;
    const previousPlanId = subscription ? subscription.plan_id : company.plan_id;

    if (!subscription) {
      const [result] = await connection.query(
        `INSERT INTO company_subscriptions
          (company_id, plan_id, status, billing_cycle, trial_start_at,
           trial_end_at, trial_duration_days, current_period_start_at,
           current_period_end_at, activation_source, auto_renew)
         VALUES (?, ?, 'trialing', 'none', ?, ?, ?, ?, ?, 'manual_trial', 0)`,
        [
          normalizedCompanyId,
          normalizedPlanId,
          startsAt,
          endsAt,
          resolvedTrialDays,
          startsAt,
          endsAt,
        ]
      );
      subscription = { id: result.insertId };
    } else {
      await connection.query(
        `UPDATE company_subscriptions
            SET plan_id = ?, status = 'trialing', billing_cycle = 'none',
                trial_start_at = ?, trial_end_at = ?, trial_duration_days = ?,
                current_period_start_at = ?, current_period_end_at = ?,
                expired_at = NULL, cancelled_at = NULL, suspended_at = NULL,
                suspension_reason = NULL, activation_source = 'manual_trial',
                auto_renew = 0, version = version + 1
          WHERE id = ? AND company_id = ?`,
        [
          normalizedPlanId,
          startsAt,
          endsAt,
          resolvedTrialDays,
          startsAt,
          endsAt,
          subscription.id,
          normalizedCompanyId,
        ]
      );
    }

    await connection.query(
      "UPDATE companies SET plan_id = ? WHERE id = ?",
      [normalizedPlanId, normalizedCompanyId]
    );
    await connection.query(
      `INSERT INTO subscription_periods
        (subscription_id, company_id, plan_id, period_type, billing_cycle,
         starts_at, ends_at, status, source_key, staff_limit_snapshot,
         user_limit_snapshot, price_snapshot, currency)
       VALUES (?, ?, ?, 'trial', 'none', ?, ?, 'active', ?, ?, ?, ?, 'INR')`,
      [
        subscription.id,
        normalizedCompanyId,
        normalizedPlanId,
        startsAt,
        endsAt,
        sourceKey,
        plan.max_staff,
        plan.max_users,
        plan.price,
      ]
    );
    await insertEvent(connection, {
      subscriptionId: subscription.id,
      companyId: normalizedCompanyId,
      eventType: "trial_created",
      fromStatus: previousStatus,
      toStatus: "trialing",
      oldPlanId: previousPlanId,
      newPlanId: normalizedPlanId,
      effectiveAt: startsAt,
      actor: normalizedActor,
      requestId,
      metadata: {
        intent,
        trial_start_at: startsAt,
        trial_end_at: endsAt,
        source: "subscription_service",
        actor_metadata: normalizedActor.metadata,
      },
    });

    return getEffectiveSubscription(normalizedCompanyId, { connection });
  });
};

const calculatePaidPeriod = async (
  connection,
  billingCycle,
  requestedStartAt,
  requestedEndAt
) => {
  // activateSubscription normalizes caller input to a UTC MySQL DATETIME once.
  // Parsing that normalized string again would reinterpret it in the Node
  // process timezone and shift the stored instant.
  const startInput = requestedStartAt;
  const endInput = requestedEndAt;
  if (billingCycle === "custom" && !endInput) {
    throw serviceError("INVALID_PERIOD", "periodEndAt is required for custom billing");
  }
  if (billingCycle !== "custom" && endInput) {
    throw serviceError(
      "INVALID_PERIOD",
      "periodEndAt must not be supplied for monthly or annual billing"
    );
  }

  const [rows] = await connection.query(
    `SELECT
       COALESCE(?, UTC_TIMESTAMP()) AS starts_at,
       CASE
         WHEN ? = 'monthly' THEN DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL 1 MONTH)
         WHEN ? = 'annual' THEN DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL 1 YEAR)
         ELSE ?
       END AS ends_at,
       CASE
         WHEN (CASE
           WHEN ? = 'monthly' THEN DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL 1 MONTH)
           WHEN ? = 'annual' THEN DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL 1 YEAR)
           ELSE ?
         END) > COALESCE(?, UTC_TIMESTAMP()) THEN 1 ELSE 0
       END AS is_valid`,
    [
      startInput,
      billingCycle,
      startInput,
      billingCycle,
      startInput,
      endInput,
      billingCycle,
      startInput,
      billingCycle,
      startInput,
      endInput,
      startInput,
    ]
  );
  if (!rows.length || Number(rows[0].is_valid) !== 1) {
    throw serviceError("INVALID_PERIOD", "Paid period end must be after its start");
  }
  return rows[0];
};

const activateSubscription = async ({
  companyId,
  planId,
  billingCycle,
  periodStartAt,
  periodEndAt,
  actor,
  idempotencyKey,
  connection: callerConnection,
} = {}) => {
  const normalizedCompanyId = asPositiveInteger(companyId, "COMPANY_NOT_FOUND", "companyId");
  const normalizedPlanId = asPositiveInteger(planId, "PLAN_NOT_FOUND", "planId");
  const normalizedCycle = String(billingCycle || "").trim().toLowerCase();
  if (!BILLING_CYCLES.has(normalizedCycle)) {
    throw serviceError(
      "INVALID_BILLING_CYCLE",
      "billingCycle must be monthly, annual, or custom"
    );
  }
  const key = normalizeIdempotencyKey(idempotencyKey);
  const normalizedActor = normalizeActor(actor);
  const requestId = `activated:${key}`;
  const sourceKey = `paid:${key}`;
  const requestedStart = canonicalDateInput(periodStartAt);
  const requestedEnd = canonicalDateInput(periodEndAt);
  const intent = {
    operation: "activate",
    plan_id: normalizedPlanId,
    billing_cycle: normalizedCycle,
    requested_period_start_at: requestedStart,
    requested_period_end_at: requestedEnd,
  };

  return withMutationTransaction(callerConnection, async (connection) => {
    const company = await lockCompany(connection, normalizedCompanyId);
    const subscription = await lockSubscription(connection, normalizedCompanyId);
    const plan = await lockPlan(connection, normalizedPlanId);
    if (!subscription) {
      throw serviceError("SUBSCRIPTION_NOT_PROVISIONED", "Subscription is not provisioned");
    }

    const retryResult = await idempotentResultOrConflict({
      connection,
      companyId: normalizedCompanyId,
      subscriptionId: subscription.id,
      requestId,
      eventType: "activated",
      intent,
    });
    if (retryResult) return retryResult;

    const previousStatus = String(subscription.status || "").toLowerCase();
    if (!["trialing", "expired"].includes(previousStatus)) {
      throw serviceError(
        "INVALID_SUBSCRIPTION_TRANSITION",
        `Cannot activate a subscription from status ${subscription.status}`
      );
    }
    if (previousStatus === "expired"
      && (!subscription.trial_start_at || !subscription.trial_end_at)) {
      throw serviceError(
        "INVALID_SUBSCRIPTION_TRANSITION",
        "Only an expired trial can be activated in this phase"
      );
    }

    const period = await calculatePaidPeriod(
      connection,
      normalizedCycle,
      requestedStart,
      requestedEnd
    );

    await connection.query(
      `UPDATE company_subscriptions
          SET plan_id = ?, status = 'active', billing_cycle = ?,
              subscription_start_at = ?, current_period_start_at = ?,
              current_period_end_at = ?, activated_at = UTC_TIMESTAMP(),
              activation_source = 'manual_admin', expired_at = NULL,
              suspended_at = NULL, suspension_reason = NULL,
              cancel_at_period_end = 0, cancelled_at = NULL,
              auto_renew = 0, version = version + 1
        WHERE id = ? AND company_id = ?`,
      [
        normalizedPlanId,
        normalizedCycle,
        period.starts_at,
        period.starts_at,
        period.ends_at,
        subscription.id,
        normalizedCompanyId,
      ]
    );
    await connection.query(
      "UPDATE companies SET plan_id = ? WHERE id = ?",
      [normalizedPlanId, normalizedCompanyId]
    );
    await connection.query(
      `UPDATE subscription_periods
          SET status = 'completed'
        WHERE subscription_id = ? AND company_id = ?
          AND period_type = 'trial' AND status = 'active'`,
      [subscription.id, normalizedCompanyId]
    );
    await connection.query(
      `INSERT INTO subscription_periods
        (subscription_id, company_id, plan_id, period_type, billing_cycle,
         starts_at, ends_at, status, source_key, staff_limit_snapshot,
         user_limit_snapshot, price_snapshot, currency)
       VALUES (?, ?, ?, 'paid', ?, ?, ?, 'active', ?, ?, ?, ?, 'INR')`,
      [
        subscription.id,
        normalizedCompanyId,
        normalizedPlanId,
        normalizedCycle,
        period.starts_at,
        period.ends_at,
        sourceKey,
        plan.max_staff,
        plan.max_users,
        plan.price,
      ]
    );
    await insertEvent(connection, {
      subscriptionId: subscription.id,
      companyId: normalizedCompanyId,
      eventType: "activated",
      fromStatus: subscription.status,
      toStatus: "active",
      oldPlanId: subscription.plan_id === null ? company.plan_id : subscription.plan_id,
      newPlanId: normalizedPlanId,
      effectiveAt: period.starts_at,
      actor: normalizedActor,
      requestId,
      metadata: {
        intent,
        period_start_at: period.starts_at,
        period_end_at: period.ends_at,
        source: "manual_admin",
        actor_metadata: normalizedActor.metadata,
      },
    });

    return getEffectiveSubscription(normalizedCompanyId, { connection });
  });
};

const activateSubscriptionByPlanCode = async ({
  companyId,
  planCode,
  billingCycle,
  periodStartAt,
  periodEndAt,
  actor,
  idempotencyKey,
  connection: callerConnection,
} = {}) => {
  const normalizedCode = String(planCode || "").trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length > 50) {
    throw serviceError("PLAN_NOT_FOUND", "Plan not found");
  }

  return withMutationTransaction(callerConnection, async (connection) => {
    const [plans] = await connection.query(
      `SELECT id, is_active
         FROM plans
        WHERE code = ?
        LIMIT 1
        FOR UPDATE`,
      [normalizedCode]
    );
    if (!plans.length) throw serviceError("PLAN_NOT_FOUND", "Plan not found");
    if (Number(plans[0].is_active) !== 1) {
      throw serviceError("PLAN_INACTIVE", "Plan is inactive");
    }

    return activateSubscription({
      companyId,
      planId: plans[0].id,
      billingCycle,
      periodStartAt,
      periodEndAt,
      actor,
      idempotencyKey,
      connection,
    });
  });
};

const normalizeBatchSize = (value) => {
  const batchSize = value === undefined || value === null || value === ""
    ? DEFAULT_EXPIRY_BATCH_SIZE
    : Number(value);
  if (!Number.isSafeInteger(batchSize)
    || batchSize <= 0
    || batchSize > MAX_EXPIRY_BATCH_SIZE) {
    throw serviceError(
      "INVALID_BATCH_SIZE",
      `batchSize must be between 1 and ${MAX_EXPIRY_BATCH_SIZE}`
    );
  }
  return batchSize;
};

const expireDueTrialCandidate = async (candidate, callerConnection) =>
  withMutationTransaction(callerConnection, async (connection) => {
    const [rows] = await connection.query(
      `SELECT id, company_id, plan_id, status, trial_start_at, trial_end_at,
              DATE_FORMAT(trial_end_at, '%Y%m%d%H%i%s') AS trial_end_key,
              CASE
                WHEN status = 'trialing'
                 AND trial_end_at IS NOT NULL
                 AND trial_end_at <= UTC_TIMESTAMP() THEN 1
                ELSE 0
              END AS is_due
         FROM company_subscriptions
        WHERE id = ?
        FOR UPDATE`,
      [candidate.id]
    );
    if (!rows.length || Number(rows[0].is_due) !== 1) {
      return { outcome: "skipped", subscriptionId: candidate.id };
    }

    const subscription = rows[0];
    const requestId = `trial-expired:${subscription.id}:${subscription.trial_end_key}`;
    const existingEvent = await findRequestEvent(
      connection,
      subscription.id,
      requestId
    );
    if (existingEvent && existingEvent.event_type !== "trial_expired") {
      throw serviceError(
        "IDEMPOTENCY_CONFLICT",
        "The deterministic trial-expiry request ID is already used by another event"
      );
    }

    await connection.query(
      `UPDATE company_subscriptions
          SET status = 'expired', expired_at = trial_end_at,
              version = version + 1
        WHERE id = ? AND company_id = ? AND status = 'trialing'`,
      [subscription.id, subscription.company_id]
    );
    await connection.query(
      `UPDATE subscription_periods
          SET status = 'expired'
        WHERE subscription_id = ? AND company_id = ?
          AND period_type = 'trial' AND status = 'active'`,
      [subscription.id, subscription.company_id]
    );

    if (!existingEvent) {
      await insertEvent(connection, {
        subscriptionId: subscription.id,
        companyId: subscription.company_id,
        eventType: "trial_expired",
        fromStatus: "trialing",
        toStatus: "expired",
        oldPlanId: subscription.plan_id,
        newPlanId: subscription.plan_id,
        effectiveAt: subscription.trial_end_at,
        actor: {
          type: "system",
          userId: null,
          reason: "Trial reached configured end time",
        },
        requestId,
        metadata: {
          trial_end_at: subscription.trial_end_at,
          source: "subscription_expiry_scheduler",
        },
      });
    }

    return {
      outcome: "expired",
      subscriptionId: subscription.id,
      companyId: subscription.company_id,
      requestId,
    };
  });

const expireDueTrials = async (options = {}) => {
  const batchSize = normalizeBatchSize(options.batchSize);
  const discoveryExecutor = options.connection || db;
  const [candidates] = await discoveryExecutor.query(
    `SELECT id, company_id
       FROM company_subscriptions
      WHERE status = 'trialing'
        AND trial_end_at IS NOT NULL
        AND trial_end_at <= UTC_TIMESTAMP()
      ORDER BY trial_end_at ASC, id ASC
      LIMIT ?`,
    [batchSize]
  );

  const summary = {
    found: candidates.length,
    expired: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const candidate of candidates) {
    try {
      const result = await expireDueTrialCandidate(candidate, options.connection);
      if (result.outcome === "expired") summary.expired += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        subscription_id: candidate.id,
        company_id: candidate.company_id,
        code: error.code || "TRIAL_EXPIRY_FAILED",
        message: error.message,
      });
    }
  }
  return summary;
};

module.exports = {
  BILLING_CYCLES,
  DEFAULT_EXPIRY_BATCH_SIZE,
  MAX_TRIAL_DAYS,
  SubscriptionServiceError,
  activateSubscription,
  activateSubscriptionByPlanCode,
  createTrialCompany,
  expireDueTrials,
  getEffectiveSubscription,
};
