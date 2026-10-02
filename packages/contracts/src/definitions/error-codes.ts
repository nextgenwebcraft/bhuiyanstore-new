/**
 * Stable technical error codes (guide section 13.2). User messages are localized in @bsd/i18n
 * under `error.<CODE>`. Unknown and inaccessible companies share one code (anti-enumeration).
 */
export const errorCodes = [
  "UNAUTHENTICATED",
  "PASSWORD_CHANGE_REQUIRED",
  "COMPANY_NOT_FOUND",
  "FORBIDDEN",
  "MODULE_UNAVAILABLE",
  "VALIDATION_FAILED",
  "INSUFFICIENT_STOCK",
  "DUPLICATE_DOCUMENT",
  "AMOUNT_EXCEEDS_DUE",
  "IDEMPOTENCY_CONFLICT",
  "REQUEST_ABORTED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
