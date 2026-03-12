const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeToolResult } = require("../dist/tool-adapters.js");

test("normalizeToolResult converts find empty sentinel to empty array", () => {
  const result = normalizeToolResult("find", {
    content: [{ type: "text", text: "No files found matching pattern" }],
  });

  assert.deepEqual(result.value, []);
  assert.equal(result.estimatedChars, 2);
});

test("normalizeToolResult parses grep output into structured matches", () => {
  const result = normalizeToolResult("grep", {
    content: [
      {
        type: "text",
        text: "src/index.ts:12: const value = 1\nsrc/index.ts-13- const context = 2",
      },
    ],
  });

  assert.deepEqual(result.value, [
    { path: "src/index.ts", line: 12, text: "const value = 1", kind: "match" },
    { path: "src/index.ts", line: 13, text: "const context = 2", kind: "context" },
  ]);
});

test("normalizeToolResult returns details.ptcValue when present", () => {
  const value = { rows: [{ id: 1 }], rowCount: 1 };
  const result = normalizeToolResult("query_db", {
    content: [{ type: "text", text: "Returned 1 rows" }],
    details: { ptcValue: value },
  });

  assert.deepEqual(result.value, value);
});
