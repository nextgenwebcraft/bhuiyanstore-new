import { z } from "zod";
import {
  amountSchema,
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  positiveAmountStringSchema,
} from "./primitives";

/** D129: registered company cheque (no face value). */
export const companyCheckSchema = z.object({
  id: idSchema,
  bankName: z.string(),
  checkNumber: z.string(),
  /** Sum of posted charges. */
  chargedTotal: decimalStringSchema,
  /** Sum of posted payments. */
  paidTotal: decimalStringSchema,
  /** chargedTotal − paidTotal (floored at 0). */
  due: decimalStringSchema,
  createdAt: z.string(),
});
export type CompanyCheckRecord = z.infer<typeof companyCheckSchema>;

const checkBankName = z
  .string()
  .trim()
  .min(1, { message: "validation.companyCheck.bankName" })
  .max(80, { message: "validation.companyCheck.bankName" });

const checkNumber = z
  .string()
  .trim()
  .min(1, { message: "validation.companyCheck.checkNumber" })
  .max(40, { message: "validation.companyCheck.checkNumber" });

export const companyCheckCreateRowSchema = z.object({
  bankName: checkBankName,
  checkNumber: checkNumber,
});
export type CompanyCheckCreateRow = z.input<typeof companyCheckCreateRowSchema>;

/** Bulk register cheques on the company-checks page. */
export const companyCheckBulkCreateRequestSchema = z.object({
  rows: z.array(companyCheckCreateRowSchema).min(1).max(100),
});
export type CompanyCheckBulkCreateRequest = z.input<typeof companyCheckBulkCreateRequestSchema>;

export const companyCheckListSchema = z.object({
  items: z.array(companyCheckSchema),
});
export type CompanyCheckList = z.infer<typeof companyCheckListSchema>;

/** Open cheques for the order picker (not fully paid). */
export const companyCheckPickerListSchema = z.object({
  items: z.array(
    z.object({
      id: idSchema,
      bankName: z.string(),
      checkNumber: z.string(),
      due: decimalStringSchema,
      label: z.string(),
    }),
  ),
});
export type CompanyCheckPickerList = z.infer<typeof companyCheckPickerListSchema>;

export const companyCheckPaymentRequestSchema = z.object({
  companyCheckId: idSchema,
  date: businessDateSchema,
  amount: positiveAmountStringSchema("validation.amountPositive"),
});
export type CompanyCheckPaymentRequest = z.input<typeof companyCheckPaymentRequestSchema>;

export const companyCheckPaymentSchema = z.object({
  id: idSchema,
  companyCheckId: idSchema,
  amount: decimalStringSchema,
  date: businessDateSchema,
  moneyEntryId: idSchema,
});
export type CompanyCheckPaymentRecord = z.infer<typeof companyCheckPaymentSchema>;

export const companyCheckHistoryLineSchema = z.object({
  kind: z.enum(["charge", "payment"]),
  id: idSchema,
  date: businessDateSchema,
  amount: decimalStringSchema,
  note: z.string(),
});

/** Completed cheques (due 0 after charges) for History. */
export const companyCheckHistoryItemSchema = z.object({
  id: idSchema,
  bankName: z.string(),
  checkNumber: z.string(),
  chargedTotal: decimalStringSchema,
  paidTotal: decimalStringSchema,
  completedAt: z.string(),
  lines: z.array(companyCheckHistoryLineSchema),
});
export type CompanyCheckHistoryItem = z.infer<typeof companyCheckHistoryItemSchema>;

export const companyCheckHistoryListSchema = z.object({
  items: z.array(companyCheckHistoryItemSchema),
});
export type CompanyCheckHistoryList = z.infer<typeof companyCheckHistoryListSchema>;

/** Kept for request typing symmetry with other money posts. */
export const companyCheckAmountSchema = amountSchema;
