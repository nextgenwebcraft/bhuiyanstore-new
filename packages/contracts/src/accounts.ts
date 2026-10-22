import { z } from "zod";
import { moneyEntryKinds, owedAllocationSchema, srLoanTypes } from "./daily";
import { monthSchema, staffBalancesSchema } from "./month";
import { amountSchema, businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * Staff and SR money accounts (D27, D18, guide §11.9) and payroll (D11, D24, D25). Balances are
 * month-engine figures; a person's account always shows what they owe us and what we owe them
 * separately, never as one signed number.
 */

const money = decimalStringSchema;

export const staffAccountKinds = ["distributor", "sr"] as const;
export type StaffAccountKind = (typeof staffAccountKinds)[number];

export const staffAccountRowSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  kind: z.enum(staffAccountKinds),
  balances: staffBalancesSchema,
  /** আমাদের পাওনা: advance + loan + shortage + SR loan. */
  owesUs: money,
  /** আমরা দেব: credit + salary still to pay + owed to SR. */
  weOwe: money,
});

export const staffAccountsSchema = z.object({
  date: businessDateSchema,
  cutoffDate: businessDateSchema.nullable(),
  rows: z.array(staffAccountRowSchema),
});
export type StaffAccounts = z.infer<typeof staffAccountsSchema>;

export const staffStatementLineSchema = z.object({
  /** The money entry; null for a DSR sheet line (no personal balance moves there). */
  entryId: idSchema.nullable(),
  date: businessDateSchema,
  kind: z.enum(moneyEntryKinds),
  amount: money,
  payrollRunId: idSchema.nullable(),
  /** D42: the SR loan type of an SR loan or repayment. */
  srLoanType: z.enum(srLoanTypes).nullable(),
  change: staffBalancesSchema,
  balances: staffBalancesSchema,
});
export type StaffStatementLine = z.infer<typeof staffStatementLineSchema>;

export const staffStatementSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  kind: z.enum(staffAccountKinds),
  from: businessDateSchema,
  to: businessDateSchema,
  cutoffDate: businessDateSchema.nullable(),
  opening: staffBalancesSchema,
  closing: staffBalancesSchema,
  owesUs: money,
  weOwe: money,
  lines: z.array(staffStatementLineSchema),
});
export type StaffStatement = z.infer<typeof staffStatementSchema>;

// ---------------------------------------------------------------- payroll

export const payrollStatuses = ["none", "draft", "approved", "paid", "reversed"] as const;
export type PayrollStatus = (typeof payrollStatuses)[number];

const owedSchema = z.object({ advance: money, loan: money, shortage: money });

export const payrollLineSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  roleName: z.string(),
  /** The monthly salary before the absent fee. */
  salary: money,
  /** D75: the month's absent fees (frozen once the salary is posted), taken off the salary only. */
  absent: money,
  /** What the person owes on the run date (snapshot once approved or paid). */
  owed: owedSchema,
  /** The default recovery: advance → loan → shortage, capped at salary − absent. */
  proposed: owedSchema,
  recovery: owedSchema,
  recoveryTotal: money,
  /** Cash Pabe (D25): salary − absent − recovery, never negative. */
  cashPay: money,
  reason: z.string(),
  /** D75: this person's salary is posted and paid (Pay Now, or the whole run paid). */
  paid: z.boolean(),
});
export type PayrollLine = z.infer<typeof payrollLineSchema>;

export const payrollRunSchema = z.object({
  id: idSchema.nullable(),
  month: monthSchema,
  status: z.enum(payrollStatuses),
  version: z.number().int().nonnegative(),
  date: businessDateSchema,
  payDate: businessDateSchema.nullable(),
  cutoffDate: businessDateSchema.nullable(),
  lines: z.array(payrollLineSchema),
  totals: z.object({ salary: money, absent: money, recovery: money, cashPay: money }),
  approvedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
});
export type PayrollRun = z.infer<typeof payrollRunSchema>;

export const payrollLineRequestSchema = z.object({
  staffId: idSchema,
  salary: amountSchema,
  /** Null takes the proposal; otherwise a manager override that needs a reason. */
  recovery: owedAllocationSchema.nullable().default(null),
  reason: z.string().trim().max(300).default(""),
});

export const payrollSaveRequestSchema = z.object({
  /** 0 creates the draft; otherwise the version the user edited. */
  version: z.number().int().nonnegative(),
  date: businessDateSchema,
  lines: z.array(payrollLineRequestSchema).max(500),
});
export type PayrollSaveRequest = z.input<typeof payrollSaveRequestSchema>;

/** `payStaff` (D75): post and pay one person's salary now, before the rest of the run. */
export const payrollActions = ["approve", "pay", "reverse", "discard", "payStaff"] as const;
export type PayrollAction = (typeof payrollActions)[number];

export const payrollTransitionRequestSchema = z.object({
  /** 0 only for `payStaff` when the month has no run yet. */
  version: z.number().int().nonnegative(),
  /** Date Cash Pabe is paid (`pay`, `payStaff`); on or after the run date. */
  payDate: businessDateSchema.nullable().default(null),
  /** The person `payStaff` pays. */
  staffId: idSchema.nullable().default(null),
});
export type PayrollTransitionRequest = z.input<typeof payrollTransitionRequestSchema>;
