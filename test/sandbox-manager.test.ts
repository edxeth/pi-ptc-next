const test = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("../dist/sandbox-manager.js");

function readStdout(proc) {
  return new Promise((resolve, reject) => {
    let output = "";
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}

test("createSandbox defaults to subprocess execution", async () => {
  delete process.env.PTC_USE_DOCKER;
  const sandbox = await createSandbox();
  const proc = sandbox.spawn("print('hello from sandbox')", process.cwd());
  const output = await readStdout(proc);
  assert.match(output, /hello from sandbox/);
  await sandbox.cleanup();
});
