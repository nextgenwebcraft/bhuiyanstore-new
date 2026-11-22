import { z } from "zod";
import {
  amountSchema,
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  positiveAmountStringSchema,
} from "./primitives";

/**
 * One dated record on a cheque (D129; D145 adds the running balance): an order bill charged to it
 * or a cash repayment. Lines are oldest first; `balance` is the cheque due after this line.
 */
export const companyCheckHistoryLineSchema = z.object({
  kind: z.enum(["charge", "payment"]),
  id: idSchema,
  date: businessDateSchema,
  amount: decimalStringSchema,
  note: z.string(),
  balance: decimalStringSchema,
});
export type CompanyCheckHistoryLine = z.infer<typeof companyCheckHistoryLineSchema>;

/**
 * D129: registered company cheque (no face value). D145: the active page lists every cheque with
 * an open due (never one that has no order bill yet) with its dated records.
 */
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
  /** D145: every posted charge and payment, oldest first, with the running due. */
  lines: z.array(companyCheckHistoryLineSchema),
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

/** Completed cheques (due 0 after charges) for History. */
export const companyCheckHistoryItemSchema = z.object({
  id: idSchema,
  bankName: z.string(),
  checkNumber: z.string(),
  chargedTotal: decimalStringSchema,
  paidTotal: decimalStringSchema,
  /** D145: when the cheque was registered. */
  createdAt: z.string(),
  completedAt: z.string(),
  /** D145: business date of the record that brought the due to zero. */
  completedDate: businessDateSchema,
  lines: z.array(companyCheckHistoryLineSchema),
});
export type CompanyCheckHistoryItem = z.infer<typeof companyCheckHistoryItemSchema>;

export const companyCheckHistoryListSchema = z.object({
  items: z.array(companyCheckHistoryItemSchema),
});
export type CompanyCheckHistoryList = z.infer<typeof companyCheckHistoryListSchema>;

/** Kept for request typing symmetry with other money posts. */
export const companyCheckAmountSchema = amountSchema;
