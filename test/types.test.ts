const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("types.ts exports settings and execution detail contracts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "types.ts"), "utf8");
  assert.match(source, /export interface PtcSettings/);
  assert.match(source, /export interface ExecutionDetails/);
  assert.match(source, /AgentToolUpdateCallback<unknown>/);
});
