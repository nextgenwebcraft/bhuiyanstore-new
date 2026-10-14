import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { MONEY_KIND_EFFECTS } from "./money-kinds";
import { owedBuckets } from "./types";
import type {
  CompanyEntryResult,
  DayResult,
  EngineWarning,
  MonthClosing,
  MonthInput,
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
  stock: Decimal;
  dueFromCompany: Decimal;
  /** Billed value of the goods ordered and not yet received (D48), at their order prices. */
  dueValue: Decimal;
  prices: Record<PriceKind, Decimal | null>;
};

type ProductTotals = {
  ordered: Decimal;
  received: Decimal;
  issued: Decimal;
  returned: Decimal;
  delivered: Decimal;
  damaged: Decimal;
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
  /** Company damage refunds + replacement goods at unit cost (D47): income in net profit. */
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
  /** Σ split quantity × (split price − day sale price), added to sales at the day price. */
  splitAdjustment: Decimal;
  /** Shop commission (D41), taken out of sales at the day price. */
  commission: Decimal;
};

/**
 * The month engine (PLAN §2, §4): pure and deterministic. It never rounds; settlement rounding
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
    products.set(p.id, {
      stock: dec(o?.stock),
      dueFromCompany: openingDue,
      // D48: billed value of the undelivered goods; defaults to opening due × opening order price.
      dueValue: openingDue.isZero()
        ? ZERO
        : o?.dueFromCompanyValue === undefined
          ? openingDue.mul(o?.orderPrice === undefined ? ZERO : toDecimal(o.orderPrice))
          : toDecimal(o.dueFromCompanyValue),
      prices: {
        orderPrice: o?.orderPrice === undefined ? null : toDecimal(o.orderPrice),
        costPrice: o?.costPrice === undefined ? null : toDecimal(o.costPrice),
        salePrice: o?.salePrice === undefined ? null : toDecimal(o.salePrice),
      },
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

  const companyPayableOpening = dec(input.opening.companyPayable);
  let companyPayable = companyPayableOpening;
  let companyOrders = ZERO;
  let companyReceipts = ZERO; // excess receipts billed at once (D48)
  let companyDeposits = ZERO;
  let companyIncentives = ZERO;
  let companyRefunds = ZERO;
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

    const dayProducts = day.products ?? {};
    for (const id of Object.keys(dayProducts)) requireProduct(id);

    // Prices for the day: carry forward, changed by today's values.
    for (const [id, state] of products) {
      const p = dayProducts[id];
      for (const kind of ["orderPrice", "costPrice", "salePrice"] as const) {
        const v = p?.[kind];
        if (v !== undefined) state.prices[kind] = toDecimal(v);
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
      const salePrice = products.get(line.productId)?.prices.salePrice ?? ZERO;
      const splitAdjustment = sum(splits.map((s) => s.quantity.mul(s.unitPrice.sub(salePrice))));
      const agg = lineAggregates.get(line.productId) ?? {
        issued: ZERO,
        returned: ZERO,
        damaged: ZERO,
        splitAdjustment: ZERO,
        commission: ZERO,
      };
      agg.issued = agg.issued.add(issued);
      agg.returned = agg.returned.add(returned);
      agg.damaged = agg.damaged.add(damaged);
      agg.splitAdjustment = agg.splitAdjustment.add(splitAdjustment);
      agg.commission = agg.commission.add(commission);
      lineAggregates.set(line.productId, agg);

      const net = issued.sub(returned);
      const amount = net.mul(salePrice).add(splitAdjustment).sub(commission);
      const soldValue = lineSold.mul(salePrice).add(splitAdjustment).sub(commission);
      const dsr = dsrOf(line.staffId);
      dsr.sales = dsr.sales.add(soldValue);
      persons.push({
        staffId: line.staffId,
        productId: line.productId,
        issued: str(issued),
        returned: str(returned),
        net: str(net),
        damaged: str(damaged),
        amount: str(amount),
        sold: str(lineSold),
        commission: str(commission),
        soldValue: str(soldValue),
      });
      const byProduct =
        personTotals.get(line.staffId) ?? new Map<ProductId, { net: Decimal; amount: Decimal }>();
      const pt = byProduct.get(line.productId) ?? { net: ZERO, amount: ZERO };
      byProduct.set(line.productId, { net: pt.net.add(net), amount: pt.amount.add(amount) });
      personTotals.set(line.staffId, byProduct);
    }

    const productResults: ProductDayResult[] = [];
    let daySales = ZERO;
    let dayCommission = ZERO;
    const dayRefunds: CompanyEntryResult[] = [];
    const dayFreeGoods: CompanyEntryResult[] = [];
    const dayReplacements: CompanyEntryResult[] = [];
    for (const [id, state] of products) {
      const p = dayProducts[id];
      const agg = lineAggregates.get(id);
      const ordered = dec(p?.ordered);
      const received = dec(p?.received);
      const incentiveReceived = dec(p?.incentiveReceived);
      if (incentiveReceived.isNegative()) throw new RangeError(`invalid free goods: ${id}`);
      if (!incentiveReceived.isZero()) {
        dayFreeGoods.push({
          date: day.date,
          kind: "freeGoods",
          amount: "0",
          productId: id,
          quantity: str(incentiveReceived),
          balance: "",
          undelivered: "",
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
          balance: "",
          undelivered: "",
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
        refundValue = refundValue.add(amount);
        dayRefunds.push({
          date: day.date,
          kind: "damageRefund",
          amount: str(amount),
          ...(refund.ref === undefined ? {} : { ref: refund.ref }),
          productId: id,
          balance: "",
          undelivered: "",
        });
      }
      const damageRecovery = refundValue.add(replacementValue);
      const issued = agg?.issued ?? ZERO;
      const returned = agg?.returned ?? ZERO;
      const delivered = issued.sub(returned);
      const damaged = dec(p?.damaged).add(agg?.damaged ?? ZERO);
      const sold = delivered.sub(damaged);
      const replacedFromStock = dec(p?.replacedFromStock);

      const priceFor = (kind: PriceKind, quantity: Decimal): Decimal => {
        const price = state.prices[kind];
        if (price === null) {
          if (!quantity.isZero()) warn({ code: "MISSING_PRICE", productId: id, detail: kind });
          return ZERO;
        }
        return price;
      };
      const orderPrice = priceFor("orderPrice", ordered.abs().add(received.abs()));
      const costPrice = priceFor(
        "costPrice",
        delivered.abs().add(damaged.abs()).add(replacedFromStock.abs()),
      );
      const salePrice = priceFor("salePrice", sold.abs().add(returned.abs()));

      const commission = agg?.commission ?? ZERO;
      const sales = sold
        .mul(salePrice)
        .add(agg?.splitAdjustment ?? ZERO)
        .sub(commission);
      // D47: cost of every delivered piece (damaged ones included) and of the good pieces handed out
      // of the godown for buyers' damaged ones; sales already fall by the damaged pieces.
      const cost = delivered.add(replacedFromStock).mul(costPrice);
      const grossProfit = sales.sub(cost);

      // D48: an order is billed at once; receiving ordered goods moves no money, only excess is billed.
      const orderBill = ordered.mul(orderPrice);
      state.dueFromCompany = state.dueFromCompany.add(ordered);
      state.dueValue = state.dueValue.add(orderBill);
      companyOrders = companyOrders.add(orderBill);
      companyPayable = companyPayable.add(orderBill);
      if (ordered.gt(0)) {
        companyEntries.push({
          date: day.date,
          kind: "order",
          amount: str(orderBill),
          productId: id,
          quantity: str(ordered),
          balance: str(companyPayable),
          undelivered: str(totalDueValue()),
        });
      }
      // D46: goods due is never negative; an excess receipt offsets no later order.
      const dueBeforeReceipt = state.dueFromCompany;
      const covered = Decimal.min(Decimal.max(received, ZERO), dueBeforeReceipt);
      const excess = Decimal.max(received, ZERO).sub(covered);
      const valueBefore = state.dueValue;
      state.dueFromCompany = Decimal.max(ZERO, dueBeforeReceipt.sub(received));
      const released = state.dueFromCompany.isZero()
        ? valueBefore // exactly 0 when the due clears
        : valueBefore.mul(covered).div(dueBeforeReceipt);
      state.dueValue = valueBefore.sub(released);
      const excessBill = excess.mul(orderPrice);
      companyPayable = companyPayable.add(excessBill);
      companyReceipts = companyReceipts.add(excessBill);
      // Billed value of the goods received: undelivered value released + excess billed now.
      const receiptValue = released.add(excessBill);
      if (received.gt(0)) {
        companyEntries.push({
          date: day.date,
          kind: "receipt",
          amount: str(excessBill),
          productId: id,
          quantity: str(received),
          balance: str(companyPayable),
          undelivered: str(totalDueValue()),
        });
      }
      state.stock = state.stock
        .add(received)
        .add(replacementReceived)
        .add(incentiveReceived)
        .sub(delivered)
        .sub(replacedFromStock);
      if (state.stock.isNegative()) {
        warn({ code: "NEGATIVE_STOCK", productId: id, detail: str(state.stock) });
      }
      const stockValue = state.stock.mul(state.prices.costPrice ?? ZERO);

      const t = totals.get(id) as ProductTotals;
      const orderValue = orderBill;
      const receiptBill = excessBill;
      const receiptSale = received.mul(state.prices.salePrice ?? ZERO);
      const returnValue = returned.mul(state.prices.salePrice ?? ZERO);
      const damageValue = damaged.add(replacedFromStock).mul(costPrice);
      t.ordered = t.ordered.add(ordered);
      t.received = t.received.add(received);
      t.issued = t.issued.add(issued);
      t.returned = t.returned.add(returned);
      t.delivered = t.delivered.add(delivered);
      t.damaged = t.damaged.add(damaged);
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
        sold: str(sold),
        orderPrice: priceString("orderPrice"),
        costPrice: priceString("costPrice"),
        salePrice: priceString("salePrice"),
        commission: str(commission),
        sales: str(sales),
        cost: str(cost),
        grossProfit: str(grossProfit),
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
        stock: str(state.stock),
        stockValue: str(stockValue),
      });
    }

    for (const refund of dayRefunds) {
      companyPayable = companyPayable.sub(toDecimal(refund.amount));
      companyEntries.push({
        ...refund,
        balance: str(companyPayable),
        undelivered: str(totalDueValue()),
      });
    }
    for (const memo of [...dayFreeGoods, ...dayReplacements]) {
      companyEntries.push({
        ...memo,
        balance: str(companyPayable),
        undelivered: str(totalDueValue()),
      });
    }

    let cashIn = ZERO;
    let cashOut = ZERO;
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
      if (effect.cash === 1) cashIn = cashIn.add(amount);
      if (effect.cash === -1) cashOut = cashOut.add(amount);

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
        }
        companyEntries.push({
          date: day.date,
          kind: effect.company,
          amount: str(amount),
          ...(entry.ref === undefined ? {} : { ref: entry.ref }),
          balance: str(companyPayable),
          undelivered: str(totalDueValue()),
        });
      }

      if (entry.kind === "staffCostPaid" && entry.staffId) {
        costPaid.set(entry.staffId, (costPaid.get(entry.staffId) ?? ZERO).add(amount));
      }

      if (effect.staff && entry.staffId) {
        const b = staffOf(entry.staffId);
        const before = { ...b };
        if (effect.staff.balance === "owed") {
          const left = reduceOwed(b, amount, entry.allocation);
          if (left.gt(0)) {
            b.credit = b.credit.add(left);
            warn({ code: "REPAYMENT_EXCEEDS_DUE", staffId: entry.staffId, detail: str(left) });
          }
        } else {
          const key = effect.staff.balance;
          b[key] = b[key].add(effect.staff.direction === 1 ? amount : amount.neg());
          if (b[key].isNegative()) {
            warn({ code: "NEGATIVE_BALANCE", staffId: entry.staffId, detail: key });
          }
        }
        if (effect.staffAlso) {
          const key = effect.staffAlso.balance;
          b[key] = b[key].add(effect.staffAlso.direction === 1 ? amount : amount.neg());
          if (b[key].isNegative()) {
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
      }
    }
    for (const [key, value] of marketDue) {
      if (value.isNegative()) {
        warn({ code: "NEGATIVE_MARKET_DUE", ...(key ? { staffId: key } : {}), detail: str(value) });
      }
    }

    const cashLeft = daySales.add(cashIn).sub(cashOut);
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
      })),
      money: {
        sales: str(daySales),
        commission: str(dayCommission),
        marketDueNew: str(dayDueNew),
        marketDueCollected: str(dayDueCollected),
        srIncentive: str(dayIncentive),
        expenses: str(dayExpenses),
        cashIn: str(cashIn),
        cashOut: str(cashOut),
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
      closingStock: str(s.stock),
      closingValue: str(s.stock.mul(s.prices.costPrice ?? ZERO)),
      closingAtSale: str(s.stock.mul(s.prices.salePrice ?? ZERO)),
      closingCartons: cartons(s.stock, p.id),
      dueFromCompany: str(s.dueFromCompany),
      dueFromCompanyValue: str(s.dueValue),
    };
  });
  const allTotals = [...totals.values()];
  const closingValue = sum(
    [...products.values()].map((s) => s.stock.mul(s.prices.costPrice ?? ZERO)),
  );

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
  const damageRecovery = sum(allTotals.map((t) => t.damageRecovery));
  const netWithoutIncentive = gross.sub(salaries).sub(expenses).add(damageRecovery);

  const closing: MonthClosing = {
    products: Object.fromEntries(
      [...products].map(([id, s]) => {
        const prices: Partial<Record<PriceKind, string>> = {};
        for (const kind of ["orderPrice", "costPrice", "salePrice"] as const) {
          const price = s.prices[kind];
          if (price !== null) prices[kind] = str(price);
        }
        return [
          id,
          {
            stock: str(s.stock),
            dueFromCompany: str(s.dueFromCompany),
            dueFromCompanyValue: str(s.dueValue),
            ...prices,
          },
        ];
      }),
    ),
    marketDue: Object.fromEntries([...marketDue].map(([k, v]) => [k, str(v)])),
    shopDue: Object.fromEntries([...shopDue].map(([k, v]) => [k, str(v)])),
    staff: Object.fromEntries([...staff].map(([k, b]) => [k, balanceStrings(b)])),
    companyPayable: str(companyPayable),
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
        closing: str(companyPayable),
        undeliveredOpening: str(undeliveredOpening),
        undeliveredClosing: str(totalDueValue()),
      },
      profit: {
        gross: str(gross),
        damageRecovery: str(damageRecovery),
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
    },
    closing,
    staffEntries,
    companyEntries,
    shopEntries,
    warnings,
  };
}

/** Reduces advance → loan → shortage (or an explicit allocation); returns the unallocated rest. */
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
