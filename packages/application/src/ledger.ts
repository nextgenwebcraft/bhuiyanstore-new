import {
  computeMonth,
  datesBetween,
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shiftMonth,
  shiftBusinessDate,
  sumQuantities,
  toMonthOpening,
  type DayInput,
  type DsrLineInput,
  type MoneyEntryInput,
  type MonthClosing,
  type MonthOpening,
  type MonthOutput,
  type OpeningKind,
  type PriceKind,
  type ProductDayInput,
} from "@bsd/domain";
import type { StockEntryKind } from "@bsd/contracts";
import type { CompanyAccess } from "./access";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { plain } from "./numeric";
import { packOn } from "./products";

/**
 * Runs the month engine over posted documents (PLAN §4). Nothing here calculates: it only turns
 * stored raw facts into `MonthInput`, month by month from the live opening, so every screen
 * and report reads one engine.
 */

type Db = AppContext["db"] | Tx;

const ENGINE_PRICE: Record<string, PriceKind> = {
  order: "orderPrice",
  cost: "costPrice",
  sale: "salePrice",
};

const STOCK_FIELD: Record<
  StockEntryKind,
  "ordered" | "received" | "damaged" | "incentiveReceived"
> = {
  order: "ordered",
  receipt: "received",
  damage: "damaged",
  incentive: "incentiveReceived",
};

type DecimalColumn = Parameters<typeof plain>[0];

/** A money entry's named allocation parts, or null for the default order. */
export function allocationOf(entry: {
  allocAdvance: DecimalColumn | null;
  allocLoan: DecimalColumn | null;
  allocShortage: DecimalColumn | null;
}): { advance: string; loan: string; shortage: string } | null {
  if (entry.allocAdvance === null || entry.allocLoan === null || entry.allocShortage === null) {
    return null;
  }
  return {
    advance: plain(entry.allocAdvance),
    loan: plain(entry.allocLoan),
    shortage: plain(entry.allocShortage),
  };
}

export type ActiveOpening = { sessionId: string; cutoffDate: string; opening: MonthOpening };

/** The live opening (cutoff date saved, D43) as the engine's first opening; null before. */
export async function liveOpening(db: Db, companyId: string): Promise<ActiveOpening | null> {
  const session = await db.openingSession.findUnique({
    where: { companyId },
    include: {
      stock: true,
      balances: { orderBy: [{ kind: "asc" }, { partyKey: "asc" }] },
    },
  });
  if (!session || !session.cutoffDate) return null;
  const cutoffDate = fromDbDate(session.cutoffDate);
  const opening = toMonthOpening({
    cutoffDate,
    stock: session.stock.map((line) => ({
      productId: line.productId,
      pieces: plain(line.pieces),
      unitCost: plain(line.unitCost),
      salePrice: plain(line.salePrice),
      orderPrice: plain(line.orderPrice),
      dueFromCompany: plain(line.dueFromCompany),
    })),
    balances: session.balances.map((line) => ({
      kind: line.kind as OpeningKind,
      amount: plain(line.amount),
      staffId: line.staffId,
      cashAccountId: line.cashAccountId,
      shopId: line.shopId,
    })),
  });
  return { sessionId: session.id, cutoffDate, opening };
}

/** Engine input for [from, to] (one month at most), starting from `opening`. */
async function rangeInput(
  db: Db,
  companyId: string,
  from: string,
  to: string,
  opening: MonthOpening,
) {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [products, prices, stock, dsrDays, money, damage] = await Promise.all([
    db.product.findMany({
      where: { companyId },
      include: { packs: true },
      orderBy: { sku: "asc" },
    }),
    db.priceChange.findMany({
      where: { product: { companyId }, effectiveFrom: { lte: toDbDate(to) } },
      orderBy: { effectiveFrom: "asc" },
    }),
    db.stockEntry.findMany({ where: { companyId, status: "posted", date: range } }),
    db.dsrDay.findMany({
      where: { companyId, status: "posted", date: range },
      include: {
        lines: { include: { splits: true }, orderBy: { product: { sku: "asc" } } },
      },
      orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }],
    }),
    db.moneyEntry.findMany({
      where: { companyId, status: "posted", date: range },
      orderBy: { createdAt: "asc" },
    }),
    // Only these damage legs reach the engine: stock (D17) or money back from the company (D33).
    db.damageEvent.findMany({
      where: {
        companyId,
        status: "posted",
        date: range,
        OR: [
          { kind: "buyerReplacement", fromStock: true },
          { kind: { in: ["companyReplacement", "companyRefund"] } },
        ],
      },
      include: { line: { select: { productId: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Prices on or before `from` open the range (latest wins); later ones change on their day.
  const openingProducts: Record<string, MonthOpening["products"][string]> = {
    ...opening.products,
  };
  const days = new Map<string, Required<Pick<DayInput, "products" | "dsrLines" | "money">>>(
    datesBetween(from, to).map((date) => [date, { products: {}, dsrLines: [], money: [] }]),
  );
  const dayOf = (date: string) => {
    const day = days.get(date);
    if (!day) throw new Error(`ledger: ${date} is outside ${from}..${to}`);
    return day;
  };
  const dayProduct = (date: string, productId: string): ProductDayInput => {
    const day = dayOf(date);
    const products = day.products as Record<string, ProductDayInput>;
    return (products[productId] ??= {});
  };
  for (const change of prices) {
    const kind = ENGINE_PRICE[change.kind];
    if (!kind) continue;
    const date = fromDbDate(change.effectiveFrom);
    const price = plain(change.price);
    if (date <= from) {
      const current = openingProducts[change.productId] ?? { stock: "0", dueFromCompany: "0" };
      openingProducts[change.productId] = { ...current, [kind]: price };
    } else {
      (dayProduct(date, change.productId) as Record<PriceKind, string>)[kind] = price;
    }
  }

  for (const entry of stock) {
    const target = dayProduct(fromDbDate(entry.date), entry.productId) as Record<string, string>;
    const field = STOCK_FIELD[entry.kind as StockEntryKind] ?? "damaged";
    target[field] = sumQuantities([target[field] ?? "0", plain(entry.pieces)]);
  }

  for (const sheet of dsrDays) {
    const day = dayOf(fromDbDate(sheet.date));
    for (const line of sheet.lines) {
      (day.dsrLines as DsrLineInput[]).push({
        staffId: sheet.staffId,
        productId: line.productId,
        issued: plain(line.issued),
        returned: plain(line.returned),
        damaged: plain(line.damaged),
        commission: plain(line.commission),
        priceSplits: line.splits.map((s) => ({
          quantity: plain(s.quantity),
          unitPrice: plain(s.unitPrice),
        })),
      });
    }
    for (const kind of ["marketDueNew", "marketDueCollected"] as const) {
      const amount = plain(sheet[kind]);
      if (amount !== "0") {
        (day.money as MoneyEntryInput[]).push({ kind, amount, staffId: sheet.staffId });
      }
    }
  }

  for (const event of damage) {
    const target = dayProduct(fromDbDate(event.date), event.line.productId);
    const quantity = plain(event.quantity);
    if (event.kind === "buyerReplacement") {
      target.replacedFromStock = sumQuantities([target.replacedFromStock ?? "0", quantity]);
    } else if (event.kind === "companyRefund") {
      target.companyRefunds = [
        ...(target.companyRefunds ?? []),
        { quantity, unitCost: event.unitCost ? plain(event.unitCost) : "0", ref: event.id },
      ];
    } else {
      target.replacements = [
        ...(target.replacements ?? []),
        { quantity, unitCost: event.unitCost ? plain(event.unitCost) : "0" },
      ];
    }
  }

  for (const entry of money) {
    const day = dayOf(fromDbDate(entry.date));
    const allocation = allocationOf(entry);
    (day.money as MoneyEntryInput[]).push({
      kind: entry.kind as MoneyEntryInput["kind"],
      amount: plain(entry.amount),
      ref: entry.id,
      ...(entry.staffId ? { staffId: entry.staffId } : {}),
      ...(entry.shopId ? { shopId: entry.shopId } : {}),
      ...(entry.expenseCategoryId ? { category: entry.expenseCategoryId } : {}),
      ...(allocation ? { allocation } : {}),
    });
  }

  return {
    products: products.map((p) => ({
      id: p.id,
      piecesPerCarton: String(packOn(p.packs, from)?.piecesPerCarton ?? 1),
    })),
    opening: { ...opening, products: openingProducts },
    days: [...days].map(([date, day]) => ({ date, ...day })),
  };
}

export type LedgerRun = {
  cutoffDate: string;
  /** First date the output covers: the month start, or the cutoff in the go-live month. */
  from: string;
  to: string;
  input: DayInput[];
  output: MonthOutput;
};

/**
 * The engine output for the month containing `to`, through `to`. Earlier months come from their
 * month-close snapshot when closed, otherwise they are recalculated from posted documents.
 * Returns null before the cutoff date is saved or for a date before the cutoff.
 */
export async function runLedger(
  db: Db,
  access: CompanyAccess,
  to: string,
  known?: ActiveOpening | null,
): Promise<LedgerRun | null> {
  const companyId = access.company.id;
  const active = known === undefined ? await liveOpening(db, companyId) : known;
  if (!active || to < active.cutoffDate) return null;

  const closes = await db.monthClose.findMany({
    where: { companyId, month: { lt: monthOf(to) } },
    select: { month: true, closing: true },
  });
  const closed = new Map(closes.map((c) => [c.month, c.closing as unknown as MonthClosing]));

  let opening: MonthOpening = active.opening;
  let start = active.cutoffDate;
  for (let month = monthOf(start); month < monthOf(to); month = shiftMonth(month, 1)) {
    const snapshot = closed.get(month);
    if (snapshot) {
      opening = snapshot;
    } else {
      opening = computeMonth(
        await rangeInput(db, companyId, start, lastOfMonth(month), opening),
      ).closing;
    }
    start = firstOfMonth(shiftMonth(month, 1));
  }
  const input = await rangeInput(db, companyId, start, to, opening);
  return {
    cutoffDate: active.cutoffDate,
    from: start,
    to,
    input: input.days,
    output: computeMonth(input),
  };
}

/**
 * One engine run over [from, to] (any length), opening with the engine's state at the end of the
 * day before `from`. Month aggregates in the output then cover exactly the range. `from` is moved
 * up to the cutoff; null before the cutoff date is saved or when the whole range precedes the cutoff.
 */
export async function rangeRun(
  db: Db,
  access: CompanyAccess,
  from: string,
  to: string,
  known?: ActiveOpening | null,
): Promise<LedgerRun | null> {
  const active = known === undefined ? await liveOpening(db, access.company.id) : known;
  if (!active || to < active.cutoffDate) return null;
  const start = from < active.cutoffDate ? active.cutoffDate : from;
  let opening = active.opening;
  if (start > active.cutoffDate) {
    const before = await runLedger(db, access, shiftBusinessDate(start, -1), active);
    if (before) opening = before.output.closing;
  }
  const input = await rangeInput(db, access.company.id, start, to, opening);
  return {
    cutoffDate: active.cutoffDate,
    from: start,
    to,
    input: input.days,
    output: computeMonth(input),
  };
}

/** Product names and carton sizes on `date`, and every tenant staff name, for engine rows. */
export async function namesFor(db: Db, access: CompanyAccess, date: string) {
  const [products, staff] = await Promise.all([
    db.product.findMany({
      where: { companyId: access.company.id },
      include: { packs: true },
      orderBy: { sku: "asc" },
    }),
    db.staff.findMany({
      where: { tenantId: access.company.tenantId },
      select: { id: true, name: true },
    }),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      piecesPerCarton: String(packOn(p.packs, date)?.piecesPerCarton ?? 1),
    })),
    staff: new Map(staff.map((s) => [s.id, s.name])),
  };
}
