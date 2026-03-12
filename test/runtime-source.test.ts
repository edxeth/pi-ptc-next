const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("runtime.py exposes absolute-path helper", () => {
  const runtimePath = path.join(__dirname, "..", "src", "python-runtime", "runtime.py");
  const source = fs.readFileSync(runtimePath, "utf8");

  assert.match(source, /async def find_files_abs\(/);
  assert.match(source, /os\.path\.abspath\(path\)/);
});

test("runtime.py exposes read_tree helper", () => {
  const runtimePath = path.join(__dirname, "..", "src", "python-runtime", "runtime.py");
  const source = fs.readFileSync(runtimePath, "utf8");

  assert.match(source, /async def read_tree\(/);
  assert.match(source, /files = await self\.find_files_abs\(/);
  assert.match(source, /contents = await self\.read_many\(/);
});
