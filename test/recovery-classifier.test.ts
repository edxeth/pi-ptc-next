const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCodeExecutionRecoveryPrompt,
  classifyCodeExecutionFailure,
} = require("../dist/recovery-classifier.js");

test("classifyCodeExecutionFailure detects direct missing-await helper failures", () => {
  const code = [
    'path = "package.json"',
    "content = read(path)",
    "return content",
  ].join("\n");
  const traceback = [
    "Traceback (most recent call last):",
    '  File "<stdin>", line 2, in user_main',
    '    content = read(path)',
    "TypeError: object of type 'coroutine' has no len()",
  ].join("\n");

  assert.equal(classifyCodeExecutionFailure("TypeError: object of type 'coroutine' has no len()", traceback, code), "missing-await");
});

test("classifyCodeExecutionFailure detects async-wrapper iteration misuse deterministically", () => {
  const code = 'files = sorted(glob("src/**/*.ts"))';
  const traceback = [
    "Traceback (most recent call last):",
    '  File "<stdin>", line 1, in user_main',
    '    files = sorted(glob("src/**/*.ts"))',
    "TypeError: 'coroutine' object is not iterable",
  ].join("\n");

  assert.equal(classifyCodeExecutionFailure("TypeError: 'coroutine' object is not iterable", traceback, code), "async-wrapper-iterated");
});

test("classifyCodeExecutionFailure returns null for unrelated SyntaxError and NameError inputs", () => {
  assert.equal(
    classifyCodeExecutionFailure(
      "SyntaxError: invalid syntax",
      'Traceback (most recent call last):\n  File "<stdin>", line 1\n    def broken(:\n               ^',
      "def broken(:"
    ),
    null
  );

  assert.equal(
    classifyCodeExecutionFailure(
      "NameError: name 'missing_var' is not defined",
      "Traceback (most recent call last):\n  File \"<stdin>\", line 1, in user_main\n    return missing_var",
      "return missing_var"
    ),
    null
  );
});

test("buildCodeExecutionRecoveryPrompt returns stable minimal text for each supported failure class", () => {
  assert.equal(
    buildCodeExecutionRecoveryPrompt("missing-await"),
    "PTC recovery: You called an async helper without await. Helpers like read, glob, find, grep, and ls are async wrappers. Await each helper call before using its result."
  );
  assert.equal(
    buildCodeExecutionRecoveryPrompt("async-wrapper-iterated"),
    "PTC recovery: You used an async helper result before awaiting it. Helpers like read, glob, find, grep, and ls are async wrappers. Await the helper call before iterating, sorting, slicing, indexing, or unpacking the result."
  );
});
