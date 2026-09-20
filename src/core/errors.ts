/** Typed errors shared across backends and modules. */

export class BackendError extends Error {
  constructor(
    message: string,
    readonly backendId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export class SchemaViolationError extends BackendError {
  constructor(backendId: string, detail: string, cause?: unknown) {
    super(`schema violation: ${detail}`, backendId, cause);
    this.name = "SchemaViolationError";
  }
}

export class LlmUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
