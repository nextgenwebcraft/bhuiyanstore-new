import {
  Decimal,
  computeMonth,
  datesBetween,
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shiftMonth,
  shiftBusinessDate,
  sumQuantities,
  toMonthOpening,
  type CompanyFund,
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
import { openingBatches } from "./batches";

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

/** D53: godown damage is its own engine input (stock and cost fall, no sales), not product-level damaged. */
const STOCK_FIELD: Record<
  Exclude<StockEntryKind, "damageDeposit">,
  "ordered" | "received" | "godownDamaged" | "incentiveReceived"
> = {
  order: "ordered",
  receipt: "received",
  damage: "godownDamaged",
  incentive: "incentiveReceived",
};

/**
 * D72: all money is cash, so each company has one cash bucket: the first active `cash` account
 * of its opening cash lines, else the tenant's first active one; `""` when none exists. Every
 * opening cash line and money entry counts in this bucket, whatever account it was stored with.
 */
export async function cashAccountOf(db: Db, tenantId: string, companyId: string): Promise<string> {
  const [accounts, lines] = await Promise.all([
    db.cashAccount.findMany({
      where: { tenantId, active: true, kind: "cash" },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.openingBalanceLine.findMany({
      where: { kind: "cash", cashAccountId: { not: null }, session: { companyId } },
      select: { cashAccountId: true },
    }),
  ]);
  const opened = new Set(lines.map((l) => l.cashAccountId));
  return (accounts.find((a) => opened.has(a.id)) ?? accounts[0])?.id ?? "";
}

/** D72: an opening's account balances as one cash bucket. */
function singleCash(opening: MonthOpening, cash: string): MonthOpening {
  if (!opening.cashAccounts) return opening;
  const total = Object.values(opening.cashAccounts).reduce<Decimal>(
    (sum, amount) => sum.add(amount),
    new Decimal(0),
  );
  return { ...opening, cashAccounts: total.isZero() ? {} : { [cash]: total.toString() } };
}

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

/**
 * A month-close snapshot stored before D48 has no billed undelivered value and its payable leaves
 * the undelivered goods out. As an opening it gets `due × order price` per product, added to the
 * payable, so it means what D48 says: the balance after the undelivered goods were billed.
 */
export function upgradeClosing(snapshot: MonthClosing): MonthClosing {
  const entries = Object.entries(snapshot.products);
  if (entries.every(([, p]) => p.dueFromCompanyValue !== undefined && p.batches !== undefined)) {
    return snapshot;
  }
  let billed = new Decimal(0);
  const products = Object.fromEntries(
    entries.map(([id, original]) => {
      let p = original;
      // D49: a snapshot stored before batches holds its stock as one batch at the closing prices.
      if (p.batches === undefined && !new Decimal(p.stock).isZero()) {
        p = {
          ...p,
          batches: [
            {
              seq: 1,
              startDate: "opening",
              costPrice: p.costPrice ?? "0",
              salePrice: p.salePrice ?? "0",
              quantity: p.stock,
            },
          ],
        };
      }
      if (p.dueFromCompanyValue !== undefined) return [id, p];
      const value = Decimal.max(0, new Decimal(p.dueFromCompany)).mul(p.orderPrice ?? "0");
      billed = billed.add(value);
      return [id, { ...p, dueFromCompanyValue: value.toString() }];
    }),
  );
  return {
    ...snapshot,
    products,
    companyPayable: new Decimal(snapshot.companyPayable).add(billed).toString(),
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
  const batches = await openingBatches(db, companyId);
  const opening = toMonthOpening({
    cutoffDate,
    stock: session.stock.map((line) => ({
      productId: line.productId,
      pieces: plain(line.pieces),
      damagedPieces: plain(line.damagedPieces),
      unitCost: plain(line.unitCost),
      salePrice: plain(line.salePrice),
      dueFromCompany: plain(line.dueFromCompany),
      batch: batches.get(line.productId) ?? null,
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
  tenantId: string,
  companyId: string,
  from: string,
  to: string,
  opening: MonthOpening,
) {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [products, prices, stock, dsrDays, money, damage, cash] = await Promise.all([
    db.product.findMany({
      where: { companyId },
      include: { packs: true },
      orderBy: { sku: "asc" },
    }),
    db.priceChange.findMany({
      where: { product: { companyId }, effectiveFrom: { lte: toDbDate(to) } },
      orderBy: { effectiveFrom: "asc" },
    }),
    db.stockEntry.findMany({
      where: { companyId, status: "posted", date: range },
      include: { batch: { select: { seq: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.dsrDay.findMany({
      where: { companyId, status: "posted", date: range },
      include: {
        lines: { include: { splits: true }, orderBy: { product: { sku: "asc" } } },
      },
      orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }],
    }),
    // D72: an old transfer between two accounts nets to nothing in the single cash bucket.
    db.moneyEntry.findMany({
      where: { companyId, status: "posted", date: range, kind: { not: "cashTransfer" } },
      orderBy: { createdAt: "asc" },
    }),
    // Only these damage legs reach the engine: stock (D17), money back from the company (D33)
    // and the damaged-goods custody legs (D53). A buyer replacement from the DSR's samari is on
    // the sheet already.
    db.damageEvent.findMany({
      where: {
        companyId,
        status: "posted",
        date: range,
        OR: [
          { kind: "buyerReplacement", fromStock: true },
          {
            kind: {
              in: [
                "companyReplacement",
                "companyRefund",
                "companyDispatch",
                "companyReject",
                "writeOff",
              ],
            },
          },
        ],
      },
      include: { line: { select: { productId: true } } },
      orderBy: { createdAt: "asc" },
    }),
    cashAccountOf(db, tenantId, companyId),
  ]);

  // D49: prices strictly before `from` open the range (latest wins); a price effective on a day
  // inside the range, `from` included, is that day's input, so a receipt that day can start a new
  // batch. The opening's own prices (written at the cutoff, `source = 'opening'`) equal the opening
  // batch, so on the cutoff day they change nothing and never create a batch.
  const openingProducts: Record<string, MonthOpening["products"][string]> = {
    ...opening.products,
  };
  const days = new Map<string, Required<Pick<DayInput, "products" | "dsrLines" | "money">>>(
    datesBetween(from, to).map((date) => [date, { products: {}, dsrLines: [], money: [] }]),
  );
  const dayDefaults = { defaultCashAccount: cash, defaultDepositAccount: cash };
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
    if (date < from) {
      const current = openingProducts[change.productId] ?? { stock: "0", dueFromCompany: "0" };
      openingProducts[change.productId] = { ...current, [kind]: price };
    } else {
      (dayProduct(date, change.productId) as Record<PriceKind, string>)[kind] = price;
    }
  }

  for (const entry of stock) {
    if (entry.kind === "order" && entry.cartonRate !== null && entry.piecesPerCarton !== null) {
      // D57: an order with a carton rate and free goods; older rows (no rate) stay `ordered`.
      const product = dayProduct(fromDbDate(entry.date), entry.productId);
      product.orders = [
        ...(product.orders ?? []),
        {
          pieces: plain(entry.pieces),
          freePieces: entry.freePieces === null ? "0" : plain(entry.freePieces),
          cartonRate: plain(entry.cartonRate),
          piecesPerCarton: String(entry.piecesPerCarton),
          ref: entry.id,
          ...(entry.fundFrom.length > 0 ? { fundFrom: entry.fundFrom as CompanyFund[] } : {}),
          ...(entry.orderGroup ? { group: entry.orderGroup } : {}),
        },
      ];
      continue;
    }
    if (entry.kind === "receipt" && entry.batchId && entry.batch) {
      // D68: received into the named batch at the receipt's own prices.
      const product = dayProduct(fromDbDate(entry.date), entry.productId);
      product.batchReceipts = [
        ...(product.batchReceipts ?? []),
        {
          key: entry.batchId,
          seq: entry.batch.seq,
          quantity: plain(entry.pieces),
          costPrice: plain(entry.costPrice) ?? "0",
          salePrice: plain(entry.salePrice) ?? "0",
        },
      ];
      continue;
    }
    if (entry.kind === "damageDeposit") {
      // D63: damaged pieces handed to the company for money: they leave damaged stock and the
      // company returns their value at once (a dispatch plus a money return).
      const target = dayProduct(fromDbDate(entry.date), entry.productId);
      const pieces = plain(entry.pieces);
      target.companyDispatched = sumQuantities([target.companyDispatched ?? "0", pieces]);
      target.companyRefunds = [
        ...(target.companyRefunds ?? []),
        { quantity: pieces, unitCost: plain(entry.unitPrice) ?? "0", ref: entry.id },
      ];
      continue;
    }
    const target = dayProduct(fromDbDate(entry.date), entry.productId) as Record<string, string>;
    const field = STOCK_FIELD[entry.kind as keyof typeof STOCK_FIELD] ?? "godownDamaged";
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
        ...(line.damageRate === null ? {} : { damageRate: plain(line.damageRate) }),
        priceSplits: line.splits.map((s) => ({
          quantity: plain(s.quantity),
          unitPrice: plain(s.unitPrice),
        })),
        ...(line.batchKey !== "" && line.batchSeq !== null
          ? {
              batch: {
                key: line.batchKey,
                seq: line.batchSeq,
                ...(line.costPrice === null ? {} : { costPrice: plain(line.costPrice) }),
                ...(line.salePrice === null ? {} : { salePrice: plain(line.salePrice) }),
              },
            }
          : {}),
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
    } else if (event.kind === "companyDispatch") {
      target.companyDispatched = sumQuantities([target.companyDispatched ?? "0", quantity]);
    } else if (event.kind === "companyReject") {
      target.companyRejected = sumQuantities([target.companyRejected ?? "0", quantity]);
    } else if (event.kind === "writeOff") {
      target.writtenOff = sumQuantities([target.writtenOff ?? "0", quantity]);
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
      ...(entry.productId ? { productId: entry.productId } : {}),
      ...(allocation ? { allocation } : {}),
    });
  }

  return {
    products: products.map((p) => ({
      id: p.id,
      piecesPerCarton: String(packOn(p.packs, from)?.piecesPerCarton ?? 1),
    })),
    opening: { ...singleCash(opening, cash), products: openingProducts },
    days: [...days].map(([date, day]) => ({ date, ...dayDefaults, ...day })),
    staffWarnings: false,
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
  const tenantId = access.company.tenantId;
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
      // A snapshot stored before the cash book has no account balances (D52): the engine
      // starts the accounts at 0 and warns once; reopening and closing again fixes it.
      opening = {
        ...upgradeClosing(snapshot),
        ...(snapshot.cashAccounts ? {} : { cashSnapshotMissing: true }),
      };
    } else {
      opening = computeMonth(
        await rangeInput(db, tenantId, companyId, start, lastOfMonth(month), opening),
      ).closing;
    }
    start = firstOfMonth(shiftMonth(month, 1));
  }
  const input = await rangeInput(db, tenantId, companyId, start, to, opening);
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
  const input = await rangeInput(
    db,
    access.company.tenantId,
    access.company.id,
    start,
    to,
    opening,
  );
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
  const natSort = (a: { sku: string }, b: { sku: string }) =>
    a.sku.localeCompare(b.sku, undefined, { numeric: true });
  return {
    products: products.sort(natSort).map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      piecesPerCarton: String(packOn(p.packs, date)?.piecesPerCarton ?? 1),
    })),
    staff: new Map(staff.map((s) => [s.id, s.name])),
  };
}
