import type {
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
  ToolInfo as ExtensionToolInfo,
} from "@mariozechner/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import type { ChildProcess } from "child_process";

export interface SandboxManager {
  /**
   * Spawn a Python process in the sandbox for RPC communication.
   */
  spawn(code: string, cwd: string): ChildProcess;

  /**
   * Cleanup sandbox resources.
   */
  cleanup(): Promise<void>;
}

export interface PtcToolOptions {
  /** Explicit opt-in for custom/extension tools callable from code_execution. */
  enabled?: boolean;
  /** Override whether the tool should be treated as read-only. */
  readOnly?: boolean;
  /** Optional Python wrapper name. Defaults to the tool name. */
  pythonName?: string;
}

export type PtcToolDefinition<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
> = ToolDefinition<TParams, TDetails> & {
  ptc?: PtcToolOptions;
};

export interface LoadedTool {
  tool: PtcToolDefinition;
  filename: string;
}

export type ToolSource = "builtin" | "alias" | "custom" | "extension";

export interface ToolInfo extends ExtensionToolInfo {
  execute: ToolDefinition["execute"];
  source: ToolSource;
  isReadOnly: boolean;
  ptc?: PtcToolOptions;
}

export interface CallerMetadata {
  type: "code_execution";
  parentToolCallId?: string;
  nestedCallId: string;
}

export interface NormalizedToolResult {
  value: unknown;
  estimatedChars: number;
}

export type RpcMessage =
  | { type: "tool_call"; id: string; tool: string; params: Record<string, unknown> }
  | { type: "tool_result"; id: string; value?: unknown; error?: string }
  | { type: "execution_progress"; line: number; total_lines: number }
  | { type: "complete"; output: string }
  | { type: "error"; message: string; traceback?: string }
  | { type: "update"; message: string };

interface ExecutionMetrics {
  nestedToolCalls: number;
  nestedToolNames: string[];
  nestedResultChars: number;
  nestedResultCount: number;
  nestedErrors: number;
  durationMs: number;
  estimatedAvoidedTokens: number;
}

export interface ExecutionOptions {
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  parentToolCallId?: string;
}

export interface ExecutionDetails extends ExecutionMetrics {
  currentLine?: number;
  totalLines?: number;
  userCode?: string[];
}

export interface CodeExecutionResult {
  output: string;
  details: ExecutionDetails;
}

export interface PtcSettings {
  executionTimeoutMs: number;
  maxOutputChars: number;
  allowMutations: boolean;
  allowBash: boolean;
  maxParallelToolCalls: number;
  callableTools?: string[];
  blockedTools?: string[];
}

export interface ExecuteToolContext {
  ctx: ExtensionContext;
  signal?: AbortSignal;
  caller?: CallerMetadata;
}
