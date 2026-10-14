import type { DecimalInput } from "../decimal";

/** Inputs and results of the month engine (PLAN §2, §4). Quantities are pieces; money is BDT. */

export type ProductId = string;
export type StaffId = string;
export type ShopId = string;

export type PriceKind = "orderPrice" | "costPrice" | "salePrice";

export type CatalogProduct = {
  id: ProductId;
  /** Carton size snapshot for the month, used only for carton reports (PLAN §2.5). */
  piecesPerCarton: DecimalInput;
};

export type OpeningProduct = {
  stock: DecimalInput;
  /** Goods ordered from the company and not yet received (Excel "Balance Quantity"). */
  dueFromCompany: DecimalInput;
  /**
   * Billed value of the undelivered goods (D48). Defaults to `dueFromCompany` × `orderPrice`.
   * The opening company payable already includes it (it is the balance after that billing).
   */
  dueFromCompanyValue?: DecimalInput;
  /** The previous month's last prices; day 1 carries them forward until changed. */
  orderPrice?: DecimalInput;
  costPrice?: DecimalInput;
  salePrice?: DecimalInput;
};

/** One person's money balances by type (D27, guide §11.9). Never one signed figure. */
export type StaffBalances = {
  advance?: DecimalInput;
  loan?: DecimalInput;
  shortage?: DecimalInput;
  /** We owe the person: excess handed in or business cost paid personally. */
  credit?: DecimalInput;
  salaryPayable?: DecimalInput;
  srLoan?: DecimalInput;
  owedToSr?: DecimalInput;
};

export type MonthOpening = {
  products: Readonly<Record<ProductId, OpeningProduct>>;
  /** Market due (বাজারের বকেয়া) by DSR; the key `""` holds due not attributed to a DSR. */
  marketDue?: Readonly<Record<StaffId, DecimalInput>>;
  /** The same market due by shop, for due entered against a shop (D35); a subset of `marketDue`. */
  shopDue?: Readonly<Record<ShopId, DecimalInput>>;
  staff?: Readonly<Record<StaffId, StaffBalances>>;
  /**
   * Positive = we owe the company; negative = money deposited with it. The balance after the
   * undelivered opening goods were billed (D48).
   */
  companyPayable?: DecimalInput;
};

export type ProductDayInput = {
  ordered?: DecimalInput;
  received?: DecimalInput;
  /** Damage recorded at product level (Excel column N); DSR lines may add their own. */
  damaged?: DecimalInput;
  /**
   * Good pieces handed to buyers straight from the godown for their damaged ones (D17). They
   * leave stock and count in the damage value; unlike `damaged` they were never issued, so sold
   * pieces and sales are unchanged.
   */
  replacedFromStock?: DecimalInput;
  /**
   * Company replacements for damaged goods, accepted into saleable stock (D17). No bill, no due
   * from company and no payable; quantity × reviewed unit cost is the replacement recovery.
   */
  replacements?: readonly { quantity: DecimalInput; unitCost: DecimalInput }[];
  /**
   * Free goods the company gave as an incentive (D16): saleable stock with no bill, no due from
   * company and no payable. Shown on the company ledger as a memo without an amount.
   */
  incentiveReceived?: DecimalInput;
  /**
   * Money the company returned for damaged goods sent to it (D33). Quantity × price per piece
   * lowers what we owe the company and is damage recovery income in net profit (D47); stock and
   * gross profit are unchanged.
   */
  companyRefunds?: readonly { quantity: DecimalInput; unitCost: DecimalInput; ref?: string }[];
  /** A price present here changes it from this day on (carry-forward). */
  orderPrice?: DecimalInput;
  costPrice?: DecimalInput;
  salePrice?: DecimalInput;
};

/** Pieces sold at a price other than the day's sale price (D06). */
export type PriceSplitInput = { quantity: DecimalInput; unitPrice: DecimalInput };

export type DsrLineInput = {
  staffId: StaffId;
  productId: ProductId;
  /** Samari: pieces issued (cartons × carton size + loose pieces, converted before input). */
  issued?: DecimalInput;
  /** Firot: unsold pieces returned. */
  returned?: DecimalInput;
  damaged?: DecimalInput;
  priceSplits?: readonly PriceSplitInput[];
  /** Taka given to shops on this line (D41); lowers its sales, cash and profit. */
  commission?: DecimalInput;
};

export type MoneyKind =
  | "marketDueNew"
  | "marketDueCollected"
  | "srIncentive"
  | "expense"
  | "staffAdvance"
  | "staffLoan"
  | "staffShortage"
  | "staffRepayment"
  | "staffExcess"
  | "staffCostPaid"
  | "staffCreditPaid"
  | "salaryAccrual"
  | "salaryRecovery"
  | "salaryPaid"
  | "srLoan"
  | "srRepayment"
  | "srOwed"
  | "srPayment"
  | "staffOffset"
  | "srOffset"
  | "supplierDeposit"
  | "companyIncentive";

/** The owed buckets in recovery/allocation order: advance, then loan, then shortage. */
export const owedBuckets = ["advance", "loan", "shortage"] as const;
export type OwedBucket = (typeof owedBuckets)[number];

export type MoneyEntryInput = {
  kind: MoneyKind;
  /** Always positive; the kind decides the direction (D27). */
  amount: DecimalInput;
  staffId?: StaffId;
  /** The shop of a market due entry (D35); it still counts under its DSR as well. */
  shopId?: ShopId;
  /** Expense category for `expense` and `staffCostPaid`. */
  category?: string;
  /** Explicit allocation for repayments and salary recovery; default advance → loan → shortage. */
  allocation?: Partial<Record<OwedBucket, DecimalInput>>;
  /** Caller's reference (e.g. the posted entry's id), echoed on staff ledger lines. */
  ref?: string;
};

export type DayInput = {
  /** Business date `YYYY-MM-DD`; days must be in ascending order. */
  date: string;
  products?: Readonly<Record<ProductId, ProductDayInput>>;
  dsrLines?: readonly DsrLineInput[];
  money?: readonly MoneyEntryInput[];
};

export type MonthInput = {
  products: readonly CatalogProduct[];
  opening: MonthOpening;
  days: readonly DayInput[];
};

export type WarningCode =
  | "NEGATIVE_STOCK"
  | "MISSING_PRICE"
  | "NEGATIVE_MARKET_DUE"
  | "REPAYMENT_EXCEEDS_DUE"
  | "NEGATIVE_BALANCE";

export type EngineWarning = {
  code: WarningCode;
  date: string;
  productId?: ProductId;
  staffId?: StaffId;
  detail?: string;
};

export type ProductDayResult = {
  productId: ProductId;
  ordered: string;
  received: string;
  issued: string;
  returned: string;
  delivered: string;
  damaged: string;
  sold: string;
  orderPrice: string | null;
  costPrice: string | null;
  salePrice: string | null;
  /** Shop commission on the day's DSR lines (D41); already taken out of `sales`. */
  commission: string;
  sales: string;
  cost: string;
  grossProfit: string;
  returnValue: string;
  orderValue: string;
  /** Excess receipt billed at once (D48): pieces received beyond what was ordered. */
  receiptBill: string;
  /** Billed value of the goods received: released undelivered value + `receiptBill`. */
  receiptValue: string;
  receiptSale: string;
  damageValue: string;
  /** Damage money refund + company replacement goods at unit cost (D47). */
  damageRecovery: string;
  replacedFromStock: string;
  replacementReceived: string;
  incentiveReceived: string;
  dueFromCompany: string;
  /** Billed value of the goods not yet received (D48). */
  dueFromCompanyValue: string;
  stock: string;
  stockValue: string;
};

export type PersonDayResult = {
  staffId: StaffId;
  productId: ProductId;
  issued: string;
  returned: string;
  net: string;
  damaged: string;
  /** Excel's person amount: net × sale price (+ split adjustment − commission); damaged included. */
  amount: string;
  /** issued − returned − damaged. */
  sold: string;
  commission: string;
  /** sold × sale price (+ split adjustment − commission): what the DSR sold for cash or due. */
  soldValue: string;
};

/** One DSR's money for a day (D39 cash check): sales, dues and costs paid from that cash. */
export type DsrDayMoneyResult = {
  staffId: StaffId;
  sales: string;
  marketDueNew: string;
  marketDueCollected: string;
  /** `staffCostPaid` entries: business costs the DSR paid personally. */
  costPaid: string;
};

export type DayMoneyResult = {
  /** Net of shop commission (D41). */
  sales: string;
  commission: string;
  marketDueNew: string;
  marketDueCollected: string;
  srIncentive: string;
  expenses: string;
  cashIn: string;
  cashOut: string;
  /** হাতে অবশিষ্ট টাকা: sales + cash in − cash out (PLAN §2.4). */
  cashLeft: string;
  banked: string;
};

export type DayResult = {
  date: string;
  products: ProductDayResult[];
  persons: PersonDayResult[];
  /** Per DSR with sheet lines or DSR-level money that day. */
  dsrs: DsrDayMoneyResult[];
  money: DayMoneyResult;
};

export type ProductMonthResult = {
  productId: ProductId;
  ordered: string;
  received: string;
  issued: string;
  returned: string;
  delivered: string;
  damaged: string;
  sold: string;
  orderTotal: string;
  receiptTotal: string;
  receiptSaleTotal: string;
  commissionTotal: string;
  salesTotal: string;
  costTotal: string;
  profitTotal: string;
  returnValue: string;
  damageValue: string;
  damageRecovery: string;
  replacedFromStock: string;
  replacementReceived: string;
  replacementValue: string;
  incentiveReceived: string;
  salesCartons: string;
  closingStock: string;
  closingValue: string;
  closingAtSale: string;
  closingCartons: string;
  dueFromCompany: string;
  dueFromCompanyValue: string;
};

export type PersonMonthResult = {
  staffId: StaffId;
  products: { productId: ProductId; net: string; cartons: string; amount: string }[];
  amount: string;
};

export type StaffMonthResult = {
  staffId: StaffId;
  opening: StaffBalanceValues;
  closing: StaffBalanceValues;
  /** আমাদের পাওনা = advance + loan + shortage + SR loan. */
  owesUs: string;
  /** আমরা দেব = credit + salary payable + owed to SR. */
  weOwe: string;
};

export type MonthResult = {
  products: ProductMonthResult[];
  totals: {
    orderTotal: string;
    receiptTotal: string;
    commissionTotal: string;
    salesTotal: string;
    costTotal: string;
    profitTotal: string;
    damageValue: string;
    damageRecovery: string;
    replacementValue: string;
    closingValue: string;
  };
  persons: PersonMonthResult[];
  marketDue: {
    opening: string;
    added: string;
    collected: string;
    closing: string;
    byDsr: {
      staffId: StaffId;
      opening: string;
      added: string;
      collected: string;
      closing: string;
    }[];
    byShop: {
      shopId: ShopId;
      opening: string;
      added: string;
      collected: string;
      closing: string;
    }[];
  };
  staff: StaffMonthResult[];
  companyPayable: {
    opening: string;
    /** Σ order bills (D48): an order is billed on its day. */
    orders: string;
    /** Σ excess receipt bills: goods received beyond what was ordered. */
    receipts: string;
    deposits: string;
    incentives: string;
    damageRefunds: string;
    closing: string;
    /** Billed value of goods ordered and not yet received, at the start and end of the range. */
    undeliveredOpening: string;
    undeliveredClosing: string;
  };
  profit: {
    gross: string;
    /** Damage refunds + replacement goods (D47): income added to net profit. */
    damageRecovery: string;
    salaries: string;
    expenses: string;
    expensesByCategory: Record<string, string>;
    srIncentive: string;
    /** gross − salaries − expenses + damage recovery − SR incentive (D20, D47). */
    net: string;
    /** Net before the SR incentive (Excel's monthly profit, PLAN §2.5), with damage recovery. */
    netWithoutIncentive: string;
  };
  cashLeftTotal: string;
};

export type StaffBalanceValues = Required<Record<keyof StaffBalances, string>>;

/** Next month's opening; assignable to `MonthOpening`. */
export type MonthClosing = {
  products: Record<
    ProductId,
    { stock: string; dueFromCompany: string; dueFromCompanyValue: string } & Partial<
      Record<PriceKind, string>
    >
  >;
  marketDue: Record<StaffId, string>;
  shopDue: Record<ShopId, string>;
  staff: Record<StaffId, StaffBalanceValues>;
  companyPayable: string;
};

/** One market due entry against a shop, in posting order, with the shop's due after it. */
export type ShopEntryResult = {
  date: string;
  ref?: string;
  shopId: ShopId;
  staffId?: StaffId;
  kind: "marketDueNew" | "marketDueCollected";
  amount: string;
  balance: string;
};

/** One money entry's effect on a person's account (D27 statement line), in posting order. */
export type StaffEntryResult = {
  date: string;
  ref?: string;
  staffId: StaffId;
  kind: MoneyKind;
  amount: string;
  /** Signed change per balance made by this entry. */
  change: StaffBalanceValues;
  /** Balances after this entry. */
  balances: StaffBalanceValues;
};

export type CompanyEntryKind =
  "order" | "receipt" | "deposit" | "incentive" | "damageRefund" | "freeGoods" | "replacement";

/**
 * One movement of what we owe the company, in posting order (D48): an order bill and the bill of
 * goods received beyond the order (`receipt`, amount may be 0) raise it; a deposit, a cash
 * incentive or a damage money return lower it. `freeGoods` (amount 0) and `replacement` (amount
 * = quantity × unit cost) are memos that do not move the balance.
 */
export type CompanyEntryResult = {
  date: string;
  kind: CompanyEntryKind;
  amount: string;
  ref?: string;
  /** The product of an order, receipt, damage money return, free goods or replacement. */
  productId?: ProductId;
  /** Pieces ordered, received, given free or replaced. */
  quantity?: string;
  /** What we owe the company after this entry (negative = money deposited with it). */
  balance: string;
  /** Billed value of goods ordered and not yet received, after this entry. */
  undelivered: string;
};

export type MonthOutput = {
  days: DayResult[];
  month: MonthResult;
  closing: MonthClosing;
  staffEntries: StaffEntryResult[];
  companyEntries: CompanyEntryResult[];
  shopEntries: ShopEntryResult[];
  warnings: EngineWarning[];
};
