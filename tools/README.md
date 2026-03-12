# Custom Tools for pi-ptc

Drop `.js` files in this directory to register custom tools with pi and optionally expose them to `code_execution`.

## Required fields

Each tool file should export a default object with these fields:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Tool name |
| `label` | no | Display label |
| `description` | yes | Description shown to the model |
| `parameters` | yes | JSON Schema for the tool arguments |
| `execute` | yes | `async (toolCallId, params, signal, onUpdate, ctx) => result` |
| `ptc` | no | pi-ptc metadata controlling Python access |

## Opting into Python access

Custom and extension tools are **not callable from Python by default**.

To expose a tool to `code_execution`, set:

```js
ptc: {
  enabled: true,
  readOnly: true,
}
```

Supported metadata:

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Allow this tool to be called from `code_execution` |
| `readOnly` | boolean | Mark the tool as read-only for policy filtering |
| `pythonName` | string | Override the Python wrapper function name |

## Returning structured values to Python

If your tool returns `details.ptcValue`, that JSON-compatible value is returned directly to Python.

Example:

```js
export default {
  name: "query_db",
  description: "Run a read-only SQL query",
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
  async execute(toolCallId, params) {
    const rows = [];
    return {
      content: [{ type: "text", text: `Returned ${rows.length} rows` }],
      details: {
        ptcValue: {
          rows,
          rowCount: rows.length,
        },
      },
    };
  },
};
```

If `details.ptcValue` is omitted, pi-ptc falls back to normalizing the tool's text output.

## Notes

- Only `.js` files are loaded
- Tools are loaded at startup and hot-reloaded when files change
- `ctx.caller` may contain local caller metadata when invoked from `code_execution`
- Keep Python-facing return values compact and JSON-compatible when possible
