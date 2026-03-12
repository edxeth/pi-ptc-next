const test = require("node:test");
const assert = require("node:assert/strict");

test("contract and public type entrypoints remain directly importable", () => {
  const executionTypes = require("../dist/contracts/execution-types.js");
  const toolTypes = require("../dist/contracts/tool-types.js");
  const publicTypes = require("../dist/types.js");

  assert.equal(typeof executionTypes, "object");
  assert.equal(typeof toolTypes, "object");
  assert.equal(typeof publicTypes, "object");
});
