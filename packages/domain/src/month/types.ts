import type { DecimalInput } from "../decimal";

/** Inputs and results of the month engine (PLAN §2, §4). Quantities are pieces; money is BDT. */

export type ProductId = string;
export type StaffId = string;

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
  staff?: Readonly<Record<StaffId, StaffBalances>>;
  /** Positive = we owe the company for goods; negative = advance with the company. */
  companyPayable?: DecimalInput;
};

export type ProductDayInput = {
  ordered?: DecimalInput;
  received?: DecimalInput;
  /** Damage recorded at product level (Excel column N); DSR lines may add their own. */
  damaged?: DecimalInput;
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
  | "supplierDeposit";

export type OwedBucket = "advance" | "loan" | "shortage";

export type MoneyEntryInput = {
  kind: MoneyKind;
  /** Always positive; the kind decides the direction (D27). */
  amount: DecimalInput;
  staffId?: StaffId;
  /** Expense category for `expense` and `staffCostPaid`. */
  category?: string;
  /** Explicit allocation for repayments and salary recovery; default advance → loan → shortage. */
  allocation?: Partial<Record<OwedBucket, DecimalInput>>;
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
  sales: string;
  cost: string;
  grossProfit: string;
  returnValue: string;
  orderValue: string;
  receiptBill: string;
  receiptSale: string;
  damageValue: string;
  dueFromCompany: string;
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
  amount: string;
};

export type DayMoneyResult = {
  sales: string;
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
  salesTotal: string;
  costTotal: string;
  profitTotal: string;
  returnValue: string;
  damageValue: string;
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
    salesTotal: string;
    costTotal: string;
    profitTotal: string;
    damageValue: string;
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
  };
  staff: StaffMonthResult[];
  companyPayable: { opening: string; receipts: string; deposits: string; closing: string };
  profit: {
    gross: string;
    salaries: string;
    expenses: string;
    expensesByCategory: Record<string, string>;
    srIncentive: string;
    /** gross − salaries − expenses − SR incentive (D20). */
    net: string;
    /** Excel's monthly profit, which leaves out the SR incentive (PLAN §2.5). */
    netWithoutIncentive: string;
  };
  cashLeftTotal: string;
};

export type StaffBalanceValues = Required<Record<keyof StaffBalances, string>>;

/** Next month's opening; assignable to `MonthOpening`. */
export type MonthClosing = {
  products: Record<
    ProductId,
    { stock: string; dueFromCompany: string } & Partial<Record<PriceKind, string>>
  >;
  marketDue: Record<StaffId, string>;
  staff: Record<StaffId, StaffBalanceValues>;
  companyPayable: string;
};

export type MonthOutput = {
  days: DayResult[];
  month: MonthResult;
  closing: MonthClosing;
  warnings: EngineWarning[];
};
