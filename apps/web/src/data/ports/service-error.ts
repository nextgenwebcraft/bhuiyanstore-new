import type { ErrorCode } from "@bsd/contracts";

/** Typed failure raised by every service adapter; screens localize it via `error.<code>`. */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "ServiceError";
  }
}

export function errorCodeOf(error: unknown): ErrorCode {
  return error instanceof ServiceError ? error.code : "INTERNAL";
}
