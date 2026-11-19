import { z } from "zod";
import { dsrDaySchema, moneyEntrySchema, stockEntryKinds, stockEntrySchema } from "./daily";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/** Status filter on History lists. `all` = no status filter. */
export const historyStatusFilters = ["all", "posted", "reversed"] as const;
export type HistoryStatusFilter = (typeof historyStatusFilters)[number];

const statusFilterSchema = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? undefined : v),
  z.enum(historyStatusFilters).optional(),
);

/** Shared page query: 1-based page, optional single date and status filter. */
export const historyPageQuerySchema = z.object({
  page: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? 1 : v),
    z.coerce.number().int().positive(),
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? 25 : v),
    z.coerce
      .number()
      .int()
      .refine((n) => [25, 50, 100].includes(n), {
        message: "validation.history.pageSize",
      }),
  ),
  /** Single business date; omit or blank = every date. */
  date: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    businessDateSchema.optional(),
  ),
  /** UI default is posted; send `all` for every status. Omit also means posted (server). */
  status: statusFilterSchema,
});

export type HistoryPageQuery = z.infer<typeof historyPageQuerySchema>;

/** Status-only query for date-summary cards (orders / stock). */
export const historyStatusQuerySchema = z.object({
  status: statusFilterSchema,
});

export type HistoryStatusQuery = z.infer<typeof historyStatusQuerySchema>;

function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
}

/**
 * Stock history row with display carton / loose-piece split and money value.
 * `pieces` on the base entry stays the stored base quantity; `cartons` and `loosePieces`
 * are the separate display columns (খুচরা is not carton×size).
 */
export const historyStockLineSchema = stockEntrySchema.extend({
  cartons: decimalStringSchema,
  loosePieces: decimalStringSchema,
  amount: decimalStringSchema,
});
export type HistoryStockLine = z.infer<typeof historyStockLineSchema>;

export const historyStockPageSchema = pageOf(historyStockLineSchema);
export type HistoryStockPage = z.infer<typeof historyStockPageSchema>;

export const historyMoneyPageSchema = pageOf(moneyEntrySchema);
export type HistoryMoneyPage = z.infer<typeof historyMoneyPageSchema>;

export const historyDsrPageSchema = pageOf(dsrDaySchema);
export type HistoryDsrPage = z.infer<typeof historyDsrPageSchema>;

/**
 * One date that has stock entries, with totals for the History date-card list.
 * `cartons` and `pieces` (খুচরা) are summed separately — cartons are never converted to pieces.
 * Orders (D141): paymentMethod / checkDue / paymentEntryIds for the date card.
 */
export const historyStockDateSummarySchema = z.object({
  date: businessDateSchema,
  count: z.number().int().nonnegative(),
  /** Loose pieces only (খুচরা), not carton contents. */
  pieces: decimalStringSchema,
  cartons: decimalStringSchema,
  amount: decimalStringSchema,
  /** Orders only: নগদ / চেক / mixed when that date has both. */
  paymentMethod: z.enum(["cash", "check", "mixed"]).optional(),
  /** Orders only: remaining due on linked cheque(s); "0.00" when চেক is fully paid. */
  checkDue: decimalStringSchema.optional(),
  /** Orders only: one seed stock-entry id per orderGroup for D130 payment correct. */
  paymentEntryIds: z.array(idSchema).optional(),
  /** Orders only: cheque id when every order that day uses the same cheque. */
  companyCheckId: idSchema.nullable().optional(),
});
export type HistoryStockDateSummary = z.infer<typeof historyStockDateSummarySchema>;

export const historyStockDateSummariesSchema = z.object({
  items: z.array(historyStockDateSummarySchema),
});
export type HistoryStockDateSummaries = z.infer<typeof historyStockDateSummariesSchema>;

/** Stock kinds a History tab may filter to. */
export const historyStockKindGroups = {
  orders: ["order"],
  stock: ["receipt", "incentive"],
  damage: ["damage", "damageDeposit", "floorDamageDeposit"],
} as const satisfies Record<string, readonly (typeof stockEntryKinds)[number][]>;

export type HistoryStockKindGroup = keyof typeof historyStockKindGroups;

/** Groups that open as date cards first (no date picker). */
export const historyStockDateCardGroups = [
  "orders",
  "stock",
] as const satisfies readonly HistoryStockKindGroup[];
export type HistoryStockDateCardGroup = (typeof historyStockDateCardGroups)[number];

/** Money kind groups for History tabs. */
export const historyMoneyKindGroups = {
  shopDues: ["marketDueNew", "marketDueCollected"],
  staffCash: ["staffAdvance", "staffShortage", "staffRepayment", "staffAbsent"],
  srCash: ["srLoan", "srRepayment"],
  expenses: ["expense"],
} as const;

export type HistoryMoneyKindGroup = keyof typeof historyMoneyKindGroups;
