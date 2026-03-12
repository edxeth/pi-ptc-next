export interface PtcSettings {
  executionTimeoutMs: number;
  maxOutputChars: number;
  allowMutations: boolean;
  allowBash: boolean;
  maxParallelToolCalls: number;
  useDocker: boolean;
  allowUnsandboxedSubprocess: boolean;
  debugLogging: boolean;
  trustedReadOnlyTools?: string[];
  callableTools?: string[];
  blockedTools?: string[];
}
