const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GRAPH_SCOPE,
  MAX_TOKEN_RESPONSE_BYTES,
  GRAPH_SENDER,
  createMicrosoftGraphProvider,
  graphConfigurationIssues,
} = require("../services/microsoftGraphEmailProvider");
const {
  assertLaunchConfiguration,
  getLaunchConfigurationIssues,
} = require("../services/launchReadinessService");

const environment = (overrides = {}) => ({
  NODE_ENV: "production",
  SUBSCRIPTION_ENFORCEMENT_ENABLED: "true",
  EMAIL_PROVIDER: "microsoft_graph",
  MS_GRAPH_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  MS_GRAPH_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  MS_GRAPH_CLIENT_SECRET: "synthetic-client-secret",
  MS_GRAPH_SENDER: GRAPH_SENDER,
  APP_URL: "https://revex-books-frontend.vercel.app",
  ...overrides,
});

const response = ({ ok = true, status = 200, json = {} } = {}) => ({
  ok,
  status,
  async json() { return json; },
  headers: new Headers(),
  body: new Response(JSON.stringify(json)).body,
});

for (const mode of ["declared", "missing", "incorrect", "multibyte", "boundary"]) {
  test(`bounded token response: ${mode}`, async () => {
    let tokenCalls = 0;
    let reads = 0;
    let signal;
    const logs = [];
    const normal = JSON.stringify({ access_token: "synthetic-bounded-token", expires_in: 3600 });
    const content = mode === "boundary" ? normal.padEnd(MAX_TOKEN_RESPONSE_BYTES, " ")
      : mode === "multibyte" ? "€".repeat(Math.floor(MAX_TOKEN_RESPONSE_BYTES / 3) + 1)
      : "x".repeat(MAX_TOKEN_RESPONSE_BYTES + 1);
    const data = new TextEncoder().encode(content);
    if (mode === "multibyte") assert.ok(content.length < MAX_TOKEN_RESPONSE_BYTES && data.byteLength > MAX_TOKEN_RESPONSE_BYTES);
    const fetchImpl = async (url, options) => {
      if (!url.endsWith("/token")) return response({ status: 202 });
      tokenCalls++;
      if (tokenCalls > 1) return response({ json: { access_token: "synthetic-recovered-token", expires_in: 3600 } });
      signal = options.signal;
      const headers = new Headers();
      if (mode === "declared") headers.set("content-length", String(MAX_TOKEN_RESPONSE_BYTES + 1));
      if (mode === "incorrect") headers.set("content-length", "1");
      let offset = 0;
      return { ok: true, status: 200, headers, body: { getReader() { return {
        releaseLock() {},
        async read() {
          reads++;
          if (offset >= data.byteLength) return { done: true };
          const value = data.subarray(offset, offset + 4096);
          offset += value.byteLength;
          return { done: false, value };
        },
      }; } } };
    };
    const provider = createMicrosoftGraphProvider({ environment: environment(), fetchImpl, logger: { error(...args) { logs.push(args); } } });
    const message = { to: "private@example.test", subject: "private-subject", text: "private-reset-token" };
    const results = await Promise.all([provider.sendMail(message), provider.sendMail(message), provider.sendMail(message)]);
    assert.equal(tokenCalls, 1);
    if (mode === "boundary") {
      for (const result of results) assert.deepEqual(result, { sent: true });
      assert.equal(signal.aborted, false);
      assert.deepEqual(logs, []);
    } else {
      assert.equal(signal.aborted, true);
      if (mode === "declared") assert.equal(reads, 0);
      for (const result of results) assert.deepEqual(result, { sent: false, reason: "delivery_failed", code: "MS_GRAPH_TOKEN_RESPONSE_TOO_LARGE" });
      assert.deepEqual(logs, Array.from({ length: 3 }, () => ["Microsoft Graph email delivery failed", { code: "MS_GRAPH_TOKEN_RESPONSE_TOO_LARGE", stage: "token", status: null }]));
      assert.doesNotMatch(JSON.stringify({ logs, results }), /synthetic-|private-|content-length|https:|authorization|bearer|65537/i);
      assert.deepEqual(await provider.sendMail(message), { sent: true });
      assert.equal(tokenCalls, 2);
    }
  });
}

for (const stage of ["token", "send"]) {
  test(`${stage} redirects 300–399 are never followed, logged, or retried`, async () => {
    for (let status = 300; status <= 399; status++) {
      const calls = [];
      const logs = [];
      let redirectEnabled = true;
      const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        assert.equal(options.redirect, "manual");
        const isToken = url.endsWith("/token");
        if (redirectEnabled && (stage === "token" ? isToken : !isToken)) {
          return {
            ok: false, status,
            get headers() { throw new Error("Location https://untrusted.example.test/private-redirect"); },
            async json() { throw new Error("private-response-body"); },
          };
        }
        return isToken
          ? response({ json: { access_token: "private-access-token", expires_in: 3600 } })
          : response({ status: 202 });
      };
      const provider = createMicrosoftGraphProvider({ environment: environment(), fetchImpl,
        logger: { error(...args) { logs.push(args); } } });
      const message = { to: "private-recipient@example.test", subject: "private-subject", text: "private-payload private-reset-link" };
      const result = await provider.sendMail(message);
      const code = stage === "token" ? "MS_GRAPH_TOKEN_REQUEST_FAILED" : "MS_GRAPH_SEND_FAILED";
      assert.deepEqual(result, { sent: false, reason: "delivery_failed", code });
      assert.equal(calls.length, stage === "token" ? 1 : 2);
      assert.equal(calls.filter(({ url }) => stage === "token" ? url.endsWith("/token") : url.endsWith("/sendMail")).length, 1);
      assert.deepEqual(logs, [["Microsoft Graph email delivery failed", { code, stage, status }]]);
      assert.doesNotMatch(JSON.stringify({ result, logs }), /Location|untrusted|private-|synthetic-client-secret|authorization|bearer/i);
      if (stage === "token") {
        redirectEnabled = false;
        assert.deepEqual(await provider.sendMail(message), { sent: true });
        assert.equal(calls.length, 3);
        assert.equal(calls.filter(({ url }) => url.endsWith("/token")).length, 2);
      }
    }
  });
}

test("uses client credentials, .default scope, the exact send endpoint, and forced sender fields", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return response({ json: { access_token: "synthetic-access-token", expires_in: 3600 } });
    }
    return response({ status: 202 });
  };
  const provider = createMicrosoftGraphProvider({ environment: environment(), fetchImpl, logger: { error() {} } });
  const result = await provider.sendMail({
    to: "customer@example.test",
    subject: "Invitation",
    text: "safe text",
    html: "<p>safe body</p>",
    from: "mruthunjaya@revexbooks.com",
    replyTo: "demo@revexbooks.com",
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token");
  assert.equal(calls[0].options.method, "POST");
  const tokenBody = new URLSearchParams(calls[0].options.body);
  assert.equal(tokenBody.get("grant_type"), "client_credentials");
  assert.equal(tokenBody.get("scope"), GRAPH_SCOPE);
  assert.equal(tokenBody.get("client_id"), environment().MS_GRAPH_CLIENT_ID);
  assert.equal(tokenBody.get("client_secret"), environment().MS_GRAPH_CLIENT_SECRET);
  assert.equal(calls[1].url, `https://graph.microsoft.com/v1.0/users/${GRAPH_SENDER}/sendMail`);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.authorization, "Bearer synthetic-access-token");
  const mail = JSON.parse(calls[1].options.body);
  assert.equal(mail.message.from.emailAddress.address, GRAPH_SENDER);
  assert.deepEqual(mail.message.replyTo, [{ emailAddress: { address: GRAPH_SENDER } }]);
  assert.equal(mail.saveToSentItems, true);
  assert.doesNotMatch(calls[1].options.body, /mruthunjaya@revexbooks\.com|demo@revexbooks\.com/i);
});

test("caches a usable token and refreshes it safely before expiry", async () => {
  let currentTime = 1_000_000;
  let tokenCalls = 0;
  const authorization = [];
  const fetchImpl = async (url, options) => {
    if (url.includes("/token")) {
      tokenCalls += 1;
      return response({ json: { access_token: `token-${tokenCalls}`, expires_in: 120 } });
    }
    authorization.push(options.headers.authorization);
    return response({ status: 202 });
  };
  const provider = createMicrosoftGraphProvider({
    environment: environment(),
    fetchImpl,
    now: () => currentTime,
    logger: { error() {} },
  });
  await provider.sendMail({ to: "one@example.test", subject: "one", text: "one" });
  currentTime += 30_000;
  await provider.sendMail({ to: "two@example.test", subject: "two", text: "two" });
  currentTime += 31_000;
  await provider.sendMail({ to: "three@example.test", subject: "three", text: "three" });
  assert.equal(tokenCalls, 2);
  assert.deepEqual(authorization, ["Bearer token-1", "Bearer token-1", "Bearer token-2"]);
});

test("deduplicates concurrent token refresh requests", async () => {
  let tokenCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/token")) {
      tokenCalls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return response({ json: { access_token: "shared-token", expires_in: 3600 } });
    }
    return response({ status: 202 });
  };
  const provider = createMicrosoftGraphProvider({ environment: environment(), fetchImpl, logger: { error() {} } });
  await Promise.all([
    provider.sendMail({ to: "one@example.test", subject: "one", text: "one" }),
    provider.sendMail({ to: "two@example.test", subject: "two", text: "two" }),
  ]);
  assert.equal(tokenCalls, 1);
});

test("times out requests and logs only sanitized metadata", async () => {
  const logs = [];
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("synthetic-client-secret customer body synthetic-access-token");
      error.name = "AbortError";
      reject(error);
    });
  });
  const provider = createMicrosoftGraphProvider({
    environment: environment(),
    fetchImpl,
    timeoutMs: 5,
    logger: { error(...args) { logs.push(args); } },
  });
  const result = await provider.sendMail({
    to: "customer@example.test",
    subject: "sensitive subject",
    text: "customer-sensitive email body",
  });
  assert.deepEqual(result, { sent: false, reason: "delivery_failed", code: "MS_GRAPH_TIMEOUT" });
  const serialized = JSON.stringify(logs);
  assert.match(serialized, /MS_GRAPH_TIMEOUT/);
  assert.doesNotMatch(serialized, /synthetic-client-secret|synthetic-access-token|customer-sensitive|sensitive subject/i);
});

test("sanitizes token and Graph errors without reading their response bodies", async () => {
  for (const failingStage of ["token", "send"]) {
    let bodyRead = false;
    const logs = [];
    const fetchImpl = async (url) => {
      if (failingStage === "token" || !url.includes("/token")) {
        return { ok: false, status: 401, async json() { bodyRead = true; throw new Error("secret body"); } };
      }
      return response({ json: { access_token: "synthetic-access-token", expires_in: 3600 } });
    };
    const provider = createMicrosoftGraphProvider({ environment: environment(), fetchImpl, logger: { error(...args) { logs.push(args); } } });
    const result = await provider.sendMail({ to: "customer@example.test", subject: "subject", text: "private body" });
    assert.equal(result.sent, false);
    assert.equal(bodyRead, false);
    assert.doesNotMatch(JSON.stringify(logs), /secret body|synthetic-access-token|private body/i);
    assert.deepEqual(logs[0][1], {
      code: failingStage === "token" ? "MS_GRAPH_TOKEN_REQUEST_FAILED" : "MS_GRAPH_SEND_FAILED",
      stage: failingStage,
      status: 401,
    });
  }
});

test("production readiness accepts only complete canonical Graph configuration", () => {
  assert.deepEqual(graphConfigurationIssues(environment()), []);
  assert.doesNotThrow(() => assertLaunchConfiguration(environment()));

  for (const variable of ["EMAIL_PROVIDER", "MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET", "MS_GRAPH_SENDER"]) {
    const issues = getLaunchConfigurationIssues(environment({ [variable]: "" }));
    assert.ok(issues.some((issue) => issue.variable === variable));
  }
  for (const variable of ["MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID"]) {
    const issues = getLaunchConfigurationIssues(environment({ [variable]: "not-a-guid" }));
    assert.ok(issues.some((issue) => issue.variable === variable && issue.code.endsWith("_INVALID")));
  }
  for (const sender of ["mruthunjaya@revexbooks.com", "demo@revexbooks.com", "support@example.test", "SUPPORT@REVEXBOOKS.COM"]) {
    const issues = getLaunchConfigurationIssues(environment({ MS_GRAPH_SENDER: sender }));
    assert.ok(issues.some((issue) => issue.code === "MS_GRAPH_SENDER_INVALID"));
  }
});

test("SMTP configuration cannot satisfy Graph readiness or become a fallback", () => {
  const smtpOnly = {
    NODE_ENV: "production",
    SUBSCRIPTION_ENFORCEMENT_ENABLED: "true",
    APP_URL: "https://revex-books-frontend.vercel.app",
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "synthetic-user",
    SMTP_PASSWORD: "synthetic-value",
    SMTP_FROM: GRAPH_SENDER,
  };
  const issues = getLaunchConfigurationIssues(smtpOnly);
  assert.ok(issues.some((issue) => issue.code === "EMAIL_PROVIDER_INVALID"));
  assert.throws(() => assertLaunchConfiguration(smtpOnly), (error) => error.code === "TRIAL_LAUNCH_CONFIGURATION_INVALID");
});

test("all tests remain mocked and the provider performs no import-time network call", () => {
  let calls = 0;
  createMicrosoftGraphProvider({ environment: environment(), fetchImpl: async () => { calls += 1; return response(); } });
  assert.equal(calls, 0);
});

for (const failure of ["headers", "body-stall", "body-abort", "invalid-json", "non-2xx", "malformed"]) {
  test(`shared token acquisition recovers after ${failure} without leaking sensitive content`, async () => {
    const logs = [];
    let tokenCalls = 0;
    let sends = 0;
    let firstSignal;
    let bodyStarted = false;
    let releaseBody;
    const sensitive = "synthetic-client-secret synthetic-access-token Authorization Bearer private-reset-token temporary-password private-body";
    const fetchImpl = async (url, { signal }) => {
      if (!url.includes("/token")) {
        sends++;
        return response({ status: 202 });
      }
      tokenCalls++;
      if (tokenCalls > 1) return response({ json: { access_token: "fresh-synthetic-token", expires_in: 3600 } });
      firstSignal = signal;
      if (failure === "headers") return new Promise(() => {});
      await new Promise((resolve) => setImmediate(resolve));
      return {
        ok: failure !== "non-2xx",
        status: failure === "non-2xx" ? 401 : 200,
        headers: new Headers(),
        body: { getReader() { let consumed = false; return { releaseLock() {}, async read() {
          bodyStarted = true;
          if (consumed) return { done: true };
          consumed = true;
          if (failure === "body-stall") return new Promise((resolve) => { releaseBody = resolve; });
          if (failure === "body-abort") {
            return new Promise((_, reject) => signal.addEventListener("abort", () => {
              const error = new Error(sensitive);
              error.name = "AbortError";
              reject(error);
            }, { once: true }));
          }
          return { done: false, value: new TextEncoder().encode(failure === "invalid-json" ? "{invalid" : JSON.stringify({ error: sensitive })) };
        } }; } },
      };
    };
    const provider = createMicrosoftGraphProvider({ environment: environment(), fetchImpl, timeoutMs: 20,
      logger: { error(...args) { logs.push(args); } } });
    const message = { to: "private@example.test", subject: sensitive, text: sensitive };
    const results = await Promise.all([provider.sendMail(message), provider.sendMail(message), provider.sendMail(message)]);
    const timeout = ["headers", "body-stall", "body-abort"].includes(failure);
    const code = timeout ? "MS_GRAPH_TIMEOUT" : failure === "non-2xx" ? "MS_GRAPH_TOKEN_REQUEST_FAILED" : "MS_GRAPH_TOKEN_RESPONSE_INVALID";
    for (const result of results) assert.deepEqual(result, { sent: false, reason: "delivery_failed", code });
    assert.equal(tokenCalls, 1);
    assert.equal(sends, 0);
    assert.equal(firstSignal.aborted, timeout);
    if (failure.startsWith("body-")) assert.equal(bodyStarted, true);
    assert.equal(logs.length, 3);
    for (const entry of logs) {
      assert.equal(entry[0], "Microsoft Graph email delivery failed");
      assert.equal(entry[1].code, code);
      assert.equal(entry[1].stage, "token");
    }
    assert.doesNotMatch(JSON.stringify({ logs, results }), /synthetic-client-secret|synthetic-access-token|Authorization|Bearer|private-reset-token|temporary-password|private-body|private@example/i);
    assert.deepEqual(await provider.sendMail(message), { sent: true });
    assert.equal(tokenCalls, 2);
    if (releaseBody) releaseBody({ done: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await provider.sendMail(message), { sent: true });
    assert.equal(tokenCalls, 2);
  });
}
