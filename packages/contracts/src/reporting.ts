import { z } from "zod";
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
  /** All market dues still open at the end of the range. */
  marketDueOutstanding: decimalStringSchema,
  postedSummaryCount: z.number().int().nonnegative(),
  postedReceiptCount: z.number().int().nonnegative(),
  byDsr: z.array(dsrDayRowSchema),
  /** Requires `report.profit_view`. */
  grossProfit: decimalStringSchema.optional(),
  /** Damage refunds + replacement goods (D47), added to net profit; requires `report.profit_view`. */
  damageRecovery: decimalStringSchema.optional(),
  /** Cost value of stock received in the range; requires `inventory.cost_view`. */
  receivedValue: decimalStringSchema.optional(),
  /** Cost-based saleable inventory value at the end of the range; requires `inventory.cost_view`. */
  stockValue: decimalStringSchema.optional(),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
