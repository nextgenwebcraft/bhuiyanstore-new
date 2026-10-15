import type {
  MoneyEntryKind,
  OpeningBalanceKind,
  SrLoanType,
  StockEntryKind,
} from "@bsd/contracts";
import { Decimal, computeMonth, type DecimalInput, type MonthClosing } from "@bsd/domain";
import type { SheetReadResult } from "@bsd/importer";

/**
 * D45: the pure half of `pnpm db:seed-demo`. A workbook read result becomes a typed plan of what
 * to create (products, people, shops, opening, two replayed days); `seed-demo.ts` only walks the
 * plan and calls the application services. No I/O, no database, no workbook value is stored here.
 * Parties are referenced by plan keys (sheet keys, `sample-sr-N`, `<dsr>#N`) until created.
 */

export type SeedPlanOptions = {
  companyName: string;
  /** First replayed day and the opening's go-live date (YYYY-MM-DD). */
  cutoff: string;
};

export type PlanProduct = {
  key: string;
  sku: string;
  name: string;
  piecesPerCarton: string;
  /** The sheet had no carton size, so the default was used. */
  cartonFallback: boolean;
};

export type PlanPerson = {
  key: string;
  name: string;
  roleKind: "dsr" | "sr" | "general";
  employer: "distributor" | "supplier";
  monthlySalary: string | null;
  from: string;
  sample: boolean;
};

export type PlanShop = {
  key: string;
  name: string;
  dsrKey: string;
  area: string;
  dueLimit: string;
};

export type PlanOpeningStock = {
  productKey: string;
  pieces: string;
  dueFromCompany: string;
  unitCost: string | null;
  salePrice: string | null;
  orderPrice: string | null;
  note: string;
};

export type PlanOpeningBalance = {
  kind: OpeningBalanceKind;
  personKey: string | null;
  shopKey: string | null;
  cashAccountName: string | null;
  amount: string;
  note: string;
};

/** `cartonRate` (D57) is set on order lines only: the current order price × the carton size. */
export type PlanStockLine = {
  kind: StockEntryKind;
  productKey: string;
  pieces: string;
  cartonRate?: string;
};
export type PlanPrice = { productKey: string; kind: "order" | "cost" | "sale"; price: string };
export type PlanDsrSheet = {
  dsrKey: string;
  lines: {
    productKey: string;
    issued: string;
    returned: string;
    damaged: string;
    commission: string;
  }[];
};
export type PlanMoney = {
  kind: MoneyEntryKind;
  amount: string;
  personKey: string | null;
  shopKey: string | null;
  /** Expense category by name. */
  category: string | null;
  srLoanType: SrLoanType | null;
};
export type PlanDamageCase = {
  dsrKey: string;
  productKey: string;
  quantity: string;
  note: string;
};
export type PlanDay = {
  date: string;
  stock: PlanStockLine[];
  prices: PlanPrice[];
  dsrSheets: PlanDsrSheet[];
  money: PlanMoney[];
  damageCases: PlanDamageCase[];
};

export type SeedPlan = {
  companyName: string;
  cutoff: string;
  products: PlanProduct[];
  people: PlanPerson[];
  shops: PlanShop[];
  expenseCategories: string[];
  cashAccounts: { name: string; kind: "cash" | "bank" }[];
  opening: {
    stock: PlanOpeningStock[];
    marketDue: PlanOpeningBalance[];
    shopDue: PlanOpeningBalance[];
    staff: PlanOpeningBalance[];
    company: PlanOpeningBalance[];
    cash: PlanOpeningBalance[];
  };
  days: PlanDay[];
  /** Counts and reasons only; never a workbook value. */
  notes: string[];
};

export const CATEGORY_OFFICE = "অফিস খরচ";
export const CATEGORY_TRANSPORT = "পরিবহন খরচ";
export const CASH_ACCOUNT = "নগদ ক্যাশ";
export const BANK_ACCOUNT = "ব্যাংক হিসাব";
export const ASSIGNMENT_FROM = "2026-09-01";
const DEFAULT_CARTON = "24";
const SAMPLE_NOTE = "নমুনা";

const ZERO = new Decimal(0);
const dec = (v: DecimalInput | undefined | null): Decimal => new Decimal(v ?? 0);

/** Whole pieces ≥ 0 (never negative, fractions dropped). */
function whole(v: DecimalInput | undefined | null): Decimal {
  const d = dec(v).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return d.lte(0) ? ZERO : d;
}

const pieces = (d: Decimal): string => d.toFixed(0);
const money = (d: Decimal): string => d.toFixed(2);
/** A per-piece price with at most 6 decimals, no exponent. */
const unitPrice = (v: DecimalInput | undefined | null): string | null =>
  v === undefined || v === null ? null : dec(v).toDecimalPlaces(6).toFixed();

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isTransport = (label: string) => /transport|পরিবহন|গাড়ি|vehicle|fuel|ভাড়া/i.test(label);

type PriceKindName = "order" | "cost" | "sale";
const PRICE_FIELDS = [
  ["order", "orderPrice"],
  ["cost", "costPrice"],
  ["sale", "salePrice"],
] as const;

export function buildSeedPlan(read: SheetReadResult, options: SeedPlanOptions): SeedPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.cutoff))
    throw new RangeError("cutoff must be YYYY-MM-DD");
  const notes: string[] = [];
  const closing: MonthClosing = computeMonth(read.input).closing;

  // ---- products
  const width = Math.max(2, String(read.products.length).length);
  const products: PlanProduct[] = read.products.map((p, i) => {
    const sized = p.cartonSize !== undefined && /^[1-9]\d*$/.test(p.cartonSize);
    return {
      key: p.id,
      sku: `DRK-${String(i + 1).padStart(width, "0")}`,
      name: p.name,
      piecesPerCarton: sized ? (p.cartonSize as string) : DEFAULT_CARTON,
      cartonFallback: !sized,
    };
  });
  const firstProduct = products[0];
  if (!firstProduct) throw new Error("the sheet has no products");
  const fallbacks = products.filter((p) => p.cartonFallback).length;
  if (fallbacks > 0) {
    notes.push(
      `carton size missing in the sheet: default ${DEFAULT_CARTON} used for ${fallbacks} product(s)`,
    );
  }

  // ---- people
  const dsrLabels = new Set(read.persons.map((p) => p.trim()));
  const people: PlanPerson[] = [];
  for (const dsr of read.people.filter((p) => dsrLabels.has(p.label))) {
    people.push({
      key: dsr.key,
      name: dsr.label,
      roleKind: "dsr",
      employer: "distributor",
      monthlySalary: "12000",
      from: ASSIGNMENT_FROM,
      sample: false,
    });
  }
  const dsrs = people.filter((p) => p.roleKind === "dsr");
  const firstDsr = dsrs[0];
  if (!firstDsr) throw new Error("the sheet has no DSR persons");
  for (const other of read.people.filter((p) => !dsrLabels.has(p.label))) {
    people.push({
      key: other.key,
      name: other.label,
      roleKind: "general",
      employer: "distributor",
      monthlySalary: "15000",
      from: ASSIGNMENT_FROM,
      sample: false,
    });
  }
  const srs: PlanPerson[] = ["নমুনা এসআর ১", "নমুনা এসআর ২"].map((name, i) => ({
    key: `sample-sr-${i + 1}`,
    name,
    roleKind: "sr",
    employer: "supplier",
    monthlySalary: null,
    from: ASSIGNMENT_FROM,
    sample: true,
  }));
  people.push(...srs);
  const firstSr = srs[0] as PlanPerson;
  const personByKey = new Map(people.map((p) => [p.key, p]));
  const managers = people.filter((p) => p.roleKind === "general");
  // Sample staff money (advance, repayment) goes to a manager, else to the first DSR.
  const sampleStaff = managers[0] ?? firstDsr;

  // ---- shops: two per DSR
  const shops: PlanShop[] = dsrs.flatMap((dsr) =>
    [1, 2].map((n) => ({
      key: `${dsr.key}#${n}`,
      name: `${dsr.name}-এর দোকান ${n}`,
      dsrKey: dsr.key,
      area: "নমুনা এলাকা",
      dueLimit: "50000",
    })),
  );
  const firstShop = shops[0] as PlanShop;

  // ---- opening
  const stock: PlanOpeningStock[] = [];
  const runPrices = new Map<string, Partial<Record<PriceKindName, string>>>();
  let costFallbacks = 0;
  // D48: the opening company balance is the balance after the undelivered goods were billed.
  let undeliveredBilled = new Decimal(0);
  for (const product of products) {
    const c = closing.products[product.key];
    const pcs = whole(c?.stock);
    const sale = unitPrice(c?.salePrice);
    const order = unitPrice(c?.orderPrice);
    let cost = unitPrice(c?.costPrice);
    let note = "";
    if (cost === null && pcs.gt(0) && sale !== null) {
      cost = dec(sale).mul("0.9").toDecimalPlaces(2).toFixed();
      note = SAMPLE_NOTE;
      costFallbacks += 1;
    }
    // D46: goods due is never negative (the excess receipt is already in the company payable).
    const due = Decimal.max(0, dec(c?.dueFromCompany).toDecimalPlaces(0));
    undeliveredBilled = undeliveredBilled.add(due.mul(order ?? 0));
    stock.push({
      productKey: product.key,
      pieces: pieces(pcs),
      dueFromCompany: due.isZero() ? "0" : due.toFixed(0),
      unitCost: cost,
      salePrice: sale,
      orderPrice: order,
      note,
    });
    runPrices.set(product.key, {
      ...(order !== null ? { order } : {}),
      ...(cost !== null ? { cost } : {}),
      ...(sale !== null ? { sale } : {}),
    });
  }
  if (costFallbacks > 0) {
    notes.push(
      `opening cost missing: sample cost (sale price x 0.9) used for ${costFallbacks} product(s)`,
    );
  }

  const line = (
    kind: OpeningBalanceKind,
    amount: Decimal,
    ref: Partial<Pick<PlanOpeningBalance, "personKey" | "shopKey" | "cashAccountName">>,
    note = "",
  ): PlanOpeningBalance => ({
    kind,
    personKey: ref.personKey ?? null,
    shopKey: ref.shopKey ?? null,
    cashAccountName: ref.cashAccountName ?? null,
    amount: money(amount),
    note,
  });

  // Shop due: the closing market due split evenly; the last shop takes the rounding remainder.
  let marketTotal = ZERO;
  for (const v of Object.values(closing.marketDue)) marketTotal = marketTotal.add(v);
  const shopDue: PlanOpeningBalance[] = [];
  if (marketTotal.gt(0)) {
    const base = marketTotal.div(shops.length).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    let given = ZERO;
    shops.forEach((shop, i) => {
      const amount = i === shops.length - 1 ? marketTotal.sub(given) : base;
      given = given.add(amount);
      shopDue.push(line("shop_due", amount, { shopKey: shop.key }));
    });
  } else {
    notes.push("market due in the sheet is zero: sample shop dues used");
    for (const dsr of dsrs) {
      const mine = shops.filter((s) => s.dsrKey === dsr.key);
      shopDue.push(
        line("shop_due", new Decimal("1500"), { shopKey: mine[0]?.key ?? null }, SAMPLE_NOTE),
      );
      shopDue.push(
        line("shop_due", new Decimal("2500"), { shopKey: mine[1]?.key ?? null }, SAMPLE_NOTE),
      );
    }
  }
  const dueOf = (key: string): Decimal => dec(shopDue.find((l) => l.shopKey === key)?.amount);

  const staff: PlanOpeningBalance[] = [];
  const staffKinds: [keyof MonthClosing["staff"][string], OpeningBalanceKind][] = [
    ["shortage", "shortage"],
    ["advance", "advance"],
    ["loan", "loan"],
    ["credit", "credit"],
    ["salaryPayable", "salary_payable"],
  ];
  let unmappedBalances = 0;
  for (const [key, balances] of Object.entries(closing.staff)) {
    if (!personByKey.has(key)) {
      unmappedBalances += 1;
      continue;
    }
    for (const [field, kind] of staffKinds) {
      const amount = dec(balances[field]);
      if (amount.gt(0)) staff.push(line(kind, amount, { personKey: key }));
    }
  }
  if (unmappedBalances > 0)
    notes.push(`${unmappedBalances} person(s) with closing balances had no staff record`);
  for (const sr of srs)
    staff.push(line("sr_loan", new Decimal("5000"), { personKey: sr.key }, SAMPLE_NOTE));
  staff.push(line("owed_to_sr", new Decimal("1000"), { personKey: firstSr.key }, SAMPLE_NOTE));

  const payable = dec(closing.companyPayable).add(undeliveredBilled);
  const company: PlanOpeningBalance[] = [];
  if (payable.gt(0)) company.push(line("company_payable", payable, {}));
  else if (payable.lt(0)) company.push(line("company_advance", payable.abs(), {}));
  else {
    notes.push("company payable in the sheet is zero: sample payable used");
    company.push(line("company_payable", new Decimal("100000"), {}, SAMPLE_NOTE));
  }
  const cash = [
    line("cash", new Decimal("50000"), { cashAccountName: CASH_ACCOUNT }, SAMPLE_NOTE),
    line("cash", new Decimal("200000"), { cashAccountName: BANK_ACCOUNT }, SAMPLE_NOTE),
  ];

  // ---- the two replayed days
  const stockOf = new Map(stock.map((s) => [s.productKey, whole(s.pieces)]));
  const categoryOf = new Map(
    read.categories.map((c) => [
      c.key,
      isTransport(c.label) ? CATEGORY_TRANSPORT : CATEGORY_OFFICE,
    ]),
  );
  const dsrKeys = new Set(dsrs.map((d) => d.key));
  const productKeys = new Set(products.map((p) => p.key));
  let shopBalance = dueOf(firstShop.key);
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  let clamped = 0;

  const days: PlanDay[] = [options.cutoff, addDays(options.cutoff, 1)].map((date, dayIndex) => {
    const src = read.input.days[dayIndex];

    // godown
    const lines: PlanStockLine[] = [];
    const prices: PlanPrice[] = [];
    for (const product of products) {
      const pd = src?.products?.[product.key];
      const add = (kind: StockEntryKind, v: DecimalInput | undefined) => {
        const n = whole(v);
        if (n.gt(0)) lines.push({ kind, productKey: product.key, pieces: pieces(n) });
      };
      add("order", pd?.ordered);
      add("receipt", pd?.received);
      add("incentive", pd?.incentiveReceived);
      add("damage", pd?.damaged);
      const running = runPrices.get(product.key) ?? {};
      for (const [kind, field] of PRICE_FIELDS) {
        const price = unitPrice(pd?.[field]);
        if (price !== null && price !== running[kind]) {
          prices.push({ productKey: product.key, kind, price });
          running[kind] = price;
        }
      }
      runPrices.set(product.key, running);
    }
    const has = (kind: StockEntryKind) => lines.some((l) => l.kind === kind);
    if (!has("order")) lines.push({ kind: "order", productKey: firstProduct.key, pieces: "48" });
    if (!has("receipt"))
      lines.push({ kind: "receipt", productKey: firstProduct.key, pieces: "48" });
    if (!has("incentive"))
      lines.push({ kind: "incentive", productKey: firstProduct.key, pieces: "24" });
    // D57: an order needs its carton rate; the workbook has the per-piece order price.
    for (const l of lines) {
      if (l.kind !== "order") continue;
      const size = products.find((x) => x.key === l.productKey)?.piecesPerCarton ?? DEFAULT_CARTON;
      const price = runPrices.get(l.productKey)?.order ?? "0";
      l.cartonRate = new Decimal(price).mul(size).toDecimalPlaces(2).toString();
    }
    if (dayIndex === 1 && !has("damage")) {
      lines.push({ kind: "damage", productKey: firstProduct.key, pieces: "1" });
    }
    // running stock: receipts and free goods in, damage out (never below zero)
    for (const product of products) {
      let s = stockOf.get(product.key) ?? ZERO;
      for (const l of lines) {
        if (l.productKey === product.key && (l.kind === "receipt" || l.kind === "incentive")) {
          s = s.add(l.pieces);
        }
      }
      for (const l of lines) {
        if (l.productKey === product.key && l.kind === "damage") {
          const take = Decimal.min(dec(l.pieces), s);
          if (!take.eq(l.pieces)) clamped += 1;
          l.pieces = pieces(take);
          s = s.sub(take);
        }
      }
      stockOf.set(product.key, s);
    }
    const stockLines = lines.filter((l) => l.pieces !== "0");

    // DSR sheets (issued never above stock, returned never above issued)
    const dsrSheets: PlanDsrSheet[] = [];
    for (const dsr of dsrs) {
      const merged = new Map<string, { issued: Decimal; returned: Decimal }>();
      for (const l of src?.dsrLines ?? []) {
        if (l.staffId !== dsr.key) continue;
        if (!productKeys.has(l.productId)) {
          skip("DSR line for an unknown product");
          continue;
        }
        const available = stockOf.get(l.productId) ?? ZERO;
        const issued = Decimal.min(whole(l.issued), available);
        if (!issued.eq(whole(l.issued))) clamped += 1;
        const returned = Decimal.min(whole(l.returned), issued);
        if (issued.lte(0)) continue;
        stockOf.set(l.productId, available.sub(issued.sub(returned)));
        const row = merged.get(l.productId) ?? { issued: ZERO, returned: ZERO };
        merged.set(l.productId, {
          issued: row.issued.add(issued),
          returned: row.returned.add(returned),
        });
      }
      if (merged.size === 0) continue;
      dsrSheets.push({
        dsrKey: dsr.key,
        lines: [...merged].map(([productKey, v]) => ({
          productKey,
          issued: pieces(v.issued),
          returned: pieces(v.returned),
          damaged: "0",
          commission: "0.00",
        })),
      });
    }
    for (const l of src?.dsrLines ?? [])
      if (!dsrKeys.has(l.staffId)) skip("DSR line for a person who is not a DSR");
    if (dsrSheets.length === 0) {
      const available = stockOf.get(firstProduct.key) ?? ZERO;
      stockOf.set(firstProduct.key, available.sub(10));
      dsrSheets.push({
        dsrKey: firstDsr.key,
        lines: [
          {
            productKey: firstProduct.key,
            issued: "12",
            returned: "2",
            damaged: "0",
            commission: "0.00",
          },
        ],
      });
      notes.push("a day had no DSR lines in the sheet: one sample DSR line added");
    }
    const soldOf = (l: PlanDsrSheet["lines"][number]) =>
      dec(l.issued).sub(l.returned).sub(l.damaged);
    for (const sheet of dsrSheets) {
      const target = sheet.lines.find((l) => soldOf(l).gte(1));
      if (target) target.commission = "20.00";
    }
    if (dayIndex === 1) {
      const target = dsrSheets.flatMap((s) => s.lines).find((l) => soldOf(l).gte(2));
      if (target) target.damaged = "1";
      else
        notes.push("no DSR line had 2 or more pieces sold on day 2: sample DSR damage not added");
    }

    // money
    const money_: PlanMoney[] = [];
    const entry = (
      kind: MoneyEntryKind,
      amount: DecimalInput,
      extra: Partial<Pick<PlanMoney, "personKey" | "shopKey" | "category" | "srLoanType">> = {},
    ) => ({
      kind,
      amount: money(dec(amount)),
      personKey: extra.personKey ?? null,
      shopKey: extra.shopKey ?? null,
      category: extra.category ?? null,
      srLoanType: extra.srLoanType ?? null,
    });
    const STAFF_KINDS = new Set<MoneyEntryKind>([
      "staffAdvance",
      "staffLoan",
      "staffShortage",
      "staffRepayment",
      "staffExcess",
      "staffCostPaid",
      "staffCreditPaid",
    ]);
    const SR_KINDS = new Set<MoneyEntryKind>(["srLoan", "srRepayment", "srOwed", "srPayment"]);
    const PLAIN_KINDS = new Set<MoneyEntryKind>([
      "expense",
      "supplierDeposit",
      "companyIncentive",
      "srIncentive",
    ]);
    const sheetDue: { kind: "marketDueNew" | "marketDueCollected"; amount: Decimal }[] = [];
    for (const m of src?.money ?? []) {
      const amount = dec(m.amount).toDecimalPlaces(2);
      if (amount.lte(0)) continue;
      const kind = m.kind;
      if (kind === "marketDueNew" || kind === "marketDueCollected") sheetDue.push({ kind, amount });
      else if (kind === "srIncentive") money_.push(entry(kind, amount, { personKey: firstSr.key }));
      else if (kind === "expense") {
        money_.push(
          entry(kind, amount, { category: categoryOf.get(m.category ?? "") ?? CATEGORY_OFFICE }),
        );
      } else if (kind === "staffCostPaid") {
        const person = personByKey.get(m.staffId ?? "");
        if (person && person.roleKind !== "sr") {
          money_.push(
            entry(kind, amount, {
              personKey: person.key,
              category: categoryOf.get(m.category ?? "") ?? CATEGORY_OFFICE,
            }),
          );
        } else skip("money entry for an unmapped person");
      } else if (STAFF_KINDS.has(kind)) {
        const person = personByKey.get(m.staffId ?? "");
        if (person && person.roleKind !== "sr")
          money_.push(entry(kind, amount, { personKey: person.key }));
        else skip("money entry for an unmapped person");
      } else if (SR_KINDS.has(kind)) {
        money_.push(entry(kind, amount, { personKey: firstSr.key, srLoanType: "cash" }));
      } else if (PLAIN_KINDS.has(kind)) money_.push(entry(kind, amount));
      else skip("payroll or offset money entry (not seeded)");
    }
    // market due on the first DSR's first shop: new first, collections never above what is owed
    const dueRows: PlanMoney[] = [];
    for (const d of sheetDue.filter((x) => x.kind === "marketDueNew")) {
      shopBalance = shopBalance.add(d.amount);
      dueRows.push(
        entry("marketDueNew", d.amount, { personKey: firstDsr.key, shopKey: firstShop.key }),
      );
    }
    if (dueRows.length === 0) {
      const amount = dayIndex === 0 ? "3000" : "2000";
      shopBalance = shopBalance.add(amount);
      dueRows.push(
        entry("marketDueNew", amount, { personKey: firstDsr.key, shopKey: firstShop.key }),
      );
    }
    let collected = 0;
    for (const d of sheetDue.filter((x) => x.kind === "marketDueCollected")) {
      const amount = Decimal.min(d.amount, shopBalance);
      if (!amount.eq(d.amount)) clamped += 1;
      if (amount.lte(0)) continue;
      shopBalance = shopBalance.sub(amount);
      collected += 1;
      dueRows.push(
        entry("marketDueCollected", amount, { personKey: firstDsr.key, shopKey: firstShop.key }),
      );
    }
    if (collected === 0) {
      const amount = Decimal.min(dayIndex === 0 ? "1000" : "1500", shopBalance);
      shopBalance = shopBalance.sub(amount);
      if (amount.gt(0)) {
        dueRows.push(
          entry("marketDueCollected", amount, { personKey: firstDsr.key, shopKey: firstShop.key }),
        );
      }
    }
    money_.unshift(...dueRows);

    const absent = (kind: MoneyEntryKind) => !money_.some((m) => m.kind === kind);
    const n = dayIndex;
    if (absent("expense")) {
      money_.push(
        entry("expense", n === 0 ? "800" : "1200", {
          category: n === 0 ? CATEGORY_OFFICE : CATEGORY_TRANSPORT,
        }),
      );
    }
    const needRepayment = absent("staffRepayment");
    if (absent("staffAdvance") || needRepayment) {
      money_.push(entry("staffAdvance", n === 0 ? "2000" : "1000", { personKey: sampleStaff.key }));
    }
    if (needRepayment) money_.push(entry("staffRepayment", "500", { personKey: sampleStaff.key }));
    if (absent("supplierDeposit")) money_.push(entry("supplierDeposit", n === 0 ? "5000" : "3000"));
    if (absent("companyIncentive"))
      money_.push(entry("companyIncentive", n === 0 ? "1000" : "500"));
    if (absent("srLoan")) {
      money_.push(
        entry("srLoan", n === 0 ? "3000" : "2000", {
          personKey: firstSr.key,
          srLoanType: n === 0 ? "cash" : "commission",
        }),
      );
    }
    if (absent("srRepayment"))
      money_.push(entry("srRepayment", "500", { personKey: firstSr.key, srLoanType: "cash" }));
    if (absent("srIncentive"))
      money_.push(entry("srIncentive", n === 0 ? "1500" : "1000", { personKey: firstSr.key }));

    return {
      date,
      stock: stockLines,
      prices,
      dsrSheets,
      money: money_,
      damageCases:
        dayIndex === 1
          ? [
              {
                dsrKey: firstDsr.key,
                productKey: firstProduct.key,
                quantity: "2",
                note: SAMPLE_NOTE,
              },
            ]
          : [],
    };
  });
  for (const [reason, count] of skipped)
    notes.push(`skipped ${count} sheet entr${count === 1 ? "y" : "ies"}: ${reason}`);
  if (clamped > 0)
    notes.push(
      `${clamped} sheet quantity/amount value(s) reduced to stay within stock or what is owed`,
    );

  return {
    companyName: options.companyName,
    cutoff: options.cutoff,
    products,
    people,
    shops,
    expenseCategories: [CATEGORY_OFFICE, CATEGORY_TRANSPORT],
    cashAccounts: [
      { name: CASH_ACCOUNT, kind: "cash" },
      { name: BANK_ACCOUNT, kind: "bank" },
    ],
    opening: { stock, marketDue: [], shopDue, staff, company, cash },
    days,
    notes,
  };
}

function tally<T>(items: readonly T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${k} ${v}`).join(", ") || "none";
}

/** Counts only, so a dry run can be shown or logged without any workbook value. */
export function summarizePlan(plan: SeedPlan): string[] {
  const out = [
    `company: ${plan.companyName}, cutoff ${plan.cutoff}`,
    `products: ${plan.products.length}`,
    `staff: ${plan.people.length} (${tally(plan.people, (p) => p.roleKind)})`,
    `shops: ${plan.shops.length}`,
    `opening: stock ${plan.opening.stock.length}, marketDue ${plan.opening.marketDue.length}, shopDue ${plan.opening.shopDue.length}, staff ${plan.opening.staff.length}, company ${plan.opening.company.length}, cash ${plan.opening.cash.length}`,
  ];
  for (const day of plan.days) {
    out.push(
      `${day.date}: stock [${tally(day.stock, (l) => l.kind)}], prices ${day.prices.length}, DSR sheets ${day.dsrSheets.length} (${day.dsrSheets.reduce((n, s) => n + s.lines.length, 0)} lines), money [${tally(day.money, (m) => m.kind)}], damage cases ${day.damageCases.length}`,
    );
  }
  out.push(...plan.notes.map((n) => `note: ${n}`));
  return out;
}
