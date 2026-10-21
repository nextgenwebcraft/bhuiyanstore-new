import { z } from "zod";
import { monthStatuses } from "./month";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/** One DSR's day: what they sold, collected and left due on the market. */
export const dsrDayRowSchema = z.object({
  dsrId: idSchema,
  dsrName: z.string(),
  netSales: decimalStringSchema,
  salesCash: decimalStringSchema,
  marketDueCreated: decimalStringSchema,
  oldDuesCollected: decimalStringSchema,
});

export type DsrDayRow = z.infer<typeof dsrDayRowSchema>;

/**
 * The dashboard's report for a date range (guide 5.2 "date filters; sales, collections, gross
 * profit if permitted, stock value, dues"). Derived from posted events only (guide 5.3, 21.1);
 * never a stored total. Figures are summed over [from, to]. Optional fields are omitted without
 * the matching permission.
 */
export const dashboardSummarySchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  /** First day with figures (the activated opening's cutoff); null until an opening is live. */
  cutoffDate: businessDateSchema.nullable(),
  netSales: decimalStringSchema,
  /** Cash collected on the range's sales summaries. */
  salesCash: decimalStringSchema,
  /** Old market dues collected in the range. */
  oldDuesCollected: decimalStringSchema,
  /** salesCash + oldDuesCollected. */
  cashCollected: decimalStringSchema,
  /** Unpaid part of the range's sales. */
  marketDueCreated: decimalStringSchema,
  /** All market dues still open at the start of the range (D60 আগের বকেয়া). */
  marketDueOpening: decimalStringSchema,
  /** All market dues still open at the end of the range. */
  marketDueOutstanding: decimalStringSchema,
  /** D60: samari value (issued × sale price), returns and shop commission over the range. */
  issuedValue: decimalStringSchema,
  returnValue: decimalStringSchema,
  commission: decimalStringSchema,
  /** Category expenses and staff shortages over the range; require `finance.view`. */
  expenses: decimalStringSchema.optional(),
  staffShortage: decimalStringSchema.optional(),
  /** Cost value of damaged pieces; requires `inventory.cost_view`. */
  damageValue: decimalStringSchema.optional(),
  /** Billed value of goods ordered and not received at the end (D48); requires `inventory.cost_view`. */
  undeliveredValue: decimalStringSchema.optional(),
  postedSummaryCount: z.number().int().nonnegative(),
  postedReceiptCount: z.number().int().nonnegative(),
  byDsr: z.array(dsrDayRowSchema),
  /** Requires `report.profit_view`. */
  grossProfit: decimalStringSchema.optional(),
  /** Cost value of stock received in the range; requires `inventory.cost_view`. */
  receivedValue: decimalStringSchema.optional(),
  /** Cost-based saleable inventory value at the end of the range; requires `inventory.cost_view`. */
  stockValue: decimalStringSchema.optional(),
  /** Each cash and bank account's balance at the end of the range (D52); requires `finance.view`. */
  cashAccounts: z
    .array(
      z.object({ accountId: z.string(), accountName: z.string(), balance: decimalStringSchema }),
    )
    .optional(),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** One company's net profit over the range (engine `month.profit`, no salary, D66). */
const companyProfitSchema = z.object({
  companyId: idSchema,
  companyName: z.string(),
  gross: decimalStringSchema,
  expenses: decimalStringSchema,
  srIncentive: decimalStringSchema,
  net: decimalStringSchema,
});

/**
 * The master panel's dashboard (D66): every company's summary, their total, and the profit and
 * loss of the whole business = Σ company net profit − salaries − master expenses.
 */
export const masterSummarySchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  companies: z.array(
    z.object({ companyId: idSchema, companyName: z.string(), summary: dashboardSummarySchema }),
  ),
  total: dashboardSummarySchema,
  /** Requires `report.profit_view` (a super-admin has every permission). */
  profit: z
    .object({
      companies: z.array(companyProfitSchema),
      companiesNet: decimalStringSchema,
      salaries: decimalStringSchema,
      masterExpenses: decimalStringSchema,
      net: decimalStringSchema,
    })
    .nullable(),
});

export type MasterSummary = z.infer<typeof masterSummarySchema>;

/**
 * One month across every company and the master (D66): each one's close state, and whether the
 * month can be closed or reopened for all of them together.
 */
export const masterMonthSchema = z.object({
  month: z.string(),
  companies: z.array(
    z.object({
      companyId: idSchema,
      companyName: z.string(),
      isMaster: z.boolean(),
      status: z.enum(monthStatuses),
      /** Why this one can't be closed (an i18n key), or null. */
      closeBlockedBy: z.string().nullable(),
    }),
  ),
  canCloseAll: z.boolean(),
  canReopenAll: z.boolean(),
});

export type MasterMonth = z.infer<typeof masterMonthSchema>;
