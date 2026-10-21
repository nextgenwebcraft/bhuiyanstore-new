import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { roundSettlement } from "../money";
import { srCost, staffCost } from "./money-kinds";
import type { DayInput, DayResult, MoneyKind, StaffId } from "./types";

export type DsrDaySummary = {
  staffId: StaffId;
  netSales: string;
  /** Sales money handed in: net sales − new market due. */
  salesCash: string;
  marketDueCreated: string;
  oldDuesCollected: string;
};

export type DaySummary = {
  netSales: string;
  salesCash: string;
  oldDuesCollected: string;
  /** salesCash + old dues collected. */
  cashCollected: string;
  marketDueCreated: string;
  grossProfit: string;
  /** Billed value of stock received that day (Excel H); an excess is billed now, ordered goods were billed at the order (D48). */
  receivedValue: string;
  /** Cost value of stock at the end of the day. */
  stockValue: string;
  /** D60: samari value (issued × the day's sale price), returns, damage, shop commission. */
  issuedValue: string;
  returnValue: string;
  damageValue: string;
  /** D67: DSR-damaged pieces at the day's sale price (the dashboard chain's damage). */
  damageSaleValue: string;
  /** D67: purchase cost of the goods sold (delivered) that day. */
  costOfSold: string;
  commission: string;
  /** Category expenses (operating cost). */
  expenses: string;
  /** Σ staff shortage entries. */
  staffShortage: string;
  /** D67: money paid out for distributor staff that day, net of returns (`staffCost`). */
  staffCost: string;
  /** D67: money paid out for SRs that day, net of returns (`srCost`). */
  srCost: string;
  byDsr: DsrDaySummary[];
};

const sum = (values: readonly string[]) =>
  values.reduce((total, v) => total.add(toDecimal(v)), new Decimal(0));

/**
 * D67: the dashboard's calculation chain over summed period figures.
 * নিট ব্যালান্স = মোট সামারি − ফেরত − ড্যামেজ (sale price) − কমিশন − অপারেটিং খরচ − ডিএসআর খরচ
 * − এসআর খরচ; নিট লাভ = নিট ব্যালান্স − বিক্রিত পণ্যের ক্রয়মূল্য.
 */
export function dashboardChain(input: {
  issuedValue: DecimalInput;
  returnValue: DecimalInput;
  damageSaleValue: DecimalInput;
  commission: DecimalInput;
  expenses: DecimalInput;
  staffCost: DecimalInput;
  srCost: DecimalInput;
  costOfSold?: DecimalInput;
}): { netBalance: string; netProfit: string | null } {
  const netBalance = toDecimal(input.issuedValue)
    .sub(toDecimal(input.returnValue))
    .sub(toDecimal(input.damageSaleValue))
    .sub(toDecimal(input.commission))
    .sub(toDecimal(input.expenses))
    .sub(toDecimal(input.staffCost))
    .sub(toDecimal(input.srCost));
  return {
    netBalance: roundSettlement(netBalance),
    netProfit:
      input.costOfSold === undefined
        ? null
        : roundSettlement(netBalance.sub(toDecimal(input.costOfSold))),
  };
}

/**
 * The dashboard's per-day figures, from one engine day and that day's input (PLAN §6). Market due
 * not attributed to a DSR counts in the totals only.
 */
export function summarizeDay(day: DayResult, input: DayInput): DaySummary {
  const dsr = new Map<StaffId, { sales: Decimal; dueNew: Decimal; collected: Decimal }>();
  const row = (staffId: StaffId) => {
    let entry = dsr.get(staffId);
    if (!entry) {
      entry = { sales: new Decimal(0), dueNew: new Decimal(0), collected: new Decimal(0) };
      dsr.set(staffId, entry);
    }
    return entry;
  };
  for (const person of day.persons)
    row(person.staffId).sales = row(person.staffId).sales.add(person.amount);
  for (const entry of input.money ?? []) {
    if (!entry.staffId) continue;
    if (entry.kind === "marketDueNew")
      row(entry.staffId).dueNew = row(entry.staffId).dueNew.add(toDecimal(entry.amount));
    if (entry.kind === "marketDueCollected") {
      row(entry.staffId).collected = row(entry.staffId).collected.add(toDecimal(entry.amount));
    }
  }

  const sales = toDecimal(day.money.sales);
  const dueNew = toDecimal(day.money.marketDueNew);
  const collected = toDecimal(day.money.marketDueCollected);
  const salesCash = sales.sub(dueNew);
  const ofKind = (kind: MoneyKind) =>
    sum((input.money ?? []).filter((e) => e.kind === kind).map((e) => String(e.amount)));
  return {
    netSales: roundSettlement(sales),
    salesCash: roundSettlement(salesCash),
    oldDuesCollected: roundSettlement(collected),
    cashCollected: roundSettlement(salesCash.add(collected)),
    marketDueCreated: roundSettlement(dueNew),
    grossProfit: roundSettlement(sum(day.products.map((p) => p.grossProfit))),
    receivedValue: roundSettlement(sum(day.products.map((p) => p.receiptValue))),
    stockValue: roundSettlement(sum(day.products.map((p) => p.stockValue))),
    issuedValue: roundSettlement(sum(day.products.map((p) => p.issuedValue))),
    returnValue: roundSettlement(sum(day.products.map((p) => p.returnValue))),
    damageValue: roundSettlement(sum(day.products.map((p) => p.damageValue))),
    damageSaleValue: roundSettlement(
      day.products.reduce(
        (total, p) => total.add(toDecimal(p.damaged).mul(toDecimal(p.salePrice ?? "0"))),
        new Decimal(0),
      ),
    ),
    costOfSold: roundSettlement(sum(day.products.map((p) => p.cost))),
    commission: roundSettlement(toDecimal(day.money.commission)),
    expenses: roundSettlement(toDecimal(day.money.expenses)),
    staffShortage: roundSettlement(ofKind("staffShortage")),
    staffCost: roundSettlement(toDecimal(staffCost(input.money ?? []))),
    srCost: roundSettlement(toDecimal(srCost(input.money ?? []))),
    byDsr: [...dsr].map(([staffId, v]) => ({
      staffId,
      netSales: roundSettlement(v.sales),
      salesCash: roundSettlement(v.sales.sub(v.dueNew)),
      marketDueCreated: roundSettlement(v.dueNew),
      oldDuesCollected: roundSettlement(v.collected),
    })),
  };
}
