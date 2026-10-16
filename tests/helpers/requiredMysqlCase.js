"use strict";
// node:test records a failed child without rejecting the awaited t.test().
// Explicit completion prevents dependent cases from using partial prerequisites.
async function requiredCase(t, name, body) {
  let passed = false;
  await t.test(name, async () => { await body(); passed = true; });
  return passed;
}
module.exports = { requiredCase };
