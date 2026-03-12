const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("tool-watcher preserves ptc metadata and reload failure handling", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "tool-watcher.ts"), "utf8");
  assert.match(source, /ptc: def\.ptc/);
  assert.match(source, /loadFile\(filename\)\.catch/);
});
