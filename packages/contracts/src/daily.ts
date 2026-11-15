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

/** Stock entries: TSM orders stay `pending` until Manager/Super Admin approve. */
export const stockEntryStatuses = ["pending", "posted", "reversed"] as const;
export type StockEntryStatus = (typeof stockEntryStatuses)[number];

// ---------------------------------------------------------------- godown (stock entries)

/** Excel `C` Due Quantity (order), `G` Receive (receipt) and `N` DAMAGE PRODUCT (damage). */
/** `incentive`: free goods from the company (D16), stock without a bill or payable. */
/**
 * `damageDeposit` (D63): damaged lots returned to the company as money at a rate per piece.
 * `floorDamageDeposit` (D131): saleable floor stock returned the same way, from a named batch.
 */
export const stockEntryKinds = [
  "order",
  "receipt",
  "damage",
  "incentive",
  "damageDeposit",
  "floorDamageDeposit",
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
  /** D63/D131: damage deposits — taka per piece returned to the company. */
  unitPrice: decimalStringSchema.nullable(),
  /** D63, orders only: the balance parts named to pay it, and the group posted together. */
  fundFrom: z.array(z.enum(orderFunds)),
  orderGroup: z.string().nullable(),
  /** D129: cheque that received this order's bill (null = cash / company payable). */
  companyCheckId: idSchema.nullable(),
  /** D68/D131: order/receipt batch, or the saleable batch a floor damage deposit takes from. */
  batchId: idSchema.nullable(),
  batchSeq: z.number().int().positive().nullable(),
  /** D68: per-piece prices (an order's batch prices, a receipt's own); cost null without cost view. */
  costPrice: decimalStringSchema.nullable(),
  salePrice: decimalStringSchema.nullable(),
  status: z.enum(stockEntryStatuses),
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

export type StockEntry = z.infer<typeof stockEntrySchema>;

/**
 * One godown line. An `order` (D57, D68) carries paid pieces, optional free pieces, the purchase
 * taka per carton (required with paid pieces; without it a free-only order takes the latest
 * batch's purchase price) and the sale price per piece; paid pieces may be 0 only with free
 * pieces, which go into the same batch. A `receipt` (D68, D118) names the batch it receives into,
 * may take paid and/or free pieces separately (freePieces), and may change the batch's per-piece
 * prices. A damage deposit (D63) carries whole pieces > 0 and the taka per piece. Other kinds
 * carry whole pieces > 0 and nothing else.
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
    const free = line.freePieces !== undefined && line.freePieces !== "0";
    if (line.kind === "damageDeposit" || line.kind === "floorDamageDeposit") {
      if (line.unitPrice === undefined) issue("unitPrice", "validation.damage.unitCostRequired");
    } else if (line.unitPrice !== undefined) {
      issue("unitPrice", "validation.daily.orderOnly");
    }
    if (line.kind === "receipt") {
      if (line.batchId === undefined) issue("batchId", "validation.daily.batchRequired");
      if (!paid && !free) issue("pieces", "validation.quantityPositive");
      if (line.cartonRate !== undefined) issue("cartonRate", "validation.daily.orderOnly");
      return;
    }
    if (line.kind === "floorDamageDeposit") {
      if (line.batchId === undefined) issue("batchId", "validation.daily.batchRequired");
      if (!paid) issue("pieces", "validation.quantityPositive");
      if (line.freePieces !== undefined) issue("freePieces", "validation.daily.orderOnly");
      if (line.cartonRate !== undefined) issue("cartonRate", "validation.daily.orderOnly");
      if (line.costPrice !== undefined) issue("costPrice", "validation.daily.orderOnly");
      if (line.salePrice !== undefined) issue("salePrice", "validation.daily.orderOnly");
      return;
    }
    if (line.batchId !== undefined) issue("batchId", "validation.daily.orderOnly");
    if (line.costPrice !== undefined) issue("costPrice", "validation.daily.orderOnly");
    if (line.kind !== "order") {
      if (!paid) issue("pieces", "validation.quantityPositive");
      if (line.freePieces !== undefined) issue("freePieces", "validation.daily.orderOnly");
      if (line.cartonRate !== undefined) issue("cartonRate", "validation.daily.orderOnly");
      if (line.salePrice !== undefined) issue("salePrice", "validation.daily.orderOnly");
      return;
    }
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

export const orderPaymentMethods = ["cash", "check"] as const;
export type OrderPaymentMethod = (typeof orderPaymentMethods)[number];

export const stockEntryPostRequestSchema = z
  .object({
    date: businessDateSchema,
    lines: z.array(stockEntryLineRequestSchema).max(500).default([]),
    prices: z.array(dayPriceRequestSchema).max(1500).default([]),
    /** D63: the balance parts that pay this request's orders first. */
    fundFrom: z.array(z.enum(orderFunds)).max(2).default([]),
    /** D129: cash → companyPayable; check → charge the named cheque. Default cash. */
    paymentMethod: z.enum(orderPaymentMethods).default("cash"),
    companyCheckId: idSchema.optional(),
  })
  .refine((v) => v.lines.length + v.prices.length > 0, {
    message: "validation.daily.empty",
    path: ["lines"],
  })
  .refine((v) => v.fundFrom.length === 0 || v.lines.some((l) => l.kind === "order"), {
    message: "validation.daily.orderOnly",
    path: ["fundFrom"],
  })
  .superRefine((v, ctx) => {
    const hasOrder = v.lines.some((l) => l.kind === "order");
    if (!hasOrder) return;
    if (v.paymentMethod === "check" && !v.companyCheckId) {
      ctx.addIssue({
        code: "custom",
        path: ["companyCheckId"],
        message: "validation.companyCheck.required",
      });
    }
    if (v.paymentMethod === "cash" && v.companyCheckId) {
      ctx.addIssue({
        code: "custom",
        path: ["companyCheckId"],
        message: "validation.companyCheck.cashOnly",
      });
    }
  });

export type StockEntryPostRequest = z.input<typeof stockEntryPostRequestSchema>;

/**
 * D130: Super Admin corrects payment on a posted order group (নগদ ↔ চেক) without reversing
 * stock. Pass any line id from the group; all posted order lines that share its orderGroup update.
 */
export const orderPaymentCorrectRequestSchema = z
  .object({
    paymentMethod: z.enum(orderPaymentMethods),
    companyCheckId: idSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMethod === "check" && !v.companyCheckId) {
      ctx.addIssue({
        code: "custom",
        path: ["companyCheckId"],
        message: "validation.companyCheck.required",
      });
    }
    if (v.paymentMethod === "cash" && v.companyCheckId) {
      ctx.addIssue({
        code: "custom",
        path: ["companyCheckId"],
        message: "validation.companyCheck.cashOnly",
      });
    }
  });

export type OrderPaymentCorrectRequest = z.input<typeof orderPaymentCorrectRequestSchema>;

// ---------------------------------------------------------------- DSR day sheet (D03)

export const dsrDayStatuses = ["draft", "posted", "reversed"] as const;
export type DsrDayStatus = (typeof dsrDayStatuses)[number];

export const dsrLineRequestSchema = z.object({
  productId: idSchema,
  /**
   * D122: the selling DSR for this line. The parent day stays the SR sheet; engine attribution
   * and dashboard byDsr use this id.
   */
  dsrStaffId: idSchema,
  /** Samari: pieces issued (cartons × carton size + loose pieces). */
  issued: wholePiecesSchema,
  /** Firot: unsold pieces returned. */
  returned: wholePiecesSchema,
  damaged: wholePiecesSchema,
  /** Taka given to shops on this line (D41); lowers its sales. */
  commission: amountSchema.default("0"),
  /**
   * D68: the batch the pieces come from (a batch id, `auto:<n>`, or '' for oldest first). One
   * line per DSR, product and batch. The prices default to the batch's; a changed price becomes
   * the batch's from then on. The purchase price needs cost view.
   */
  batchKey: z.string().max(64).default(""),
  costPrice: unitPriceSchema.optional(),
  salePrice: unitPriceSchema.optional(),
  /**
   * D109: taka per damaged piece. Omitted with no damage, or when it should stay the line's sale
   * price. It does not change the batch.
   */
  damageRate: unitPriceSchema.optional(),
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

/** D112: Manager submits posted sheet's day-end cash; locks further Manager edits. */
export const dsrHandoverSubmitRequestSchema = z.object({
  version: z.number().int().positive(),
  cashHandedOver: amountSchema,
});

export type DsrHandoverSubmitRequest = z.infer<typeof dsrHandoverSubmitRequestSchema>;

/** D112: Super Admin accepts the submitted handover amount. */
export const dsrHandoverApproveRequestSchema = z.object({
  version: z.number().int().positive(),
});

export type DsrHandoverApproveRequest = z.infer<typeof dsrHandoverApproveRequestSchema>;

export const dsrLineSchema = dsrLineRequestSchema.extend({
  dsrStaffName: z.string(),
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  batchKey: z.string(),
  batchSeq: z.number().int().nonnegative().nullable(),
  /** Null without cost view, or for a line without a batch. */
  costPrice: decimalStringSchema.nullable(),
  salePrice: decimalStringSchema.nullable(),
  /** D109: null when the line has no damage, or damage stored before a rate was entered. */
  damageRate: decimalStringSchema.nullable(),
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
  /** D112: Manager submit → pending → Super Admin approve. */
  handoverStatus: z.enum(["none", "pending", "approved"]).default("none"),
  lines: z.array(dsrLineSchema),
  postedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
  /** D71: firot and damage the DSR sent after posting, waiting for the office's approval. */
  fieldReport: z
    .object({
      id: idSchema,
      version: z.number().int().positive(),
      createdAt: z.string(),
      lines: z.array(
        z.object({
          productId: idSchema,
          productName: z.string(),
          returned: decimalStringSchema,
          damaged: decimalStringSchema,
        }),
      ),
    })
    .nullable()
    .optional(),
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
  "rebateClaim",
  "companyCheckPayment",
] as const;

export type MoneyEntryKind = (typeof moneyEntryKinds)[number];

/**
 * D42: an SR loan is a direct cash loan or a product commission advance; repayments name one.
 * D79: `shortage` is a third label on that same balance. It does not split the figure.
 */
export const srLoanTypes = ["cash", "commission", "shortage"] as const;
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
  rebateClaim: "payment.post",
  companyCheckPayment: "payment.post",
};

/** Kinds that need an expense category. */
export const moneyCategoryKinds: readonly MoneyEntryKind[] = ["expense", "staffCostPaid"];

/** D105: kinds that may name the product they are for (the company statement shows it). */
export const moneyProductKinds: readonly MoneyEntryKind[] = ["companyIncentive", "rebateClaim"];

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
    /** D105: optional, only meaningful for `moneyProductKinds`. */
    productId: idSchema.nullable().default(null),
    allocation: owedAllocationSchema.nullable().default(null),
    /** Required for SR loans and repayments (D42); null for every other kind. */
    srLoanType: z.enum(srLoanTypes).nullable().default(null),
    /**
     * D50: a shop typed on the due page that is not in the list. Created (or, when the exact
     * name exists, reused) in the same atomic request; mutually exclusive with `shopId`.
     */
    newShop: newShopSchema.nullable().default(null),
    /**
     * The SR whose daily sheet the entry is entered on (shop due, staff/SR cash, operating cost).
     * Scopes that sheet's cash check; null for entries made anywhere else.
     */
    sheetStaffId: idSchema.nullable().default(null),
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
  /** D105: the product a companyIncentive/rebateClaim is tagged to; null for every other kind. */
  productId: idSchema.nullable(),
  productName: z.string().nullable(),
  allocation: owedAllocationSchema.nullable(),
  srLoanType: z.enum(srLoanTypes).nullable(),
  /** Set when a payroll run posted the entry; it is then reversed only with the run. */
  payrollRunId: idSchema.nullable(),
  /** Set when a posted DSR day created the entry (field visits, D40; handover difference, D54). */
  dsrDayId: idSchema.nullable(),
  /** The SR sheet the entry was entered on; null when it was not entered on a daily sheet. */
  sheetStaffId: idSchema.nullable(),
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
 * `costPrice` and `value` are null without `inventory.cost_view`; an automatic batch at zero
 * cost holds free goods that arrived before any named batch (D68). `startDate` is a business date, or `opening` for stock
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
 * D68 / D118: one stored batch (order lot) of a product with its current per-piece prices and the
 * pieces still due from the company on the date (`undelivered` = paid + free). `costPrice` is null
 * without cost view.
 */
export const productLotSchema = z.object({
  id: idSchema,
  seq: z.number().int().positive(),
  source: z.enum(["order", "opening"]),
  costPrice: costMoney,
  salePrice: money,
  undelivered: money,
  /** Paid pieces still due on this batch (D118). */
  undeliveredPaid: money,
  /** Free pieces still due on this batch (D118). */
  undeliveredFree: money,
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
  /** D109: pieces of this product still held, one row per stored rate. */
  damageLots: z.array(
    z.object({
      rate: decimalStringSchema,
      pieces: decimalStringSchema,
    }),
  ),
  dueFromCompany: money,
  /** Billed value of the goods not yet received (D48). */
  dueFromCompanyValue: money,
  stock: money,
  stockValue: costMoney,
  /** The batches left at the end of the day, oldest first; the newest may be 0 (D49). */
  batches: z.array(batchRowSchema),
  /**
   * D68: the product's stored batches that still matter on the date: those with goods due from
   * the company or in stock, and the latest one (its prices pre-fill the next order).
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
  /** D119: claim rate for damaged pieces when present. */
  damageRate: decimalStringSchema.nullable().optional(),
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
   * Handover below the expected cash (D81). Shown only: not a money entry, and no balance moves.
   */
  handoverShorts: z
    .array(
      z.object({
        staffId: idSchema,
        staffName: z.string(),
        date: businessDateSchema,
        amount: money,
      }),
    )
    .default([]),
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
