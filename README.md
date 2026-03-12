# Programmatic Tool Calling (PTC) for pi

`pi-ptc` adds a provider-agnostic `code_execution` tool to pi. The model writes Python code, Python calls local pi tools through an internal RPC bridge, and only the final Python output is returned to the model context.

This is **not** Anthropic's provider-native PTC wire protocol. Instead, it implements the same core local behavior in a way that can work across multiple labs and models such as GPT-5.4, GLM-5, and Claude-class models.

## Why this exists

Without PTC, multi-step tool use usually looks like this:

1. Model calls a tool
2. Tool result comes back into the conversation
3. Model reasons over that result in-context
4. Repeat for every additional tool call

That is expensive for large intermediate results.

With `code_execution`, the model can do this instead:

1. Write Python once
2. Call tools from Python as async functions
3. Filter/aggregate/loop locally
4. Return only the compact final answer

## What changed in this version

This implementation now focuses on provider-agnostic reliability:

- Added a real hard execution timeout for the whole Python run
- Added a `glob()` alias over pi's `find()` behavior for model ergonomics
- Normalized common built-in tool results into Python-friendly values
- Excluded `code_execution` from calling itself recursively
- Added local tool opt-in metadata for custom/extension tools
- Added nested execution metrics such as nested tool count and estimated avoided tokens
- Added bounded concurrency helper utilities in Python
- Added `ptc.read_tree(...)` for deterministic find+read workflows

## Available Python functions

By default, Python code inside `code_execution` can call a safe built-in subset:

- `read(path, file_path=None, offset=None, limit=None) -> str`
- `glob(pattern, path='.', limit=1000) -> list[str]`
- `find(pattern, path='.', limit=1000) -> list[str]`
- `grep(...) -> list[dict]`
- `ls(path='.', limit=500) -> list[str]`

Optional tools can be enabled via environment/config policy:

- `bash(...) -> dict`
- `edit(...) -> dict`
- `write(...) -> dict`

Custom and extension tools are **not callable from Python by default**. They must explicitly opt in with `ptc.enabled: true`.

## Model-facing usage rules

The `code_execution` tool is best for:

- 3+ dependent tool calls
- loops, filtering, aggregation, and batching
- large intermediate results that should stay out of chat history
- inspecting many files and returning a compact summary

Avoid it for:

- one simple tool call
- workflows where the user explicitly needs every raw intermediate result in the chat transcript

Important runtime rules:

- Top-level `await` is already available
- Do **not** call `asyncio.run(...)`
- Do **not** call `_rpc_call(...)` directly; use the generated wrappers and `ptc.*` helpers
- Prefer returning compact JSON or summaries
- Intermediate tool results stay local unless you explicitly print or return them

## Python helpers

The runtime also exposes a `ptc` helper object:

- `await ptc.gather_limit(coros, limit=8)`
- `await ptc.read_many(paths, limit=8, offset=None, line_limit=None)`
- `await ptc.read_tree(pattern, path='.', limit=1000, concurrency=None, offset=None, line_limit=None)`
- `await ptc.find_files(pattern, path='.', limit=1000)`
- `await ptc.find_files_abs(pattern, path='.', limit=1000)`
- `await ptc.read_text(path, offset=None, limit=None)`
- `ptc.json_dump(value)`

Example:

```python
entries = await ptc.read_tree(pattern="**/*.ts", path="src", concurrency=6)
return {
    "files": len(entries),
    "sample_lengths": [len(entry["content"]) for entry in entries[:3]],
}
```

## Result normalization

pi tools are normalized before being returned to Python:

- `read` returns a string
- `find`, `glob`, and `ls` return `list[str]`
- `grep` returns `list[dict]`
- `bash`, `edit`, and `write` return dictionaries
- empty `find`/`ls`/`grep` results become empty lists rather than English sentinel strings

This makes the runtime easier for non-Anthropic models to use reliably.

## Local tool policy

This extension uses a local provider-agnostic equivalent of `allowed_callers`.

### Built-ins

Safe read-only built-ins are callable by default.

### Mutating tools

`bash`, `edit`, and `write` are blocked unless explicitly enabled.

### Custom and extension tools

These must opt in with:

```js
ptc: {
  enabled: true,
  readOnly: true,
}
```

## Environment variables

### Execution

- `PTC_USE_DOCKER=true` — run Python inside Docker instead of a local subprocess
- `PTC_EXECUTION_TIMEOUT_MS=270000` — hard timeout for the full Python execution
- `PTC_MAX_OUTPUT_CHARS=100000` — truncate final output after this many characters
- `PTC_MAX_PARALLEL_TOOL_CALLS=8` — default concurrency for `ptc.gather_limit()`

### Tool policy

- `PTC_ALLOW_MUTATIONS=true` — allow mutating tools from Python
- `PTC_ALLOW_BASH=true` — allow `bash` from Python
- `PTC_CALLABLE_TOOLS=read,glob,find,grep,ls` — explicit allowlist override
- `PTC_BLOCKED_TOOLS=bash,write` — explicit denylist override

## How it works

```text
User request
  ↓
Model calls code_execution
  ↓
pi-ptc builds Python wrappers for callable tools
  ↓
Python runtime executes user code
  ↓
Python calls tools over local JSON RPC
  ↓
Node executes real pi tools
  ↓
Results are normalized into Python-friendly values
  ↓
Python returns one compact final output
```

## Architecture

- `src/index.ts` — registers `code_execution` and model guidance
- `src/code-executor.ts` — execution orchestration and global timeout
- `src/tool-registry.ts` — tool discovery, policy, and caller metadata
- `src/tool-adapters.ts` — normalization of pi tool results
- `src/tool-wrapper.ts` — Python wrapper generation
- `src/rpc-protocol.ts` — Node-side RPC bridge and nested metrics
- `src/python-runtime/runtime.py` — Python runtime and helpers
- `src/python-runtime/rpc.py` — Python-side RPC client
- `src/tool-loader.ts` / `src/tool-watcher.ts` — custom tool loading and hot reload

## Execution modes

### Subprocess mode

Default mode.

- runs `python3 -u -c ...` in the current working directory
- simplest setup
- suitable for trusted local use

### Docker mode

Enable with:

```bash
export PTC_USE_DOCKER=true
```

Behavior:

- uses `python:3.12-slim`
- disables network access
- mounts the workspace read-only
- applies container memory/CPU limits
- reuses the container for multiple executions during the session

## Execution limits

- Hard timeout: `PTC_EXECUTION_TIMEOUT_MS` (default `270000` ms)
- Max final output: `PTC_MAX_OUTPUT_CHARS` (default `100000` chars)
- Per nested tool call timeout: 300 seconds in the Python RPC client
- Cancellation: abort signals are supported

## Custom tools

Drop `.js` files into `tools/`.

Example:

```js
export default {
  name: "query_db",
  description: "Run a read-only database query",
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string" },
    },
    required: ["sql"],
  },
  ptc: {
    enabled: true,
    readOnly: true,
  },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return {
      content: [{ type: "text", text: "Query completed" }],
      details: {
        ptcValue: {
          rows: [],
          rowCount: 0,
        },
      },
    };
  },
};
```

If `details.ptcValue` is present, that JSON-compatible value is returned directly to Python.

## Hot reload

Custom `.js` tools in `tools/` are watched and hot-reloaded while the session is running.

## Metrics

Completed `code_execution` runs now record local nested execution stats, including:

- nested tool call count
- nested tool names
- nested result count
- nested result character volume
- estimated avoided tokens
- total duration

These metrics are stored in tool result details for benchmarking and debugging.

## Development

```bash
npm run build
npm test
```

## Troubleshooting

### `asyncio.run() cannot be called from a running event loop`

Remove `asyncio.run(...)` from model-generated Python. Top-level `await` is already available.

### Tool not callable from Python

Check one of these:

- the tool is blocked by policy
- it is mutating and `PTC_ALLOW_MUTATIONS` is disabled
- it is a custom/extension tool without `ptc.enabled: true`

### Why did Python get a list instead of text?

That is intentional for tools like `find`, `glob`, `ls`, and `grep`. The runtime normalizes those into structured values to improve cross-model reliability.

## License

MIT
