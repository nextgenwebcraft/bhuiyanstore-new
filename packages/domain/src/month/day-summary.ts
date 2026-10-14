import { Decimal, toDecimal } from "../decimal";
import { roundSettlement } from "../money";
import type { DayInput, DayResult, StaffId } from "./types";

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
  byDsr: DsrDaySummary[];
};

const sum = (values: readonly string[]) =>
  values.reduce((total, v) => total.add(toDecimal(v)), new Decimal(0));

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
  return {
    netSales: roundSettlement(sales),
    salesCash: roundSettlement(salesCash),
    oldDuesCollected: roundSettlement(collected),
    cashCollected: roundSettlement(salesCash.add(collected)),
    marketDueCreated: roundSettlement(dueNew),
    grossProfit: roundSettlement(sum(day.products.map((p) => p.grossProfit))),
    receivedValue: roundSettlement(sum(day.products.map((p) => p.receiptValue))),
    stockValue: roundSettlement(sum(day.products.map((p) => p.stockValue))),
    byDsr: [...dsr].map(([staffId, v]) => ({
      staffId,
      netSales: roundSettlement(v.sales),
      salesCash: roundSettlement(v.sales.sub(v.dueNew)),
      marketDueCreated: roundSettlement(v.dueNew),
      oldDuesCollected: roundSettlement(v.collected),
    })),
  };
}
