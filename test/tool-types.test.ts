const test = require("node:test");
const assert = require("node:assert/strict");

test("tool-types contract module is directly importable", () => {
  const toolTypes = require("../dist/contracts/tool-types.js");
  assert.equal(typeof toolTypes, "object");
});
