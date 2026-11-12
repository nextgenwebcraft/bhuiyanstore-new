import { z } from "zod";
import { monthSchema } from "./month";
import { decimalStringSchema, idSchema } from "./primitives";

const shareholderName = z
  .string()
  .trim()
  .min(1, { message: "validation.share.name" })
  .max(80, { message: "validation.share.name" });

/** Invest amount: a non-negative paisa figure. */
export const investAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "validation.share.amount" });

export const shareholderSchema = z.object({
  id: idSchema,
  name: z.string(),
  active: z.boolean(),
});
export type ShareholderRecord = z.infer<typeof shareholderSchema>;

export const shareholderCreateRequestSchema = z.object({ name: shareholderName });
export type ShareholderCreateRequest = z.input<typeof shareholderCreateRequestSchema>;

export const shareholderUpdateRequestSchema = z.object({
  name: shareholderName,
  active: z.boolean(),
});
export type ShareholderUpdateRequest = z.input<typeof shareholderUpdateRequestSchema>;

/** One company's invest amount in force from a month, within a batch save. */
export const investmentEntrySchema = z.object({
  targetCompanyId: idSchema,
  fromMonth: monthSchema,
  amount: investAmountSchema,
});
export type InvestmentEntry = z.input<typeof investmentEntrySchema>;

/**
 * Every invest entry a শেয়ারহোল্ডার screen edit touches, saved as one atomic transaction so a
 * partial failure never leaves some companies updated and others not (guide §13.3).
 */
export const investmentsRequestSchema = z.object({
  entries: z.array(investmentEntrySchema).min(1),
});
export type InvestmentsRequest = z.input<typeof investmentsRequestSchema>;

/** A shareholder with their invest amount in each active company, as of a month. */
export const shareholderInvestmentsSchema = z.object({
  shareholderId: idSchema,
  name: z.string(),
  active: z.boolean(),
  investments: z.array(z.object({ companyId: idSchema, amount: decimalStringSchema })),
});
export type ShareholderInvestments = z.infer<typeof shareholderInvestmentsSchema>;

/** The new শেয়ারহোল্ডার module: every shareholder and their invest, for one month. */
export const shareholderListSchema = z.object({
  month: monthSchema,
  companies: z.array(z.object({ companyId: idSchema, companyName: z.string() })),
  shareholders: z.array(shareholderInvestmentsSchema),
});
export type ShareholderList = z.infer<typeof shareholderListSchema>;

/** A calendar year the master panel and Company Hishab Reports cover: 2026 through 2040. */
export const hishabYearSchema = z.string().regex(/^\d{4}$/, { message: "validation.share.year" });

/**
 * Company Hishab Reports: one company, one year, twelve monthly rows. দান is always 2% of the
 * net (profit − khoroch); totalProfit is the net after দান. Invest is the selected shareholder's
 * own invest (or everyone's combined invest when none is selected); shareholderProfit is their
 * exact share of totalProfit in that same proportion (equal to totalProfit itself when no
 * shareholder is selected). profitPerLakh is always totalProfit over everyone's combined invest,
 * so it reads the same regardless of which shareholder is selected.
 */
export const companyHishabYearSchema = z.object({
  year: hishabYearSchema,
  companyId: idSchema,
  companyName: z.string(),
  shareholderId: idSchema.nullable(),
  shareholders: z.array(
    z.object({ shareholderId: idSchema, name: z.string(), active: z.boolean() }),
  ),
  months: z.array(
    z.object({
      month: monthSchema,
      profit: decimalStringSchema,
      khoroch: decimalStringSchema,
      dan: decimalStringSchema,
      totalProfit: decimalStringSchema,
      invest: decimalStringSchema,
      shareholderProfit: decimalStringSchema,
      profitPerLakh: decimalStringSchema,
    }),
  ),
});
export type CompanyHishabYear = z.infer<typeof companyHishabYearSchema>;

/**
 * The master panel: every active company's totalProfit side by side, one year, filterable by
 * shareholder. totalDan is 2% of the combined totalProfit (not a sum of the per-company দান).
 * previousDueTotal (D128) on each month is the sum of reductions applied to that month;
 * shareholderProfit and profitPerLakh use distributableProfit (totalProfit after those
 * reductions). openPreviousDueTotal is the remaining open dues for the apply form. perShareholder
 * (D94) is every **active** shareholder's share (closed partners omitted).
 */
export const masterHishabYearSchema = z.object({
  year: hishabYearSchema,
  shareholderId: idSchema.nullable(),
  /** Remaining open Previous Due balances (amount > 0), for the apply form. */
  openPreviousDueTotal: decimalStringSchema,
  companies: z.array(z.object({ companyId: idSchema, companyName: z.string() })),
  shareholders: z.array(
    z.object({ shareholderId: idSchema, name: z.string(), active: z.boolean() }),
  ),
  months: z.array(
    z.object({
      month: monthSchema,
      companies: z.array(z.object({ companyId: idSchema, totalProfit: decimalStringSchema })),
      totalProfit: decimalStringSchema,
      /** Amount applied from Previous Due against this month's profit. */
      previousDueTotal: decimalStringSchema,
      /** totalProfit after Previous Due applications for the shareholder split (D128). */
      distributableProfit: decimalStringSchema,
      totalDan: decimalStringSchema,
      invest: decimalStringSchema,
      shareholderProfit: decimalStringSchema,
      profitPerLakh: decimalStringSchema,
      perShareholder: z.array(
        z.object({ shareholderId: idSchema, profit: decimalStringSchema, paid: z.boolean() }),
      ),
    }),
  ),
});
export type MasterHishabYear = z.infer<typeof masterHishabYearSchema>;

/** Tenant-wide Previous Due row (D128): reason + remaining amount; amount 0 is settled. */
export const previousDueSchema = z.object({
  id: idSchema,
  reason: z.string(),
  amount: decimalStringSchema,
});
export type PreviousDueRecord = z.infer<typeof previousDueSchema>;

const previousDueReason = z
  .string()
  .trim()
  .min(1, { message: "validation.previousDue.reason" })
  .max(200, { message: "validation.previousDue.reason" });

export const previousDueCreateRequestSchema = z.object({
  reason: previousDueReason,
  amount: investAmountSchema,
});
export type PreviousDueCreateRequest = z.input<typeof previousDueCreateRequestSchema>;

export const previousDueUpdateRequestSchema = z.object({
  reason: previousDueReason,
  amount: investAmountSchema,
});
export type PreviousDueUpdateRequest = z.input<typeof previousDueUpdateRequestSchema>;

export const previousDueListSchema = z.object({
  items: z.array(previousDueSchema),
  /** Sum of amounts where amount > 0. */
  openTotal: decimalStringSchema,
});
export type PreviousDueList = z.infer<typeof previousDueListSchema>;

/** Apply part of a Previous Due against one month's profit (D128). */
export const previousDueReduceRequestSchema = z.object({
  previousDueId: idSchema,
  month: monthSchema,
  amount: investAmountSchema.refine((value) => /[1-9]/.test(value), {
    message: "validation.previousDue.reduceAmount",
  }),
});
export type PreviousDueReduceRequest = z.input<typeof previousDueReduceRequestSchema>;

/** D94: marks (or unmarks) one shareholder's one month as paid on the master panel. */
export const shareholderPayoutRequestSchema = z.object({
  shareholderId: idSchema,
  month: monthSchema,
  paid: z.boolean(),
});
export type ShareholderPayoutRequest = z.input<typeof shareholderPayoutRequestSchema>;
