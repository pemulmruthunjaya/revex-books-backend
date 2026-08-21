const readline = require("node:readline");
const { Writable } = require("node:stream");
const { createPlatformAdmin } = require("../services/platformAdminService");

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
};

const hiddenPasswordPrompt = () => new Promise((resolve) => {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write("Password: ");
  muted = true;
  rl.question("", (password) => {
    muted = false;
    process.stdout.write("\n");
    rl.close();
    resolve(password);
  });
});

const run = async () => {
  const name = argument("name");
  const email = argument("email");
  if (!name || !email || !process.stdin.isTTY) {
    throw new Error("Run interactively with --name and --email; the password is requested securely");
  }
  const password = await hiddenPasswordPrompt();
  await createPlatformAdmin({ name, email, password });
  console.log("Platform administrator created successfully");
};

run()
  .catch((error) => {
    console.error(error.code === "PLATFORM_ADMIN_EXISTS" ? error.message : "Unable to create platform administrator");
    process.exitCode = 1;
  })
  .finally(async () => {
    const db = require("../db/connection");
    await db.end();
  });
