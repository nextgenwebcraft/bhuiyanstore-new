import { z } from "zod";
import { priceKinds, unitPriceSchema } from "./catalog";
import type { PermissionId } from "./definitions/permissions";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * Daily entry (PLAN §2.2, §5, §9 Phase E). Users enter only raw facts; every calculated figure
 * comes from the month engine. Posted documents are immutable: a correction reverses the posted
 * document and enters a new one.
 */

/** Whole pieces ≥ 0 (cartons are converted to pieces with the line's carton size). */
export const wholePiecesSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, { message: "validation.wholeNumber" });

/** Whole pieces > 0. */
export const positivePiecesSchema = z
  .string()
  .regex(/^[1-9]\d*$/, { message: "validation.quantityPositive" });

/** Taka > 0 with at most 2 decimals; the entry type decides the direction (D27). */
export const positiveAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "validation.amountPositive" })
  .refine((v) => /[1-9]/.test(v), { message: "validation.amountPositive" });

/** Taka ≥ 0 with at most 2 decimals. */
export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "validation.opening.amount" });

export const documentStatuses = ["posted", "reversed"] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

// ---------------------------------------------------------------- godown (stock entries)

/** Excel `C` Due Quantity (order), `G` Receive (receipt) and `N` DAMAGE PRODUCT (damage). */
export const stockEntryKinds = ["order", "receipt", "damage"] as const;
export type StockEntryKind = (typeof stockEntryKinds)[number];

export const stockEntrySchema = z.object({
  id: idSchema,
  date: businessDateSchema,
  kind: z.enum(stockEntryKinds),
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  pieces: positivePiecesSchema,
  status: z.enum(documentStatuses),
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

export type StockEntry = z.infer<typeof stockEntrySchema>;

export const stockEntryLineRequestSchema = z.object({
  kind: z.enum(stockEntryKinds),
  productId: idSchema,
  pieces: positivePiecesSchema,
});

/**
 * A price present here applies from `date` on (Excel's carry-forward, PLAN §2.2). Prices posted
 * with a receipt are that batch's purchase and sale price.
 */
export const dayPriceRequestSchema = z.object({
  productId: idSchema,
  kind: z.enum(priceKinds),
  price: unitPriceSchema,
});

export const stockEntryPostRequestSchema = z
  .object({
    date: businessDateSchema,
    lines: z.array(stockEntryLineRequestSchema).max(500).default([]),
    prices: z.array(dayPriceRequestSchema).max(1500).default([]),
  })
  .refine((v) => v.lines.length + v.prices.length > 0, {
    message: "validation.daily.empty",
    path: ["lines"],
  });

export type StockEntryPostRequest = z.input<typeof stockEntryPostRequestSchema>;

// ---------------------------------------------------------------- DSR day sheet (D03)

export const dsrDayStatuses = ["draft", "posted", "reversed"] as const;
export type DsrDayStatus = (typeof dsrDayStatuses)[number];

export const dsrLineRequestSchema = z.object({
  productId: idSchema,
  /** Samari: pieces issued (cartons × carton size + loose pieces). */
  issued: wholePiecesSchema,
  /** Firot: unsold pieces returned. */
  returned: wholePiecesSchema,
  damaged: wholePiecesSchema,
});

export const dsrDaySaveRequestSchema = z.object({
  date: businessDateSchema,
  staffId: idSchema,
  /** 0 creates the sheet; otherwise the version the user edited. */
  version: z.number().int().nonnegative(),
  /** বাকি: new market due left by this DSR today. */
  marketDueNew: amountSchema,
  /** Old dues this DSR collected today. */
  marketDueCollected: amountSchema,
  lines: z.array(dsrLineRequestSchema).max(500),
});

export type DsrDaySaveRequest = z.input<typeof dsrDaySaveRequestSchema>;

export const dsrLineSchema = dsrLineRequestSchema.extend({
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
});

export const dsrDaySchema = z.object({
  id: idSchema,
  date: businessDateSchema,
  staffId: idSchema,
  staffName: z.string(),
  status: z.enum(dsrDayStatuses),
  version: z.number().int().positive(),
  marketDueNew: decimalStringSchema,
  marketDueCollected: decimalStringSchema,
  lines: z.array(dsrLineSchema),
  postedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
});

export type DsrDay = z.infer<typeof dsrDaySchema>;

export const documentTransitionRequestSchema = z.object({
  version: z.number().int().positive(),
});

export type DocumentTransitionRequest = z.infer<typeof documentTransitionRequestSchema>;

// ---------------------------------------------------------------- money entries (D27)

/** Same list as the month engine's `MoneyKind` (asserted in `application/src/kinds.test.ts`). */
export const moneyEntryKinds = [
  "marketDueNew",
  "marketDueCollected",
  "srIncentive",
  "expense",
  "staffAdvance",
  "staffLoan",
  "staffShortage",
  "staffRepayment",
  "staffExcess",
  "staffCostPaid",
  "staffCreditPaid",
  "salaryAccrual",
  "salaryRecovery",
  "salaryPaid",
  "srLoan",
  "srRepayment",
  "srOwed",
  "srPayment",
  "staffOffset",
  "srOffset",
  "supplierDeposit",
  "companyIncentive",
] as const;

export type MoneyEntryKind = (typeof moneyEntryKinds)[number];

/**
 * Which person a kind is entered against: a DSR (market due), an SR (D18) or distributor staff
 * (any role except SR, D02). Kinds missing here take no person.
 */
export const moneyKindPerson: Partial<Record<MoneyEntryKind, "dsr" | "sr" | "distributor">> = {
  marketDueNew: "dsr",
  marketDueCollected: "dsr",
  srIncentive: "sr",
  staffAdvance: "distributor",
  staffLoan: "distributor",
  staffShortage: "distributor",
  staffRepayment: "distributor",
  staffExcess: "distributor",
  staffCostPaid: "distributor",
  staffCreditPaid: "distributor",
  salaryAccrual: "distributor",
  salaryRecovery: "distributor",
  salaryPaid: "distributor",
  srLoan: "sr",
  srRepayment: "sr",
  srOwed: "sr",
  srPayment: "sr",
  staffOffset: "distributor",
  srOffset: "sr",
};

/** The permission that posts each kind. */
export const moneyKindPermission: Record<MoneyEntryKind, PermissionId> = {
  marketDueNew: "sale.post",
  marketDueCollected: "collection.post",
  srIncentive: "sr_incentive.pay",
  expense: "payment.post",
  staffAdvance: "payment.post",
  staffLoan: "payment.post",
  staffShortage: "payment.post",
  staffRepayment: "payment.post",
  staffExcess: "payment.post",
  staffCostPaid: "payment.post",
  staffCreditPaid: "payment.post",
  salaryAccrual: "compensation.manage",
  salaryRecovery: "compensation.manage",
  salaryPaid: "compensation.manage",
  srLoan: "sr_loan.create",
  srRepayment: "sr_loan.repay",
  srOwed: "sr_payable.settle",
  srPayment: "sr_payable.settle",
  staffOffset: "payment.post",
  srOffset: "sr_payable.settle",
  supplierDeposit: "payment.post",
  companyIncentive: "payment.post",
};

/** Kinds that need an expense category. */
export const moneyCategoryKinds: readonly MoneyEntryKind[] = ["expense", "staffCostPaid"];

/** Kinds that reduce what a person owes and may name the parts (default advance → loan → shortage). */
export const moneyAllocationKinds: readonly MoneyEntryKind[] = [
  "staffRepayment",
  "staffOffset",
  "salaryRecovery",
];

const allocationPart = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "validation.opening.amount" });

/** Parts of a repayment, offset or recovery; together they equal the amount. */
export const owedAllocationSchema = z.object({
  advance: allocationPart.default("0"),
  loan: allocationPart.default("0"),
  shortage: allocationPart.default("0"),
});

export type OwedAllocation = z.infer<typeof owedAllocationSchema>;

export const moneyEntryPostRequestSchema = z.object({
  date: businessDateSchema,
  kind: z.enum(moneyEntryKinds),
  amount: positiveAmountSchema,
  staffId: idSchema.nullable().default(null),
  expenseCategoryId: idSchema.nullable().default(null),
  allocation: owedAllocationSchema.nullable().default(null),
});

export type MoneyEntryPostRequest = z.input<typeof moneyEntryPostRequestSchema>;

export const moneyEntrySchema = z.object({
  id: idSchema,
  date: businessDateSchema,
  kind: z.enum(moneyEntryKinds),
  amount: decimalStringSchema,
  staffId: idSchema.nullable(),
  staffName: z.string().nullable(),
  expenseCategoryId: idSchema.nullable(),
  categoryName: z.string().nullable(),
  allocation: owedAllocationSchema.nullable(),
  /** Set when a payroll run posted the entry; it is then reversed only with the run. */
  payrollRunId: idSchema.nullable(),
  status: z.enum(documentStatuses),
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

export type MoneyEntry = z.infer<typeof moneyEntrySchema>;

// ---------------------------------------------------------------- day view (PLAN §6)

const money = decimalStringSchema;
/** Cost-based values are null without `inventory.cost_view` (profit also needs `report.profit_view`). */
const costMoney = decimalStringSchema.nullable();

export const dayProductRowSchema = z.object({
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
  orderPrice: money.nullable(),
  costPrice: costMoney,
  salePrice: money.nullable(),
  sales: money,
  cost: costMoney,
  grossProfit: costMoney,
  returnValue: money,
  orderValue: money,
  receiptBill: money,
  receiptSale: money,
  damageValue: costMoney,
  dueFromCompany: money,
  stock: money,
  stockValue: costMoney,
});

export type DayProductRow = z.infer<typeof dayProductRowSchema>;

export const dayPersonRowSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  productId: idSchema,
  issued: money,
  returned: money,
  net: money,
  damaged: money,
  amount: money,
});

export const dayMoneySchema = z.object({
  sales: money,
  marketDueNew: money,
  marketDueCollected: money,
  srIncentive: money,
  expenses: money,
  cashIn: money,
  cashOut: money,
  cashLeft: money,
  banked: money,
});

export const engineWarningSchema = z.object({
  code: z.string(),
  date: businessDateSchema,
  productId: z.string().optional(),
  staffId: z.string().optional(),
  detail: z.string().optional(),
});

export type EngineWarningDto = z.infer<typeof engineWarningSchema>;

export const dayViewSchema = z.object({
  date: businessDateSchema,
  /** Null until the company's opening is active; daily entry starts at the cutoff date. */
  cutoffDate: businessDateSchema.nullable(),
  products: z.array(dayProductRowSchema),
  persons: z.array(dayPersonRowSchema),
  money: dayMoneySchema,
  /** All market due still open at the end of the date. */
  marketDueOutstanding: money,
  marketDueByDsr: z.array(z.object({ staffId: z.string(), staffName: z.string(), amount: money })),
  warnings: z.array(engineWarningSchema),
  canSeeCost: z.boolean(),
  canSeeProfit: z.boolean(),
});

export type DayView = z.infer<typeof dayViewSchema>;
