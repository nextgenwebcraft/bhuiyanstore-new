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
  /** D67 / D119: DSR-damaged pieces at ড্যামেজ দর (else sale); cash chain uses this (D107). */
  damageSaleValue: decimalStringSchema,
  /**
   * D133 মোট ড্যামেজ card: held damage lots at range end + damageDeposit / floorDamageDeposit
   * money in the range. Not used for হাতে জমা (that still subtracts `damageSaleValue`).
   */
  damageTotal: decimalStringSchema,
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
   * D112 / D125: badge on হাতে জমা. `pending` if any sheet is pending or has হাতে জমা
   * amount saved but not yet Super-Admin approved; else `approved` if any approved; else `none`.
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

/**
 * Month-wise মোট বিক্রি for one calendar year on the company dashboard (D128). Each month is the
 * same engine range as the dashboard for that month; future months are zero. `salesProfit` is
 * omitted without `inventory.cost_view` and `report.profit_view`.
 */
export const dashboardMonthlySchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  months: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      totalSales: decimalStringSchema,
      salesProfit: decimalStringSchema.optional(),
    }),
  ),
});

export type DashboardMonthly = z.infer<typeof dashboardMonthlySchema>;

/** D146: the money held in a company at one date: undelivered goods + stock + market dues. */
const companyCapitalFiguresSchema = z.object({
  /** Billed value of goods ordered and not received yet (dashboard `undeliveredValue`). */
  undelivered: decimalStringSchema,
  /** Cost value of saleable stock (dashboard `stockValue`). */
  stock: decimalStringSchema,
  /** Market dues still open (dashboard `marketDueOutstanding`). */
  marketDue: decimalStringSchema,
  /** undelivered + stock + marketDue, summed on the server. */
  total: decimalStringSchema,
});

/** D150: one day of the money held in a company (the day's closing figures). */
const companyCapitalDaySchema = companyCapitalFiguresSchema.extend({ date: businessDateSchema });

/** D150: the daily average of the money held, and its lowest and highest day. */
const companyCapitalStatsSchema = z.object({
  /** Days averaged (from the opening cutoff, through today for the running month). */
  days: z.number().int().positive(),
  /** Σ each day's closing figures ÷ days, per part and in total. */
  average: companyCapitalFiguresSchema,
  lowest: z.object({ date: businessDateSchema, total: decimalStringSchema }),
  highest: z.object({ date: businessDateSchema, total: decimalStringSchema }),
});

/**
 * D146 / D150 History → সারাংশ: how much money is held in the company (আনডেলিভারি + মজুদ মাল +
 * বাজারের বাকি), as of today, at the end of every month of a year (the current month runs to
 * today; later months are left out), and every day of the year with each month's and the year's
 * daily average, lowest and highest day. Each day is the engine's own closing for that day, so a
 * month end matches the dashboard for that month. Never a stored total. Requires
 * `inventory.cost_view`.
 */
export const companyCapitalYearSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  asOf: businessDateSchema,
  current: companyCapitalFiguresSchema,
  /** Null when the year has no day from the opening cutoff on. */
  yearStats: companyCapitalStatsSchema.nullable(),
  months: z.array(
    companyCapitalFiguresSchema.extend({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      /** The date the figures stand at: month end, or today for the running month. */
      to: businessDateSchema,
      /** Null for a month wholly before the opening cutoff. */
      stats: companyCapitalStatsSchema.nullable(),
    }),
  ),
  /** Every day from the year start (or the cutoff) through the year end (or today), oldest first. */
  days: z.array(companyCapitalDaySchema),
});

export type CompanyCapitalYear = z.infer<typeof companyCapitalYearSchema>;

/** D148: one staff member's খরচ for the month (salary accrual + expenses booked on them). */
const monthStaffKhorochSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  salary: decimalStringSchema,
  expenses: decimalStringSchema,
  total: decimalStringSchema,
});

/**
 * D148 History → মাসিক সারসংক্ষেপ: one month of a company — order, receive, sale, commission,
 * operating cost, each staff role's খরচ (বেতনসহ) and the net profit after all of them. Order,
 * receive, sale, commission and sales profit are the dashboard's figures for the month; khoroch
 * split and net profit are `@bsd/domain` `monthKhoroch` / `monthNetProfit`. Requires
 * `report.profit_view`, `inventory.cost_view` and `finance.view`.
 */
export const monthlySummarySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  from: businessDateSchema,
  /** Month end, or today for the running month. */
  to: businessDateSchema,
  cutoffDate: businessDateSchema.nullable(),
  /** মোট অর্ডার: Σ order bills in the month (engine companyPayable.orders). */
  totalOrder: decimalStringSchema,
  /** মোট রিসিভ: billed value of goods received (dashboard receivedValue). */
  totalReceive: decimalStringSchema,
  /** মোট বিক্রি (dashboard totalSales). */
  totalSales: decimalStringSchema,
  /** ডিলার/দোকান কমিশন (dashboard commission). */
  commission: decimalStringSchema,
  /** বিক্রয় লাভ (dashboard salesProfit), the base the khoroch come off. */
  salesProfit: decimalStringSchema,
  /** Category expenses with no staff. */
  operatingCost: decimalStringSchema,
  /** One row per non-SR staff role of the tenant (zero rows kept), then any other role found. */
  roles: z.array(
    z.object({
      roleId: z.string(),
      roleName: z.string(),
      salary: decimalStringSchema,
      expenses: decimalStringSchema,
      total: decimalStringSchema,
      staff: z.array(monthStaffKhorochSchema),
    }),
  ),
  staffTotal: decimalStringSchema,
  /** salesProfit − operatingCost − staffTotal. */
  netProfit: decimalStringSchema,
  /** The dashboard's নিট প্রফিট for the same month (cash-based staff cost), for comparison. */
  dashboardNetProfit: decimalStringSchema,
  /** Payroll people whose salary for this month is not posted yet (salary khoroch still missing). */
  salaryPendingCount: z.number().int().nonnegative(),
});

export type MonthlySummary = z.infer<typeof monthlySummarySchema>;

/**
 * D149 History → বেতন ইতিহাস: one posted salary line — what the person earned, what was kept back
 * (absent fee, advance, loan, shortage) and what reached their hand.
 */
export const salaryHistoryRowSchema = z.object({
  runId: idSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  staffId: idSchema,
  staffName: z.string(),
  roleName: z.string(),
  salary: decimalStringSchema,
  /** Absent fee: lowers the payable only; never taken from a balance (D67). */
  absent: decimalStringSchema,
  /** salary − absent (the salary booked as expense). */
  payable: decimalStringSchema,
  /** What the person owed when the salary was posted. */
  owed: z.object({
    advance: decimalStringSchema,
    loan: decimalStringSchema,
    shortage: decimalStringSchema,
  }),
  recovery: z.object({
    advance: decimalStringSchema,
    loan: decimalStringSchema,
    shortage: decimalStringSchema,
  }),
  /** owed − recovery: what is still owed after this salary. */
  remaining: z.object({
    advance: decimalStringSchema,
    loan: decimalStringSchema,
    shortage: decimalStringSchema,
  }),
  recoveryTotal: decimalStringSchema,
  /** ক্যাশ পাবে: payable − recovery. */
  cashPay: decimalStringSchema,
  /** Cash actually paid (posted salaryPaid); 0 until paid. */
  cashPaid: decimalStringSchema,
  /** The salary posting date and the cash payment date (null until paid). */
  postedDate: businessDateSchema,
  paidDate: businessDateSchema.nullable(),
});

/** D149: the year's posted salary lines, filtered by month / staff; totals cover the shown rows. */
export const salaryHistorySchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
  staffId: idSchema.nullable(),
  /** Everyone with a posted salary in the year (for the staff filter). */
  staffOptions: z.array(z.object({ staffId: idSchema, staffName: z.string() })),
  rows: z.array(salaryHistoryRowSchema),
  totals: z.object({
    salary: decimalStringSchema,
    absent: decimalStringSchema,
    recovery: decimalStringSchema,
    cashPay: decimalStringSchema,
    cashPaid: decimalStringSchema,
  }),
});

export type SalaryHistoryRow = z.infer<typeof salaryHistoryRowSchema>;
export type SalaryHistory = z.infer<typeof salaryHistorySchema>;

/**
 * Day-wise মোট বিক্রি for the company dashboard chart (D128/D140 day tab): every day of the
 * selected calendar month through today. `salesProfit` needs the same permissions as monthly.
 */
export const dashboardDailySchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  days: z.array(
    z.object({
      date: businessDateSchema,
      totalSales: decimalStringSchema,
      salesProfit: decimalStringSchema.optional(),
    }),
  ),
});

export type DashboardDaily = z.infer<typeof dashboardDailySchema>;

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
