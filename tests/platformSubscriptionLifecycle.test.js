const assert = require("node:assert/strict");
const test = require("node:test");
const {
  changeSubscriptionPlan, extendSubscriptionTrial, reactivateSubscription,
  renewSubscription, suspendSubscription,
} = require("../services/subscriptionService");

const NOW = "2026-08-23 10:00:00";
const addUtc = (value, amount, unit) => { const date = new Date(`${value.replace(" ", "T")}Z`); if (unit === "month") date.setUTCMonth(date.getUTCMonth() + amount); else if (unit === "year") date.setUTCFullYear(date.getUTCFullYear() + amount); else date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 19).replace("T", " "); };
const actor = { type: "platform_admin", userId: null, reason: "test", metadata: { platform_admin_id: 1 } };

const connection = (overrides = {}) => {
  const state = { company: { id: 1, status: "active", plan_id: 1 }, plan: { id: 2, code: "PRO", name: "Pro", price: 100, is_active: 1, max_staff: 5, max_users: 10 }, subscription: { id: 9, company_id: 1, plan_id: 1, status: "active", billing_cycle: "monthly", current_period_start_at: "2026-08-01 00:00:00", current_period_end_at: "2026-09-21 00:00:00", trial_start_at: null, trial_end_at: null, version: 1 }, events: [], periods: [], extensions: [], ...overrides };
  const db = { state, async query(sql, params = []) { const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("FROM companies") && q.includes("FOR UPDATE")) return [[state.company]];
    if (q.includes("FROM company_subscriptions") && q.includes("FOR UPDATE")) return [[state.subscription]];
    if (q.includes("FROM plans") && q.includes("FOR UPDATE")) return [[state.plan.id === Number(params[0]) ? state.plan : null].filter(Boolean)];
    if (q.includes("FROM subscription_events") && q.includes("request_id = ?")) return [[state.events.find((e) => e.subscription_id === params[0] && e.request_id === params[1])].filter(Boolean)];
    if (q.startsWith("SELECT CASE WHEN ? = 'active'")) return [[{ starts_at: state.subscription.status === "active" && state.subscription.current_period_end_at > NOW ? state.subscription.current_period_end_at : NOW }]];
    if (q.startsWith("SELECT COALESCE(?, UTC_TIMESTAMP())")) { const start = params[0] || NOW, cycle = params[1]; return [[{ starts_at: start, ends_at: addUtc(start, 1, cycle === "monthly" ? "month" : "year"), is_valid: 1 }]]; }
    if (q === "SELECT UTC_TIMESTAMP() AS effective_at") return [[{ effective_at: NOW }]];
    if (q.includes("DATE_ADD(?, INTERVAL ? DAY)")) return [[{ effective_at: NOW, new_trial_end_at: addUtc(params[0], Number(params[1]), "day") }]];
    if (q.includes("period_is_valid")) return [[{ effective_at: NOW, period_is_valid: state.subscription.current_period_end_at === null || state.subscription.current_period_end_at > NOW ? 1 : 0 }]];
    if (q.startsWith("UPDATE companies SET plan_id")) { state.company.plan_id = params[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith("UPDATE company_subscriptions")) {
      if (q.includes("trial_end_at = ?")) Object.assign(state.subscription, { trial_end_at: params[0], current_period_end_at: params[1] });
      else if (q.includes("status = 'suspended'")) Object.assign(state.subscription, { status: "suspended", suspended_at: params[0] });
      else if (q.includes("suspended_at = NULL")) Object.assign(state.subscription, { status: "active", suspended_at: null });
      else if (q.includes("subscription_start_at = COALESCE")) Object.assign(state.subscription, { plan_id: params[0], status: "active", billing_cycle: params[1], current_period_start_at: params[3], current_period_end_at: params[4] });
      else if (q.includes("SET plan_id = ?")) state.subscription.plan_id = params[0];
      state.subscription.version += 1; return [{ affectedRows: 1 }];
    }
    if (q.startsWith("INSERT INTO subscription_periods")) { state.periods.push({ starts_at: params[4], ends_at: params[5], source_key: params[6] }); return [{ affectedRows: 1 }]; }
    if (q.startsWith("UPDATE subscription_periods")) return [{ affectedRows: 1 }];
    if (q.startsWith("INSERT INTO trial_extensions")) { state.extensions.push(params); return [{ affectedRows: 1 }]; }
    if (q.startsWith("INSERT INTO subscription_events")) { state.events.push({ subscription_id: params[0], event_type: params[2], metadata: params[11], request_id: params[12] }); return [{ affectedRows: 1 }]; }
    if (q.includes("LEFT JOIN company_subscriptions")) return [[{ company_id: 1, company_status: "active", subscription_id: state.subscription.id, subscription_plan_id: state.subscription.plan_id, subscription_status: state.subscription.status, billing_cycle: state.subscription.billing_cycle, trial_start_at: state.subscription.trial_start_at, trial_end_at: state.subscription.trial_end_at, current_period_start_at: state.subscription.current_period_start_at, current_period_end_at: state.subscription.current_period_end_at, plan_id: state.plan.id, plan_code: state.plan.code, plan_name: state.plan.name, paid_period_is_current: state.subscription.current_period_end_at > NOW ? 1 : 0, trial_is_current: state.subscription.trial_end_at > NOW ? 1 : 0 }]];
    throw new Error(`Unhandled SQL: ${q}`);
  } };
  return db;
};

test("active renewal preserves remaining time and is idempotent", async () => { const db = connection(); await renewSubscription({ companyId: 1, planId: 2, billingCycle: "monthly", actor, idempotencyKey: "renew-1", connection: db }); assert.equal(db.state.periods[0].starts_at, "2026-09-21 00:00:00"); assert.equal(db.state.periods[0].ends_at, "2026-10-21 00:00:00"); await renewSubscription({ companyId: 1, planId: 2, billingCycle: "monthly", actor, idempotencyKey: "renew-1", connection: db }); assert.equal(db.state.periods.length, 1); });
test("expired annual renewal starts now and uses calendar year", async () => { const db = connection({ subscription: { id: 9, company_id: 1, plan_id: 1, status: "expired", current_period_end_at: "2026-08-01 00:00:00", version: 1 } }); await renewSubscription({ companyId: 1, planId: 2, billingCycle: "annual", actor, idempotencyKey: "renew-expired", connection: db }); assert.equal(db.state.periods[0].starts_at, NOW); assert.equal(db.state.periods[0].ends_at, "2027-08-23 10:00:00"); });
test("plan change records old/new plan and rejects inactive plan", async () => { const db = connection(); await changeSubscriptionPlan({ companyId: 1, planId: 2, actor, idempotencyKey: "plan-1", connection: db }); assert.equal(db.state.subscription.plan_id, 2); assert.equal(db.state.events[0].event_type, "plan_changed"); const inactive = connection(); inactive.state.plan.is_active = 0; await assert.rejects(changeSubscriptionPlan({ companyId: 1, planId: 2, actor, idempotencyKey: "plan-2", connection: inactive }), (e) => e.code === "PLAN_INACTIVE"); });
test("trial extension updates trial history and validates days/state", async () => { const db = connection({ subscription: { id: 9, company_id: 1, plan_id: 2, status: "trialing", trial_end_at: "2026-08-30 10:00:00", version: 1 } }); await extendSubscriptionTrial({ companyId: 1, extensionDays: 7, actor, idempotencyKey: "trial-1", connection: db }); assert.equal(db.state.subscription.trial_end_at, "2026-09-06 10:00:00"); assert.equal(db.state.extensions.length, 1); await assert.rejects(extendSubscriptionTrial({ companyId: 1, extensionDays: 91, actor, idempotencyKey: "trial-2", connection: db }), (e) => e.code === "INVALID_TRIAL_EXTENSION"); });
test("suspend and reactivate preserve paid period", async () => { const db = connection(); const end = db.state.subscription.current_period_end_at; await suspendSubscription({ companyId: 1, reason: "review", actor, idempotencyKey: "suspend-1", connection: db }); assert.equal(db.state.subscription.status, "suspended"); await reactivateSubscription({ companyId: 1, actor, idempotencyKey: "reactivate-1", connection: db }); assert.equal(db.state.subscription.status, "active"); assert.equal(db.state.subscription.current_period_end_at, end); });
test("reactivation rejects a paid period that expired while suspended", async () => { const db = connection({ subscription: { id: 9, company_id: 1, plan_id: 2, status: "suspended", current_period_end_at: "2026-08-22 00:00:00", version: 1 } }); await assert.rejects(reactivateSubscription({ companyId: 1, actor, idempotencyKey: "reactivate-expired", connection: db }), (e) => e.code === "PAID_PERIOD_EXPIRED"); });
