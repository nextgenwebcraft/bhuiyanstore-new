import { z } from "zod";
import { monthStatuses } from "./month";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * One DSR's day (or range): what they sold, collected and left due on the market, plus D69's
 * sales chain for just this person (issuedValue through totalSales; salesProfit needs
 * `inventory.cost_view` and `report.profit_view`, same as the dashboard total).
 */
export const dsrDayRowSchema = z.object({
  dsrId: idSchema,
  dsrName: z.string(),
  netSales: decimalStringSchema,
  salesCash: decimalStringSchema,
  marketDueCreated: decimalStringSchema,
  oldDuesCollected: decimalStringSchema,
  issuedValue: decimalStringSchema,
  returnValue: decimalStringSchema,
  damageSaleValue: decimalStringSchema,
  commission: decimalStringSchema,
  /** D107 মোট বিক্রি: issuedValue − returnValue. */
  totalSales: decimalStringSchema,
  salesProfit: decimalStringSchema.optional(),
});

export type DsrDayRow = z.infer<typeof dsrDayRowSchema>;

/** D109: damaged pieces still held for one product at one rate. */
export const damageLotRowSchema = z.object({
  productId: idSchema,
  productName: z.string(),
  rate: decimalStringSchema,
  pieces: decimalStringSchema,
  /** pieces × rate, rounded to 2 decimals. */
  amount: decimalStringSchema,
});

export type DamageLotRow = z.infer<typeof damageLotRowSchema>;

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
  /** D67: money paid out for staff (advance to salary, net of returns); requires `finance.view`. */
  staffCost: decimalStringSchema.optional(),
  /** D67 (amended 2026-10-22, domain `srCost`): one day's SR loan change, or what the SRs owe at the end of a longer range; requires `finance.view`. */
  srCost: decimalStringSchema.optional(),
  /** D67: DSR-damaged pieces at the sale price. */
  damageSaleValue: decimalStringSchema,
  /**
   * Cash handed over below the expected cash, summed over the range (D81). Display only: it is
   * not taken off cash, a staff balance, or profit.
   */
  handoverShort: decimalStringSchema.default("0.00"),
  /** D69 (amended D106): কমিশন + অপারেটিং খরচ + ডিএসআর খরচ, shown only; requires `finance.view`. */
  totalCost: decimalStringSchema.optional(),
  /** D69: অপারেটিং খরচ + ডিএসআর খরচ, what নিট প্রফিট takes off the profit; requires `finance.view`. */
  profitCost: decimalStringSchema.optional(),
  /**
   * D107 হাতে জমা: মোট বিক্রি − ড্যামেজ − কমিশন − অপারেটিং খরচ − ডিএসআর খরচ − নতুন বকেয়া + বকেয়া জমা.
   * Requires `finance.view` because operating cost and DSR cost are part of it.
   */
  cashInHand: decimalStringSchema.optional(),
  /**
   * D112: badge on হাতে জমা when Managers have submitted day-end cash in the range.
   * `pending` if any sheet is pending; else `approved` if any approved; else omitted/`none`.
   */
  cashInHandHandover: z
    .object({
      status: z.enum(["none", "pending", "approved"]),
      amount: decimalStringSchema.nullable(),
    })
    .optional(),
  /** D107 মোট বিক্রি: issuedValue − returnValue. */
  totalSales: decimalStringSchema,
  /** D69: the DSR-line profit (domain `salesProfit`); requires `inventory.cost_view` and `report.profit_view`. */
  salesProfit: decimalStringSchema.optional(),
  /** D69: salesProfit − অপারেটিং খরচ − ডিএসআর খরচ; requires `finance.view` too. */
  netProfit: decimalStringSchema.optional(),
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
  /** D109: damaged pieces still held at the end of the range, one row per product and rate. */
  damageLots: z.array(damageLotRowSchema),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** One company's net profit over the range (engine `month.profit`; salaries paid by it, D67). */
const companyProfitSchema = z.object({
  companyId: idSchema,
  companyName: z.string(),
  gross: decimalStringSchema,
  salaries: decimalStringSchema,
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
