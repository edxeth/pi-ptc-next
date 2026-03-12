const test = require("node:test");
const assert = require("node:assert/strict");
const { CodeExecutor } = require("../dist/code-executor.js");

test("CodeExecutor rejects asyncio.run before execution", async () => {
  const sandboxManager = {
    spawn() {
      throw new Error("spawn should not be reached");
    },
    async cleanup() {},
  };
  const toolRegistry = {
    getCallableTools() {
      throw new Error("tool registry should not be reached");
    },
    executeTool() {
      throw new Error("executeTool should not be reached");
    },
  };

  const executor = new CodeExecutor(
    sandboxManager,
    toolRegistry,
    { cwd: process.cwd() },
    {
      executionTimeoutMs: 1000,
      maxOutputChars: 1000,
      allowMutations: false,
      allowBash: false,
      maxParallelToolCalls: 4,
      callableTools: undefined,
      blockedTools: undefined,
    },
    process.cwd()
  );

  await assert.rejects(
    executor.execute("import asyncio\nasyncio.run(main())", { cwd: process.cwd() }),
    /Top-level await is already available/
  );
});
