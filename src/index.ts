import { Type, type TSchema } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text, type Component } from "@mariozechner/pi-tui";
import { CodeExecutor } from "./code-executor";
import { createSandbox } from "./sandbox-manager";
import { loadTools } from "./tool-loader";
import { ToolRegistry } from "./tool-registry";
import type { ExecutionDetails, PtcSettings, PtcToolDefinition, SandboxManager } from "./types";
import { watchTools } from "./tool-watcher";
import { loadSettingsFromEnv } from "./utils";

let sandboxManager: SandboxManager | null = null;
let codeExecutor: CodeExecutor | null = null;
let toolRegistry: ToolRegistry | null = null;
let toolWatcher: { close(): void } | null = null;
let settings: PtcSettings | null = null;

function renderExecutingCode(
  codeLines: string[],
  currentLine: number,
  totalLines: number,
  theme: Theme
): Component {
  const lines: string[] = [];
  lines.push(theme.fg("muted", `Executing Python code (line ${currentLine}/${totalLines}):`));
  lines.push("");

  codeLines.forEach((line, index) => {
    const lineNumber = index + 1;
    const isCurrentLine = lineNumber === currentLine;
    let prefix = `${String(lineNumber).padStart(3, " ")} │ `;
    let content = line;

    if (isCurrentLine) {
      prefix = theme.fg("success", `→ ${String(lineNumber).padStart(2, " ")} │ `);
      content = theme.fg("text", line);
    } else if (lineNumber < currentLine) {
      prefix = theme.fg("muted", prefix);
      content = theme.fg("muted", line);
    } else {
      prefix = theme.fg("muted", prefix);
    }

    lines.push(prefix + content);
  });

  return new Text(lines.join("\n"), 0, 0);
}

function renderCompletedOutput(resultText: string, details: ExecutionDetails | undefined, theme: Theme): Component {
  if (!details) {
    return new Text(resultText || "(No output)", 0, 0);
  }

  const summary = theme.fg(
    "muted",
    `[PTC] nested calls=${details.nestedToolCalls}, nested results=${details.nestedResultCount}, ` +
      `estimated avoided tokens≈${details.estimatedAvoidedTokens}, duration=${Math.round(details.durationMs / 1000)}s`
  );

  const body = resultText || "(No output)";
  return new Text(`${summary}\n\n${body}`, 0, 0);
}

function buildToolDescription(currentSettings: PtcSettings): string {
  const callable = currentSettings.callableTools?.length
    ? currentSettings.callableTools.join(", ")
    : currentSettings.allowMutations
      ? "read, glob, find, grep, ls, edit, write" + (currentSettings.allowBash ? ", bash" : "")
      : "read, glob, find, grep, ls" + (currentSettings.allowBash ? ", bash" : "");

  return `Execute Python code with local programmatic tool calling.

Use this tool when you need 3+ dependent tool calls, loops, filtering, aggregation, or large intermediate results that should stay out of the chat context. Avoid it for a single simple tool call.

Important rules:
- Top-level await is already available. Do not call asyncio.run(...).
- Use generated helpers such as read(), glob(), find(), grep(), ls(), and ptc.* helpers. Do not call _rpc_call(...) directly.
- Return a compact final answer only. If you return a dict/list, it will be JSON-serialized automatically.
- Intermediate tool results stay local to this tool run and are not sent back to the model unless you include them in the final output.
- Prefer compact JSON summaries over raw dumps.

Prefer these patterns:
- Many file reads from explicit paths: ptc.read_many(paths, limit=...)
- Find and read an entire tree: ptc.read_tree(pattern=..., path=..., concurrency=...)
- Bounded concurrency for arbitrary coroutines: ptc.gather_limit(coros, limit=...)
- Relative file discovery: glob(...) or ptc.find_files(...)
- Absolute file discovery for later read()/write(): ptc.find_files_abs(...)

Python helpers currently available in this session:
- read(path, file_path=None, offset=None, limit=None) -> str
- glob(pattern, path='.', limit=1000) -> list[str]
- find(pattern, path='.', limit=1000) -> list[str]
- grep(...) -> list[dict]
- ls(path='.', limit=500) -> list[str]
- ptc.gather_limit(coros, limit=...) -> list
- ptc.read_many(paths, limit=..., offset=None, line_limit=None) -> list[str]
- ptc.read_tree(pattern=..., path='.', limit=1000, concurrency=..., offset=None, line_limit=None) -> list[dict]
- ptc.find_files(...), ptc.find_files_abs(...), ptc.read_text(...), ptc.json_dump(...)

Callable tool set for this session: ${callable}

Example:

entries = await ptc.read_tree(pattern="**/*.ts", path="src", concurrency=6)
return {
  "files": len(entries),
  "sample_lengths": [len(entry["content"]) for entry in entries[:3]],
}`;
}


function getExtensionRoot(): string {
  return __dirname.endsWith("/dist") || __dirname.endsWith("\\dist")
    ? __dirname.replace(/[/\\]dist$/, "")
    : __dirname;
}

async function registerLoadedTools(pi: ExtensionAPI, extensionRoot: string): Promise<Map<string, string>> {
  const loadedTools = await loadTools(extensionRoot);
  const initialFileMap = new Map<string, string>();

  for (const { tool, filename } of loadedTools) {
    pi.registerTool({
      name: tool.name,
      label: tool.label || tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute,
      ptc: tool.ptc,
    } as PtcToolDefinition);
    initialFileMap.set(filename, tool.name);
  }

  return initialFileMap;
}

function buildCodeExecutionTool(): PtcToolDefinition {
  return {
    name: "code_execution",
    label: "Code Execution",
    description: buildToolDescription(settings as PtcSettings),
    parameters: Type.Object({
      code: Type.String({
        description:
          "Python code to execute. Top-level await is supported; do not call asyncio.run(...). Prefer returning a compact final result.",
      }),
    }),
    execute: async (toolCallId, { code }, signal, onUpdate, ctx) => {
      if (!codeExecutor) {
        throw new Error("Code executor not initialized");
      }

      try {
        const result = await codeExecutor.execute(code, {
          cwd: ctx.cwd,
          signal,
          onUpdate,
          parentToolCallId: toolCallId,
        });

        return {
          content: [{ type: "text" as const, text: result.output || "(No output)" }],
          details: result.details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Python execution failed: ${message}`);
      }
    },
    renderResult(result, { isPartial }, theme) {
      const details = result.details as ExecutionDetails | undefined;
      if (isPartial && details?.userCode && details.currentLine) {
        return renderExecutingCode(
          details.userCode,
          details.currentLine,
          details.totalLines || details.userCode.length,
          theme
        );
      }

      const text = result.content
        .filter((content): content is { type: "text"; text: string } => content.type === "text")
        .map((content) => content.text)
        .join("");

      return renderCompletedOutput(text, details, theme);
    },
  };
}

async function cleanupSessionResources(): Promise<void> {
  if (toolWatcher) {
    toolWatcher.close();
    toolWatcher = null;
  }
  if (sandboxManager) {
    await sandboxManager.cleanup();
    sandboxManager = null;
  }
  codeExecutor = null;
  toolRegistry = null;
  settings = null;
}

/**
 * PTC (Programmatic Tool Calling) extension.
 */
export default async function ptcExtension(pi: ExtensionAPI, context: ExtensionContext) {
  settings = loadSettingsFromEnv();
  const extensionRoot = getExtensionRoot();

  toolRegistry = new ToolRegistry(pi);
  sandboxManager = await createSandbox();
  codeExecutor = new CodeExecutor(sandboxManager, toolRegistry, context, settings, extensionRoot);

  const initialFileMap = await registerLoadedTools(pi, extensionRoot);
  toolWatcher = watchTools(extensionRoot, pi, toolRegistry, initialFileMap);
  pi.registerTool(buildCodeExecutionTool());

  pi.on("session_shutdown", cleanupSessionResources);
}
