const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path"), { constants } = require("node:fs");
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform"), originalUid = process.getuid;
let entry, flags, mode, fault, directoryMode = 0o700, realParent, closeFailure, unlinkFailure, unlinkCalls;
const name = path.resolve("private", "activation.txt");
const parent = path.dirname(name);
const metadata = () => ({ dev: 1, ino: 2, uid: 42, nlink: 1, mode: 0o600, isFile: () => true });
const filesystem = {
  async realpath() { return realParent || parent; },
  async lstat(p) { if (p === parent) return { uid: 42, mode: directoryMode, isDirectory: () => true }; if (!entry) throw Object.assign(Error("missing"), { code: "ENOENT" }); return entry.meta; },
  async open(p, f, m) {
    flags = f; mode = m; if (entry) throw Error("exists"); entry = { meta: metadata(), body: null };
    return { async stat() { if (fault === "stat") throw Error("stat failed"); return entry.meta; }, async writeFile(v) { entry.body = v; if (fault === "write") throw Error("sensitive contents"); }, async sync() { if (fault === "sync") throw Error("sync failed"); }, async close() { if (closeFailure) throw Error("sensitive close failure"); } };
  },
  async unlink(p) { assert.equal(p, name); unlinkCalls++; if (unlinkFailure) throw Error("unlink failed"); entry = null; },
};
require.cache[require.resolve("node:fs/promises")] = { exports: filesystem };
// Builtins do not use require.cache: intercept only this module's import.
const Module = require("node:module"), load = Module._load;
Module._load = function(request, ...args) { return request === "node:fs/promises" ? filesystem : load.call(this, request, ...args); };
const { reserve } = require("../utils/internalPilotActivationFile"); Module._load = load;
test.beforeEach(() => { Object.defineProperty(process, "platform", { value: "linux", configurable: true }); process.getuid = () => 42; entry = null; fault = null; directoryMode = 0o700; realParent = null; closeFailure = false; unlinkFailure = false; unlinkCalls = 0; });
test.after(() => { Object.defineProperty(process, "platform", originalPlatform); if (originalUid) process.getuid = originalUid; else delete process.getuid; });
test("file is exclusive, no-follow, owner-only and uses canonical fragment URL", async () => {
  const file = await reserve(name); assert.equal(mode, 0o600); assert.ok(flags & constants.O_EXCL); assert.ok(flags & constants.O_CREAT);
  const url = "https://revex-books-frontend.vercel.app/activate-account#token=" + "A".repeat(43);
  await file.write(url); assert.equal(entry.body, url + "\n"); await assert.rejects(reserve(name), { code: "PILOT_OUTPUT_UNAVAILABLE" });
  await file.cleanup(); assert.equal(entry, null);
});
test("unsafe directory/symlink/Windows ACL assumptions are rejected without creating output", async () => {
  directoryMode = 0o755; await assert.rejects(reserve(name), { code: "PILOT_PRIVATE_DIRECTORY_REQUIRED" }); assert.equal(entry, null);
  directoryMode = 0o700; realParent = path.resolve("different"); await assert.rejects(reserve(name)); assert.equal(entry, null);
  Object.defineProperty(process, "platform", { value: "win32", configurable: true }); await assert.rejects(reserve(name), { code: "PILOT_PRIVATE_POSIX_FILE_REQUIRED" }); assert.equal(entry, null);
});
test("partial write/sync failure output is removed; replaced files are never deleted", async () => {
  for (const f of ["write", "sync"]) {
    fault = f; const file = await reserve(name); await assert.rejects(file.write("https://revex-books-frontend.vercel.app/activate-account#token=" + "A".repeat(43))); await file.cleanup(); assert.equal(entry, null);
  }
  fault = null; const file = await reserve(name); entry.meta = { ...metadata(), ino: 3 };
  await assert.rejects(file.cleanup(), { code: "PILOT_OUTPUT_CLEANUP_FAILED" }); assert.notEqual(entry, null);
});
test("unverifiable initial file identity fails closed without deleting an unverified pathname", async () => {
  fault = "stat"; await assert.rejects(reserve(name), { code: "PILOT_OUTPUT_CLEANUP_FAILED" }); assert.notEqual(entry, null); assert.equal(unlinkCalls, 0);
});
test("close failure still attempts identity-checked deletion and reports cleanup uncertainty", async () => {
  const file = await reserve(name); closeFailure = true;
  await assert.rejects(file.write("https://revex-books-frontend.vercel.app/activate-account#token=" + "A".repeat(43)));
  await assert.rejects(file.cleanup(), { code: "PILOT_OUTPUT_CLEANUP_FAILED" });
  assert.equal(unlinkCalls, 1); assert.equal(entry, null);
});
test("close failure never deletes a replacement, and deletion failure cannot report success", async () => {
  const file = await reserve(name); closeFailure = true; entry.meta = { ...metadata(), ino: 999 };
  await assert.rejects(file.cleanup(), { code: "PILOT_OUTPUT_CLEANUP_FAILED" }); assert.equal(unlinkCalls, 0); assert.notEqual(entry, null);
  entry.meta = metadata(); unlinkFailure = true;
  await assert.rejects(file.cleanup(), { code: "PILOT_OUTPUT_CLEANUP_FAILED" }); assert.equal(unlinkCalls, 1); assert.notEqual(entry, null);
});
