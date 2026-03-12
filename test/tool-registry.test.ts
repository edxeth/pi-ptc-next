const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("tool-registry source includes callable policy and glob alias", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "tool-registry.ts"), "utf8");

  assert.match(source, /tool\.name === "code_execution"/);
  assert.match(source, /builtins\.set\("glob"/);
  assert.match(source, /return tool\.ptc\?\.enabled === true/);
  assert.match(source, /allowMutations/);
  assert.match(source, /allowBash/);
});
