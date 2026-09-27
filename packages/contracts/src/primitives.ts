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
