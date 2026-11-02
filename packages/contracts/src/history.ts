import { z } from "zod";
import { dsrDaySchema, moneyEntrySchema, stockEntryKinds, stockEntrySchema } from "./daily";

/** Shared page query: 1-based page, fixed page sizes. */
export const historyPageQuerySchema = z.object({
  page: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? 1 : v),
    z.coerce.number().int().positive(),
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? 25 : v),
    z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), {
      message: "validation.history.pageSize",
    }),
  ),
});

export type HistoryPageQuery = z.infer<typeof historyPageQuerySchema>;

function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
}

export const historyStockPageSchema = pageOf(stockEntrySchema);
export type HistoryStockPage = z.infer<typeof historyStockPageSchema>;

export const historyMoneyPageSchema = pageOf(moneyEntrySchema);
export type HistoryMoneyPage = z.infer<typeof historyMoneyPageSchema>;

export const historyDsrPageSchema = pageOf(dsrDaySchema);
export type HistoryDsrPage = z.infer<typeof historyDsrPageSchema>;

/** Stock kinds a History tab may filter to. */
export const historyStockKindGroups = {
  orders: ["order"],
  stock: ["receipt", "incentive"],
  damage: ["damage", "damageDeposit"],
} as const satisfies Record<string, readonly (typeof stockEntryKinds)[number][]>;

export type HistoryStockKindGroup = keyof typeof historyStockKindGroups;

/** Money kind groups for History tabs. */
export const historyMoneyKindGroups = {
  shopDues: ["marketDueNew", "marketDueCollected"],
  staffCash: ["staffAdvance", "staffShortage", "staffRepayment", "staffAbsent"],
  srCash: ["srLoan", "srRepayment"],
  expenses: ["expense"],
} as const;

export type HistoryMoneyKindGroup = keyof typeof historyMoneyKindGroups;
