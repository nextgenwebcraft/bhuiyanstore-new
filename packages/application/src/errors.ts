import type { ApiError, ErrorCode, StockShortage } from "@bsd/contracts";
import type { z } from "zod";

export type FieldError = { path: string; code: string };
export type { StockShortage };

/** A typed, expected failure. Route handlers turn it into an `ApiError` response. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly fieldErrors?: FieldError[],
    readonly retryable = false,
    readonly stockShortages?: StockShortage[],
  ) {
    super(code);
    this.name = "AppError";
  }

  toApiError(requestId?: string): ApiError {
    return {
      code: this.code,
      retryable: this.retryable,
      ...(requestId ? { requestId } : {}),
      ...(this.fieldErrors?.length ? { fieldErrors: this.fieldErrors } : {}),
      ...(this.stockShortages?.length ? { stockShortages: this.stockShortages } : {}),
    };
  }
}

/** Parses with a contract schema; failures become VALIDATION_FAILED with field paths. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError(
    "VALIDATION_FAILED",
    result.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.message })),
  );
}

export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  COMPANY_NOT_FOUND: 404,
  FORBIDDEN: 403,
  MODULE_UNAVAILABLE: 403,
  VALIDATION_FAILED: 422,
  INSUFFICIENT_STOCK: 409,
  DUPLICATE_DOCUMENT: 409,
  AMOUNT_EXCEEDS_DUE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  REQUEST_ABORTED: 499,
  INTERNAL: 500,
};

/** A single-field VALIDATION_FAILED error; `code` is an i18n key. */
export const invalid = (path: string, code: string) =>
  new AppError("VALIDATION_FAILED", [{ path, code }]);
