import { Decimal, toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";

export type PriceSplit = { quantity: DecimalInput; unitPrice: DecimalInput };
export type CostedAllocation = { quantity: DecimalInput; unitCost: DecimalInput };

/** line amount = sold quantity × actual unit sale price, at settlement precision (guide 9.5). */
export function priceSplitAmount(split: PriceSplit): string {
  return roundSettlement(toDecimal(split.quantity).mul(toDecimal(split.unitPrice)));
}

/** COGS = Σ allocation.quantity × allocation.unit_cost_snapshot, at settlement precision. */
export function allocationCost(allocations: readonly CostedAllocation[]): string {
  return roundSettlement(
    allocations.reduce<Decimal>(
      (total, a) => total.add(toDecimal(a.quantity).mul(toDecimal(a.unitCost))),
      new Decimal(0),
    ),
  );
}

export function sumAmounts(values: readonly DecimalInput[]): string {
  return roundSettlement(
    values.reduce<Decimal>((total, v) => total.add(toDecimal(v)), new Decimal(0)),
  );
}

export type SaleTotals = {
  netSales: string;
  cogs: string;
  grossProfit: string;
  cashCollected: string;
  /** বাজারের বকেয়া: unpaid portion of this summary's sales (guide 10.3). */
  marketDue: string;
};

/**
 * Summary-level totals (guide section 9.5): net sales = Σ line amounts, gross profit = net sales
 * − COGS, and current collection + new market due reconcile exactly to net sales. Collecting more
 * than was sold is not a sale; that excess belongs to DSR cash settlement, so it is rejected here.
 */
export function saleTotals(
  lineAmounts: readonly DecimalInput[],
  lineCosts: readonly DecimalInput[],
  cashCollected: DecimalInput,
): SaleTotals {
  const netSales = sumAmounts(lineAmounts);
  const cogs = sumAmounts(lineCosts);
  const cash = toDecimal(cashCollected);
  if (cash.isNegative()) throw new RangeError("cashCollected must not be negative");
  if (cash.gt(toDecimal(netSales))) throw new RangeError("cashCollected exceeds net sales");
  return {
    netSales,
    cogs,
    grossProfit: roundSettlement(toDecimal(netSales).sub(toDecimal(cogs))),
    cashCollected: roundSettlement(cash),
    marketDue: roundSettlement(toDecimal(netSales).sub(cash)),
  };
}

export type OpenDueItem = { id: string; businessDate: string; remainingAmount: DecimalInput };
export type DueAllocation = { dueItemId: string; amount: string };

/**
 * Prefills an old-dues collection against the oldest open market-due items first (guide 10.3),
 * stable by ID within a date. Throws when the amount exceeds the total open due: an
 * over-collection is not a market receivable and must not silently create a credit.
 */
export function allocateOldestFirst(
  items: readonly OpenDueItem[],
  amount: DecimalInput,
): DueAllocation[] {
  let remaining = toDecimal(amount);
  if (remaining.lte(0)) throw new RangeError("amount must be positive");
  const ordered = [...items].sort(
    (a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id),
  );
  const allocations: DueAllocation[] = [];
  for (const item of ordered) {
    if (remaining.isZero()) break;
    const open = toDecimal(item.remainingAmount);
    if (open.lte(0)) continue;
    const take = Decimal.min(open, remaining);
    allocations.push({ dueItemId: item.id, amount: roundSettlement(take) });
    remaining = remaining.sub(take);
  }
  if (remaining.gt(0)) throw new RangeError("amount exceeds open market due");
  return allocations;
}
