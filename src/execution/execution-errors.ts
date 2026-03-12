function formatPythonErrorMessage(message: string, traceback?: string): string {
  if (traceback) {
    return `Python execution error:\n${message}\n\nTraceback:\n${traceback}`;
  }
  return `Python execution error: ${message}`;
}

export class PtcExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PtcAbortError extends PtcExecutionError {}
export class PtcTimeoutError extends PtcExecutionError {}
export class PtcTransportError extends PtcExecutionError {}
export class PtcProtocolError extends PtcExecutionError {}

export class PtcPythonError extends PtcExecutionError {
  readonly rawMessage: string;

  constructor(
    message: string,
    readonly traceback?: string
  ) {
    super(formatPythonErrorMessage(message, traceback));
    this.rawMessage = message;
  }
}

export class PtcNestedToolError extends PtcExecutionError {
  constructor(
    readonly payload: {
      type: string;
      message: string;
      stack?: string;
    }
  ) {
    super(payload.stack ? `${payload.message}\n${payload.stack}` : payload.message);
  }
}
