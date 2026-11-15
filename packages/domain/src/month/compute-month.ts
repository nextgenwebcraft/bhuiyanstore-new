import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { MONEY_KIND_EFFECTS, cashBookEffect } from "./money-kinds";
import { depositInvestment, fundOrder } from "./order-funding";
import {
  autoKey,
  consumeFifo,
  firstPieces,
  lastPiecesCost,
  layerAtSale,
  layerCost,
  receiveFree,
  receiveInto,
  receiveIntoBatch,
  repriceNewest,
  returnToOldest,
  takeFromBatch,
  totalAtSale,
  totalQuantity,
  totalValue,
  type BatchLayer,
  type LayerAllocation,
} from "./batches";
import { addDamageLot, damageLotsFrom, damageLotsResult } from "./damage-lots";
import { owedBuckets } from "./types";
import type {
  BatchCarry,
  BatchResult,
  CashBookAccountResult,
  CashEntryResult,
  CashEntryType,
  CompanyEntryResult,
  CompanyFund,
  DayResult,
  EngineWarning,
  LineAllocationResult,
  MoneyKind,
  MonthClosing,
  MonthInput,
  ProductDayInput,
  MonthOutput,
  OwedBucket,
  PersonDayResult,
  PriceKind,
  ProductDayResult,
  ProductId,
  ShopEntryResult,
  ShopId,
  StaffBalanceValues,
  StaffBalances,
  StaffEntryResult,
  StaffId,
  StaffMonthResult,
} from "./types";

const ZERO = new Decimal(0);
const OWED_ORDER = owedBuckets;
const BALANCE_KEYS = [
  "advance",
  "loan",
  "shortage",
  "credit",
  "salaryPayable",
  "srLoan",
  "owedToSr",
] as const satisfies readonly (keyof StaffBalances)[];
const CARTON_SCALE = 6;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Balances = Record<keyof StaffBalances, Decimal>;

const dec = (value: DecimalInput | undefined): Decimal =>
  value === undefined ? ZERO : toDecimal(value);
const str = (value: Decimal): string => value.toString();
const sum = (values: Iterable<Decimal>): Decimal => {
  let total = ZERO;
  for (const v of values) total = total.add(v);
  return total;
};

function newestPrice(batches: readonly BatchLayer[], kind: "costPrice" | "salePrice") {
  const newest = batches[batches.length - 1];
  return newest ? newest[kind] : null;
}

function emptyBalances(): Balances {
  return {
    advance: ZERO,
    loan: ZERO,
    shortage: ZERO,
    credit: ZERO,
    salaryPayable: ZERO,
    srLoan: ZERO,
    owedToSr: ZERO,
  };
}

function balanceStrings(b: Balances): StaffBalanceValues {
  return {
    advance: str(b.advance),
    loan: str(b.loan),
    shortage: str(b.shortage),
    credit: str(b.credit),
    salaryPayable: str(b.salaryPayable),
    srLoan: str(b.srLoan),
    owedToSr: str(b.owedToSr),
  };
}

type ProductState = {
  /** FIFO batches, oldest first; stock is their sum (D49). */
  batches: BatchLayer[];
  dueFromCompany: Decimal;
  /** Billed value of the goods ordered and not yet received (D48), at their order prices. */
  dueValue: Decimal;
  /** The current prices (carry-forward); cost and sale equal the newest batch's after a receipt. */
  prices: Record<PriceKind, Decimal | null>;
  /** Damaged pieces held in the godown (D53). */
  damagedStock: Decimal;
  /** Damaged pieces at the company awaiting its decision (D53). */
  damageAtCompany: Decimal;
  /** D109: pieces held at each stored rate. */
  damageLots: Map<string, Decimal>;
};

/** A company ledger line before the balances after it are known. */
type CompanyMemo = Omit<
  CompanyEntryResult,
  "balance" | "undelivered" | "damageBalance" | "incentiveBalance"
>;

/** Paid pieces of the day's `orders` (D57). */
const stage0Pieces = (p: ProductDayInput | undefined): Decimal =>
  sum((p?.orders ?? []).map((o) => toDecimal(o.pieces)));

type OrderStageEntry = {
  pieces: Decimal;
  freePieces: Decimal;
  /** null for an order at the current order price (importer/history). */
  cartonRate: Decimal | null;
  bill: Decimal;
  ref?: string;
  fundFrom: readonly CompanyFund[];
  group?: string;
  /** D129: cheque-funded — skip companyPayable / fund split. */
  paidByCheck?: boolean;
};

/** The day's orders and receipt of one product against its undelivered pool (D48, D57). */
type OrderStage = {
  entries: OrderStageEntry[];
  orderBill: Decimal;
  dueQtyAfter: Decimal;
  dueValueAfter: Decimal;
  excessBill: Decimal;
  /** Undelivered value cleared by this receipt (D82). Does not move the company balance. */
  released: Decimal;
  /** Billed value of the goods received: released undelivered value + excess billed now. */
  receiptValue: Decimal;
};

function orderStage(
  state: ProductState,
  p: ProductDayInput | undefined,
  received: Decimal,
): OrderStage {
  const entries: OrderStageEntry[] = [];
  const orderPrice = state.prices.orderPrice ?? ZERO;
  const legacy = dec(p?.ordered);
  if (!legacy.isZero()) {
    entries.push({
      pieces: legacy,
      freePieces: ZERO,
      cartonRate: null,
      bill: legacy.mul(orderPrice),
      fundFrom: [],
    });
  }
  for (const o of p?.orders ?? []) {
    const pieces = toDecimal(o.pieces);
    const freePieces = dec(o.freePieces);
    const cartonRate = toDecimal(o.cartonRate);
    const perCarton = toDecimal(o.piecesPerCarton);
    if (pieces.isNegative() || freePieces.isNegative() || cartonRate.isNegative()) {
      throw new RangeError("invalid order");
    }
    if (perCarton.lte(0)) throw new RangeError("invalid order: carton size");
    entries.push({
      pieces,
      freePieces,
      cartonRate,
      bill: pieces.mul(cartonRate).div(perCarton),
      ...(o.ref === undefined ? {} : { ref: o.ref }),
      fundFrom: o.paidByCheck ? [] : (o.fundFrom ?? []),
      ...(o.group === undefined ? {} : { group: o.group }),
      ...(o.paidByCheck ? { paidByCheck: true } : {}),
    });
  }
  let dueQty = state.dueFromCompany;
  let dueValue = state.dueValue;
  let orderBill = ZERO;
  for (const e of entries) {
    dueQty = dueQty.add(e.pieces).add(e.freePieces);
    dueValue = dueValue.add(e.bill);
    orderBill = orderBill.add(e.bill);
  }
  // D46: goods due is never negative; an excess receipt offsets no later order.
  const covered = Decimal.min(Decimal.max(received, ZERO), dueQty);
  const excess = Decimal.max(received, ZERO).sub(covered);
  const dueQtyAfter = Decimal.max(ZERO, dueQty.sub(received));
  const released = dueQtyAfter.isZero()
    ? dueValue // exactly 0 when the due clears
    : covered.isZero()
      ? ZERO
      : dueValue.mul(covered).div(dueQty);
  const excessBill = excess.mul(orderPrice);
  return {
    entries,
    orderBill,
    dueQtyAfter,
    dueValueAfter: dueValue.sub(released),
    excessBill,
    released,
    receiptValue: released.add(excessBill),
  };
}

type ProductTotals = {
  ordered: Decimal;
  received: Decimal;
  issued: Decimal;
  returned: Decimal;
  delivered: Decimal;
  damaged: Decimal;
  godownDamaged: Decimal;
  sold: Decimal;
  orderTotal: Decimal;
  receiptTotal: Decimal;
  receiptSaleTotal: Decimal;
  commissionTotal: Decimal;
  salesTotal: Decimal;
  costTotal: Decimal;
  profitTotal: Decimal;
  returnValue: Decimal;
  damageValue: Decimal;
  replacedFromStock: Decimal;
  replacementReceived: Decimal;
  replacementValue: Decimal;
  /** Company damage refunds + replacement goods at unit cost (D47 memo; not profit). */
  damageRecovery: Decimal;
  orderBill: Decimal;
  excessBill: Decimal;
  incentiveReceived: Decimal;
};

function emptyProductTotals(): ProductTotals {
  return {
    ordered: ZERO,
    received: ZERO,
    issued: ZERO,
    returned: ZERO,
    delivered: ZERO,
    damaged: ZERO,
    godownDamaged: ZERO,
    sold: ZERO,
    orderTotal: ZERO,
    receiptTotal: ZERO,
    receiptSaleTotal: ZERO,
    commissionTotal: ZERO,
    salesTotal: ZERO,
    costTotal: ZERO,
    profitTotal: ZERO,
    returnValue: ZERO,
    damageValue: ZERO,
    replacedFromStock: ZERO,
    replacementReceived: ZERO,
    replacementValue: ZERO,
    damageRecovery: ZERO,
    orderBill: ZERO,
    excessBill: ZERO,
    incentiveReceived: ZERO,
  };
}

type LineAggregate = {
  issued: Decimal;
  returned: Decimal;
  damaged: Decimal;
  /** Shop commission (D41), already taken out of `soldValue`. */
  commission: Decimal;
  /** Î£ line soldValue (batch sale prices, price splits, commission) (D49). */
  soldValue: Decimal;
  /** Î£ line cost: every delivered piece at its batch cost (D47, D49). */
  cost: Decimal;
  /** Batch cost of the damaged (exchanged) pieces of the lines (D49). */
  damagedCost: Decimal;
  /** Issued and returned pieces at the line's list sale price (its batch's, D68). */
  issuedValue: Decimal;
  returnValue: Decimal;
};

const toBatchResult = (b: BatchLayer): BatchResult => ({
  key: b.key,
  seq: b.seq,
  startDate: b.startDate,
  costPrice: str(b.costPrice),
  salePrice: str(b.salePrice),
  quantity: str(b.quantity),
  value: str(b.quantity.mul(b.costPrice)),
});
const toCarry = (b: BatchLayer): BatchCarry => ({
  key: b.key,
  seq: b.seq,
  startDate: b.startDate,
  costPrice: str(b.costPrice),
  salePrice: str(b.salePrice),
  quantity: str(b.quantity),
});
const toAllocationResult = (a: LayerAllocation): LineAllocationResult => ({
  key: a.key,
  seq: a.seq,
  quantity: str(a.quantity),
  costPrice: str(a.costPrice),
  salePrice: str(a.salePrice),
});

/**
 * The month engine (PLAN Â§2, Â§4): pure and deterministic. It never rounds; settlement rounding
 * stays at presentation boundaries until P01 is decided. Data problems (negative stock, missing
 * prices, over-repayment) become warnings so an imperfect month can still be calculated and
 * reviewed; malformed input (unknown IDs, unordered dates, missing staff) throws.
 */
export function computeMonth(input: MonthInput): MonthOutput {
  const warnings: EngineWarning[] = [];
  const catalog = new Map(input.products.map((p) => [p.id, p]));
  if (catalog.size !== input.products.length) throw new RangeError("duplicate product id");
  for (const p of input.products) {
    const size = toDecimal(p.piecesPerCarton);
    if (!size.isInteger() || size.lte(0)) {
      throw new RangeError(`piecesPerCarton must be a positive integer: ${p.id}`);
    }
  }
  const requireProduct = (id: ProductId): void => {
    if (!catalog.has(id)) throw new RangeError(`unknown product: ${id}`);
  };

  const products = new Map<ProductId, ProductState>();
  for (const p of input.products) {
    const o = input.opening.products[p.id];
    const openingDue = Decimal.max(ZERO, dec(o?.dueFromCompany)); // D46: never negative
    const openingCost = o?.costPrice === undefined ? null : toDecimal(o.costPrice);
    const openingSale = o?.salePrice === undefined ? null : toDecimal(o.salePrice);
    // D49: the opening batches, or one batch from the stock at the opening prices.
    const openingBatches: BatchLayer[] = (o?.batches ?? [])
      .map((b) => ({
        key: b.key ?? autoKey(b.seq),
        seq: b.seq,
        startDate: b.startDate,
        costPrice: toDecimal(b.costPrice),
        salePrice: toDecimal(b.salePrice),
        quantity: toDecimal(b.quantity),
      }))
      .sort((a, b) => a.seq - b.seq);
    const batchCost = newestPrice(openingBatches, "costPrice");
    const batchSale = newestPrice(openingBatches, "salePrice");
    if (openingBatches.length === 0 && !dec(o?.stock).isZero()) {
      openingBatches.push({
        key: autoKey(1),
        seq: 1,
        startDate: "opening",
        costPrice: openingCost ?? ZERO,
        salePrice: openingSale ?? ZERO,
        quantity: dec(o?.stock),
      });
    }
    products.set(p.id, {
      batches: openingBatches,
      dueFromCompany: openingDue,
      // D48: billed value of the undelivered goods; defaults to opening due Ã— opening order price.
      dueValue: openingDue.isZero()
        ? ZERO
        : o?.dueFromCompanyValue === undefined
          ? openingDue.mul(o?.orderPrice === undefined ? ZERO : toDecimal(o.orderPrice))
          : toDecimal(o.dueFromCompanyValue),
      prices: {
        orderPrice: o?.orderPrice === undefined ? null : toDecimal(o.orderPrice),
        // Current prices = the newest batch when the opening carries batches without prices.
        costPrice: openingCost ?? batchCost,
        salePrice: openingSale ?? batchSale,
      },
      damagedStock: dec(o?.damagedStock),
      damageAtCompany: dec(o?.damageAtCompany),
      damageLots: damageLotsFrom(o?.damageLots),
    });
  }
  for (const id of Object.keys(input.opening.products)) requireProduct(id);

  const marketDueOpening = new Map<StaffId, Decimal>();
  for (const [staffId, amount] of Object.entries(input.opening.marketDue ?? {})) {
    marketDueOpening.set(staffId, toDecimal(amount));
  }
  const marketDue = new Map(marketDueOpening);
  const marketDueAdded = new Map<StaffId, Decimal>();
  const marketDueCollected = new Map<StaffId, Decimal>();

  const shopDueOpening = new Map<ShopId, Decimal>();
  for (const [shopId, amount] of Object.entries(input.opening.shopDue ?? {})) {
    shopDueOpening.set(shopId, toDecimal(amount));
  }
  const shopDue = new Map(shopDueOpening);
  const shopDueAdded = new Map<ShopId, Decimal>();
  const shopDueCollected = new Map<ShopId, Decimal>();
  const shopEntries: ShopEntryResult[] = [];

  const staffOpening = new Map<StaffId, Balances>();
  for (const [staffId, b] of Object.entries(input.opening.staff ?? {})) {
    const balances = emptyBalances();
    for (const key of BALANCE_KEYS) balances[key] = dec(b[key]);
    staffOpening.set(staffId, balances);
  }
  const staff = new Map<StaffId, Balances>(
    [...staffOpening].map(([id, b]) => [id, { ...b }] as const),
  );
  const staffOf = (id: StaffId): Balances => {
    let b = staff.get(id);
    if (!b) {
      b = emptyBalances();
      staff.set(id, b);
      staffOpening.set(id, emptyBalances());
    }
    return b;
  };
  const staffWarnings = input.staffWarnings ?? true;

  const companyPayableOpening = dec(input.opening.companyPayable);
  let companyPayable = companyPayableOpening;
  let companyOrders = ZERO;
  let companyReceipts = ZERO; // excess receipts billed at once (D48)
  let companyDeposits = ZERO;
  let companyIncentives = ZERO;
  let companyRefunds = ZERO;
  let companyInvestments = ZERO;
  // D63: the damage and incentive parts of the money deposited with the company.
  let damageFund = dec(input.opening.companyDamageBalance);
  let incentiveFund = dec(input.opening.companyIncentiveBalance);
  const funds = () => ({ damageBalance: str(damageFund), incentiveBalance: str(incentiveFund) });
  const companyEntries: CompanyEntryResult[] = [];
  const totalDueValue = (): Decimal => sum([...products.values()].map((s) => s.dueValue));
  const undeliveredOpening = totalDueValue();

  const totals = new Map<ProductId, ProductTotals>(
    input.products.map((p) => [p.id, emptyProductTotals()]),
  );
  const personTotals = new Map<StaffId, Map<ProductId, { net: Decimal; amount: Decimal }>>();
  const expensesByCategory = new Map<string, Decimal>();
  let salaries = ZERO;
  let srIncentive = ZERO;
  let cashLeftTotal = ZERO;

  // D52: the cash and bank book, by account (`""` = no account).
  const cashOpening = new Map<string, Decimal>();
  for (const [account, amount] of Object.entries(input.opening.cashAccounts ?? {})) {
    cashOpening.set(account, toDecimal(amount));
  }
  const cashBalance = new Map(cashOpening);
  const cashIn = new Map<string, Decimal>();
  const cashOut = new Map<string, Decimal>();
  const cashEntries: CashEntryResult[] = [];
  const bookMove = (
    date: string,
    type: CashEntryType,
    account: string,
    direction: 1 | -1,
    amount: Decimal,
    extra: { ref?: string | undefined; counterAccount?: string },
  ): void => {
    const balance = (cashBalance.get(account) ?? ZERO).add(direction === 1 ? amount : amount.neg());
    cashBalance.set(account, balance);
    const bucket = direction === 1 ? cashIn : cashOut;
    bucket.set(account, (bucket.get(account) ?? ZERO).add(amount));
    cashEntries.push({
      date,
      ...(extra.ref === undefined ? {} : { ref: extra.ref }),
      type,
      account,
      in: direction === 1 ? str(amount) : "0",
      out: direction === -1 ? str(amount) : "0",
      balance: str(balance),
      ...(extra.counterAccount === undefined ? {} : { counterAccount: extra.counterAccount }),
    });
  };
  let cashSnapshotWarned = !input.opening.cashSnapshotMissing;

  const days: DayResult[] = [];
  const staffEntries: StaffEntryResult[] = [];
  let previousDate = "";
  for (const day of input.days) {
    if (!DATE_PATTERN.test(day.date)) throw new RangeError(`invalid date: ${day.date}`);
    if (day.date <= previousDate) throw new RangeError(`days must be ascending: ${day.date}`);
    previousDate = day.date;
    const warn = (w: Omit<EngineWarning, "date">): void => {
      warnings.push({ date: day.date, ...w });
    };
    if (!cashSnapshotWarned) {
      cashSnapshotWarned = true;
      warn({ code: "CASH_SNAPSHOT_MISSING" });
    }

    const dayProducts = day.products ?? {};
    for (const id of Object.keys(dayProducts)) requireProduct(id);
    const orderStages = new Map<ProductId, OrderStage>();
    const dayReceipts = new Map<ProductId, { received: Decimal; receiptSale: Decimal }>();

    // Prices for the day: carry forward, changed by today's values. D49: the day's stock inflows
    // come first. A receipt's pieces take the day's cost and sale price (merging into the newest
    // batch only when both are equal, else a new batch); a price change on a day without a receipt
    // re-prices the newest batch only. Free goods and company replacements are zero-cost pieces.
    // D68: a receipt into a named batch takes the receipt's own prices instead.
    for (const [id, state] of products) {
      const p = dayProducts[id];
      for (const kind of ["orderPrice", "costPrice", "salePrice"] as const) {
        const v = p?.[kind];
        if (v !== undefined) state.prices[kind] = toDecimal(v);
      }
      const batchReceipts = (p?.batchReceipts ?? []).map((r) => ({
        key: r.key,
        seq: r.seq,
        quantity: toDecimal(r.quantity),
        costPrice: toDecimal(r.costPrice),
        salePrice: toDecimal(r.salePrice),
      }));
      for (const r of batchReceipts) {
        if (r.quantity.lte(0) || r.costPrice.isNegative() || r.salePrice.isNegative()) {
          throw new RangeError(`invalid batch receipt: ${id}`);
        }
      }
      const unbatched = dec(p?.received);
      const received = unbatched.add(sum(batchReceipts.map((r) => r.quantity)));
      const sale = state.prices.salePrice ?? ZERO;
      // D57: the order/receipt pool decides the receipt batch's cost per piece.
      const stage = orderStage(state, p, received);
      orderStages.set(id, stage);
      // The cost price the day's other pieces fall back on (deficit batches, history).
      const cost = state.prices.costPrice ?? ZERO;
      let receiptSale = unbatched.mul(sale);
      if (unbatched.gt(0)) {
        const receiptCost = stage.receiptValue.div(received);
        receiveInto(state.batches, unbatched, receiptCost, sale, day.date);
        // The current cost price follows the newest batch (display, carried into the closing).
        state.prices.costPrice = receiptCost;
      } else if (batchReceipts.length === 0) {
        repriceNewest(state.batches, {
          costPrice: p?.costPrice === undefined ? undefined : toDecimal(p.costPrice),
          salePrice: p?.salePrice === undefined ? undefined : toDecimal(p.salePrice),
        });
      }
      for (const r of batchReceipts) {
        receiveIntoBatch(state.batches, r, r.quantity, r, day.date);
        state.prices.costPrice = r.costPrice;
        state.prices.salePrice = r.salePrice;
        receiptSale = receiptSale.add(r.quantity.mul(r.salePrice));
      }
      dayReceipts.set(id, { received, receiptSale });
      const freeQuantity = sum((p?.replacements ?? []).map((r) => toDecimal(r.quantity))).add(
        dec(p?.incentiveReceived),
      );
      receiveFree(state.batches, freeQuantity, sale, day.date);
      // A negative receipt (correction) takes pieces back out, oldest first.
      if (unbatched.isNegative()) {
        consumeFifo(state.batches, unbatched.neg(), { costPrice: cost, salePrice: sale }, day.date);
      }
    }

    const lineAggregates = new Map<ProductId, LineAggregate>();
    const persons: PersonDayResult[] = [];
    const dsrMoney = new Map<
      StaffId,
      { sales: Decimal; marketDueNew: Decimal; marketDueCollected: Decimal }
    >();
    const dsrOf = (id: StaffId) => {
      let row = dsrMoney.get(id);
      if (!row) {
        row = { sales: ZERO, marketDueNew: ZERO, marketDueCollected: ZERO };
        dsrMoney.set(id, row);
      }
      return row;
    };
    /** Only reported for staff that are DSRs that day (sheet lines or market due). */
    const costPaid = new Map<StaffId, Decimal>();
    const staffMoney = new Map<StaffId, Decimal>();
    for (const line of day.dsrLines ?? []) {
      requireProduct(line.productId);
      if (!line.staffId) throw new RangeError("DSR line without staffId");
      const issued = dec(line.issued);
      const returned = dec(line.returned);
      const damaged = dec(line.damaged);
      const commission = dec(line.commission);
      if (commission.isNegative()) {
        throw new RangeError(`commission must not be negative: ${line.staffId}/${line.productId}`);
      }
      const splits = (line.priceSplits ?? []).map((s) => ({
        quantity: toDecimal(s.quantity),
        unitPrice: toDecimal(s.unitPrice),
      }));
      for (const s of splits) {
        if (s.quantity.lte(0)) throw new RangeError("price split quantity must be positive");
      }
      const lineSold = issued.sub(returned).sub(damaged);
      if (splits.length && sum(splits.map((s) => s.quantity)).gt(lineSold)) {
        throw new RangeError(`price splits exceed sold pieces: ${line.staffId}/${line.productId}`);
      }
      const lineState = products.get(line.productId) as ProductState;
      const fallback = {
        costPrice: lineState.prices.costPrice ?? ZERO,
        salePrice: lineState.prices.salePrice ?? ZERO,
      };
      const net = issued.sub(returned);
      const named = line.batch;
      const layer = named ? lineState.batches.find((b) => b.key === named.key) : undefined;
      const batch = named
        ? {
            key: named.key,
            seq: named.seq,
            costPrice:
              named.costPrice === undefined
                ? (layer?.costPrice ?? fallback.costPrice)
                : toDecimal(named.costPrice),
            salePrice:
              named.salePrice === undefined
                ? (layer?.salePrice ?? fallback.salePrice)
                : toDecimal(named.salePrice),
          }
        : null;
      if (batch && (batch.costPrice.isNegative() || batch.salePrice.isNegative())) {
        throw new RangeError(`invalid batch price: ${line.staffId}/${line.productId}`);
      }
      // D68: a line naming its batch takes the pieces from it at the line's prices. D49: else
      // the pieces leave the oldest batches first (a negative net returns to the oldest). The
      // first `sold` allocated pieces are sold, the last `damaged` ones exchanged.
      const allocation = batch
        ? takeFromBatch(lineState.batches, batch, net, batch, day.date)
        : net.gt(0)
          ? consumeFifo(lineState.batches, net, fallback, day.date)
          : returnToOldest(lineState.batches, net.neg(), fallback, day.date);
      const newestSale = lineState.batches[lineState.batches.length - 1]?.salePrice;
      const firstSale =
        batch?.salePrice ?? allocation[0]?.salePrice ?? newestSale ?? fallback.salePrice;
      const listSale = batch?.salePrice ?? fallback.salePrice;
      const soldPieces = lineSold.gt(0) ? firstPieces(allocation, lineSold) : [];
      let soldBase = soldPieces.reduce((t, c) => t.add(c.quantity.mul(c.salePrice)), ZERO);
      // Sold below zero (damaged beyond net, or a net return) is valued at the first batch price.
      if (lineSold.isNegative()) soldBase = lineSold.mul(firstSale);
      // Price-split pieces are the first sold pieces: adjust against the batch price they replace.
      let splitAdjustment = ZERO;
      const pool = soldPieces.map((c) => ({ ...c }));
      let at = 0;
      for (const sp of splits) {
        let left = sp.quantity;
        while (left.gt(0)) {
          const chunk = pool[at];
          if (!chunk) break;
          const take = Decimal.min(left, chunk.quantity);
          splitAdjustment = splitAdjustment.add(take.mul(sp.unitPrice.sub(chunk.salePrice)));
          chunk.quantity = chunk.quantity.sub(take);
          left = left.sub(take);
          if (chunk.quantity.isZero()) at++;
        }
      }
      const amount = layerAtSale(allocation).add(splitAdjustment).sub(commission);
      const soldValue = soldBase.add(splitAdjustment).sub(commission);
      const lineCostValue = layerCost(allocation);
      const agg = lineAggregates.get(line.productId) ?? {
        issued: ZERO,
        returned: ZERO,
        damaged: ZERO,
        commission: ZERO,
        soldValue: ZERO,
        cost: ZERO,
        damagedCost: ZERO,
        issuedValue: ZERO,
        returnValue: ZERO,
      };
      agg.issued = agg.issued.add(issued);
      agg.returned = agg.returned.add(returned);
      agg.damaged = agg.damaged.add(damaged);
      agg.commission = agg.commission.add(commission);
      agg.soldValue = agg.soldValue.add(soldValue);
      agg.cost = agg.cost.add(lineCostValue);
      agg.damagedCost = agg.damagedCost.add(
        damaged.isZero()
          ? ZERO
          : lastPiecesCost(allocation, damaged, batch?.costPrice ?? fallback.costPrice),
      );
      agg.issuedValue = agg.issuedValue.add(issued.mul(listSale));
      agg.returnValue = agg.returnValue.add(returned.mul(listSale));
      lineAggregates.set(line.productId, agg);
      // D109/D119: the stored rate is the claim price (and damage money cards). Absent = sale price.
      let damageRateOut: string | null = null;
      if (damaged.gt(0)) {
        const rate = line.damageRate === undefined ? listSale : toDecimal(line.damageRate);
        if (rate.isNegative()) {
          throw new RangeError(`invalid damage rate: ${line.staffId}/${line.productId}`);
        }
        addDamageLot(lineState.damageLots, rate, damaged);
        damageRateOut = str(rate);
      }

      const dsr = dsrOf(line.staffId);
      dsr.sales = dsr.sales.add(soldValue);
      persons.push({
        staffId: line.staffId,
        productId: line.productId,
        issued: str(issued),
        returned: str(returned),
        net: str(net),
        damaged: str(damaged),
        damageRate: damageRateOut,
        amount: str(amount),
        sold: str(lineSold),
        commission: str(commission),
        soldValue: str(soldValue),
        allocations: allocation.map(toAllocationResult),
      });
      const byProduct =
        personTotals.get(line.staffId) ?? new Map<ProductId, { net: Decimal; amount: Decimal }>();
      const pt = byProduct.get(line.productId) ?? { net: ZERO, amount: ZERO };
      byProduct.set(line.productId, { net: pt.net.add(net), amount: pt.amount.add(amount) });
      personTotals.set(line.staffId, byProduct);
    }

    // D63: the day's damage money returns and money incentives, posted after the orders, can
    // already pay that day's orders.
    let pendingDamage = ZERO;
    let pendingIncentive = ZERO;
    for (const p of Object.values(dayProducts)) {
      for (const r of p.companyRefunds ?? []) {
        pendingDamage = pendingDamage.add(toDecimal(r.quantity).mul(toDecimal(r.unitCost)));
      }
      for (const r of p.batchDamageDeposits ?? []) {
        pendingDamage = pendingDamage.add(toDecimal(r.quantity).mul(toDecimal(r.unitCost)));
      }
    }
    for (const entry of day.money ?? []) {
      if (MONEY_KIND_EFFECTS[entry.kind]?.company === "incentive") {
        pendingIncentive = pendingIncentive.add(toDecimal(entry.amount));
      }
    }

    const productResults: ProductDayResult[] = [];
    let daySales = ZERO;
    let dayCommission = ZERO;
    const dayRefunds: CompanyMemo[] = [];
    const dayFreeGoods: CompanyMemo[] = [];
    const dayReplacements: CompanyMemo[] = [];
    for (const [id, state] of products) {
      const p = dayProducts[id];
      const agg = lineAggregates.get(id);
      const ordered = dec(p?.ordered).add(stage0Pieces(p));
      const { received, receiptSale } = dayReceipts.get(id) ?? {
        received: ZERO,
        receiptSale: ZERO,
      };
      const incentiveReceived = dec(p?.incentiveReceived);
      if (incentiveReceived.isNegative()) throw new RangeError(`invalid free goods: ${id}`);
      if (!incentiveReceived.isZero()) {
        dayFreeGoods.push({
          date: day.date,
          kind: "freeGoods",
          amount: "0",
          productId: id,
          quantity: str(incentiveReceived),
        });
      }
      const replacements = (p?.replacements ?? []).map((r) => ({
        quantity: toDecimal(r.quantity),
        unitCost: toDecimal(r.unitCost),
      }));
      for (const r of replacements) {
        if (r.quantity.lte(0) || r.unitCost.isNegative()) {
          throw new RangeError(`invalid replacement: ${id}`);
        }
      }
      const replacementReceived = sum(replacements.map((r) => r.quantity));
      const replacementValue = sum(replacements.map((r) => r.quantity.mul(r.unitCost)));
      if (!replacementReceived.isZero()) {
        dayReplacements.push({
          date: day.date,
          kind: "replacement",
          amount: str(replacementValue),
          productId: id,
          quantity: str(replacementReceived),
        });
      }
      let refundValue = ZERO;
      for (const refund of p?.companyRefunds ?? []) {
        const quantity = toDecimal(refund.quantity);
        const unitCost = toDecimal(refund.unitCost);
        if (quantity.lte(0) || unitCost.isNegative()) {
          throw new RangeError(`invalid company refund: ${id}`);
        }
        const amount = quantity.mul(unitCost);
        companyRefunds = companyRefunds.add(amount);
        addDamageLot(state.damageLots, unitCost, quantity.neg());
        refundValue = refundValue.add(amount);
        dayRefunds.push({
          date: day.date,
          kind: "damageRefund",
          amount: str(amount),
          ...(refund.ref === undefined ? {} : { ref: refund.ref }),
          productId: id,
        });
      }
      // D131: floor stock → company money from a named batch (no damage-lot / profit charge).
      for (const deposit of p?.batchDamageDeposits ?? []) {
        const quantity = toDecimal(deposit.quantity);
        const unitCost = toDecimal(deposit.unitCost);
        if (quantity.lte(0) || unitCost.isNegative()) {
          throw new RangeError(`invalid floor damage deposit: ${id}`);
        }
        const layer = state.batches.find((b) => b.key === deposit.key);
        const prices = {
          costPrice: layer?.costPrice ?? (state.prices.costPrice ?? ZERO),
          salePrice: layer?.salePrice ?? (state.prices.salePrice ?? ZERO),
        };
        takeFromBatch(
          state.batches,
          { key: deposit.key, seq: deposit.seq },
          quantity,
          prices,
          day.date,
        );
        const amount = quantity.mul(unitCost);
        companyRefunds = companyRefunds.add(amount);
        refundValue = refundValue.add(amount);
        dayRefunds.push({
          date: day.date,
          kind: "damageRefund",
          amount: str(amount),
          ...(deposit.ref === undefined ? {} : { ref: deposit.ref }),
          productId: id,
        });
      }
      const damageRecovery = refundValue.add(replacementValue);
      const issued = agg?.issued ?? ZERO;
      const returned = agg?.returned ?? ZERO;
      const delivered = issued.sub(returned);
      const damaged = dec(p?.damaged).add(agg?.damaged ?? ZERO);
      const sold = delivered.sub(damaged);
      const replacedFromStock = dec(p?.replacedFromStock);
      const godownDamaged = dec(p?.godownDamaged);
      const dispatched = dec(p?.companyDispatched);
      const rejected = dec(p?.companyRejected);
      const writtenOff = dec(p?.writtenOff);
      for (const q of [godownDamaged, dispatched, rejected, writtenOff]) {
        if (q.isNegative()) throw new RangeError(`invalid damaged goods quantity: ${id}`);
      }
      const refundedPieces = sum((p?.companyRefunds ?? []).map((r) => toDecimal(r.quantity)));

      const priceFor = (kind: PriceKind, quantity: Decimal): Decimal => {
        const price = state.prices[kind];
        if (price === null) {
          if (!quantity.isZero()) warn({ code: "MISSING_PRICE", productId: id, detail: kind });
          return ZERO;
        }
        return price;
      };
      priceFor("orderPrice", ordered.abs().add(received.abs()).add(stage0Pieces(p)));
      const costPrice = priceFor(
        "costPrice",
        delivered.abs().add(damaged.abs()).add(replacedFromStock.abs()).add(godownDamaged),
      );
      priceFor("salePrice", sold.abs().add(returned.abs()));

      // D49: good pieces handed out of the godown for buyers' damaged ones, then pieces found
      // damaged in the godown, leave the oldest batches first.
      const stockFallback = { costPrice, salePrice: state.prices.salePrice ?? ZERO };
      const replacedAllocation = consumeFifo(
        state.batches,
        replacedFromStock,
        stockFallback,
        day.date,
      );
      const godownAllocation = consumeFifo(state.batches, godownDamaged, stockFallback, day.date);
      const replacedCost = layerCost(replacedAllocation);
      const godownCost = layerCost(godownAllocation);
      const newestSalePrice =
        state.batches[state.batches.length - 1]?.salePrice ?? state.prices.salePrice ?? ZERO;
      const productDamaged = dec(p?.damaged);

      const commission = agg?.commission ?? ZERO;
      // Line sales use the batch prices; the product-level damaged pieces (importer only) fall at
      // the newest batch's sale price.
      const sales = (agg?.soldValue ?? ZERO).sub(productDamaged.mul(newestSalePrice));
      // D47: cost of every delivered piece (damaged ones included, at batch cost) and of the good
      // pieces handed out of the godown for buyers' damaged ones; sales already fall by the damaged
      // pieces. D53: pieces found damaged in the godown are charged the same way, with no sales.
      const cost = (agg?.cost ?? ZERO).add(replacedCost).add(godownCost);
      const grossProfit = sales.sub(cost);

      // D48/D57: an order is billed at once; receiving ordered goods moves no money, only excess
      // is billed. The pool was computed with the day's stock inflows above.
      const stage = orderStages.get(id) as OrderStage;
      state.dueFromCompany = stage.dueQtyAfter;
      // Each order line's undelivered is after that bill and before today's receipt (D82).
      let dueValueWalk = stage.dueValueAfter.add(stage.released).sub(stage.orderBill);
      for (const o of stage.entries) {
        dueValueWalk = dueValueWalk.add(o.bill);
        state.dueValue = dueValueWalk;
        companyOrders = companyOrders.add(o.bill);
        // D129: cheque-funded orders still raise undelivered goods, but never companyPayable.
        if (o.paidByCheck) continue;
        companyPayable = companyPayable.add(o.bill);
        const { fromDamage, fromIncentive, fromDeposit } = fundOrder(o.bill, o.fundFrom, {
          damage: damageFund.add(pendingDamage),
          incentive: incentiveFund.add(pendingIncentive),
        });
        damageFund = damageFund.sub(fromDamage);
        incentiveFund = incentiveFund.sub(fromIncentive);
        companyEntries.push({
          date: day.date,
          kind: "order",
          amount: str(o.bill),
          ...(o.ref === undefined ? {} : { ref: o.ref }),
          productId: id,
          quantity: str(o.pieces),
          ...(o.cartonRate === null
            ? {}
            : { freeQuantity: str(o.freePieces), cartonRate: str(o.cartonRate) }),
          fromDamage: str(fromDamage),
          fromIncentive: str(fromIncentive),
          fromDeposit: str(fromDeposit),
          ...(o.group === undefined ? {} : { group: o.group }),
          balance: str(companyPayable),
          ...funds(),
          undelivered: str(totalDueValue()),
        });
      }
      state.dueValue = stage.dueValueAfter;
      const orderBill = stage.orderBill;
      const excessBill = stage.excessBill;
      companyPayable = companyPayable.add(excessBill);
      companyReceipts = companyReceipts.add(excessBill);
      const receiptValue = stage.receiptValue;
      if (received.gt(0)) {
        companyEntries.push({
          date: day.date,
          kind: "receipt",
          amount: str(excessBill),
          released: str(stage.released),
          productId: id,
          quantity: str(received),
          balance: str(companyPayable),
          ...funds(),
          undelivered: str(totalDueValue()),
        });
      }
      // D53: damaged goods stock. The sheet's damaged pieces and the buyer's exchanged pieces
      // arrive; dispatch and write-off leave; a company rejection brings pieces back.
      state.damagedStock = state.damagedStock
        .add(agg?.damaged ?? ZERO)
        .add(godownDamaged)
        .add(replacedFromStock)
        .sub(dispatched)
        .add(rejected)
        .sub(writtenOff);
      state.damageAtCompany = state.damageAtCompany
        .add(dispatched)
        .sub(rejected)
        .sub(replacementReceived)
        .sub(refundedPieces);
      const stock = totalQuantity(state.batches);
      if (stock.isNegative()) {
        warn({ code: "NEGATIVE_STOCK", productId: id, detail: str(stock) });
      }
      const stockValue = totalValue(state.batches);

      const t = totals.get(id) as ProductTotals;
      const orderValue = orderBill;
      const receiptBill = excessBill;
      const returnValue = agg?.returnValue ?? ZERO;
      const issuedValue = agg?.issuedValue ?? ZERO;
      // D49: the damaged pieces' batch cost, plus replaced and godown-damaged pieces at theirs;
      // product-level damaged (importer only) at the current cost.
      const damageValue = (agg?.damagedCost ?? ZERO)
        .add(productDamaged.mul(costPrice))
        .add(replacedCost)
        .add(godownCost);
      t.ordered = t.ordered.add(ordered);
      t.received = t.received.add(received);
      t.issued = t.issued.add(issued);
      t.returned = t.returned.add(returned);
      t.delivered = t.delivered.add(delivered);
      t.damaged = t.damaged.add(damaged);
      t.godownDamaged = t.godownDamaged.add(godownDamaged);
      t.sold = t.sold.add(sold);
      t.orderTotal = t.orderTotal.add(orderValue);
      t.receiptTotal = t.receiptTotal.add(receiptBill);
      t.receiptSaleTotal = t.receiptSaleTotal.add(receiptSale);
      t.commissionTotal = t.commissionTotal.add(commission);
      t.salesTotal = t.salesTotal.add(sales);
      t.costTotal = t.costTotal.add(cost);
      t.profitTotal = t.profitTotal.add(grossProfit);
      t.returnValue = t.returnValue.add(returnValue);
      t.damageValue = t.damageValue.add(damageValue);
      t.replacedFromStock = t.replacedFromStock.add(replacedFromStock);
      t.replacementReceived = t.replacementReceived.add(replacementReceived);
      t.replacementValue = t.replacementValue.add(replacementValue);
      t.damageRecovery = t.damageRecovery.add(damageRecovery);
      t.incentiveReceived = t.incentiveReceived.add(incentiveReceived);
      daySales = daySales.add(sales);
      dayCommission = dayCommission.add(commission);

      const priceString = (kind: PriceKind): string | null => {
        const price = state.prices[kind];
        return price === null ? null : str(price);
      };
      productResults.push({
        productId: id,
        ordered: str(ordered),
        received: str(received),
        issued: str(issued),
        returned: str(returned),
        delivered: str(delivered),
        damaged: str(damaged),
        godownDamaged: str(godownDamaged),
        sold: str(sold),
        orderPrice: priceString("orderPrice"),
        costPrice: priceString("costPrice"),
        salePrice: priceString("salePrice"),
        commission: str(commission),
        sales: str(sales),
        cost: str(cost),
        grossProfit: str(grossProfit),
        issuedValue: str(issuedValue),
        returnValue: str(returnValue),
        orderValue: str(orderValue),
        receiptBill: str(receiptBill),
        receiptValue: str(receiptValue),
        receiptSale: str(receiptSale),
        damageValue: str(damageValue),
        damageRecovery: str(damageRecovery),
        replacedFromStock: str(replacedFromStock),
        replacementReceived: str(replacementReceived),
        incentiveReceived: str(incentiveReceived),
        dueFromCompany: str(state.dueFromCompany),
        dueFromCompanyValue: str(state.dueValue),
        stock: str(stock),
        stockValue: str(stockValue),
        batches: state.batches.map(toBatchResult),
        damagedStock: str(state.damagedStock),
        damageAtCompany: str(state.damageAtCompany),
        damageLots: damageLotsResult(state.damageLots, true),
      });
    }

    for (const refund of dayRefunds) {
      companyPayable = companyPayable.sub(toDecimal(refund.amount));
      damageFund = damageFund.add(toDecimal(refund.amount));
      companyEntries.push({
        ...refund,
        balance: str(companyPayable),
        ...funds(),
        undelivered: str(totalDueValue()),
      });
    }
    for (const memo of [...dayFreeGoods, ...dayReplacements]) {
      companyEntries.push({
        ...memo,
        balance: str(companyPayable),
        ...funds(),
        undelivered: str(totalDueValue()),
      });
    }

    // D52: the day's sales cash goes to the default account; market due entries and the DSR
    // handover difference are money entries below, so the account ends at the real cash.
    const defaultCash = day.defaultCashAccount ?? "";
    if (daySales.isNegative()) bookMove(day.date, "sales", defaultCash, -1, daySales.neg(), {});
    else if (!daySales.isZero()) bookMove(day.date, "sales", defaultCash, 1, daySales, {});
    let dayCashIn = ZERO;
    let dayCashOut = ZERO;
    let banked = ZERO;
    let dayDueNew = ZERO;
    let dayDueCollected = ZERO;
    let dayIncentive = ZERO;
    let dayExpenses = ZERO;
    for (const entry of day.money ?? []) {
      const effect = MONEY_KIND_EFFECTS[entry.kind];
      if (!effect) throw new RangeError(`unknown money kind: ${String(entry.kind)}`);
      const amount = toDecimal(entry.amount);
      if (amount.isNegative()) throw new RangeError(`money amount must not be negative`);
      if (effect.requiresStaff && !entry.staffId) {
        throw new RangeError(`${entry.kind} requires staffId`);
      }
      if (effect.cash === 1) dayCashIn = dayCashIn.add(amount);
      if (effect.cash === -1) dayCashOut = dayCashOut.add(amount);

      const book = cashBookEffect(entry.kind);
      if (book === "transfer") {
        const from = entry.account ?? defaultCash;
        const to = entry.toAccount;
        if (to === undefined || to === from) {
          throw new RangeError("a transfer needs two different accounts");
        }
        bookMove(day.date, entry.kind, from, -1, amount, { ref: entry.ref, counterAccount: to });
        bookMove(day.date, entry.kind, to, 1, amount, { ref: entry.ref, counterAccount: from });
      } else if (book !== 0) {
        const fallback =
          entry.kind === "supplierDeposit"
            ? (day.defaultDepositAccount ?? defaultCash)
            : defaultCash;
        const account = entry.account ?? fallback;
        if (effect.company === "deposit") {
          // D63: a deposit beyond the total cash and bank balance is money put in first.
          const investment = depositInvestment(amount, sum([...cashBalance.values()]));
          if (investment.gt(0)) {
            bookMove(day.date, "investment", account, 1, investment, { ref: entry.ref });
            companyInvestments = companyInvestments.add(investment);
            companyEntries.push({
              date: day.date,
              kind: "investment",
              amount: str(investment),
              ...(entry.ref === undefined ? {} : { ref: entry.ref }),
              balance: str(companyPayable),
              ...funds(),
              undelivered: str(totalDueValue()),
            });
          }
        }
        bookMove(day.date, entry.kind, account, book, amount, { ref: entry.ref });
      }

      if (effect.marketDue) {
        const key = entry.staffId ?? "";
        const signed = effect.marketDue === 1 ? amount : amount.neg();
        marketDue.set(key, (marketDue.get(key) ?? ZERO).add(signed));
        const bucket = effect.marketDue === 1 ? marketDueAdded : marketDueCollected;
        bucket.set(key, (bucket.get(key) ?? ZERO).add(amount));
        if (effect.marketDue === 1) dayDueNew = dayDueNew.add(amount);
        else dayDueCollected = dayDueCollected.add(amount);
        if (entry.staffId) {
          const dsr = dsrOf(entry.staffId);
          if (effect.marketDue === 1) dsr.marketDueNew = dsr.marketDueNew.add(amount);
          else dsr.marketDueCollected = dsr.marketDueCollected.add(amount);
        }
        if (entry.shopId) {
          const shopId = entry.shopId;
          const balance = (shopDue.get(shopId) ?? ZERO).add(signed);
          shopDue.set(shopId, balance);
          const shopBucket = effect.marketDue === 1 ? shopDueAdded : shopDueCollected;
          shopBucket.set(shopId, (shopBucket.get(shopId) ?? ZERO).add(amount));
          shopEntries.push({
            date: day.date,
            ...(entry.ref === undefined ? {} : { ref: entry.ref }),
            shopId,
            ...(entry.staffId ? { staffId: entry.staffId } : {}),
            kind: effect.marketDue === 1 ? "marketDueNew" : "marketDueCollected",
            amount: str(amount),
            balance: str(balance),
          });
        }
      }

      if (effect.expense === "category" || effect.expense === "salary") {
        const category = effect.expense === "salary" ? "salary" : (entry.category ?? "operating");
        if (effect.expense === "salary") salaries = salaries.add(amount);
        else {
          expensesByCategory.set(category, (expensesByCategory.get(category) ?? ZERO).add(amount));
          dayExpenses = dayExpenses.add(amount);
        }
      }
      if (effect.expense === "srIncentive") {
        srIncentive = srIncentive.add(amount);
        dayIncentive = dayIncentive.add(amount);
      }

      if (effect.company) {
        companyPayable = companyPayable.sub(amount);
        if (effect.company === "deposit") {
          companyDeposits = companyDeposits.add(amount);
          banked = banked.add(amount);
        } else {
          companyIncentives = companyIncentives.add(amount);
          incentiveFund = incentiveFund.add(amount);
        }
        companyEntries.push({
          date: day.date,
          kind: effect.company,
          amount: str(amount),
          ...(entry.ref === undefined ? {} : { ref: entry.ref }),
          ...(entry.productId === undefined ? {} : { productId: entry.productId }),
          balance: str(companyPayable),
          ...funds(),
          undelivered: str(totalDueValue()),
        });
      }

      if (entry.kind === "staffCostPaid" && entry.staffId) {
        costPaid.set(entry.staffId, (costPaid.get(entry.staffId) ?? ZERO).add(amount));
      }
      const staffCash = STAFF_CASH[entry.kind];
      if (staffCash && entry.staffId) {
        const prior = staffMoney.get(entry.staffId) ?? ZERO;
        staffMoney.set(entry.staffId, staffCash === 1 ? prior.add(amount) : prior.sub(amount));
      }

      if (effect.staff && entry.staffId) {
        const b = staffOf(entry.staffId);
        const before = { ...b };
        if (effect.staff.balance === "owed") {
          const left = reduceOwed(b, amount, entry.allocation);
          if (left.gt(0)) {
            b.credit = b.credit.add(left);
            if (staffWarnings) {
              warn({ code: "REPAYMENT_EXCEEDS_DUE", staffId: entry.staffId, detail: str(left) });
            }
          }
        } else {
          const key = effect.staff.balance;
          b[key] = b[key].add(effect.staff.direction === 1 ? amount : amount.neg());
          if (staffWarnings && b[key].isNegative()) {
            warn({ code: "NEGATIVE_BALANCE", staffId: entry.staffId, detail: key });
          }
        }
        if (effect.staffAlso) {
          const key = effect.staffAlso.balance;
          b[key] = b[key].add(effect.staffAlso.direction === 1 ? amount : amount.neg());
          if (staffWarnings && b[key].isNegative()) {
            warn({ code: "NEGATIVE_BALANCE", staffId: entry.staffId, detail: key });
          }
        }
        const change = emptyBalances();
        for (const key of BALANCE_KEYS) change[key] = b[key].sub(before[key]);
        staffEntries.push({
          date: day.date,
          ...(entry.ref === undefined ? {} : { ref: entry.ref }),
          staffId: entry.staffId,
          kind: entry.kind,
          amount: str(amount),
          change: balanceStrings(change),
          balances: balanceStrings(b),
        });
      } else if (entry.kind === "staffAbsent" && entry.staffId) {
        // D75: the absent fee moves no balance (payroll takes it off the salary) but is listed.
        const b = staffOf(entry.staffId);
        staffEntries.push({
          date: day.date,
          ...(entry.ref === undefined ? {} : { ref: entry.ref }),
          staffId: entry.staffId,
          kind: entry.kind,
          amount: str(amount),
          change: balanceStrings(emptyBalances()),
          balances: balanceStrings(b),
        });
      }
    }
    for (const [key, value] of marketDue) {
      if (value.isNegative()) {
        warn({ code: "NEGATIVE_MARKET_DUE", ...(key ? { staffId: key } : {}), detail: str(value) });
      }
    }

    const cashLeft = daySales.add(dayCashIn).sub(dayCashOut);
    cashLeftTotal = cashLeftTotal.add(cashLeft);
    days.push({
      date: day.date,
      products: productResults,
      persons,
      dsrs: [...dsrMoney].map(([staffId, d]) => ({
        staffId,
        sales: str(d.sales),
        marketDueNew: str(d.marketDueNew),
        marketDueCollected: str(d.marketDueCollected),
        costPaid: str(costPaid.get(staffId) ?? ZERO),
        staffMoney: str(staffMoney.get(staffId) ?? ZERO),
      })),
      money: {
        sales: str(daySales),
        commission: str(dayCommission),
        marketDueNew: str(dayDueNew),
        marketDueCollected: str(dayDueCollected),
        srIncentive: str(dayIncentive),
        expenses: str(dayExpenses),
        cashIn: str(dayCashIn),
        cashOut: str(dayCashOut),
        cashLeft: str(cashLeft),
        banked: str(banked),
      },
    });
  }

  const cartons = (pieces: Decimal, id: ProductId): string => {
    const size = toDecimal(catalog.get(id)?.piecesPerCarton ?? "1");
    return str(pieces.div(size).toDecimalPlaces(CARTON_SCALE));
  };

  const productMonth = input.products.map((p) => {
    const t = totals.get(p.id) as ProductTotals;
    const s = products.get(p.id) as ProductState;
    return {
      productId: p.id,
      ordered: str(t.ordered),
      received: str(t.received),
      issued: str(t.issued),
      returned: str(t.returned),
      delivered: str(t.delivered),
      damaged: str(t.damaged),
      godownDamaged: str(t.godownDamaged),
      sold: str(t.sold),
      orderTotal: str(t.orderTotal),
      receiptTotal: str(t.receiptTotal),
      receiptSaleTotal: str(t.receiptSaleTotal),
      commissionTotal: str(t.commissionTotal),
      salesTotal: str(t.salesTotal),
      costTotal: str(t.costTotal),
      profitTotal: str(t.profitTotal),
      returnValue: str(t.returnValue),
      damageValue: str(t.damageValue),
      damageRecovery: str(t.damageRecovery),
      replacedFromStock: str(t.replacedFromStock),
      replacementReceived: str(t.replacementReceived),
      replacementValue: str(t.replacementValue),
      incentiveReceived: str(t.incentiveReceived),
      salesCartons: cartons(t.delivered, p.id),
      closingStock: str(totalQuantity(s.batches)),
      closingValue: str(totalValue(s.batches)),
      closingAtSale: str(totalAtSale(s.batches)),
      closingCartons: cartons(totalQuantity(s.batches), p.id),
      closingBatches: s.batches.map(toBatchResult),
      dueFromCompany: str(s.dueFromCompany),
      dueFromCompanyValue: str(s.dueValue),
      damagedStock: str(s.damagedStock),
      damageAtCompany: str(s.damageAtCompany),
    };
  });
  const allTotals = [...totals.values()];
  const closingValue = sum([...products.values()].map((s) => totalValue(s.batches)));

  const personMonth = [...personTotals].map(([staffId, byProduct]) => ({
    staffId,
    products: [...byProduct].map(([productId, v]) => ({
      productId,
      net: str(v.net),
      cartons: cartons(v.net, productId),
      amount: str(v.amount),
    })),
    amount: str(sum([...byProduct.values()].map((v) => v.amount))),
  }));

  const dueKeys = new Set([...marketDueOpening.keys(), ...marketDue.keys()]);
  const byDsr = [...dueKeys].map((staffId) => ({
    staffId,
    opening: str(marketDueOpening.get(staffId) ?? ZERO),
    added: str(marketDueAdded.get(staffId) ?? ZERO),
    collected: str(marketDueCollected.get(staffId) ?? ZERO),
    closing: str(marketDue.get(staffId) ?? ZERO),
  }));
  const shopKeys = new Set([...shopDueOpening.keys(), ...shopDue.keys()]);
  const byShop = [...shopKeys].map((shopId) => ({
    shopId,
    opening: str(shopDueOpening.get(shopId) ?? ZERO),
    added: str(shopDueAdded.get(shopId) ?? ZERO),
    collected: str(shopDueCollected.get(shopId) ?? ZERO),
    closing: str(shopDue.get(shopId) ?? ZERO),
  }));

  const staffMonth: StaffMonthResult[] = [...staff].map(([staffId, b]) => ({
    staffId,
    opening: balanceStrings(staffOpening.get(staffId) ?? emptyBalances()),
    closing: balanceStrings(b),
    owesUs: str(b.advance.add(b.loan).add(b.shortage).add(b.srLoan)),
    weOwe: str(b.credit.add(b.salaryPayable).add(b.owedToSr)),
  }));

  const gross = sum(allTotals.map((t) => t.profitTotal));
  const expenses = sum(expensesByCategory.values());
  const damageRecovery = sum(allTotals.map((t) => t.damageRecovery)); // memo only (D47 amendment)
  const netWithoutIncentive = gross.sub(salaries).sub(expenses);

  const cashAccountKeys = [...new Set([...cashOpening.keys(), ...cashBalance.keys()])];
  const cashBook: CashBookAccountResult[] = cashAccountKeys.map((accountId) => ({
    accountId,
    opening: str(cashOpening.get(accountId) ?? ZERO),
    in: str(cashIn.get(accountId) ?? ZERO),
    out: str(cashOut.get(accountId) ?? ZERO),
    closing: str(cashBalance.get(accountId) ?? ZERO),
  }));

  const closing: MonthClosing = {
    products: Object.fromEntries(
      [...products].map(([id, s]) => {
        const prices: Partial<Record<PriceKind, string>> = {};
        for (const kind of ["orderPrice", "costPrice", "salePrice"] as const) {
          const price = s.prices[kind];
          if (price !== null) prices[kind] = str(price);
        }
        const damageLots = damageLotsResult(s.damageLots, false);
        return [
          id,
          {
            stock: str(totalQuantity(s.batches)),
            batches: s.batches.map(toCarry),
            dueFromCompany: str(s.dueFromCompany),
            dueFromCompanyValue: str(s.dueValue),
            damagedStock: str(s.damagedStock),
            damageAtCompany: str(s.damageAtCompany),
            ...prices,
            ...(damageLots.length === 0 ? {} : { damageLots }),
          },
        ];
      }),
    ),
    marketDue: Object.fromEntries([...marketDue].map(([k, v]) => [k, str(v)])),
    shopDue: Object.fromEntries([...shopDue].map(([k, v]) => [k, str(v)])),
    staff: Object.fromEntries([...staff].map(([k, b]) => [k, balanceStrings(b)])),
    companyPayable: str(companyPayable),
    companyDamageBalance: str(damageFund),
    companyIncentiveBalance: str(incentiveFund),
    cashAccounts: Object.fromEntries([...cashBalance].map(([k, v]) => [k, str(v)])),
  };

  return {
    days,
    month: {
      products: productMonth,
      totals: {
        orderTotal: str(sum(allTotals.map((t) => t.orderTotal))),
        receiptTotal: str(sum(allTotals.map((t) => t.receiptTotal))),
        commissionTotal: str(sum(allTotals.map((t) => t.commissionTotal))),
        salesTotal: str(sum(allTotals.map((t) => t.salesTotal))),
        costTotal: str(sum(allTotals.map((t) => t.costTotal))),
        profitTotal: str(gross),
        damageValue: str(sum(allTotals.map((t) => t.damageValue))),
        damageRecovery: str(damageRecovery),
        replacementValue: str(sum(allTotals.map((t) => t.replacementValue))),
        closingValue: str(closingValue),
      },
      persons: personMonth,
      marketDue: {
        opening: str(sum(marketDueOpening.values())),
        added: str(sum(marketDueAdded.values())),
        collected: str(sum(marketDueCollected.values())),
        closing: str(sum(marketDue.values())),
        byDsr,
        byShop,
      },
      staff: staffMonth,
      companyPayable: {
        opening: str(companyPayableOpening),
        orders: str(companyOrders),
        receipts: str(companyReceipts),
        deposits: str(companyDeposits),
        incentives: str(companyIncentives),
        damageRefunds: str(companyRefunds),
        investments: str(companyInvestments),
        closing: str(companyPayable),
        damageBalanceOpening: str(dec(input.opening.companyDamageBalance)),
        incentiveBalanceOpening: str(dec(input.opening.companyIncentiveBalance)),
        damageBalance: str(damageFund),
        incentiveBalance: str(incentiveFund),
        undeliveredOpening: str(undeliveredOpening),
        undeliveredClosing: str(totalDueValue()),
      },
      profit: {
        gross: str(gross),
        salaries: str(salaries),
        expenses: str(expenses),
        expensesByCategory: Object.fromEntries(
          [...expensesByCategory].map(([k, v]) => [k, str(v)]),
        ),
        srIncentive: str(srIncentive),
        net: str(netWithoutIncentive.sub(srIncentive)),
        netWithoutIncentive: str(netWithoutIncentive),
      },
      cashLeftTotal: str(cashLeftTotal),
      cashBook,
    },
    closing,
    staffEntries,
    companyEntries,
    shopEntries,
    cashEntries,
    warnings,
  };
}

/** D62: how the DSR sheet's staff money moves the expected cash handover. */
const STAFF_CASH: Partial<Record<MoneyKind, 1 | -1>> = {
  staffAdvance: -1,
  staffShortage: -1,
  staffRepayment: 1,
};

/** Reduces advance â†’ loan â†’ shortage (or an explicit allocation); returns the unallocated rest. */
function reduceOwed(
  b: Balances,
  amount: Decimal,
  allocation: Partial<Record<OwedBucket, DecimalInput>> | undefined,
): Decimal {
  if (allocation) {
    const parts = OWED_ORDER.map((k) => [k, dec(allocation[k])] as const);
    if (!sum(parts.map(([, v]) => v)).eq(amount)) {
      throw new RangeError("allocation must equal the amount");
    }
    let rest = ZERO;
    for (const [k, v] of parts) {
      const take = Decimal.min(v, Decimal.max(b[k], ZERO));
      b[k] = b[k].sub(take);
      rest = rest.add(v.sub(take));
    }
    return rest;
  }
  let rest = amount;
  for (const k of OWED_ORDER) {
    if (rest.isZero()) break;
    const take = Decimal.min(rest, Decimal.max(b[k], ZERO));
    b[k] = b[k].sub(take);
    rest = rest.sub(take);
  }
  return rest;
}
