const assert = require("node:assert/strict");
const db = require("../db/connection");
const {
  activateSubscription,
  activateSubscriptionByPlanCode,
  createTrialCompany,
  expireDueTrials,
  getEffectiveSubscription,
} = require("../services/subscriptionService");

const NOW = "2026-08-20T00:00:00.000Z";

const clone = (value) => JSON.parse(JSON.stringify(value));

const addMonthsUtc = (iso, months) => {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0
  )).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
};

const createState = (overrides = {}) => ({
  company: { id: 1, status: "active", plan_id: null },
  subscription: null,
  plan: {
    id: 2,
    code: "PLAN_2",
    name: "Pro",
    price: "1999.00",
    is_active: 1,
    default_trial_days: 14,
    max_users: 10,
    max_staff: 8,
  },
  periods: [],
  events: [],
  ...clone(overrides),
});

const effectiveRow = (state) => {
  const subscription = state.subscription;
  const plan = subscription && subscription.plan_id === state.plan?.id ? state.plan : null;
  return {
    company_id: state.company.id,
    company_status: state.company.status,
    subscription_id: subscription?.id || null,
    subscription_plan_id: subscription?.plan_id ?? null,
    subscription_status: subscription?.status || null,
    billing_cycle: subscription?.billing_cycle || null,
    trial_start_at: subscription?.trial_start_at || null,
    trial_end_at: subscription?.trial_end_at || null,
    trial_duration_days: subscription?.trial_duration_days || null,
    subscription_start_at: subscription?.subscription_start_at || null,
    current_period_start_at: subscription?.current_period_start_at || null,
    current_period_end_at: subscription?.current_period_end_at || null,
    cancel_at_period_end: subscription?.cancel_at_period_end || 0,
    cancelled_at: subscription?.cancelled_at || null,
    expired_at: subscription?.expired_at || null,
    suspended_at: subscription?.suspended_at || null,
    activation_source: subscription?.activation_source || null,
    plan_id: plan?.id || null,
    plan_code: plan?.code || null,
    plan_name: plan?.name || null,
    database_now: NOW,
    trial_is_current: subscription?.trial_end_at
      && new Date(subscription.trial_end_at) > new Date(NOW) ? 1 : 0,
    paid_period_is_current: subscription?.current_period_end_at
      && new Date(subscription.current_period_end_at) > new Date(NOW) ? 1 : 0,
  };
};

const createConnection = (state, options = {}) => {
  const calls = [];
  const lifecycle = { begin: 0, commit: 0, rollback: 0, release: 0 };
  const connection = {
    calls,
    lifecycle,
    beginTransaction: async () => { lifecycle.begin += 1; },
    commit: async () => { lifecycle.commit += 1; },
    rollback: async () => { lifecycle.rollback += 1; },
    release: () => { lifecycle.release += 1; },
    query: async (sql, params = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params: clone(params) });

      if (options.failWhen && normalized.includes(options.failWhen)) {
        throw new Error("Injected database failure");
      }
      if (normalized.includes("FROM companies") && normalized.includes("FOR UPDATE")) {
        return [state.company && Number(params[0]) === state.company.id
          ? [clone(state.company)]
          : []];
      }
      if (normalized.includes("FROM company_subscriptions")
        && normalized.includes("FOR UPDATE")) {
        return [state.subscription ? [clone(state.subscription)] : []];
      }
      if (normalized.includes("FROM plans") && normalized.includes("FOR UPDATE")) {
        const matches = normalized.includes("WHERE code = ?")
          ? state.plan && params[0] === state.plan.code
          : state.plan && Number(params[0]) === state.plan.id;
        return [matches ? [clone(state.plan)] : []];
      }
      if (normalized.includes("FROM subscription_events")
        && normalized.includes("request_id = ?")) {
        const event = state.events.find((item) =>
          Number(item.subscription_id) === Number(params[0]) && item.request_id === params[1]);
        if (!event) return [[]];
        const returned = clone(event);
        if (options.reorderEventJson) {
          const metadata = JSON.parse(returned.metadata);
          metadata.intent = Object.fromEntries(Object.entries(metadata.intent).reverse());
          returned.metadata = JSON.stringify(metadata);
        }
        return [[returned]];
      }
      if (normalized.startsWith("SELECT UTC_TIMESTAMP() AS starts_at")) {
        const endsAt = new Date(NOW);
        endsAt.setUTCDate(endsAt.getUTCDate() + Number(params[0]));
        return [[{ starts_at: NOW, ends_at: endsAt.toISOString() }]];
      }
      if (normalized.startsWith("INSERT INTO company_subscriptions")) {
        state.subscription = {
          id: 101,
          company_id: params[0],
          plan_id: params[1],
          status: "trialing",
          billing_cycle: "none",
          trial_start_at: params[2],
          trial_end_at: params[3],
          trial_duration_days: params[4],
          current_period_start_at: params[5],
          current_period_end_at: params[6],
          activation_source: "manual_trial",
          cancel_at_period_end: 0,
        };
        return [{ insertId: 101, affectedRows: 1 }];
      }
      if (normalized.startsWith("UPDATE company_subscriptions")
        && normalized.includes("status = 'trialing'")) {
        Object.assign(state.subscription, {
          plan_id: params[0],
          status: "trialing",
          billing_cycle: "none",
          trial_start_at: params[1],
          trial_end_at: params[2],
          trial_duration_days: params[3],
          current_period_start_at: params[4],
          current_period_end_at: params[5],
          expired_at: null,
          cancelled_at: null,
          suspended_at: null,
          activation_source: "manual_trial",
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized === "UPDATE companies SET plan_id = ? WHERE id = ?") {
        state.company.plan_id = params[0];
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO subscription_periods")) {
        const isTrial = normalized.includes("'trial', 'none'");
        const period = isTrial ? {
          id: state.periods.length + 1,
          subscription_id: params[0],
          company_id: params[1],
          plan_id: params[2],
          period_type: "trial",
          billing_cycle: "none",
          starts_at: params[3],
          ends_at: params[4],
          status: "active",
          source_key: params[5],
        } : {
          id: state.periods.length + 1,
          subscription_id: params[0],
          company_id: params[1],
          plan_id: params[2],
          period_type: "paid",
          billing_cycle: params[3],
          starts_at: params[4],
          ends_at: params[5],
          status: "active",
          source_key: params[6],
        };
        if (state.periods.some((item) =>
          item.subscription_id === period.subscription_id
          && item.source_key === period.source_key)) {
          const error = new Error("Duplicate period");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        state.periods.push(period);
        return [{ insertId: period.id, affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO subscription_events")) {
        const event = {
          id: state.events.length + 1,
          subscription_id: params[0],
          company_id: params[1],
          event_type: params[2],
          from_status: params[3],
          to_status: params[4],
          old_plan_id: params[5],
          new_plan_id: params[6],
          effective_at: params[7],
          actor_type: params[8],
          actor_user_id: params[9],
          reason: params[10],
          metadata: params[11],
          request_id: params[12],
        };
        if (state.events.some((item) =>
          item.subscription_id === event.subscription_id
          && item.request_id === event.request_id)) {
          const error = new Error("Duplicate event");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        state.events.push(event);
        return [{ insertId: event.id, affectedRows: 1 }];
      }
      if (normalized.startsWith("SELECT COALESCE(?, UTC_TIMESTAMP()) AS starts_at")) {
        const start = params[0] || NOW;
        const cycle = params[1];
        const end = cycle === "monthly"
          ? addMonthsUtc(start, 1)
          : cycle === "annual"
            ? addMonthsUtc(start, 12)
            : params[5];
        return [[{
          starts_at: start,
          ends_at: end,
          is_valid: end && new Date(end) > new Date(start) ? 1 : 0,
        }]];
      }
      if (normalized.startsWith("UPDATE company_subscriptions")
        && normalized.includes("status = 'active'")) {
        Object.assign(state.subscription, {
          plan_id: params[0],
          status: "active",
          billing_cycle: params[1],
          subscription_start_at: params[2],
          current_period_start_at: params[3],
          current_period_end_at: params[4],
          activation_source: "manual_admin",
          expired_at: null,
          suspended_at: null,
          cancelled_at: null,
          cancel_at_period_end: 0,
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("UPDATE subscription_periods")
        && normalized.includes("status = 'completed'")) {
        state.periods
          .filter((item) => item.subscription_id === params[0]
            && item.company_id === params[1]
            && item.period_type === "trial"
            && item.status === "active")
          .forEach((item) => { item.status = "completed"; });
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("FROM companies c")
        && normalized.includes("LEFT JOIN company_subscriptions")) {
        return [state.company && Number(params[0]) === state.company.id
          ? [effectiveRow(state)]
          : []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  return connection;
};

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("legacy active company remains valid", async () => {
  const state = createState({
    subscription: {
      id: 10, company_id: 1, plan_id: 2, status: "active",
      billing_cycle: "none", current_period_end_at: null,
      activation_source: "legacy_migration",
    },
  });
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.equal(result.access.valid, true);
  assert.equal(result.access.expires_at, null);
});

test("active company with NULL plan remains valid", async () => {
  const state = createState({
    subscription: {
      id: 10, company_id: 1, plan_id: null, status: "active",
      billing_cycle: "none", current_period_end_at: null,
    },
  });
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.equal(result.plan, null);
  assert.equal(result.access.valid, true);
});

test("active paid period in the future remains valid", async () => {
  const state = createState({
    subscription: {
      id: 10, company_id: 1, plan_id: 2, status: "active",
      billing_cycle: "monthly",
      current_period_end_at: "2026-09-20T00:00:00.000Z",
    },
  });
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.equal(result.access.valid, true);
  assert.equal(result.access.reason, "SUBSCRIPTION_ACTIVE");
});

test("active paid period at its end is invalid", async () => {
  const state = createState({
    subscription: {
      id: 10, company_id: 1, plan_id: 2, status: "active",
      billing_cycle: "monthly", current_period_end_at: NOW,
    },
  });
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.equal(result.access.valid, false);
  assert.equal(result.access.reason, "PAID_PERIOD_EXPIRED");
});

test("valid trial is allowed", async () => {
  const state = createState({
    subscription: {
      id: 10, company_id: 1, plan_id: 2, status: "trialing",
      billing_cycle: "none", trial_end_at: "2026-08-21T00:00:00.000Z",
    },
  });
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.deepEqual(result.access, {
    valid: true,
    reason: "TRIAL_ACTIVE",
    expires_at: "2026-08-21T00:00:00.000Z",
  });
});

test("expired trial is invalid before scheduler state maintenance", async () => {
  const state = createState({
    subscription: {
      id: 10, company_id: 1, plan_id: 2, status: "trialing",
      billing_cycle: "none", trial_end_at: NOW,
    },
  });
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.equal(result.access.valid, false);
  assert.equal(result.access.reason, "TRIAL_EXPIRED");
});

for (const [status, reason] of [
  ["suspended", "SUBSCRIPTION_SUSPENDED"],
  ["cancelled", "SUBSCRIPTION_CANCELLED"],
]) {
  test(`${status} subscription is invalid`, async () => {
    const state = createState({
      subscription: { id: 10, company_id: 1, plan_id: 2, status },
    });
    const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
    assert.equal(result.access.valid, false);
    assert.equal(result.access.reason, reason);
  });
}

test("missing subscription is invalid", async () => {
  const state = createState();
  const result = await getEffectiveSubscription(1, { connection: createConnection(state) });
  assert.equal(result.access.reason, "SUBSCRIPTION_NOT_PROVISIONED");
});

test("trial creation writes one subscription, period, and event", async () => {
  const state = createState();
  const connection = createConnection(state);
  const result = await createTrialCompany({
    companyId: 1,
    planId: 2,
    idempotencyKey: "trial-one",
    actor: { type: "admin", userId: 7 },
    connection,
  });
  assert.equal(result.access.valid, true);
  assert.equal(state.subscription.status, "trialing");
  assert.equal(state.subscription.trial_duration_days, 14);
  assert.equal(state.company.plan_id, 2);
  assert.equal(state.periods.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].event_type, "trial_created");
});

test("duplicate trial retry returns success without duplicate history", async () => {
  const state = createState();
  const connection = createConnection(state);
  const input = {
    companyId: 1, planId: 2, trialDays: 21,
    idempotencyKey: "trial-retry", connection,
  };
  await createTrialCompany(input);
  const second = await createTrialCompany(input);
  assert.equal(second.access.valid, true);
  assert.equal(state.periods.length, 1);
  assert.equal(state.events.length, 1);
});

test("idempotency comparison tolerates MySQL JSON key reordering", async () => {
  const state = createState();
  const connection = createConnection(state, { reorderEventJson: true });
  const input = {
    companyId: 1, planId: 2, trialDays: 21,
    idempotencyKey: "trial-json-order", connection,
  };
  await createTrialCompany(input);
  const result = await createTrialCompany(input);
  assert.equal(result.access.valid, true);
  assert.equal(state.periods.length, 1);
  assert.equal(state.events.length, 1);
});

test("conflicting trial idempotency retry is rejected", async () => {
  const state = createState();
  const connection = createConnection(state);
  await createTrialCompany({
    companyId: 1, planId: 2, trialDays: 14,
    idempotencyKey: "trial-conflict", connection,
  });
  await expectCode(createTrialCompany({
    companyId: 1, planId: 2, trialDays: 30,
    idempotencyKey: "trial-conflict", connection,
  }), "IDEMPOTENCY_CONFLICT");
});

test("invalid trial duration is rejected", async () => {
  const state = createState();
  await expectCode(createTrialCompany({
    companyId: 1, planId: 2, trialDays: 366,
    idempotencyKey: "bad-duration", connection: createConnection(state),
  }), "INVALID_TRIAL_DURATION");
});

test("missing and inactive plans are rejected", async () => {
  const missing = createState({ plan: null });
  await expectCode(createTrialCompany({
    companyId: 1, planId: 2, idempotencyKey: "missing-plan",
    connection: createConnection(missing),
  }), "PLAN_NOT_FOUND");

  const inactive = createState();
  inactive.plan.is_active = 0;
  await expectCode(createTrialCompany({
    companyId: 1, planId: 2, idempotencyKey: "inactive-plan",
    connection: createConnection(inactive),
  }), "PLAN_INACTIVE");
});

const trialState = (status = "trialing") => createState({
  subscription: {
    id: 10,
    company_id: 1,
    plan_id: 2,
    status,
    billing_cycle: "none",
    trial_start_at: "2026-08-01T00:00:00.000Z",
    trial_end_at: "2026-08-15T00:00:00.000Z",
    trial_duration_days: 14,
    current_period_start_at: "2026-08-01T00:00:00.000Z",
    current_period_end_at: "2026-08-15T00:00:00.000Z",
  },
  periods: [{
    id: 1,
    subscription_id: 10,
    company_id: 1,
    plan_id: 2,
    period_type: "trial",
    billing_cycle: "none",
    starts_at: "2026-08-01T00:00:00.000Z",
    ends_at: "2026-08-15T00:00:00.000Z",
    status: "active",
    source_key: "trial:original",
  }],
});

test("activation from trial creates paid history", async () => {
  const state = trialState();
  const result = await activateSubscription({
    companyId: 1, planId: 2, billingCycle: "monthly",
    idempotencyKey: "activate-trial", connection: createConnection(state),
  });
  assert.equal(result.access.valid, true);
  assert.equal(state.subscription.status, "active");
  assert.equal(state.periods.filter((item) => item.period_type === "paid").length, 1);
  assert.equal(state.events[0].event_type, "activated");
});

test("activation from expired trial succeeds", async () => {
  const state = trialState("expired");
  await activateSubscription({
    companyId: 1, planId: 2, billingCycle: "annual",
    idempotencyKey: "activate-expired", connection: createConnection(state),
  });
  assert.equal(state.subscription.status, "active");
  assert.equal(state.subscription.billing_cycle, "annual");
});

test("manual activation resolves an active plan by stable code", async () => {
  const state = trialState();
  await activateSubscriptionByPlanCode({
    companyId: 1, planCode: " plan_2 ", billingCycle: "monthly",
    idempotencyKey: "activate-by-code", connection: createConnection(state),
  });
  assert.equal(state.subscription.status, "active");
  assert.equal(state.company.plan_id, 2);
});

test("manual activation rejects missing and inactive plan codes", async () => {
  await expectCode(activateSubscriptionByPlanCode({
    companyId: 1, planCode: "MISSING", billingCycle: "monthly",
    idempotencyKey: "missing-code", connection: createConnection(trialState()),
  }), "PLAN_NOT_FOUND");

  const state = trialState();
  state.plan.is_active = 0;
  await expectCode(activateSubscriptionByPlanCode({
    companyId: 1, planCode: "PLAN_2", billingCycle: "monthly",
    idempotencyKey: "inactive-code", connection: createConnection(state),
  }), "PLAN_INACTIVE");
});

test("invalid activation transition is rejected", async () => {
  const state = trialState("suspended");
  await expectCode(activateSubscription({
    companyId: 1, planId: 2, billingCycle: "monthly",
    idempotencyKey: "activate-suspended", connection: createConnection(state),
  }), "INVALID_SUBSCRIPTION_TRANSITION");
});

test("duplicate activation retry does not duplicate history", async () => {
  const state = trialState();
  const connection = createConnection(state);
  const input = {
    companyId: 1, planId: 2, billingCycle: "monthly",
    idempotencyKey: "activate-retry", connection,
  };
  await activateSubscription(input);
  await activateSubscription(input);
  assert.equal(state.periods.filter((item) => item.period_type === "paid").length, 1);
  assert.equal(state.events.filter((item) => item.event_type === "activated").length, 1);
});

test("conflicting activation idempotency retry is rejected", async () => {
  const state = trialState();
  const connection = createConnection(state);
  await activateSubscription({
    companyId: 1, planId: 2, billingCycle: "monthly",
    idempotencyKey: "activate-conflict", connection,
  });
  await expectCode(activateSubscription({
    companyId: 1, planId: 2, billingCycle: "annual",
    idempotencyKey: "activate-conflict", connection,
  }), "IDEMPOTENCY_CONFLICT");
});

test("activation preserves trial dates and trial period history", async () => {
  const state = trialState();
  const originalSubscriptionDates = {
    start: state.subscription.trial_start_at,
    end: state.subscription.trial_end_at,
  };
  const originalPeriod = clone(state.periods[0]);
  await activateSubscription({
    companyId: 1, planId: 2, billingCycle: "custom",
    periodStartAt: "2026-08-20T00:00:00.000Z",
    periodEndAt: "2026-11-20T00:00:00.000Z",
    idempotencyKey: "preserve-trial", connection: createConnection(state),
  });
  assert.equal(state.subscription.trial_start_at, originalSubscriptionDates.start);
  assert.equal(state.subscription.trial_end_at, originalSubscriptionDates.end);
  assert.equal(state.periods[0].starts_at, originalPeriod.starts_at);
  assert.equal(state.periods[0].ends_at, originalPeriod.ends_at);
  assert.equal(state.periods[0].status, "completed");
});

test("owned transaction rolls back and releases on database failure", async () => {
  const state = createState();
  const connection = createConnection(state, { failWhen: "INSERT INTO subscription_events" });
  const originalGetConnection = db.getConnection;
  db.getConnection = async () => connection;
  try {
    await assert.rejects(createTrialCompany({
      companyId: 1,
      planId: 2,
      idempotencyKey: "rollback-test",
    }), /Injected database failure/);
    assert.deepEqual(connection.lifecycle, {
      begin: 1, commit: 0, rollback: 1, release: 1,
    });
  } finally {
    db.getConnection = originalGetConnection;
  }
});

const expirySubscription = (overrides = {}) => ({
  id: 301,
  company_id: 41,
  plan_id: 2,
  status: "trialing",
  trial_start_at: "2026-08-06T00:00:00.000Z",
  trial_end_at: NOW,
  expired_at: null,
  version: 1,
  ...overrides,
});

const createExpiryHarness = (subscriptions, options = {}) => {
  const state = {
    companies: subscriptions.map((item) => ({
      id: item.company_id, status: "active", plan_id: item.plan_id,
    })),
    subscriptions: clone(subscriptions),
    periods: subscriptions.map((item) => ({
      id: item.id + 1000,
      subscription_id: item.id,
      company_id: item.company_id,
      plan_id: item.plan_id,
      period_type: "trial",
      status: "active",
      starts_at: item.trial_start_at,
      ends_at: item.trial_end_at,
    })),
    events: [],
  };
  const lifecycle = { begin: 0, commit: 0, rollback: 0, release: 0 };
  const toKey = (value) => new Date(value).toISOString()
    .slice(0, 19).replace(/[-T:]/g, "");

  const poolQuery = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("FROM company_subscriptions")
      && normalized.includes("ORDER BY trial_end_at")
      && !normalized.includes("FOR UPDATE")) {
      const limit = Number(params[0]);
      const due = state.subscriptions
        .filter((item) => item.status === "trialing"
          && item.trial_end_at
          && new Date(item.trial_end_at) <= new Date(NOW))
        .sort((a, b) => new Date(a.trial_end_at) - new Date(b.trial_end_at)
          || a.id - b.id)
        .slice(0, limit)
        .map(({ id, company_id }) => ({ id, company_id }));
      return [due];
    }
    throw new Error(`Unexpected expiry pool query: ${normalized}`);
  };

  const getConnection = async () => {
    let snapshot;
    return {
      beginTransaction: async () => {
        lifecycle.begin += 1;
        snapshot = clone(state);
      },
      commit: async () => { lifecycle.commit += 1; snapshot = null; },
      rollback: async () => {
        lifecycle.rollback += 1;
        state.companies = snapshot.companies;
        state.subscriptions = snapshot.subscriptions;
        state.periods = snapshot.periods;
        state.events = snapshot.events;
      },
      release: () => { lifecycle.release += 1; },
      query: async (sql, params = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized.includes("FROM company_subscriptions")
          && normalized.includes("FOR UPDATE")) {
          const item = state.subscriptions.find((row) => row.id === Number(params[0]));
          if (!item) return [[]];
          return [[{
            ...clone(item),
            trial_end_key: toKey(item.trial_end_at),
            is_due: item.status === "trialing"
              && new Date(item.trial_end_at) <= new Date(NOW) ? 1 : 0,
          }]];
        }
        if (normalized.includes("FROM subscription_events")
          && normalized.includes("request_id = ?")) {
          const event = state.events.find((row) =>
            row.subscription_id === Number(params[0]) && row.request_id === params[1]);
          return [event ? [clone(event)] : []];
        }
        if (normalized.startsWith("UPDATE company_subscriptions")) {
          const item = state.subscriptions.find((row) =>
            row.id === Number(params[0]) && row.company_id === Number(params[1]));
          if (item && item.status === "trialing") {
            item.status = "expired";
            item.expired_at = item.trial_end_at;
            item.version += 1;
          }
          return [{ affectedRows: item ? 1 : 0 }];
        }
        if (normalized.startsWith("UPDATE subscription_periods")) {
          state.periods
            .filter((row) => row.subscription_id === Number(params[0])
              && row.company_id === Number(params[1])
              && row.period_type === "trial" && row.status === "active")
            .forEach((row) => { row.status = "expired"; });
          return [{ affectedRows: 1 }];
        }
        if (normalized.startsWith("INSERT INTO subscription_events")) {
          if (options.failEventInsert) throw new Error("Injected expiry event failure");
          const event = {
            id: state.events.length + 1,
            subscription_id: params[0], company_id: params[1],
            event_type: params[2], from_status: params[3], to_status: params[4],
            old_plan_id: params[5], new_plan_id: params[6], effective_at: params[7],
            actor_type: params[8], actor_user_id: params[9], reason: params[10],
            metadata: params[11], request_id: params[12],
          };
          if (state.events.some((row) => row.subscription_id === event.subscription_id
            && row.request_id === event.request_id)) {
            const error = new Error("Duplicate expiry event");
            error.code = "ER_DUP_ENTRY";
            throw error;
          }
          state.events.push(event);
          return [{ insertId: event.id, affectedRows: 1 }];
        }
        throw new Error(`Unexpected expiry connection query: ${normalized}`);
      },
    };
  };

  return { state, lifecycle, poolQuery, getConnection };
};

const withExpiryHarness = async (harness, work) => {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  db.query = harness.poolQuery;
  db.getConnection = harness.getConnection;
  try {
    return await work();
  } finally {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
  }
};

test("due trial expires atomically and preserves tenant fields", async () => {
  const original = expirySubscription();
  const harness = createExpiryHarness([original]);
  const summary = await withExpiryHarness(harness, () => expireDueTrials());
  assert.deepEqual(summary, { found: 1, expired: 1, skipped: 0, failed: 0, failures: [] });
  const subscription = harness.state.subscriptions[0];
  assert.equal(subscription.status, "expired");
  assert.equal(subscription.expired_at, original.trial_end_at);
  assert.equal(subscription.trial_start_at, original.trial_start_at);
  assert.equal(subscription.trial_end_at, original.trial_end_at);
  assert.equal(subscription.plan_id, original.plan_id);
  assert.equal(subscription.version, 2);
  assert.deepEqual(harness.state.companies[0], {
    id: original.company_id, status: "active", plan_id: original.plan_id,
  });
  assert.equal(harness.state.periods[0].status, "expired");
});

test("expiry event is deterministic and repeated run is idempotent", async () => {
  const harness = createExpiryHarness([expirySubscription()]);
  await withExpiryHarness(harness, async () => {
    await expireDueTrials();
    const second = await expireDueTrials();
    assert.equal(second.found, 0);
  });
  assert.equal(harness.state.events.length, 1);
  const event = harness.state.events[0];
  assert.equal(event.event_type, "trial_expired");
  assert.equal(event.from_status, "trialing");
  assert.equal(event.to_status, "expired");
  assert.equal(event.old_plan_id, 2);
  assert.equal(event.new_plan_id, 2);
  assert.equal(event.actor_type, "system");
  assert.equal(event.actor_user_id, null);
  assert.equal(event.reason, "Trial reached configured end time");
  assert.equal(event.request_id, "trial-expired:301:20260820000000");
});

test("future and non-trialing subscriptions are not discovered", async () => {
  const subscriptions = [
    expirySubscription({ id: 1, trial_end_at: "2026-08-20T00:00:01.000Z" }),
    expirySubscription({ id: 2, status: "expired" }),
    expirySubscription({ id: 3, status: "suspended" }),
    expirySubscription({ id: 4, status: "cancelled" }),
    expirySubscription({ id: 5, status: "active" }),
  ];
  const harness = createExpiryHarness(subscriptions);
  const summary = await withExpiryHarness(harness, () => expireDueTrials());
  assert.deepEqual(summary, { found: 0, expired: 0, skipped: 0, failed: 0, failures: [] });
  assert.equal(harness.state.events.length, 0);
});

test("database UTC boundary is due", async () => {
  const harness = createExpiryHarness([expirySubscription({ trial_end_at: NOW })]);
  const summary = await withExpiryHarness(harness, () => expireDueTrials());
  assert.equal(summary.expired, 1);
});

test("batch size limits one-transaction-per-subscription work", async () => {
  const subscriptions = [1, 2, 3].map((id) => expirySubscription({
    id, company_id: 100 + id,
  }));
  const harness = createExpiryHarness(subscriptions);
  const summary = await withExpiryHarness(harness, () => expireDueTrials({ batchSize: 2 }));
  assert.equal(summary.found, 2);
  assert.equal(summary.expired, 2);
  assert.deepEqual(harness.lifecycle, { begin: 2, commit: 2, rollback: 0, release: 2 });
  assert.equal(harness.state.subscriptions.filter((row) => row.status === "trialing").length, 1);
});

test("expiry event failure rolls back subscription and period", async () => {
  const original = expirySubscription();
  const harness = createExpiryHarness([original], { failEventInsert: true });
  const summary = await withExpiryHarness(harness, () => expireDueTrials());
  assert.equal(summary.failed, 1);
  assert.equal(summary.expired, 0);
  assert.equal(harness.state.subscriptions[0].status, "trialing");
  assert.equal(harness.state.subscriptions[0].expired_at, null);
  assert.equal(harness.state.subscriptions[0].version, 1);
  assert.equal(harness.state.periods[0].status, "active");
  assert.equal(harness.state.events.length, 0);
  assert.deepEqual(harness.lifecycle, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

const withSchedulerDouble = async (enabled, work) => {
  const cron = require("node-cron");
  const originalValidate = cron.validate;
  const originalSchedule = cron.schedule;
  const originalEnabled = process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED;
  const originalCron = process.env.SUBSCRIPTION_EXPIRY_CRON;
  const calls = [];
  cron.validate = () => true;
  cron.schedule = (expression, callback, options) => {
    calls.push({ expression, callback, options });
    return { stop() {} };
  };
  if (enabled) process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED = "true";
  else delete process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED;
  delete process.env.SUBSCRIPTION_EXPIRY_CRON;
  const modulePath = require.resolve("../jobs/subscriptionExpiryScheduler");
  delete require.cache[modulePath];
  try {
    const scheduler = require(modulePath);
    return await work(scheduler, calls);
  } finally {
    delete require.cache[modulePath];
    cron.validate = originalValidate;
    cron.schedule = originalSchedule;
    if (originalEnabled === undefined) delete process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED;
    else process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED = originalEnabled;
    if (originalCron === undefined) delete process.env.SUBSCRIPTION_EXPIRY_CRON;
    else process.env.SUBSCRIPTION_EXPIRY_CRON = originalCron;
  }
};

test("subscription expiry scheduler import and disabled start remain inert", async () => {
  await withSchedulerDouble(false, async (scheduler, calls) => {
    assert.equal(calls.length, 0, "module import must not schedule work");
    assert.equal(scheduler.startSubscriptionExpiryScheduler(), null);
    assert.equal(calls.length, 0);
  });
});

test("explicit scheduler start uses default cron and noOverlap", async () => {
  await withSchedulerDouble(true, async (scheduler, calls) => {
    assert.equal(calls.length, 0);
    const task = scheduler.startSubscriptionExpiryScheduler();
    assert(task);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expression, "*/15 * * * *");
    assert.deepEqual(calls[0].options, { noOverlap: true });
  });
});

const run = async () => {
  let passed = 0;
  for (const { name, fn } of tests) {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  }
  console.log(`Subscription service: ${passed} focused tests passed`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
