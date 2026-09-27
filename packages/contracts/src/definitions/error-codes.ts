/**
 * Stable technical error codes (guide section 13.2). User messages are localized in @bsd/i18n
 * under `error.<CODE>`. Unknown and inaccessible companies share one code (anti-enumeration).
 */
export const errorCodes = [
  "COMPANY_NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "REQUEST_ABORTED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
