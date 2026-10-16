"use strict";
const fs = require("node:fs/promises"), { constants } = require("node:fs"), path = require("node:path");
const fail = code => { throw Object.assign(new Error(code), { code }); };
// POSIX-only capability: Windows mode bits do not enforce a private ACL. Use
// a private WSL directory; never claim chmod(0600) secures a Windows file.
async function reserve(filename) {
  if (process.platform === "win32" || typeof process.getuid !== "function") fail("PILOT_PRIVATE_POSIX_FILE_REQUIRED");
  if (typeof filename !== "string" || !path.isAbsolute(filename) || path.resolve(filename) !== filename) fail("PILOT_OUTPUT_PATH_INVALID");
  const parent = path.dirname(filename), real = await fs.realpath(parent), dir = await fs.lstat(parent);
  if (real !== parent || !dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o077) !== 0) fail("PILOT_PRIVATE_DIRECTORY_REQUIRED");
  let handle;
  try { handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { fail("PILOT_OUTPUT_UNAVAILABLE"); }
  let original, closed = false;
  async function cleanup() {
    // Never unlink a pathname whose identity could not be tied to our handle.
    if (!original && !closed) { try { original = await handle.stat(); } catch { /* fail closed below */ } }
    let closeFailed = false;
    if (!closed) {
      try { await handle.close(); closed = true; }
      catch { closeFailed = true; }
    }
    try {
      const now = await fs.lstat(filename);
      if (!original || !now.isFile() || now.uid !== process.getuid() || now.nlink !== 1 || (now.mode & 0o777) !== 0o600 ||
          now.dev !== original.dev || now.ino !== original.ino) fail("PILOT_OUTPUT_CLEANUP_FAILED");
      await fs.unlink(filename);
      try { await fs.lstat(filename); fail("PILOT_OUTPUT_CLEANUP_FAILED"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    } catch { fail("PILOT_OUTPUT_CLEANUP_FAILED"); }
    if (closeFailed) fail("PILOT_OUTPUT_CLEANUP_FAILED");
  }
  try {
    original = await handle.stat();
    if (!original.isFile() || original.uid !== process.getuid() || (original.mode & 0o777) !== 0o600 || original.nlink !== 1) fail("PILOT_OUTPUT_PERMISSIONS_INVALID");
  } catch (error) { await cleanup(); throw error; }
  return {
    async write(url) {
      if (typeof url !== "string" || !/^https:\/\/revex-books-frontend\.vercel\.app\/activate-account#token=[A-Za-z0-9_-]{43}$/.test(url)) fail("PILOT_OUTPUT_CONTENT_INVALID");
      await handle.writeFile(url + "\n", "utf8"); await handle.sync();
      const now = await fs.lstat(filename);
      if (now.dev !== original.dev || now.ino !== original.ino || now.uid !== process.getuid() || now.nlink !== 1 || (now.mode & 0o777) !== 0o600) fail("PILOT_OUTPUT_PERMISSIONS_INVALID");
      await handle.close(); closed = true;
    },
    cleanup,
  };
}
module.exports = { reserve };
