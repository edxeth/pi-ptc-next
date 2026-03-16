import type { RecoveryFailureClass } from "./recovery-state";

export type RecoveryKind = RecoveryFailureClass;

const KNOWN_ASYNC_HELPERS = [
  "read",
  "glob",
  "find",
  "grep",
  "ls",
  "ptc.read_many",
  "ptc.read_tree",
  "ptc.find_files",
  "ptc.find_files_abs",
  "ptc.read_text",
] as const;

const helperPattern = KNOWN_ASYNC_HELPERS.map((name) => escapeRegExp(name)).join("|");
const helperCallPattern = new RegExp(`\\b(?:${helperPattern})\\s*\\(`);
const awaitedHelperCallPattern = new RegExp(`\\bawait\\s+(?:${helperPattern})\\s*\\(`);
const iteratedHelperPatterns = [
  new RegExp(`\\b(?:sorted|list|tuple|set)\\s*\\([^\\n]*\\b(?:${helperPattern})\\s*\\(`),
  new RegExp(`\\bfor\\b[^\\n]*\\bin\\b[^\\n]*\\b(?:${helperPattern})\\s*\\(`),
  new RegExp(`\\b(?:${helperPattern})\\s*\\([^\\n]*\\)\\s*\\[`),
  new RegExp(`^[^#\\n=]+,\\s*[^#\\n=]+=\\s*(?:\\*\\s*)?(?:${helperPattern})\\s*\\(`),
] as const;
const missingAwaitDiagnosticPattern = /\bcoroutine\b|was never awaited|\bawait\b/i;
const iteratedCoroutineDiagnosticPattern =
  /'coroutine' object is not iterable|'coroutine' object is not subscriptable|cannot unpack non-iterable coroutine object/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComment(line: string): string {
  return line.replace(/#.*$/, "").trim();
}

function getEvidenceLines(traceback?: string, code?: string): string[] {
  return [traceback, code]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split("\n"))
    .map(stripComment)
    .filter((line) => line.length > 0);
}

function hasDirectUnawaitedHelperCall(lines: string[]): boolean {
  return lines.some((line) => {
    if (!helperCallPattern.test(line) || awaitedHelperCallPattern.test(line)) {
      return false;
    }

    return !iteratedHelperPatterns.some((pattern) => pattern.test(line));
  });
}

function hasIteratedUnawaitedHelperUse(lines: string[]): boolean {
  return lines.some((line) => !awaitedHelperCallPattern.test(line) && iteratedHelperPatterns.some((pattern) => pattern.test(line)));
}

export function classifyCodeExecutionFailure(
  message: string,
  traceback?: string,
  code?: string
): RecoveryFailureClass | null {
  const evidenceLines = getEvidenceLines(traceback, code);
  const diagnostics = [message, traceback]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  if (missingAwaitDiagnosticPattern.test(diagnostics) && hasDirectUnawaitedHelperCall(evidenceLines)) {
    return "missing-await";
  }

  if (iteratedCoroutineDiagnosticPattern.test(diagnostics) && hasIteratedUnawaitedHelperUse(evidenceLines)) {
    return "async-wrapper-iterated";
  }

  return null;
}

export function buildCodeExecutionRecoveryPrompt(kind: RecoveryKind): string {
  switch (kind) {
    case "missing-await":
      return "PTC recovery: You called an async helper without await. Helpers like read, glob, find, grep, and ls are async wrappers. Await each helper call before using its result.";
    case "async-wrapper-iterated":
      return "PTC recovery: You used an async helper result before awaiting it. Helpers like read, glob, find, grep, and ls are async wrappers. Await the helper call before iterating, sorting, slicing, indexing, or unpacking the result.";
  }
}
