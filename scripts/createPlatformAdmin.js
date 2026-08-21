const readline = require("node:readline");

class BootstrapPromptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BootstrapPromptError";
    this.code = code;
  }
}

const argument = (argv, name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? String(argv[index + 1] || "").trim() : "";
};

const concealedPasswordPrompt = ({ input = process.stdin, output = process.stdout } = {}) => {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new BootstrapPromptError(
      "INTERACTIVE_TERMINAL_REQUIRED",
      "An interactive terminal is required for concealed password entry"
    ));
  }

  return new Promise((resolve, reject) => {
    let password = "";
    const wasRaw = Boolean(input.isRaw);
    const wasPaused = typeof input.isPaused === "function" ? input.isPaused() : false;
    let settled = false;

    const cleanup = () => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(wasRaw);
      if (wasPaused && typeof input.pause === "function") input.pause();
      output.write("\n");
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onKeypress = (text, key = {}) => {
      if (key.ctrl && key.name === "c") {
        return finish(reject, new BootstrapPromptError(
          "PROMPT_CANCELLED",
          "Platform administrator creation cancelled"
        ));
      }
      if (key.name === "return" || key.name === "enter") return finish(resolve, password);
      if (key.name === "backspace") {
        password = password.slice(0, -1);
        return;
      }
      if (!key.ctrl && !key.meta && text) {
        password += String(text).replace(/[\x00-\x1f\x7f]/g, "");
      }
    };

    output.write("Password: ");
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
  });
};

const safeFailureMessage = (error) => {
  if (["PROMPT_CANCELLED", "INTERACTIVE_TERMINAL_REQUIRED", "INVALID_ARGUMENTS"].includes(error?.code)) return error.message;
  if (error?.code === "EMPTY_PASSWORD") return "Password cannot be empty";
  if (error?.code === "PASSWORD_TOO_SHORT") return "Password must be at least 8 characters";
  if (["PLATFORM_ADMIN_EXISTS", "INVALID_PLATFORM_ADMIN"].includes(error?.code)) return error.message;
  const databaseCodes = new Set(["ECONNREFUSED", "ETIMEDOUT", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_NO_SUCH_TABLE"]);
  if (databaseCodes.has(error?.code)) {
    return `Database operation failed (${error.code}). Verify the database connection and platform-admin migration.`;
  }
  return "Unable to create platform administrator. Check the server configuration and try again.";
};

const run = async ({
  argv = process.argv.slice(2),
  passwordPrompt = concealedPasswordPrompt,
  createAdmin,
  output = console,
} = {}) => {
  const name = argument(argv, "name");
  const email = argument(argv, "email");
  if (!name || !email) {
    throw new BootstrapPromptError("INVALID_ARGUMENTS", "Both --name and --email are required");
  }
  const password = await passwordPrompt();
  if (!password) throw new BootstrapPromptError("EMPTY_PASSWORD", "Password cannot be empty");
  if (password.length < 8) throw new BootstrapPromptError("PASSWORD_TOO_SHORT", "Password must be at least 8 characters");

  let runtime;
  try {
    runtime = createAdmin ? null : {
      createAdmin: require("../services/platformAdminService").createPlatformAdmin,
      db: require("../db/connection"),
    };
    const admin = await (createAdmin || runtime.createAdmin)({ name, email, password });
    output.log("Platform administrator created successfully");
    return admin;
  } finally {
    if (runtime?.db) await runtime.db.end();
  }
};

const main = async () => {
  try {
    await run();
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
};

if (require.main === module) main();

module.exports = { BootstrapPromptError, argument, concealedPasswordPrompt, run, safeFailureMessage };
