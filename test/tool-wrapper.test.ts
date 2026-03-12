const test = require("node:test");
const assert = require("node:assert/strict");
const { generateToolWrappers } = require("../dist/tool-wrapper.js");

test("generateToolWrappers emits read compatibility and typed helpers", () => {
  const code = generateToolWrappers([
    {
      name: "read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path" },
          offset: { type: "integer", description: "Offset" },
        },
        required: ["path"],
      },
      source: "builtin",
      isReadOnly: true,
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
    },
    {
      name: "glob",
      description: "Find files",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob" },
          path: { type: "string", description: "Base path" },
        },
        required: ["pattern"],
      },
      source: "alias",
      isReadOnly: true,
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
    },
  ]);

  assert.match(code, /async def read\(/);
  assert.match(code, /file_path: Optional\[str\] = None/);
  assert.match(code, /async def glob\(/);
  assert.match(code, /-> List\[str\]/);
  assert.match(code, /return await _rpc_call\("glob", params\)/);
});
