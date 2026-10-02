import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { MONEY_KIND_EFFECTS } from "./money-kinds";
import type {
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
  StaffBalanceValues,
  StaffBalances,
  StaffId,
  StaffMonthResult,
} from "./types";

const ZERO = new Decimal(0);
const OWED_ORDER: readonly OwedBucket[] = ["advance", "loan", "shortage"];
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
  salesTotal: Decimal;
  costTotal: Decimal;
  profitTotal: Decimal;
  returnValue: Decimal;
  damageValue: Decimal;
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
    salesTotal: ZERO,
    costTotal: ZERO,
    profitTotal: ZERO,
    returnValue: ZERO,
    damageValue: ZERO,
  };
}

type LineAggregate = {
  issued: Decimal;
  returned: Decimal;
  damaged: Decimal;
  /** Σ split quantity × (split price − day sale price), added to sales at the day price. */
  splitAdjustment: Decimal;
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
    products.set(p.id, {
      stock: dec(o?.stock),
      dueFromCompany: dec(o?.dueFromCompany),
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
  let companyReceipts = ZERO;
  let companyDeposits = ZERO;

  const totals = new Map<ProductId, ProductTotals>(
    input.products.map((p) => [p.id, emptyProductTotals()]),
  );
  const personTotals = new Map<StaffId, Map<ProductId, { net: Decimal; amount: Decimal }>>();
  const expensesByCategory = new Map<string, Decimal>();
  let salaries = ZERO;
  let srIncentive = ZERO;
  let cashLeftTotal = ZERO;

  const days: DayResult[] = [];
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
    for (const line of day.dsrLines ?? []) {
      requireProduct(line.productId);
      if (!line.staffId) throw new RangeError("DSR line without staffId");
      const issued = dec(line.issued);
      const returned = dec(line.returned);
      const damaged = dec(line.damaged);
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
      };
      agg.issued = agg.issued.add(issued);
      agg.returned = agg.returned.add(returned);
      agg.damaged = agg.damaged.add(damaged);
      agg.splitAdjustment = agg.splitAdjustment.add(splitAdjustment);
      lineAggregates.set(line.productId, agg);

      const net = issued.sub(returned);
      const amount = net.mul(salePrice).add(splitAdjustment);
      persons.push({
        staffId: line.staffId,
        productId: line.productId,
        issued: str(issued),
        returned: str(returned),
        net: str(net),
        damaged: str(damaged),
        amount: str(amount),
      });
      const byProduct =
        personTotals.get(line.staffId) ?? new Map<ProductId, { net: Decimal; amount: Decimal }>();
      const pt = byProduct.get(line.productId) ?? { net: ZERO, amount: ZERO };
      byProduct.set(line.productId, { net: pt.net.add(net), amount: pt.amount.add(amount) });
      personTotals.set(line.staffId, byProduct);
    }

    const productResults: ProductDayResult[] = [];
    let daySales = ZERO;
    for (const [id, state] of products) {
      const p = dayProducts[id];
      const agg = lineAggregates.get(id);
      const ordered = dec(p?.ordered);
      const received = dec(p?.received);
      const issued = agg?.issued ?? ZERO;
      const returned = agg?.returned ?? ZERO;
      const delivered = issued.sub(returned);
      const damaged = dec(p?.damaged).add(agg?.damaged ?? ZERO);
      const sold = delivered.sub(damaged);

      const priceFor = (kind: PriceKind, quantity: Decimal): Decimal => {
        const price = state.prices[kind];
        if (price === null) {
          if (!quantity.isZero()) warn({ code: "MISSING_PRICE", productId: id, detail: kind });
          return ZERO;
        }
        return price;
      };
      const orderPrice = priceFor("orderPrice", ordered.abs().add(received.abs()));
      const costPrice = priceFor("costPrice", sold.abs().add(damaged.abs()));
      const salePrice = priceFor("salePrice", sold.abs().add(returned.abs()));

      const sales = sold.mul(salePrice).add(agg?.splitAdjustment ?? ZERO);
      const cost = sold.mul(costPrice);
      const grossProfit = sales.sub(cost);
      state.dueFromCompany = state.dueFromCompany.add(ordered).sub(received);
      state.stock = state.stock.add(received).sub(delivered);
      if (state.stock.isNegative()) {
        warn({ code: "NEGATIVE_STOCK", productId: id, detail: str(state.stock) });
      }
      const stockValue = state.stock.mul(state.prices.costPrice ?? ZERO);

      const t = totals.get(id) as ProductTotals;
      const orderValue = ordered.mul(orderPrice);
      const receiptBill = received.mul(orderPrice);
      const receiptSale = received.mul(state.prices.salePrice ?? ZERO);
      const returnValue = returned.mul(state.prices.salePrice ?? ZERO);
      const damageValue = damaged.mul(costPrice);
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
      t.salesTotal = t.salesTotal.add(sales);
      t.costTotal = t.costTotal.add(cost);
      t.profitTotal = t.profitTotal.add(grossProfit);
      t.returnValue = t.returnValue.add(returnValue);
      t.damageValue = t.damageValue.add(damageValue);
      companyReceipts = companyReceipts.add(receiptBill);
      companyPayable = companyPayable.add(receiptBill);
      daySales = daySales.add(sales);

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
        sales: str(sales),
        cost: str(cost),
        grossProfit: str(grossProfit),
        returnValue: str(returnValue),
        orderValue: str(orderValue),
        receiptBill: str(receiptBill),
        receiptSale: str(receiptSale),
        damageValue: str(damageValue),
        dueFromCompany: str(state.dueFromCompany),
        stock: str(state.stock),
        stockValue: str(stockValue),
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

      if (effect.companyPayable === -1) {
        companyPayable = companyPayable.sub(amount);
        companyDeposits = companyDeposits.add(amount);
        banked = banked.add(amount);
      }

      if (effect.staff && entry.staffId) {
        const b = staffOf(entry.staffId);
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
      money: {
        sales: str(daySales),
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
      salesTotal: str(t.salesTotal),
      costTotal: str(t.costTotal),
      profitTotal: str(t.profitTotal),
      returnValue: str(t.returnValue),
      damageValue: str(t.damageValue),
      salesCartons: cartons(t.delivered, p.id),
      closingStock: str(s.stock),
      closingValue: str(s.stock.mul(s.prices.costPrice ?? ZERO)),
      closingAtSale: str(s.stock.mul(s.prices.salePrice ?? ZERO)),
      closingCartons: cartons(s.stock, p.id),
      dueFromCompany: str(s.dueFromCompany),
      dueFromCompanyValue: str(s.dueFromCompany.mul(s.prices.orderPrice ?? ZERO)),
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

  const staffMonth: StaffMonthResult[] = [...staff].map(([staffId, b]) => ({
    staffId,
    opening: balanceStrings(staffOpening.get(staffId) ?? emptyBalances()),
    closing: balanceStrings(b),
    owesUs: str(b.advance.add(b.loan).add(b.shortage).add(b.srLoan)),
    weOwe: str(b.credit.add(b.salaryPayable).add(b.owedToSr)),
  }));

  const gross = sum(allTotals.map((t) => t.profitTotal));
  const expenses = sum(expensesByCategory.values());
  const netWithoutIncentive = gross.sub(salaries).sub(expenses);

  const closing: MonthClosing = {
    products: Object.fromEntries(
      [...products].map(([id, s]) => {
        const prices: Partial<Record<PriceKind, string>> = {};
        for (const kind of ["orderPrice", "costPrice", "salePrice"] as const) {
          const price = s.prices[kind];
          if (price !== null) prices[kind] = str(price);
        }
        return [id, { stock: str(s.stock), dueFromCompany: str(s.dueFromCompany), ...prices }];
      }),
    ),
    marketDue: Object.fromEntries([...marketDue].map(([k, v]) => [k, str(v)])),
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
        salesTotal: str(sum(allTotals.map((t) => t.salesTotal))),
        costTotal: str(sum(allTotals.map((t) => t.costTotal))),
        profitTotal: str(gross),
        damageValue: str(sum(allTotals.map((t) => t.damageValue))),
        closingValue: str(closingValue),
      },
      persons: personMonth,
      marketDue: {
        opening: str(sum(marketDueOpening.values())),
        added: str(sum(marketDueAdded.values())),
        collected: str(sum(marketDueCollected.values())),
        closing: str(sum(marketDue.values())),
        byDsr,
      },
      staff: staffMonth,
      companyPayable: {
        opening: str(companyPayableOpening),
        receipts: str(companyReceipts),
        deposits: str(companyDeposits),
        closing: str(companyPayable),
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
    },
    closing,
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
