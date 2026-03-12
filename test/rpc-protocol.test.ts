const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { RpcProtocol } = require("../dist/rpc-protocol.js");

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
  }

  kill() {
    this.exitCode = 0;
    this.emit("exit", 0);
  }
}

test("RpcProtocol normalizes nested tool results and reports details", async () => {
  const proc = new FakeProcess();
  let sent = "";
  const sentOnce = new Promise((resolve) => {
    proc.stdin.on("data", (chunk) => {
      sent += chunk.toString();
      resolve(undefined);
    });
  });

  const protocol = new RpcProtocol(
    proc,
    async () => ({ content: [{ type: "text", text: "a.ts\nb.ts" }], details: undefined }),
    "result = await find(pattern='**/*.ts')"
  );

  proc.stdout.write(JSON.stringify({ type: "tool_call", id: "1", tool: "find", params: { pattern: "**/*.ts" } }) + "\n");
  await sentOnce;
  assert.match(sent, /"type":"tool_result"/);
  assert.match(sent, /"value":\["a.ts","b.ts"\]/);

  proc.stdout.write(JSON.stringify({ type: "complete", output: "done" }) + "\n");
  const result = await protocol.waitForCompletion();
  assert.equal(result.output, "done");
  assert.equal(result.details.nestedToolCalls, 1);
  assert.equal(result.details.nestedResultCount, 1);
});

test("RpcProtocol preserves framed stdout before the final result", async () => {
  const proc = new FakeProcess();
  const protocol = new RpcProtocol(proc, async () => null, "print('hello')");

  proc.stdout.write(JSON.stringify({ type: "stdout", text: "hello\n" }) + "\n");
  proc.stdout.write(JSON.stringify({ type: "complete", output: "done" }) + "\n");

  const result = await protocol.waitForCompletion();
  assert.equal(result.output, "hello\ndone");
});

test("RpcProtocol rejects clean exits without a terminal protocol message", async () => {
  const proc = new FakeProcess();
  const protocol = new RpcProtocol(proc, async () => null, "print('hello')");

  proc.emit("exit", 0);
  proc.stdout.end();

  await assert.rejects(protocol.waitForCompletion(), /before completing the RPC protocol/);
});

test("RpcProtocol accepts a buffered complete frame that arrives after exit", async () => {
  const proc = new FakeProcess();
  const protocol = new RpcProtocol(proc, async () => null, "print('hello')");

  proc.emit("exit", 0);
  proc.stdout.write(JSON.stringify({ type: "complete", output: "done" }) + "\n");
  proc.stdout.end();

  const result = await protocol.waitForCompletion();
  assert.equal(result.output, "done");
});

test("RpcProtocol rejects invalid JSON frames as protocol errors", async () => {
  const proc = new FakeProcess();
  const protocol = new RpcProtocol(proc, async () => null, "print('hello')");

  proc.stdout.write("not-json\n");

  await assert.rejects(protocol.waitForCompletion(), /Invalid RPC message/);
});

test("RpcProtocol rejects unknown frame types", async () => {
  const proc = new FakeProcess();
  const protocol = new RpcProtocol(proc, async () => null, "print('hello')");

  proc.stdout.write(JSON.stringify({ type: "mystery" }) + "\n");

  await assert.rejects(protocol.waitForCompletion(), /Unknown RPC frame type/);
});

test("RpcProtocol rejects malformed tool_call frames", async () => {
  const proc = new FakeProcess();
  const protocol = new RpcProtocol(proc, async () => null, "print('hello')");

  proc.stdout.write(JSON.stringify({ type: "tool_call", id: 1, tool: "find", params: [] }) + "\n");

  await assert.rejects(protocol.waitForCompletion(), /Invalid tool_call frame/);
});
