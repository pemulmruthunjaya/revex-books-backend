const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_SENDER = "support@revexbooks.com";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;

class MicrosoftGraphEmailError extends Error {
  constructor(code, stage, status = null) {
    super("Microsoft Graph email delivery failed");
    this.name = "MicrosoftGraphEmailError";
    this.code = code;
    this.stage = stage;
    this.status = status;
  }
}

const isGuid = (value) => GUID_PATTERN.test(String(value || "").trim());

const graphConfigurationIssues = (environment = process.env) => {
  const issues = [];
  if (environment.EMAIL_PROVIDER !== "microsoft_graph") {
    issues.push({ code: "EMAIL_PROVIDER_INVALID", variable: "EMAIL_PROVIDER" });
  }
  for (const variable of ["MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET", "MS_GRAPH_SENDER"]) {
    if (!String(environment[variable] || "").trim()) {
      issues.push({ code: "EMAIL_CONFIGURATION_REQUIRED", variable });
    }
  }
  if (environment.MS_GRAPH_TENANT_ID && !isGuid(environment.MS_GRAPH_TENANT_ID)) {
    issues.push({ code: "MS_GRAPH_TENANT_ID_INVALID", variable: "MS_GRAPH_TENANT_ID" });
  }
  if (environment.MS_GRAPH_CLIENT_ID && !isGuid(environment.MS_GRAPH_CLIENT_ID)) {
    issues.push({ code: "MS_GRAPH_CLIENT_ID_INVALID", variable: "MS_GRAPH_CLIENT_ID" });
  }
  if (environment.MS_GRAPH_SENDER && String(environment.MS_GRAPH_SENDER).trim() !== GRAPH_SENDER) {
    issues.push({ code: "MS_GRAPH_SENDER_INVALID", variable: "MS_GRAPH_SENDER" });
  }
  return issues;
};

const sanitizedLogDetails = (error) => ({
  code: error?.code || "MS_GRAPH_EMAIL_FAILED",
  stage: error?.stage || "unknown",
  status: Number.isInteger(error?.status) ? error.status : null,
});

const createMicrosoftGraphProvider = ({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const issues = graphConfigurationIssues(environment);
  if (issues.length) {
    throw new MicrosoftGraphEmailError("MS_GRAPH_CONFIGURATION_INVALID", "configuration");
  }
  if (typeof fetchImpl !== "function") {
    throw new MicrosoftGraphEmailError("MS_GRAPH_FETCH_UNAVAILABLE", "configuration");
  }

  const tenantId = String(environment.MS_GRAPH_TENANT_ID).trim();
  const clientId = String(environment.MS_GRAPH_CLIENT_ID).trim();
  const clientSecret = String(environment.MS_GRAPH_CLIENT_SECRET);
  const sender = GRAPH_SENDER;
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let tokenRequest = null;

  const request = async (url, options, stage, consume = (response) => response) => {
    const controller = new AbortController();
    const startedAt = performance.now();
    const checkDeadline = () => {
      if (controller.signal.aborted || performance.now() - startedAt >= timeoutMs) {
        controller.abort();
        throw new MicrosoftGraphEmailError("MS_GRAPH_TIMEOUT", stage);
      }
    };
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new MicrosoftGraphEmailError("MS_GRAPH_TIMEOUT", stage));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await fetchImpl(url, { ...options, signal: controller.signal });
          checkDeadline();
          const result = await consume(response, controller, checkDeadline);
          checkDeadline();
          return result;
        })(),
      ]);
    } catch (error) {
      if (error instanceof MicrosoftGraphEmailError && error.code === "MS_GRAPH_TOKEN_RESPONSE_TOO_LARGE") throw error;
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw new MicrosoftGraphEmailError("MS_GRAPH_TIMEOUT", stage);
      }
      if (error instanceof MicrosoftGraphEmailError) throw error;
      const code = error?.name === "AbortError" ? "MS_GRAPH_TIMEOUT" : "MS_GRAPH_NETWORK_ERROR";
      throw new MicrosoftGraphEmailError(code, stage);
    } finally {
      clearTimeout(timer);
    }
  };

  const acquireToken = async () => {
    if (cachedToken && now() < tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) return cachedToken;
    if (tokenRequest) return tokenRequest;

    tokenRequest = (async () => {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: GRAPH_SCOPE,
        grant_type: "client_credentials",
      });
      const payload = await request(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          redirect: "manual",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        },
        "token",
        async (response, controller, checkDeadline) => {
          if (!response.ok) {
            throw new MicrosoftGraphEmailError("MS_GRAPH_TOKEN_REQUEST_FAILED", "token", response.status);
          }
          try {
            const tooLarge = () => {
              controller.abort();
              throw new MicrosoftGraphEmailError("MS_GRAPH_TOKEN_RESPONSE_TOO_LARGE", "token");
            };
            const length = response.headers.get("content-length");
            if (length !== null && /^\d+$/.test(length.trim()) && Number(length) > MAX_TOKEN_RESPONSE_BYTES) tooLarge();
            const reader = response.body.getReader();
            const bytes = new Uint8Array(MAX_TOKEN_RESPONSE_BYTES);
            let total = 0;
            try {
              while (true) {
                checkDeadline();
                const { done, value } = await reader.read();
                checkDeadline();
                if (done) break;
                if (value.byteLength > MAX_TOKEN_RESPONSE_BYTES - total) tooLarge();
                bytes.set(value, total);
                total += value.byteLength;
              }
            } finally {
              reader.releaseLock();
            }
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total));
            checkDeadline();
            const payload = JSON.parse(text);
            checkDeadline();
            return payload;
          } catch (error) {
            if (error instanceof MicrosoftGraphEmailError) throw error;
            if (error?.name === "AbortError") throw error;
            throw new MicrosoftGraphEmailError("MS_GRAPH_TOKEN_RESPONSE_INVALID", "token", response.status);
          }
        }
      );
      const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
      const expiresIn = Number(payload?.expires_in);
      if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new MicrosoftGraphEmailError("MS_GRAPH_TOKEN_RESPONSE_INVALID", "token");
      }
      cachedToken = accessToken;
      tokenExpiresAt = now() + expiresIn * 1000;
      return cachedToken;
    })();

    try {
      return await tokenRequest;
    } finally {
      tokenRequest = null;
    }
  };

  const sendMail = async ({ to, subject, text, html }) => {
    try {
      const accessToken = await acquireToken();
      const response = await request(
        `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`,
        {
          method: "POST",
          redirect: "manual",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject: String(subject || ""),
              body: {
                contentType: html ? "HTML" : "Text",
                content: String(html || text || ""),
              },
              toRecipients: [{ emailAddress: { address: String(to || "") } }],
              from: { emailAddress: { address: sender } },
              replyTo: [{ emailAddress: { address: sender } }],
            },
            saveToSentItems: true,
          }),
        },
        "send"
      );
      if (!response.ok) {
        throw new MicrosoftGraphEmailError("MS_GRAPH_SEND_FAILED", "send", response.status);
      }
      return { sent: true };
    } catch (error) {
      const safeError = error instanceof MicrosoftGraphEmailError
        ? error
        : new MicrosoftGraphEmailError("MS_GRAPH_EMAIL_FAILED", "unknown");
      if (typeof logger?.error === "function") {
        logger.error("Microsoft Graph email delivery failed", sanitizedLogDetails(safeError));
      }
      return { sent: false, reason: "delivery_failed", code: safeError.code };
    }
  };

  return { sendMail };
};

module.exports = {
  MAX_TOKEN_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  GRAPH_SCOPE,
  GRAPH_SENDER,
  MicrosoftGraphEmailError,
  createMicrosoftGraphProvider,
  graphConfigurationIssues,
  isGuid,
  sanitizedLogDetails,
};
