import type { PtcSettings } from "./types";

const DEFAULT_MAX_OUTPUT_SIZE = 100_000; // 100KB max output
const DEFAULT_EXECUTION_TIMEOUT_MS = 270_000;
const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 8;
const DEBUG_PREFIX = "[PTC]";

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseListEnv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

/**
 * Load extension settings from environment variables.
 */
export function loadSettingsFromEnv(): PtcSettings {
  return {
    executionTimeoutMs: parsePositiveIntEnv(
      process.env.PTC_EXECUTION_TIMEOUT_MS,
      DEFAULT_EXECUTION_TIMEOUT_MS
    ),
    maxOutputChars: parsePositiveIntEnv(process.env.PTC_MAX_OUTPUT_CHARS, DEFAULT_MAX_OUTPUT_SIZE),
    allowMutations: parseBooleanEnv(process.env.PTC_ALLOW_MUTATIONS, false),
    allowBash: parseBooleanEnv(process.env.PTC_ALLOW_BASH, false),
    maxParallelToolCalls: parsePositiveIntEnv(
      process.env.PTC_MAX_PARALLEL_TOOL_CALLS,
      DEFAULT_MAX_PARALLEL_TOOL_CALLS
    ),
    callableTools: parseListEnv(process.env.PTC_CALLABLE_TOOLS),
    blockedTools: parseListEnv(process.env.PTC_BLOCKED_TOOLS),
  };
}

/**
 * Truncate output if it exceeds the maximum size.
 */
export function truncateOutput(output: string, maxOutputChars: number = DEFAULT_MAX_OUTPUT_SIZE): string {
  if (output.length <= maxOutputChars) {
    return output;
  }

  const truncated = output.substring(0, maxOutputChars);
  const truncationNotice = `\n\n[Output truncated - showing first ${maxOutputChars} characters of ${output.length}]`;
  return truncated + truncationNotice;
}

/**
 * Format a Python exception for display.
 */
export function formatPythonError(message: string, traceback?: string): string {
  if (traceback) {
    return `Python execution error:\n${message}\n\nTraceback:\n${traceback}`;
  }
  return `Python execution error: ${message}`;
}

/**
 * Estimate tokens from text length for relative benchmarking.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Detect a common model mistake before execution.
 */
export function validateUserCode(userCode: string): void {
  if (/\basyncio\.run\s*\(/.test(userCode)) {
    throw new Error(
      "Top-level await is already available inside code_execution. Remove asyncio.run(...) and await your coroutines directly."
    );
  }

  if (/\b_rpc_call\s*\(/.test(userCode)) {
    throw new Error(
      "Use the generated helper functions such as read(), glob(), find(), grep(), ls(), or ptc.read_many() instead of calling _rpc_call(...) directly."
    );
  }
}

function isDebugLoggingEnabled(): boolean {
  return parseBooleanEnv(process.env.PTC_DEBUG, false);
}

export function debugLog(message: string, ...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    console.log(`${DEBUG_PREFIX} ${message}`, ...args);
  }
}

export function debugWarn(message: string, ...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    console.warn(`${DEBUG_PREFIX} ${message}`, ...args);
  }
}
