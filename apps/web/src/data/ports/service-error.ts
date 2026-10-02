import type { ErrorCode } from "@bsd/contracts";
import { bn, t, type TranslationKey } from "@bsd/i18n";

export type ServiceFieldError = { path: string; code: string };

/** Typed failure raised by every service adapter; screens localize it via `error.<code>`. */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryable = false,
    readonly fieldErrors: readonly ServiceFieldError[] = [],
  ) {
    super(code);
    this.name = "ServiceError";
  }
}

export function errorCodeOf(error: unknown): ErrorCode {
  return error instanceof ServiceError ? error.code : "INTERNAL";
}

export type DescribedError = { fields: Partial<Record<string, string>>; form?: string };

/**
 * Localizes a failed write: field errors on paths the form shows go under those fields (codes
 * are dictionary keys); anything else becomes the form-level message.
 */
export function describeError(error: unknown, formPaths: readonly string[]): DescribedError {
  const fields: Partial<Record<string, string>> = {};
  let unplaced: string | undefined;
  const fieldErrors = error instanceof ServiceError ? error.fieldErrors : [];
  for (const { path, code } of fieldErrors) {
    const message = code in bn ? t(code as TranslationKey) : t("error.VALIDATION_FAILED");
    if (formPaths.includes(path)) fields[path] ??= message;
    else unplaced ??= message;
  }
  if (fieldErrors.length === 0) return { fields, form: t(`error.${errorCodeOf(error)}`) };
  return unplaced ? { fields, form: unplaced } : { fields };
}
