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

test("createSandbox allows subprocess execution only with explicit opt-in", async () => {
  const settings = {
    useDocker: false,
    allowUnsandboxedSubprocess: true,
  };
  const sandbox = await createSandbox(settings);
  const cwd = process.cwd();
  const proc = sandbox.spawn("print('hello from sandbox')", cwd);
  const output = await readStdout(proc);
  assert.match(output, /hello from sandbox/);
  assert.equal(sandbox.getRuntimeWorkspaceRoot(cwd), cwd);
  await sandbox.cleanup();
});

test("createSandbox rejects implicit unsandboxed subprocess mode", async () => {
  await assert.rejects(
    createSandbox({ useDocker: false, allowUnsandboxedSubprocess: false }),
    /PTC requires a sandboxed runtime/
  );
});
