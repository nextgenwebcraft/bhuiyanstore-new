import { z } from "zod";
import { batchRowSchema, engineWarningSchema } from "./daily";
import type { PermissionId } from "./definitions/permissions";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * Month view, period close and range reports (PLAN §2.5, §6, §9 Phase F). Every figure is a
 * projection of one month-engine run; nothing here is a stored total.
 */

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "validation.month.invalid" });

const money = decimalStringSchema;
/** Null without `inventory.cost_view` (profit figures also need `report.profit_view`). */
const costMoney = decimalStringSchema.nullable();

export const monthStatuses = ["open", "closed", "beforeOpening", "future", "noOpening"] as const;
export type MonthStatus = (typeof monthStatuses)[number];

export const monthProductRowSchema = z.object({
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  ordered: money,
  received: money,
  issued: money,
  returned: money,
  delivered: money,
  damaged: money,
  sold: money,
  orderTotal: money,
  receiptTotal: money,
  /** Shop commission (D41), already taken out of `salesTotal`. */
  commissionTotal: money,
  salesTotal: money,
  costTotal: costMoney,
  profitTotal: costMoney,
  returnValue: money,
  damageValue: costMoney,
  /** Pieces found damaged in the godown (D53); stock and cost fall, sales do not. */
  godownDamaged: money,
  /** Damaged goods stock in the godown, and damaged pieces at the company (D53). */
  damagedStock: money,
  damageAtCompany: money,
  /** Pieces given to buyers from the godown for damaged ones (D17); part of the damage value. */
  replacedFromStock: money,
  /** Company replacement pieces received for damage claims (D17); no bill, no payable. */
  replacementReceived: money,
  replacementValue: costMoney,
  /** Free goods from the company (D16); no bill, no payable. */
  incentiveReceived: money,
  salesCartons: money,
  closingStock: money,
  closingValue: costMoney,
  closingAtSale: money,
  closingCartons: money,
  /** The batches at the end of the range, oldest first (D49). */
  closingBatches: z.array(batchRowSchema),
  dueFromCompany: money,
  /** Billed value of the goods not yet received (D48). */
  dueFromCompanyValue: money,
});

export type MonthProductRow = z.infer<typeof monthProductRowSchema>;

export const monthDayRowSchema = z.object({
  date: businessDateSchema,
  sales: money,
  commission: money,
  marketDueNew: money,
  marketDueCollected: money,
  srIncentive: money,
  expenses: money,
  cashIn: money,
  cashOut: money,
  cashLeft: money,
  banked: money,
});

export const staffBalanceKeys = [
  "advance",
  "loan",
  "shortage",
  "credit",
  "salaryPayable",
  "srLoan",
  "owedToSr",
] as const;
export type StaffBalanceKey = (typeof staffBalanceKeys)[number];

export const staffBalancesSchema = z.object(
  Object.fromEntries(staffBalanceKeys.map((k) => [k, money])) as Record<
    StaffBalanceKey,
    typeof money
  >,
);
export type StaffBalancesDto = z.infer<typeof staffBalancesSchema>;

export const monthStaffRowSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  opening: staffBalancesSchema,
  closing: staffBalancesSchema,
  owesUs: money,
  weOwe: money,
});

export const monthViewSchema = z.object({
  month: monthSchema,
  status: z.enum(monthStatuses),
  cutoffDate: businessDateSchema.nullable(),
  /** First and last date the figures cover (go-live month starts at the cutoff; the current month ends today). */
  from: businessDateSchema.nullable(),
  to: businessDateSchema.nullable(),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  canClose: z.boolean(),
  /** Why closing is refused right now (an i18n key), when the actor may close. */
  closeBlockedBy: z.string().nullable(),
  canReopen: z.boolean(),
  products: z.array(monthProductRowSchema),
  totals: z.object({
    orderTotal: money,
    receiptTotal: money,
    commissionTotal: money,
    salesTotal: money,
    costTotal: costMoney,
    profitTotal: costMoney,
    damageValue: costMoney,
    /** Damage refunds + replacement goods (D47 memo): not profit. */
    damageRecovery: costMoney,
    replacementValue: costMoney,
    closingValue: costMoney,
  }),
  days: z.array(monthDayRowSchema),
  marketDue: z.object({
    opening: money,
    added: money,
    collected: money,
    closing: money,
    byDsr: z.array(
      z.object({
        staffId: z.string(),
        staffName: z.string(),
        opening: money,
        added: money,
        collected: money,
        closing: money,
      }),
    ),
  }),
  staff: z.array(monthStaffRowSchema),
  companyPayable: z.object({
    opening: money,
    /** Order bills (D48): an order is billed on its day. */
    orders: money,
    /** Goods received beyond what was ordered, billed at once. */
    receipts: money,
    deposits: money,
    incentives: money,
    damageRefunds: money,
    closing: money,
    /** Billed value of goods ordered and not yet received, at the start and end. */
    undeliveredOpening: money,
    undeliveredClosing: money,
    /** Display sign (D48): money with the company = -payable. */
    balanceOpening: money,
    balanceClosing: money,
  }),
  /** Requires `report.profit_view` (and cost view). */
  profit: z
    .object({
      gross: money,
      salaries: money,
      expenses: money,
      expensesByCategory: z.array(z.object({ name: z.string(), amount: money })),
      srIncentive: money,
      net: money,
      netWithoutIncentive: money,
    })
    .nullable(),
  cashLeftTotal: money,
  warnings: z.array(engineWarningSchema),
  canSeeCost: z.boolean(),
  canSeeProfit: z.boolean(),
});

export type MonthView = z.infer<typeof monthViewSchema>;

export const monthCloseResultSchema = z.object({
  month: monthSchema,
  status: z.enum(["closed", "open"]),
});

export type MonthCloseResult = z.infer<typeof monthCloseResultSchema>;

export const reportRangeSchema = z.object({ from: businessDateSchema, to: businessDateSchema });
export type ReportRange = z.infer<typeof reportRangeSchema>;

// ---------------------------------------------------------------- range reports

export const reportIds = [
  "stock",
  "sales",
  "profit",
  "market-due",
  "company-due",
  "company-account",
  "damage",
  "cartons",
  "person-sales",
  "staff-balances",
  "daily-cash",
  "dsr-daily",
  "cash-book",
] as const;
export type ReportId = (typeof reportIds)[number];

/**
 * Permissions a report needs beyond `report.view` (which every report needs). The one owner of
 * this rule: the server enforces it and the UI hides what it would refuse.
 */
export const reportPermissions: Partial<Record<ReportId, readonly PermissionId[]>> = {
  profit: ["inventory.cost_view", "report.profit_view"],
  "staff-balances": ["finance.view"],
  "cash-book": ["finance.view"],
};

/** Whether `permissions` allow the report: `report.view` plus its own permissions. */
export function canViewReport(id: ReportId, permissions: readonly string[]): boolean {
  return (
    permissions.includes("report.view") &&
    (reportPermissions[id] ?? []).every((permission) => permissions.includes(permission))
  );
}

/**
 * How a column is shown and exported. `quantity` is pieces (shown as cartons/pieces with the
 * row's size); `cartons` is a carton count; `label` is an i18n key, or plain text when it is not
 * one (e.g. an expense category name).
 */
export const reportColumnKinds = ["text", "label", "quantity", "cartons", "money", "rate"] as const;
export type ReportColumnKind = (typeof reportColumnKinds)[number];

export const reportQuerySchema = reportRangeSchema.refine((q) => q.from <= q.to, {
  message: "validation.period.endBeforeStart",
  path: ["to"],
});

export const reportTableSchema = z.object({
  /** An i18n key for the table heading. */
  title: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      /** An i18n key. */
      label: z.string(),
      kind: z.enum(reportColumnKinds),
    }),
  ),
  rows: z.array(
    z.object({
      /** What the row is about (a staff id for staff balances), for row actions. */
      id: z.string().optional(),
      /** Carton size for `quantity` columns of this row. */
      piecesPerCarton: z.string().optional(),
      cells: z.record(z.string(), z.string().nullable()),
    }),
  ),
  /** Totals the engine itself produces (never summed here); keyed by column. */
  totals: z.record(z.string(), z.string().nullable()).nullable(),
});

export type ReportTable = z.infer<typeof reportTableSchema>;

export const reportSchema = z.object({
  report: z.enum(reportIds),
  from: businessDateSchema,
  to: businessDateSchema,
  cutoffDate: businessDateSchema.nullable(),
  tables: z.array(reportTableSchema),
  warnings: z.array(engineWarningSchema),
});

export type Report = z.infer<typeof reportSchema>;
