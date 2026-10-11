import { z } from "zod";

/**
 * Money and decimal quantities travel as strings at every JSON boundary (guide section 6.2).
 * Accepts only Latin digits: Bengali digits are normalized by @bsd/i18n before validation.
 */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, { message: "validation.decimal.invalid" });

export type DecimalString = z.infer<typeof decimalStringSchema>;

/** ISO calendar date (YYYY-MM-DD). Business dates are interpreted in Asia/Dhaka (D08). */
export const businessDateSchema = z.iso.date();

export type BusinessDate = z.infer<typeof businessDateSchema>;

export const idSchema = z.string().min(1);

/** A positive whole number carried as a string, e.g. pieces per carton. */
export const positiveIntegerStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, { message: "validation.positiveInteger.invalid" });

/** Taka with at most 2 decimals, no sign: the one amount pattern. */
export const amountPattern = /^d+(.d{1,2})?$/;

/** A whole number ≥ 0 without leading zeros: the one whole-number pattern. */
export const wholeNumberPattern = /^(0|[1-9]d*)$/;

/** Taka ≥ 0 with at most 2 decimals; `message` is the i18n key shown on failure. */
export const amountStringSchema = (message: string) => z.string().regex(amountPattern, { message });

/** Taka > 0 with at most 2 decimals. */
export const positiveAmountStringSchema = (message: string) =>
  amountStringSchema(message).refine((v) => /[1-9]/.test(v), { message });

/** Taka ≥ 0 with at most 2 decimals, shown with the shared amount message. */
export const amountSchema = amountStringSchema("validation.opening.amount");

/** A whole number ≥ 0 carried as a string, e.g. pieces; `message` is the i18n key. */
export const wholeNumberStringSchema = (message: string) =>
  z.string().regex(wholeNumberPattern, { message });

/** Whole pieces ≥ 0 (cartons are converted to pieces with the line's carton size). */
export const wholePiecesSchema = wholeNumberStringSchema("validation.wholeNumber");

/** Client-generated idempotency key for a posting command (guide 5.4, 13.2). */
export const requestKeySchema = z.string().min(8).max(100);
