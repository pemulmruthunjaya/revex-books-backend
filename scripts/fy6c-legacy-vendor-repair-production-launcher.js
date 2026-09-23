"use strict";

const {
  run,
  parseArgs,
  validateProductionContext,
  validateRuntimeCommit,
} = require("./fy6c-legacy-vendor-repair-runner");

async function launch({
  argv = process.argv.slice(2),
  env = process.env,
  runner = run,
  pool,
  loadPool = () => require("../db/connection"),
} = {}) {
  let ownedPool = pool;
  let primaryError;
  try {
    const args = parseArgs(argv);
    if (!args.execute || args.mode !== "production")
      throw Error("IDENTITY_MODE_REQUIRED");
    validateProductionContext(args, env);
    validateRuntimeCommit(args, env);
    if (!ownedPool) ownedPool = loadPool();
    return await runner({ db: ownedPool, argv, runtimeEnv: env });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (ownedPool && typeof ownedPool.end === "function") {
      try {
        await ownedPool.end();
      } catch (cleanupError) {
        if (primaryError) primaryError.cleanupError = cleanupError;
        else throw cleanupError;
      }
    }
  }
}

if (require.main === module) {
  launch().catch((error) => {
    console.error(`REFUSED: ${error && error.message ? error.message : "FY6_EXECUTION_FAILED"}`);
    process.exitCode = 1;
  });
}

module.exports = { launch };
