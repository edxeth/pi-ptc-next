const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { loadTools } = require("../dist/tool-loader.js");

test("loadTools loads ptc metadata from tools directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ptc-tools-"));
  const toolsDir = path.join(root, "tools");
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.writeFile(
    path.join(toolsDir, "echo.js"),
    `module.exports = {
      name: 'echo',
      description: 'Echo input',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      ptc: { enabled: true, readOnly: true, pythonName: 'echo_tool' },
      async execute() { return { content: [{ type: 'text', text: 'ok' }], details: undefined }; }
    };\n`
  );

  const loaded = await loadTools(root);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].tool.name, "echo");
  assert.deepEqual(loaded[0].tool.ptc, {
    enabled: true,
    readOnly: true,
    pythonName: "echo_tool",
  });
});
