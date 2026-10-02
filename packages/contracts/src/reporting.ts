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
 * The dashboard's daily report for one business date (guide 5.2 "date filters; sales,
 * collections, gross profit if permitted, stock value, dues"). Derived from posted events only
 * (guide 5.3, 21.1); never a stored total. Optional fields are omitted without the matching
 * permission.
 */
export const dashboardSummarySchema = z.object({
  date: businessDateSchema,
  netSales: decimalStringSchema,
  /** Cash collected on that day's sales summaries. */
  salesCash: decimalStringSchema,
  /** Old market dues collected on that date. */
  oldDuesCollected: decimalStringSchema,
  /** salesCash + oldDuesCollected. */
  cashCollected: decimalStringSchema,
  /** Unpaid part of that day's sales. */
  marketDueCreated: decimalStringSchema,
  /** All market dues still open at the end of that date. */
  marketDueOutstanding: decimalStringSchema,
  postedSummaryCount: z.number().int().nonnegative(),
  postedReceiptCount: z.number().int().nonnegative(),
  byDsr: z.array(dsrDayRowSchema),
  /** Requires `report.profit_view`. */
  grossProfit: decimalStringSchema.optional(),
  /** Cost value of stock received that date; requires `inventory.cost_view`. */
  receivedValue: decimalStringSchema.optional(),
  /** Cost-based saleable inventory value now (not as of the date); requires `inventory.cost_view`. */
  stockValue: decimalStringSchema.optional(),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
