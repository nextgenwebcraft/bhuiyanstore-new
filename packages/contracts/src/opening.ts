import { z } from "zod";
import { unitPriceSchema } from "./catalog";
import {
  amountStringSchema,
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  wholeNumberStringSchema,
} from "./primitives";

/**
 * Opening balances (PLAN §7, guide §16). One opening per company, live once its go-live date is
 * saved (D43). A blank (`null`) counts as 0 in every calculation and shows as pending.
 */

/** A whole number of pieces ≥ 0. */
const piecesSchema = wholeNumberStringSchema("validation.opening.pieces");

/** A money amount ≥ 0 with at most 2 decimals; the kind decides the direction (D27). */
export const openingAmountSchema = amountStringSchema("validation.opening.amount");

/**
 * Money balances by type (guide §16.7, §11.9). Staff kinds need a person; `market_due` without a
 * person is the legacy bucket; `cash` needs a cash account; company kinds have no party.
 */
export const openingBalanceKinds = [
  "market_due",
  "shop_due",
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

/**
 * The single owner of which balance kinds each opening section saves (D43). Every kind belongs to
 * exactly one section; a section save replaces only its own kinds. Stock has its own lines.
 */
export const openingSectionKinds = {
  marketDue: ["market_due"],
  shopDue: ["shop_due"],
  staff: ["advance", "loan", "shortage", "credit", "salary_payable", "sr_loan", "owed_to_sr"],
  company: ["company_payable", "company_advance"],
  cash: ["cash"],
} as const satisfies Record<string, readonly OpeningBalanceKind[]>;

export const openingBalanceSections = Object.keys(openingSectionKinds) as [
  keyof typeof openingSectionKinds,
  ...(keyof typeof openingSectionKinds)[],
];
export type OpeningBalanceSectionId = keyof typeof openingSectionKinds;

/** The opening's sections in screen order: stock, then the money sections. */
export const openingSections = ["stock", ...openingBalanceSections] as const;
export type OpeningSectionId = (typeof openingSections)[number];

/** The section a balance kind is saved with. */
export function sectionOfBalanceKind(kind: OpeningBalanceKind): OpeningBalanceSectionId {
  return openingBalanceSections.find((section) =>
    (openingSectionKinds[section] as readonly OpeningBalanceKind[]).includes(kind),
  ) as OpeningBalanceSectionId;
}

export const openingStockLineSchema = z.object({
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  pieces: piecesSchema.nullable(),
  unitCost: unitPriceSchema.nullable(),
  salePrice: unitPriceSchema.nullable(),
  orderPrice: unitPriceSchema.nullable(),
  dueFromCompany: wholeNumberStringSchema("validation.opening.due").nullable(),
  note: z.string(),
});

export type OpeningStockLine = z.infer<typeof openingStockLineSchema>;

export const openingBalanceLineSchema = z.object({
  kind: z.enum(openingBalanceKinds),
  staffId: idSchema.nullable(),
  cashAccountId: idSchema.nullable(),
  /** D38: the shop of a `shop_due` line. */
  shopId: idSchema.nullable().default(null),
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
  shopId: idSchema.optional(),
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

/** done = every row entered (or any, for optional/open-ended sections); pending = blanks left. */
export const openingSectionStates = ["done", "pending", "optional"] as const;

/** What a section card shows; computed on the server so the cards and the setup status agree. */
export const openingSectionSummarySchema = z.object({
  section: z.enum(openingSections),
  entered: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  state: z.enum(openingSectionStates),
  /** `total`, or `owesUs` / `weOwe` for the staff section. */
  amounts: z.array(
    z.object({ key: z.enum(["total", "owesUs", "weOwe"]), value: decimalStringSchema }),
  ),
});

export type OpeningSectionSummary = z.infer<typeof openingSectionSummarySchema>;

export const openingSchema = z.object({
  companyId: idSchema,
  /** Optimistic concurrency: every save increments it; writes must send the version they read. */
  version: z.number().int().nonnegative(),
  /** Go-live date: balances are as at the start of this business date. */
  cutoffDate: businessDateSchema.nullable(),
  stock: z.array(openingStockLineSchema),
  balances: z.array(openingBalanceLineSchema),
  issues: z.array(openingIssueSchema),
  totals: openingTotalsSchema,
  sections: z.array(openingSectionSummarySchema),
  /** True once any month is closed: the opening can no longer change (D43). */
  locked: z.boolean(),
  /** The go-live date can change only while no daily record exists and the opening is unlocked. */
  cutoffEditable: z.boolean(),
});

export type Opening = z.infer<typeof openingSchema>;

export const openingCutoffRequestSchema = z.object({
  version: z.number().int().nonnegative(),
  cutoffDate: businessDateSchema,
});

export type OpeningCutoffRequest = z.infer<typeof openingCutoffRequestSchema>;

const stockSaveLine = openingStockLineSchema.pick({
  productId: true,
  pieces: true,
  unitCost: true,
  salePrice: true,
  orderPrice: true,
  dueFromCompany: true,
  note: true,
});

/**
 * Saves one section and nothing else: the stock lines, or the balance lines whose kind belongs to
 * that section (`openingSectionKinds`).
 */
export const openingSectionSaveRequestSchema = z
  .discriminatedUnion("section", [
    z.object({
      section: z.literal("stock"),
      version: z.number().int().nonnegative(),
      stock: z.array(stockSaveLine),
    }),
    z.object({
      section: z.enum(openingBalanceSections),
      version: z.number().int().nonnegative(),
      balances: z.array(openingBalanceLineSchema),
    }),
  ])
  .superRefine((request, ctx) => {
    if (request.section === "stock") return;
    const allowed: readonly OpeningBalanceKind[] = openingSectionKinds[request.section];
    request.balances.forEach((line, index) => {
      if (!allowed.includes(line.kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["balances", index, "kind"],
          message: "validation.opening.wrongSection",
        });
      }
    });
  });

export type OpeningSectionSaveRequest = z.infer<typeof openingSectionSaveRequestSchema>;
