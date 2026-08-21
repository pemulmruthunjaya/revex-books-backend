const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { BootstrapPromptError, concealedPasswordPrompt, run, safeFailureMessage } = require("../scripts/createPlatformAdmin");

class FakeInput extends EventEmitter {
  constructor() { super(); this.isTTY = true; this.isRaw = false; this.paused = true; this.rawChanges = []; }
  setRawMode(value) { this.isRaw = value; this.rawChanges.push(value); }
  isPaused() { return this.paused; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
}

const outputHarness = () => {
  const chunks = [];
  return { chunks, write: (value) => { chunks.push(String(value)); } };
};
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("raw-mode prompt captures Windows keypresses without echoing password", async () => {
  const input = new FakeInput();
  const output = outputHarness();
  const pending = concealedPasswordPrompt({ input, output });
  for (const character of "safe-password") input.emit("keypress", character, { name: character });
  input.emit("keypress", "\r", { name: "return" });
  assert.equal(await pending, "safe-password");
  assert.deepEqual(input.rawChanges, [true, false]);
  assert.equal(input.paused, true);
  assert.equal(output.chunks.join(""), "Password: \n");
});

test("backspace edits the concealed value without writing characters", async () => {
  const input = new FakeInput();
  const output = outputHarness();
  const pending = concealedPasswordPrompt({ input, output });
  for (const character of "passwordX") input.emit("keypress", character, { name: character });
  input.emit("keypress", "", { name: "backspace" });
  input.emit("keypress", "\r", { name: "enter" });
  assert.equal(await pending, "password");
  assert.equal(output.chunks.join(""), "Password: \n");
});

test("Ctrl+C cancels and restores terminal state", async () => {
  const input = new FakeInput();
  const output = outputHarness();
  const pending = concealedPasswordPrompt({ input, output });
  input.emit("keypress", "\u0003", { name: "c", ctrl: true });
  await assert.rejects(pending, (error) => error.code === "PROMPT_CANCELLED");
  assert.deepEqual(input.rawChanges, [true, false]);
  assert.equal(input.paused, true);
});

test("empty, short and cancelled prompts create nothing", async () => {
  let calls = 0;
  const createAdmin = async () => { calls += 1; };
  for (const [passwordPrompt, code] of [
    [async () => "", "EMPTY_PASSWORD"],
    [async () => "short", "PASSWORD_TOO_SHORT"],
    [async () => { throw new BootstrapPromptError("PROMPT_CANCELLED", "cancelled"); }, "PROMPT_CANCELLED"],
  ]) {
    await assert.rejects(run({ argv: ["--name", "Admin", "--email", "admin@example.test"], passwordPrompt, createAdmin, output: { log() {} } }), (error) => error.code === code);
  }
  assert.equal(calls, 0);
});

test("successful run never logs the password", async () => {
  const logs = [];
  const calls = [];
  await run({
    argv: ["--name", "Admin", "--email", "ADMIN@example.test"],
    passwordPrompt: async () => "safe-password",
    createAdmin: async (input) => { calls.push(input); return { id: 1 }; },
    output: { log: (message) => logs.push(message) },
  });
  assert.equal(calls[0].password, "safe-password");
  assert.doesNotMatch(logs.join(" "), /safe-password/);
});

test("safe errors distinguish validation, duplicate and database categories", () => {
  assert.equal(safeFailureMessage({ code: "EMPTY_PASSWORD" }), "Password cannot be empty");
  assert.match(safeFailureMessage({ code: "PLATFORM_ADMIN_EXISTS", message: "Already exists" }), /Already exists/);
  assert.match(safeFailureMessage({ code: "ER_NO_SUCH_TABLE", message: "SQL details" }), /ER_NO_SUCH_TABLE/);
  assert.doesNotMatch(safeFailureMessage({ code: "ER_NO_SUCH_TABLE", message: "SQL details" }), /SQL details/);
});

const runTests = async () => {
  let passed = 0;
  for (const item of tests) { await item.fn(); console.log(`ok ${++passed} - ${item.name}`); }
  console.log(`Platform admin bootstrap script: ${passed} focused tests passed`);
};
runTests().catch((error) => { console.error(error); process.exitCode = 1; });
