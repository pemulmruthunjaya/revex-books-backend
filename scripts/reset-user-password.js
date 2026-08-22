const { main } = require("./resetInternalUserPassword");

main().then((code) => { process.exitCode = code; });
