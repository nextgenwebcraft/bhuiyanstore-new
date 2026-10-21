import { z } from "zod";
import { priceKinds, unitPriceSchema } from "./catalog";
import type { PermissionId } from "./definitions/permissions";
import {
  amountSchema,
  amountStringSchema,
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  positiveAmountStringSchema,
  wholePiecesSchema,
} from "./primitives";

/**
 * Daily entry (PLAN §2.2, §5, §9 Phase E). Users enter only raw facts; every calculated figure
 * comes from the month engine. Posted documents are immutable: a correction reverses the posted
 * document and enters a new one.
 */

/** Whole pieces > 0. */
export const positivePiecesSchema = z
  .string()
  .regex(/^[1-9]\d*$/, { message: "validation.quantityPositive" });

/** Taka > 0 with at most 2 decimals; the entry type decides the direction (D27). */
export const positiveAmountSchema = positiveAmountStringSchema("validation.amountPositive");

export const documentStatuses = ["posted", "reversed"] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

// ---------------------------------------------------------------- godown (stock entries)

/** Excel `C` Due Quantity (order), `G` Receive (receipt) and `N` DAMAGE PRODUCT (damage). */
/** `incentive`: free goods from the company (D16), stock without a bill or payable. */
/** `damageDeposit` (D63): damaged pieces returned to the company as money at a rate per piece. */
export const stockEntryKinds = [
  "order",
  "receipt",
  "damage",
  "incentive",
  "damageDeposit",
] as const;
export type StockEntryKind = (typeof stockEntryKinds)[number];

/** D63: the company balance parts an order may be paid from first (damage before incentive). */
export const orderFunds = ["damage", "incentive"] as const;
export type OrderFund = (typeof orderFunds)[number];

export const stockEntrySchema = z.object({
  id: idSchema,
  date: businessDateSchema,
  kind: z.enum(stockEntryKinds),
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  /** Paid pieces; 0 only for a free-only order (D57). */
  pieces: wholePiecesSchema,
  /** D57, orders only: free pieces, taka per carton and the carton size at posting. */
  freePieces: wholePiecesSchema.nullable(),
  cartonRate: decimalStringSchema.nullable(),
  piecesPerCarton: z.number().int().positive().nullable(),
  /** D63, damage deposits only: taka per piece. */
  unitPrice: decimalStringSchema.nullable(),
  /** D63, orders only: the balance parts named to pay it, and the group posted together. */
  fundFrom: z.array(z.enum(orderFunds)),
  orderGroup: z.string().nullable(),
  /** D68: the batch of an order (its paid and free pieces) or of a receipt. */
  batchId: idSchema.nullable(),
  batchSeq: z.number().int().positive().nullable(),
  /** D68: per-piece prices (an order's batch prices, a receipt's own); cost null without cost view. */
  costPrice: decimalStringSchema.nullable(),
  salePrice: decimalStringSchema.nullable(),
  status: z.enum(documentStatuses),
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

export type StockEntry = z.infer<typeof stockEntrySchema>;

/**
 * One godown line. An `order` (D57, D68) carries paid pieces, optional free pieces, the purchase
 * taka per carton (required with paid pieces; without it a free-only order takes the latest
 * batch's purchase price) and the sale price per piece; paid pieces may be 0 only with free
 * pieces, which go into the same batch. A `receipt` (D68) names the batch it receives into and may change the
 * batch's per-piece prices. A damage deposit (D63) carries whole pieces > 0 and the taka per
 * piece. Other kinds carry whole pieces > 0 and nothing else.
 */
export const stockEntryLineRequestSchema = z
  .object({
    kind: z.enum(stockEntryKinds),
    productId: idSchema,
    pieces: wholePiecesSchema,
    freePieces: wholePiecesSchema.optional(),
    cartonRate: amountSchema.optional(),
    unitPrice: unitPriceSchema.optional(),
    batchId: idSchema.optional(),
    costPrice: unitPriceSchema.optional(),
    salePrice: unitPriceSchema.optional(),
  })
  .superRefine((line, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const paid = line.pieces !== "0";
    if (line.kind === "damageDeposit") {
      if (line.unitPrice === undefined) issue("unitPrice", "validation.daily.rateRequired");
    } else if (line.unitPrice !== undefined) {
      issue("unitPrice", "validation.daily.orderOnly");
    }
    if (line.kind === "receipt") {
      if (line.batchId === undefined) issue("batchId", "validation.daily.batchRequired");
    } else {
      if (line.batchId !== undefined) issue("batchId", "validation.daily.orderOnly");
      if (line.costPrice !== undefined) issue("costPrice", "validation.daily.orderOnly");
    }
    if (line.kind !== "order") {
      if (!paid) issue("pieces", "validation.quantityPositive");
      if (line.freePieces !== undefined) issue("freePieces", "validation.daily.orderOnly");
      if (line.cartonRate !== undefined) issue("cartonRate", "validation.daily.orderOnly");
      if (line.kind !== "receipt" && line.salePrice !== undefined) {
        issue("salePrice", "validation.daily.orderOnly");
      }
      return;
    }
    const free = line.freePieces !== undefined && line.freePieces !== "0";
    if (!paid && !free) issue("pieces", "validation.quantityPositive");
    if (paid && line.cartonRate === undefined) issue("cartonRate", "validation.daily.rateRequired");
    if (line.salePrice === undefined) issue("salePrice", "validation.daily.salePriceRequired");
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
    /** D63: the balance parts that pay this request's orders first. */
    fundFrom: z.array(z.enum(orderFunds)).max(2).default([]),
  })
  .refine((v) => v.lines.length + v.prices.length > 0, {
    message: "validation.daily.empty",
    path: ["lines"],
  })
  .refine((v) => v.fundFrom.length === 0 || v.lines.some((l) => l.kind === "order"), {
    message: "validation.daily.orderOnly",
    path: ["fundFrom"],
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
  /** Taka given to shops on this line (D41); lowers its sales. */
  commission: amountSchema.default("0"),
  /**
   * D68: the batch the pieces come from (a batch id, `auto:<n>`, or '' for oldest first). One
   * line per product and batch. The prices default to the batch's; a changed price becomes the
   * batch's from then on. The purchase price needs cost view.
   */
  batchKey: z.string().max(64).default(""),
  costPrice: unitPriceSchema.optional(),
  salePrice: unitPriceSchema.optional(),
});

export const dsrDaySaveRequestSchema = z.object({
  date: businessDateSchema,
  staffId: idSchema,
  /** 0 creates the sheet; otherwise the version the user edited. */
  version: z.number().int().nonnegative(),
  /**
   * DSR-level বাকি from before shop entries (D35). Omitted = keep the stored value; new due is
   * entered per shop as money entries instead.
   */
  marketDueNew: amountSchema.optional(),
  marketDueCollected: amountSchema.optional(),
  /**
   * Cash the DSR handed over at day end (D39). Posting the sheet settles the difference to what
   * was expected as a staff shortage or excess (D54).
   */
  cashHandedOver: amountSchema.nullable().optional(),
  lines: z.array(dsrLineRequestSchema).max(500),
});

export type DsrDaySaveRequest = z.input<typeof dsrDaySaveRequestSchema>;

export const dsrLineSchema = dsrLineRequestSchema.extend({
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  batchKey: z.string(),
  batchSeq: z.number().int().nonnegative().nullable(),
  /** Null without cost view, or for a line without a batch. */
  costPrice: decimalStringSchema.nullable(),
  salePrice: decimalStringSchema.nullable(),
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
  cashHandedOver: decimalStringSchema.nullable(),
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
  "staffAbsent",
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
  "cashTransfer",
] as const;

export type MoneyEntryKind = (typeof moneyEntryKinds)[number];

/** D42: an SR loan is a direct cash loan or a product commission advance; repayments name one. */
export const srLoanTypes = ["cash", "commission"] as const;
export type SrLoanType = (typeof srLoanTypes)[number];
export const srLoanTypeKinds: readonly MoneyEntryKind[] = ["srLoan", "srRepayment"];

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
  staffAbsent: "distributor",
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
  staffAbsent: "payment.post",
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
  cashTransfer: "payment.post",
};

/**
 * Kinds that name a cash or bank account on entry (D52): every kind that moves cash, a supplier
 * deposit and a transfer. Asserted equal to the engine's list in `application/src/kinds.test.ts`.
 */
export const moneyAccountKinds: readonly MoneyEntryKind[] = [
  "marketDueNew",
  "marketDueCollected",
  "srIncentive",
  "expense",
  "staffAdvance",
  "staffLoan",
  "staffShortage",
  "staffRepayment",
  "staffExcess",
  "staffCreditPaid",
  "salaryPaid",
  "srLoan",
  "srRepayment",
  "srPayment",
  "supplierDeposit",
  "cashTransfer",
];

/** Kinds that need an expense category. */
export const moneyCategoryKinds: readonly MoneyEntryKind[] = ["expense", "staffCostPaid"];

/** Kinds that reduce what a person owes and may name the parts (default advance → loan → shortage). */
export const moneyAllocationKinds: readonly MoneyEntryKind[] = [
  "staffRepayment",
  "staffOffset",
  "salaryRecovery",
];

const allocationPart = amountStringSchema("validation.opening.amount");

/** Parts of a repayment, offset or recovery; together they equal the amount. */
export const owedAllocationSchema = z.object({
  advance: allocationPart.default("0"),
  loan: allocationPart.default("0"),
  shortage: allocationPart.default("0"),
});

export type OwedAllocation = z.infer<typeof owedAllocationSchema>;

/** D50: kinds that may create their shop in the same request (the market due kinds). */
export const newShopKinds: readonly MoneyEntryKind[] = ["marketDueNew", "marketDueCollected"];

export const newShopSchema = z.object({ name: z.string().trim().min(1).max(120) });

export const moneyEntryPostRequestSchema = z
  .object({
    date: businessDateSchema,
    kind: z.enum(moneyEntryKinds),
    amount: positiveAmountSchema,
    staffId: idSchema.nullable().default(null),
    /** Required for market due kinds (D35): the shop the due is given to or collected from. */
    shopId: idSchema.nullable().default(null),
    expenseCategoryId: idSchema.nullable().default(null),
    allocation: owedAllocationSchema.nullable().default(null),
    /** Required for SR loans and repayments (D42); null for every other kind. */
    srLoanType: z.enum(srLoanTypes).nullable().default(null),
    /**
     * D50: a shop typed on the due page that is not in the list. Created (or, when the exact
     * name exists, reused) in the same atomic request; mutually exclusive with `shopId`.
     */
    newShop: newShopSchema.nullable().default(null),
    /**
     * D52: the account the money moves, only for `moneyAccountKinds`. Omitted = the company's
     * default account (the first bank account for a supplier deposit, if any). A transfer names
     * both accounts.
     */
    cashAccountId: idSchema.nullable().default(null),
    /** The receiving account of a `cashTransfer`. */
    toCashAccountId: idSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.newShop !== null) {
      if (value.shopId !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["newShop"],
          message: "validation.shop.newShopExclusive",
        });
      } else if (!newShopKinds.includes(value.kind)) {
        ctx.addIssue({ code: "custom", path: ["newShop"], message: "validation.shop.notForKind" });
      }
    }
    const transfer = value.kind === "cashTransfer";
    if (value.cashAccountId !== null && !moneyAccountKinds.includes(value.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["cashAccountId"],
        message: "validation.money.noAccountForKind",
      });
    }
    if (transfer) {
      if (value.cashAccountId === null) {
        ctx.addIssue({
          code: "custom",
          path: ["cashAccountId"],
          message: "validation.money.accountRequired",
        });
      }
      if (value.toCashAccountId === null) {
        ctx.addIssue({
          code: "custom",
          path: ["toCashAccountId"],
          message: "validation.money.accountRequired",
        });
      } else if (value.toCashAccountId === value.cashAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toCashAccountId"],
          message: "validation.money.sameAccount",
        });
      }
    } else if (value.toCashAccountId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["toCashAccountId"],
        message: "validation.money.noAccountForKind",
      });
    }
  });

export type MoneyEntryPostRequest = z.input<typeof moneyEntryPostRequestSchema>;

export const moneyEntrySchema = z.object({
  id: idSchema,
  date: businessDateSchema,
  kind: z.enum(moneyEntryKinds),
  amount: decimalStringSchema,
  staffId: idSchema.nullable(),
  staffName: z.string().nullable(),
  shopId: idSchema.nullable(),
  shopName: z.string().nullable(),
  expenseCategoryId: idSchema.nullable(),
  categoryName: z.string().nullable(),
  allocation: owedAllocationSchema.nullable(),
  srLoanType: z.enum(srLoanTypes).nullable(),
  /** D52: the account the entry moved (null = the default account, resolved when read). */
  cashAccountId: idSchema.nullable(),
  cashAccountName: z.string().nullable(),
  /** The receiving account of a transfer. */
  toCashAccountId: idSchema.nullable(),
  toCashAccountName: z.string().nullable(),
  /** Set when a payroll run posted the entry; it is then reversed only with the run. */
  payrollRunId: idSchema.nullable(),
  /** Set when a posted DSR day created the entry (field visits, D40; handover difference, D54). */
  dsrDayId: idSchema.nullable(),
  status: z.enum(documentStatuses),
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

export type MoneyEntry = z.infer<typeof moneyEntrySchema>;

// ---------------------------------------------------------------- day view (PLAN §6)

const money = decimalStringSchema;
/** Cost-based values are null without `inventory.cost_view` (profit also needs `report.profit_view`). */
const costMoney = decimalStringSchema.nullable();

/**
 * One FIFO batch of a product (D49): pieces received at one cost and sale price, oldest first.
 * `costPrice` and `value` are null without `inventory.cost_view`; a zero cost is a free batch
 * (free goods, company replacement). `startDate` is a business date, or `opening` for stock
 * counted at the opening without a known date.
 */
export const batchRowSchema = z.object({
  /** D68: the batch id, or `auto:<seq>` for goods that arrived without one (free goods etc.). */
  key: z.string(),
  seq: z.number().int().positive(),
  startDate: z.string(),
  costPrice: costMoney,
  salePrice: money,
  quantity: money,
  value: costMoney,
});

export type BatchRow = z.infer<typeof batchRowSchema>;

/** The pieces of one DSR line taken from one batch, in FIFO order (D49); read-only. */
export const lineAllocationSchema = z.object({
  key: z.string(),
  seq: z.number().int().positive(),
  quantity: money,
  costPrice: costMoney,
  salePrice: money,
});

export type LineAllocation = z.infer<typeof lineAllocationSchema>;

/**
 * D68: one stored batch (order lot) of a product with its current per-piece prices and the pieces
 * still due from the company on the date. `costPrice` is null without cost view.
 */
export const productLotSchema = z.object({
  id: idSchema,
  seq: z.number().int().positive(),
  source: z.enum(["order", "opening"]),
  costPrice: costMoney,
  salePrice: money,
  undelivered: money,
});

export type ProductLot = z.infer<typeof productLotSchema>;

export const dayProductRowSchema = z.object({
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  ordered: money,
  received: money,
  /** Free goods from the company (D16): stock without a bill. */
  incentiveReceived: money,
  issued: money,
  returned: money,
  delivered: money,
  damaged: money,
  sold: money,
  orderPrice: money.nullable(),
  costPrice: costMoney,
  salePrice: money.nullable(),
  /** Shop commission (D41), already taken out of `sales`. */
  commission: money,
  sales: money,
  cost: costMoney,
  grossProfit: costMoney,
  returnValue: money,
  orderValue: money,
  /** Excess receipt billed at once (D48); ordered goods were billed with the order. */
  receiptBill: money,
  /** Billed value of the goods received that day (D48). */
  receiptValue: money,
  receiptSale: money,
  damageValue: costMoney,
  /** Damage refunds + replacement goods at unit cost (D47 memo; not profit). */
  damageRecovery: costMoney,
  /** Pieces found damaged in the godown (D53); stock and cost fall, sales do not. */
  godownDamaged: money,
  /** Damaged goods stock in the godown and damaged pieces at the company (D53). */
  damagedStock: money,
  damageAtCompany: money,
  dueFromCompany: money,
  /** Billed value of the goods not yet received (D48). */
  dueFromCompanyValue: money,
  stock: money,
  stockValue: costMoney,
  /** The batches left at the end of the day, oldest first; the newest may be 0 (D49). */
  batches: z.array(batchRowSchema),
  /**
   * D68: the product's stored batches that still matter on the date: those with goods due from
   * the company or in stock, and the latest paid one (its prices pre-fill the next order).
   */
  lots: z.array(productLotSchema),
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
  commission: money,
  amount: money,
  /** FIFO allocation of the net pieces over the product's batches (D49). */
  allocations: z.array(lineAllocationSchema),
});

export const dayMoneySchema = z.object({
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
  /**
   * The company account at the end of the date (D48): money with the company (negative = we owe
   * it) and the billed value / pieces of goods ordered and not yet received. Needs cost view.
   */
  company: z
    .object({
      balance: money,
      undeliveredValue: money,
      undeliveredPieces: money,
      /** D63: the damage and incentive parts of the balance, and the total cash and bank. */
      damageBalance: money,
      incentiveBalance: money,
      totalCash: money,
    })
    .nullable(),
  warnings: z.array(engineWarningSchema),
  canSeeCost: z.boolean(),
  canSeeProfit: z.boolean(),
});

export type DayView = z.infer<typeof dayViewSchema>;
