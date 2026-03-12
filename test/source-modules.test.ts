const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readSource(file) {
  return fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
}

test("index.ts documents read_tree guidance", () => {
  const source = readSource("index.ts");
  assert.match(source, /ptc\.read_tree/);
  assert.match(source, /ptc\.find_files_abs/);
});

test("tool-watcher preserves ptc metadata on reload", () => {
  const source = readSource("tool-watcher.ts");
  assert.match(source, /ptc: def\.ptc/);
});

test("types.ts keeps execution metrics internal and exports settings types", () => {
  const source = readSource("types.ts");
  assert.match(source, /interface ExecutionMetrics/);
  assert.doesNotMatch(source, /export interface ExecutionMetrics/);
  assert.match(source, /export interface PtcSettings/);
});
