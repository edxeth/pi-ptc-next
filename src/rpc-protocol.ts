import { ChildProcess } from "child_process";
import readline from "readline";
import type { AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { normalizeToolResult } from "./tool-adapters";
import { estimateTokensFromChars } from "./utils";
import type { CodeExecutionResult, ExecutionDetails, RpcMessage, ToolInfo } from "./types";

type ExecuteTool = (toolName: string, params: unknown, nestedCallId: string) => Promise<unknown>;

export class RpcProtocol {
  private lineReader: readline.Interface;
  private completionPromise: Promise<CodeExecutionResult>;
  private completionResolve!: (value: CodeExecutionResult) => void;
  private completionReject!: (error: Error) => void;
  private stderr = "";
  private stdout = "";
  private userCodeLines: string[];
  private completed = false;
  private startedAt = Date.now();
  private nestedToolCalls = 0;
  private nestedToolNames: string[] = [];
  private nestedResultChars = 0;
  private nestedResultCount = 0;
  private nestedErrors = 0;

  constructor(
    private proc: ChildProcess,
    private tools: Map<string, ToolInfo>,
    private executeTool: ExecuteTool,
    userCode: string,
    private signal?: AbortSignal,
    private onUpdate?: AgentToolUpdateCallback<unknown>
  ) {
    this.userCodeLines = userCode.split("\n");
    this.lineReader = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    this.completionPromise = new Promise((resolve, reject) => {
      this.completionResolve = resolve;
      this.completionReject = reject;
    });

    this.lineReader.on("line", (line) => {
      void this.handleMessage(line);
    });

    proc.stderr?.on("data", (data) => {
      this.stderr += data.toString();
    });

    proc.on("exit", (code) => {
      if (this.completed) {
        return;
      }

      if (code !== 0 && code !== null) {
        const errorMsg = this.stderr || `Process exited with code ${code}`;
        this.rejectOnce(new Error(errorMsg));
      }
    });

    proc.on("error", (err) => {
      this.rejectOnce(new Error(`Process error: ${err.message}`));
    });

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          this.killProcess();
          this.rejectOnce(new Error("Execution aborted"));
        },
        { once: true }
      );
    }
  }

  private killProcess(): void {
    this.proc.kill("SIGTERM");
    setTimeout(() => {
      if (this.proc.exitCode === null) {
        this.proc.kill("SIGKILL");
      }
    }, 5000);
  }

  private resolveOnce(result: CodeExecutionResult): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.completionResolve(result);
  }

  private rejectOnce(error: Error): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.completionReject(error);
  }

  private buildExecutionDetails(overrides?: Partial<ExecutionDetails>): ExecutionDetails {
    return {
      nestedToolCalls: this.nestedToolCalls,
      nestedToolNames: [...this.nestedToolNames],
      nestedResultChars: this.nestedResultChars,
      nestedResultCount: this.nestedResultCount,
      nestedErrors: this.nestedErrors,
      durationMs: Date.now() - this.startedAt,
      estimatedAvoidedTokens: estimateTokensFromChars(this.nestedResultChars),
      ...overrides,
    };
  }

  private async handleMessage(line: string): Promise<void> {
    try {
      const msg = JSON.parse(line) as RpcMessage;

      switch (msg.type) {
        case "tool_call":
          await this.handleToolCall(msg);
          break;

        case "execution_progress":
          if (this.onUpdate) {
            this.onUpdate({
              content: [
                {
                  type: "text",
                  text: `Executing line ${msg.line}/${this.userCodeLines.length}`,
                },
              ],
              details: this.buildExecutionDetails({
                currentLine: msg.line,
                totalLines: this.userCodeLines.length,
                userCode: this.userCodeLines,
              }),
            });
          }
          break;

        case "complete": {
          const finalOutput = this.stdout ? `${this.stdout}\n${msg.output}`.trim() : msg.output;
          this.resolveOnce({
            output: finalOutput,
            details: this.buildExecutionDetails(),
          });
          break;
        }

        case "error": {
          const errorMessage = msg.message + (msg.traceback ? `\n${msg.traceback}` : "");
          this.rejectOnce(new Error(errorMessage));
          break;
        }

        case "update":
          if (this.onUpdate) {
            this.onUpdate({
              content: [{ type: "text", text: msg.message }],
              details: this.buildExecutionDetails(),
            });
          }
          break;
      }
    } catch {
      if (this.stdout) {
        this.stdout += `\n${line}`;
      } else {
        this.stdout = line;
      }
    }
  }

  private async handleToolCall(msg: Extract<RpcMessage, { type: "tool_call" }>): Promise<void> {
    this.nestedToolCalls += 1;
    this.nestedToolNames.push(msg.tool);

    if (this.onUpdate) {
      this.onUpdate({
        content: [{ type: "text", text: `Calling ${msg.tool}()` }],
        details: this.buildExecutionDetails(),
      });
    }

    try {
      const toolInfo = this.tools.get(msg.tool);
      if (!toolInfo) {
        throw new Error(`Unknown tool: ${msg.tool}`);
      }

      const result = await this.executeTool(msg.tool, msg.params, msg.id);
      const normalized = normalizeToolResult(msg.tool, result as { content?: Array<Record<string, unknown>>; details?: unknown });
      this.nestedResultCount += 1;
      this.nestedResultChars += normalized.estimatedChars;

      this.send({
        type: "tool_result",
        id: msg.id,
        value: normalized.value,
      });
    } catch (error) {
      this.nestedErrors += 1;
      this.send({
        type: "tool_result",
        id: msg.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private send(msg: RpcMessage): void {
    if (this.proc.stdin && !this.proc.stdin.destroyed) {
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    }
  }

  async waitForCompletion(): Promise<CodeExecutionResult> {
    return this.completionPromise;
  }
}
