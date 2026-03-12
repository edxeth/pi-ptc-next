import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import type { CallerMetadata, ExecuteToolContext, PtcSettings, PtcToolDefinition, PtcToolOptions, ToolInfo } from "./types";

function classifyTool(name: string, ptc?: PtcToolOptions): { isReadOnly: boolean } {
  if (typeof ptc?.readOnly === "boolean") {
    return { isReadOnly: ptc.readOnly };
  }

  switch (name) {
    case "read":
    case "find":
    case "glob":
    case "grep":
    case "ls":
      return { isReadOnly: true };
    default:
      return { isReadOnly: false };
  }
}

/**
 * Registry for tracking registered tools and their execute functions.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolInfo>();
  private originalRegisterTool: ExtensionAPI["registerTool"];

  constructor(private pi: ExtensionAPI) {
    this.originalRegisterTool = pi.registerTool.bind(pi);
    pi.registerTool = this.interceptRegisterTool.bind(this);
  }

  private interceptRegisterTool<TParams extends TSchema, TDetails>(
    tool: ToolDefinition<TParams, TDetails>
  ): void {
    const ptc = (tool as PtcToolDefinition<TParams, TDetails>).ptc;
    const classification = classifyTool(tool.name, ptc);
    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute,
      ptc,
      source: "extension",
      isReadOnly: classification.isReadOnly,
    });

    this.originalRegisterTool(tool);
  }

  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  private createBuiltinTools(cwd: string): Map<string, ToolInfo> {
    const builtins = new Map<string, ToolInfo>();

    const factories: Array<{ name: string; create: (cwd: string) => unknown }> = [
      { name: "read", create: createReadTool },
      { name: "bash", create: createBashTool },
      { name: "edit", create: createEditTool },
      { name: "write", create: createWriteTool },
      { name: "grep", create: createGrepTool },
      { name: "find", create: createFindTool },
      { name: "ls", create: createLsTool },
    ];

    for (const { name, create } of factories) {
      try {
        const tool = create(cwd) as {
          name: string;
          description: string;
          parameters: ToolInfo["parameters"];
          execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => Promise<unknown>;
        };
        const classification = classifyTool(tool.name);
        builtins.set(name, {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          source: "builtin",
          isReadOnly: classification.isReadOnly,
          execute: async (toolCallId, params, signal, onUpdate, _ctx) =>
            (await tool.execute(toolCallId, params, signal, onUpdate)) as never,
        });
      } catch {
        // Skip tools that fail to create.
      }
    }

    const findTool = builtins.get("find");
    if (findTool) {
      builtins.set("glob", {
        ...findTool,
        name: "glob",
        description: "Find files by glob pattern. Alias of find(). Returns a list of matching relative paths in code_execution.",
        source: "alias",
        isReadOnly: true,
      });
    }

    return builtins;
  }

  getAllTools(cwd?: string): ToolInfo[] {
    const piTools = this.pi.getAllTools();
    const allTools = new Map<string, ToolInfo>();
    const builtinTools = this.createBuiltinTools(cwd || process.cwd());

    for (const builtin of builtinTools.values()) {
      allTools.set(builtin.name, builtin);
      if (!this.tools.has(builtin.name)) {
        this.tools.set(builtin.name, builtin);
      }
    }

    for (const piTool of piTools) {
      const existing = allTools.get(piTool.name);
      if (existing) {
        allTools.set(piTool.name, {
          ...existing,
          description: piTool.description,
          parameters: piTool.parameters,
        });
        continue;
      }

      const intercepted = this.tools.get(piTool.name);
      const classification = classifyTool(piTool.name, intercepted?.ptc);
      allTools.set(piTool.name, {
        name: piTool.name,
        description: piTool.description,
        parameters: piTool.parameters,
        execute:
          intercepted?.execute ||
          (async () => {
            throw new Error(`Tool ${piTool.name} execute function not available`);
          }),
        ptc: intercepted?.ptc,
        source: intercepted?.source || "extension",
        isReadOnly: classification.isReadOnly,
      });
    }

    for (const [name, tool] of this.tools.entries()) {
      allTools.set(name, tool);
    }

    return Array.from(allTools.values());
  }

  getCallableTools(cwd: string, settings: PtcSettings): ToolInfo[] {
    const allTools = this.getAllTools(cwd);
    const allowSet = settings.callableTools ? new Set(settings.callableTools) : null;
    const blockedSet = new Set(settings.blockedTools || []);

    return allTools.filter((tool) => {
      if (tool.name === "code_execution") {
        return false;
      }

      if (blockedSet.has(tool.name)) {
        return false;
      }

      if (allowSet && !allowSet.has(tool.name)) {
        return false;
      }

      if (!settings.allowMutations && !tool.isReadOnly) {
        if (tool.name !== "bash" || !settings.allowBash) {
          return false;
        }
      }

      if (tool.name === "bash" && !settings.allowBash) {
        return false;
      }

      if (tool.source === "builtin" || tool.source === "alias") {
        return true;
      }

      return tool.ptc?.enabled === true;
    });
  }

  async executeTool(
    toolName: string,
    params: unknown,
    execution: ExecuteToolContext
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}. Available: ${Array.from(this.tools.keys()).join(", ")}`);
    }

    const toolCallId = execution.caller?.nestedCallId || `ptc_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const ctxWithCaller = Object.assign({}, execution.ctx, {
      caller: execution.caller,
    }) as ExtensionContext & { caller?: CallerMetadata };

    return await tool.execute(toolCallId, params, execution.signal, undefined, ctxWithCaller);
  }
}
