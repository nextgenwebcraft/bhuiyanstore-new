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
  /** Sum of the invest across every active company (D143). */
  totalInvest: decimalStringSchema,
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
 * previousDueTotal (D128) on each month is the sum of reductions applied to that month.
 * shareholderProfit (D143) is the selected partner's per-company share summed, or every active
 * partner's when none is selected; profitPerLakh is that shareholderProfit per lakh of the same
 * selection's invest. openPreviousDueTotal is the remaining open dues for the apply form.
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

/** One company's part of a partner's monthly share (D143). */
export const partnerShareLineSchema = z.object({
  companyId: idSchema,
  companyName: z.string(),
  invest: decimalStringSchema,
  amount: decimalStringSchema,
});
export type PartnerShareLine = z.infer<typeof partnerShareLineSchema>;

/** A recorded payment: the amount and company parts as they were when paid (snapshot). */
export const partnerPayoutSchema = z.object({
  id: idSchema,
  month: monthSchema,
  shareholderId: idSchema,
  shareholderName: z.string(),
  amount: decimalStringSchema,
  note: z.string().nullable(),
  paidAt: z.string(),
  paidByName: z.string().nullable(),
  lines: z.array(partnerShareLineSchema),
});
export type PartnerPayout = z.infer<typeof partnerPayoutSchema>;

/**
 * "future" is after the current month (nothing earned, cannot pay); "current" is still running
 * (payable, but figures can still move); "closed" is finished.
 */
export const payoutMonthStateSchema = z.enum(["future", "current", "closed"]);
export type PayoutMonthState = z.infer<typeof payoutMonthStateSchema>;

/**
 * অংশীদারদের পেমেন্ট for one month (D143): each company's profit, every active partner's
 * per-company share and total, and the payment if already made. A paid partner whose live figure
 * no longer matches the snapshot is flagged "changed". Totals are computed on the server.
 */
export const partnerPayoutMonthSchema = z.object({
  month: monthSchema,
  state: payoutMonthStateSchema,
  companies: z.array(
    z.object({
      companyId: idSchema,
      companyName: z.string(),
      totalProfit: decimalStringSchema,
      distributableProfit: decimalStringSchema,
      invest: decimalStringSchema,
    }),
  ),
  totalProfit: decimalStringSchema,
  previousDueTotal: decimalStringSchema,
  distributableProfit: decimalStringSchema,
  /** Profit of companies with no partner invest (plus paisa rounding): nobody receives it. */
  unallocated: decimalStringSchema,
  partners: z.array(
    z.object({
      shareholderId: idSchema,
      name: z.string(),
      active: z.boolean(),
      invest: decimalStringSchema,
      amount: decimalStringSchema,
      lines: z.array(partnerShareLineSchema),
      payout: partnerPayoutSchema.nullable(),
      changed: z.boolean(),
    }),
  ),
  summary: z.object({
    /** Every active partner's live amount. */
    payable: decimalStringSchema,
    /** Sum of recorded payments. */
    paid: decimalStringSchema,
    /** Live amount of active partners not yet paid. */
    unpaid: decimalStringSchema,
    paidCount: z.number().int(),
    partnerCount: z.number().int(),
  }),
});
export type PartnerPayoutMonth = z.infer<typeof partnerPayoutMonthSchema>;

/**
 * Pay one or more partners for a month (D143). Each entry carries the amount the admin saw; the
 * server refuses when the live figure no longer matches, so nobody is paid a figure they did not
 * review.
 */
export const partnerPayRequestSchema = z.object({
  month: monthSchema,
  entries: z
    .array(z.object({ shareholderId: idSchema, amount: decimalStringSchema }))
    .min(1, { message: "validation.payout.none" }),
  note: z.string().trim().max(200, { message: "validation.payout.note" }).optional(),
});
export type PartnerPayRequest = z.input<typeof partnerPayRequestSchema>;

export const partnerPayResultSchema = z.object({ paid: z.number().int() });
export type PartnerPayResult = z.infer<typeof partnerPayResultSchema>;

/** Payment history for a year (D143): every payment plus totals by partner, month and company. */
export const partnerPayoutHistorySchema = z.object({
  year: hishabYearSchema,
  shareholderId: idSchema.nullable(),
  shareholders: z.array(
    z.object({ shareholderId: idSchema, name: z.string(), active: z.boolean() }),
  ),
  companies: z.array(z.object({ companyId: idSchema, companyName: z.string() })),
  payments: z.array(partnerPayoutSchema),
  byShareholder: z.array(
    z.object({
      shareholderId: idSchema,
      name: z.string(),
      total: decimalStringSchema,
      /** Twelve entries, January first; null when that month is not paid. */
      months: z.array(decimalStringSchema.nullable()),
      byCompany: z.array(z.object({ companyId: idSchema, amount: decimalStringSchema })),
    }),
  ),
  /** Twelve totals, January first. */
  byMonth: z.array(decimalStringSchema),
  byCompany: z.array(z.object({ companyId: idSchema, amount: decimalStringSchema })),
  total: decimalStringSchema,
});
export type PartnerPayoutHistory = z.infer<typeof partnerPayoutHistorySchema>;
