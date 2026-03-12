import * as fs from "fs";
import * as path from "path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { RpcProtocol } from "./rpc-protocol";
import type { CodeExecutionResult, ExecutionOptions, PtcSettings, SandboxManager } from "./types";
import type { ToolRegistry } from "./tool-registry";
import { generateToolWrappers } from "./tool-wrapper";
import { formatPythonError, truncateOutput, validateUserCode } from "./utils";

export class CodeExecutor {
  constructor(
    private sandboxManager: SandboxManager,
    private toolRegistry: ToolRegistry,
    private ctx: ExtensionContext,
    private settings: PtcSettings,
    private extensionRoot: string
  ) {}

  private loadRuntimeFiles(): { rpcCode: string; runtimeCode: string } {
    const candidateDirs = [
      path.join(this.extensionRoot, "src/python-runtime"),
      path.join(this.extensionRoot, "python-runtime"),
      path.join(__dirname, "../src/python-runtime"),
      path.join(__dirname, "python-runtime"),
    ];

    for (const candidateDir of candidateDirs) {
      const rpcPath = path.join(candidateDir, "rpc.py");
      const runtimePath = path.join(candidateDir, "runtime.py");
      if (fs.existsSync(rpcPath) && fs.existsSync(runtimePath)) {
        return {
          rpcCode: fs.readFileSync(rpcPath, "utf-8"),
          runtimeCode: fs.readFileSync(runtimePath, "utf-8"),
        };
      }
    }

    throw new Error(
      `Failed to load Python runtime files from any known location: ${candidateDirs.join(", ")}`
    );
  }

  private buildCombinedCode(userCode: string, toolWrappers: string, rpcCode: string, runtimeCode: string): string {
    const indentedUserCode = userCode
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");

    return `
${rpcCode}

${toolWrappers}

PTC_MAX_PARALLEL_TOOL_CALLS = ${this.settings.maxParallelToolCalls}

${runtimeCode}

# User code
async def user_main():
${indentedUserCode}

# Execute
import asyncio
asyncio.run(_runtime_main(user_main))
`;
  }

  async execute(userCode: string, options: ExecutionOptions): Promise<CodeExecutionResult> {
    const { cwd, signal, onUpdate, parentToolCallId } = options;
    validateUserCode(userCode);

    const callableTools = this.toolRegistry.getCallableTools(cwd, this.settings);
    const toolsMap = new Map(callableTools.map((tool) => [tool.name, tool]));
    const toolWrappers = generateToolWrappers(callableTools);
    const { rpcCode, runtimeCode } = this.loadRuntimeFiles();
    const combinedCode = this.buildCombinedCode(userCode, toolWrappers, rpcCode, runtimeCode);
    const proc = this.sandboxManager.spawn(combinedCode, cwd);

    const rpc = new RpcProtocol(
      proc,
      toolsMap,
      async (toolName, params, nestedCallId) =>
        this.toolRegistry.executeTool(toolName, params, {
          ctx: this.ctx,
          signal,
          caller: {
            type: "code_execution",
            parentToolCallId,
            nestedCallId,
          },
        }),
      userCode,
      signal,
      onUpdate
    );

    const timeoutPromise = new Promise<CodeExecutionResult>((_, reject) => {
      const timeoutId = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
        }, 5000);
        reject(
          new Error(
            `Execution timed out after ${Math.round(this.settings.executionTimeoutMs / 1000)} seconds`
          )
        );
      }, this.settings.executionTimeoutMs);

      proc.on("exit", () => clearTimeout(timeoutId));
      proc.on("error", () => clearTimeout(timeoutId));
    });

    try {
      const result = await Promise.race([rpc.waitForCompletion(), timeoutPromise]);
      return {
        output: truncateOutput(result.output, this.settings.maxOutputChars),
        details: result.details,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Python execution error")) {
          throw error;
        }
        throw new Error(formatPythonError(error.message));
      }
      throw error;
    }
  }
}
