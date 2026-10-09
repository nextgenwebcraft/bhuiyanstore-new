import { z } from "zod";
import { unitPriceSchema } from "./catalog";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * Opening balances (PLAN §7, guide §16). One opening per company; blank (`null`) means unknown,
 * never zero, and an explicit "0" is allowed.
 */

/** A whole number of pieces ≥ 0. */
const piecesSchema = z.string().regex(/^(0|[1-9]\d*)$/, { message: "validation.opening.pieces" });

/** A money amount ≥ 0 with at most 2 decimals; the kind decides the direction (D27). */
export const openingAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "validation.opening.amount" });

export const openingStatuses = ["draft", "approved", "active"] as const;
export type OpeningStatus = (typeof openingStatuses)[number];

/**
 * Money balances by type (guide §16.7, §11.9). Staff kinds need a person; `market_due` without a
 * person is the legacy bucket; `cash` needs a cash account; company kinds have no party.
 */
export const openingBalanceKinds = [
  "market_due",
  "advance",
  "loan",
  "shortage",
  "credit",
  "salary_payable",
  "sr_loan",
  "owed_to_sr",
  "company_payable",
  "company_advance",
  "cash",
] as const;
export type OpeningBalanceKind = (typeof openingBalanceKinds)[number];

export const openingStaffKinds = [
  "advance",
  "loan",
  "shortage",
  "credit",
  "salary_payable",
  "sr_loan",
  "owed_to_sr",
] as const satisfies readonly OpeningBalanceKind[];

export const openingStockLineSchema = z.object({
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  pieces: piecesSchema.nullable(),
  unitCost: unitPriceSchema.nullable(),
  salePrice: unitPriceSchema.nullable(),
  orderPrice: unitPriceSchema.nullable(),
  dueFromCompany: z
    .string()
    .regex(/^(0|-?[1-9]\d*)$/, { message: "validation.opening.due" })
    .nullable(),
  note: z.string(),
});

export type OpeningStockLine = z.infer<typeof openingStockLineSchema>;

export const openingBalanceLineSchema = z.object({
  kind: z.enum(openingBalanceKinds),
  staffId: idSchema.nullable(),
  cashAccountId: idSchema.nullable(),
  amount: openingAmountSchema.nullable(),
  note: z.string(),
});

export type OpeningBalanceLine = z.infer<typeof openingBalanceLineSchema>;

export const openingIssueSchema = z.object({
  /** Also the i18n key of the message. */
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  productId: idSchema.optional(),
  kind: z.enum(openingBalanceKinds).optional(),
  staffId: idSchema.optional(),
  cashAccountId: idSchema.optional(),
});

export type OpeningIssue = z.infer<typeof openingIssueSchema>;

/** Control totals computed by `checkOpening` in @bsd/domain; never stored. */
export const openingTotalsSchema = z.object({
  stockPieces: decimalStringSchema,
  /** Σ pieces × unit cost over rows without errors. */
  stockValue: decimalStringSchema,
  valuedRows: z.number().int().nonnegative(),
  excludedRows: z.number().int().nonnegative(),
  dueFromCompanyPieces: decimalStringSchema,
  marketDue: decimalStringSchema,
  /** আমাদের পাওনা: advance + loan + shortage + SR loan. */
  staffOwesUs: decimalStringSchema,
  /** আমরা দেব: staff credit + salary payable + owed to SR. */
  staffWeOwe: decimalStringSchema,
  /** Positive = we owe the company; negative = advance with the company. */
  companyPayable: decimalStringSchema,
  cash: decimalStringSchema,
});

export type OpeningTotals = z.infer<typeof openingTotalsSchema>;

export const openingSchema = z.object({
  companyId: idSchema,
  status: z.enum(openingStatuses),
  /** Optimistic concurrency: every save increments it; writes must send the version they read. */
  version: z.number().int().nonnegative(),
  /** Go-live date: balances are as at the start of this business date. */
  cutoffDate: businessDateSchema.nullable(),
  stock: z.array(openingStockLineSchema),
  balances: z.array(openingBalanceLineSchema),
  issues: z.array(openingIssueSchema),
  totals: openingTotalsSchema,
  approvedAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
});

export type Opening = z.infer<typeof openingSchema>;

export const openingSaveRequestSchema = z.object({
  version: z.number().int().nonnegative(),
  cutoffDate: businessDateSchema.nullable(),
  stock: z.array(
    openingStockLineSchema.pick({
      productId: true,
      pieces: true,
      unitCost: true,
      salePrice: true,
      orderPrice: true,
      dueFromCompany: true,
      note: true,
    }),
  ),
  balances: z.array(openingBalanceLineSchema),
});

export type OpeningSaveRequest = z.infer<typeof openingSaveRequestSchema>;

/** Approve and activate act on the exact version the user reviewed. */
export const openingTransitionRequestSchema = z.object({
  version: z.number().int().nonnegative(),
});

export type OpeningTransitionRequest = z.infer<typeof openingTransitionRequestSchema>;
