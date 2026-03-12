const test = require("node:test");
const assert = require("node:assert/strict");

test("execution-types contract module is directly importable", () => {
  const executionTypes = require("../dist/contracts/execution-types.js");
  assert.equal(typeof executionTypes, "object");
});
