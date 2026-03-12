const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("index.ts documents read_tree and absolute-path guidance", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "index.ts"), "utf8");
  assert.match(source, /ptc\.read_tree/);
  assert.match(source, /ptc\.find_files_abs/);
  assert.match(source, /registerLoadedTools/);
});
