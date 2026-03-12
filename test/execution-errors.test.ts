const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PtcAbortError,
  PtcExecutionError,
  PtcNestedToolError,
  PtcProtocolError,
  PtcPythonError,
  PtcTimeoutError,
  PtcTransportError,
} = require("../dist/execution/execution-errors.js");

test("execution error classes preserve hierarchy and class names", () => {
  for (const ErrorClass of [PtcAbortError, PtcTimeoutError, PtcTransportError, PtcProtocolError]) {
    const error = new ErrorClass("boom");
    assert.ok(error instanceof Error);
    assert.ok(error instanceof PtcExecutionError);
    assert.equal(error.name, ErrorClass.name);
    assert.equal(error.message, "boom");
  }
});

test("PtcPythonError formats traceback details and retains the raw message", () => {
  const errorWithTraceback = new PtcPythonError("boom", "Traceback line 1\nTraceback line 2");
  assert.equal(errorWithTraceback.rawMessage, "boom");
  assert.match(errorWithTraceback.message, /^Python execution error:/);
  assert.match(errorWithTraceback.message, /Traceback:/);
  assert.match(errorWithTraceback.message, /Traceback line 2/);

  const errorWithoutTraceback = new PtcPythonError("plain failure");
  assert.equal(errorWithoutTraceback.message, "Python execution error: plain failure");
});

test("PtcNestedToolError prefers the provided stack when available", () => {
  const withStack = new PtcNestedToolError({
    type: "ToolFailure",
    message: "tool failed",
    stack: "stack line",
  });
  assert.equal(withStack.message, "tool failed\nstack line");

  const withoutStack = new PtcNestedToolError({
    type: "ToolFailure",
    message: "tool failed",
  });
  assert.equal(withoutStack.message, "tool failed");
});
