import { Decimal, toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";

/**
 * DSR field visits (D40). A visit sells `delivered` pieces at the day's price and swaps
 * `exchanged` damaged pieces for good ones; the cash not received becomes the shop's new due.
 */

export type FieldLineInput = {
  delivered: DecimalInput;
  exchanged: DecimalInput;
  unitPrice: DecimalInput;
};

export type FieldVisitTotals = {
  /** Σ delivered × price, rounded to the taka settlement scale. */
  salesValue: string;
  /** salesValue − cash received; never negative for a valid visit. */
  dueCreated: string;
};

export function lineValue(line: FieldLineInput): string {
  return toDecimal(line.delivered).mul(toDecimal(line.unitPrice)).toString();
}

export function fieldVisitTotals(
  lines: readonly FieldLineInput[],
  cashReceived: DecimalInput,
): FieldVisitTotals {
  const sales = lines.reduce((sum, l) => sum.add(lineValue(l)), new Decimal(0));
  const salesValue = roundSettlement(sales);
  return {
    salesValue,
    dueCreated: roundSettlement(toDecimal(salesValue).sub(toDecimal(cashReceived))),
  };
}

/** Samari still in hand: issued − Σ delivered − Σ exchanged (the expected firot). */
export function fieldRemaining(
  issued: DecimalInput,
  used: readonly { delivered: DecimalInput; exchanged: DecimalInput }[],
): string {
  return used
    .reduce(
      (left, u) => left.sub(toDecimal(u.delivered)).sub(toDecimal(u.exchanged)),
      toDecimal(issued),
    )
    .toString();
}

/**
 * Day-end বিক্রি (D107). মোট বিক্রি and ড্যামেজ are already at the settlement scale; adding them
 * keeps বিক্রি − ড্যামেজ equal to মোট বিক্রি. Summing each line's already-rounded amount and then
 * subtracting the rounded damage can leave a one-paisa gap.
 */
export function cashCheckSales(netSales: DecimalInput, damageSaleValue: DecimalInput): string {
  return roundSettlement(toDecimal(netSales).add(toDecimal(damageSaleValue)));
}

/**
 * DSR cash handover (D39, D62, D107, display only). Expected = the DSR's sales − damage at the sale
 * price − new due given + old due collected − expenses paid from that cash + staff money
 * (repayments − advances − shortages); the difference is handed over − expected. `damage` defaults
 * to 0 where the sales figure already excludes damaged pieces.
 */
export function dsrCashSettlement(input: {
  sales: DecimalInput;
  dueGiven: DecimalInput;
  dueCollected: DecimalInput;
  expenses: DecimalInput;
  staffMoney?: DecimalInput;
  /** ড্যামেজ (বিক্রয় মূল্যে), taken off expected cash. Omit when `sales` is already net of damage. */
  damage?: DecimalInput;
  handedOver: DecimalInput | null;
}): { expected: string; handedOver: string | null; difference: string | null } {
  const expected = toDecimal(input.sales)
    .sub(toDecimal(input.damage ?? "0"))
    .sub(toDecimal(input.dueGiven))
    .add(toDecimal(input.dueCollected))
    .sub(toDecimal(input.expenses))
    .add(toDecimal(input.staffMoney ?? "0"));
  if (input.handedOver === null) {
    return { expected: roundSettlement(expected), handedOver: null, difference: null };
  }
  const handed = toDecimal(input.handedOver);
  return {
    expected: roundSettlement(expected),
    handedOver: roundSettlement(handed),
    difference: roundSettlement(handed.sub(expected)),
  };
}

/**
 * Cash actually in hand from sales alone (D106, display only): sales − new due given + old due
 * collected, before DSR expenses or staff money. Shop credit given today is cash not received
 * today; a collection of an older due is cash received today though it is not today's sale.
 */
export function cashInHandOf(input: {
  sales: DecimalInput;
  dueGiven: DecimalInput;
  dueCollected: DecimalInput;
}): string {
  return roundSettlement(
    toDecimal(input.sales).sub(toDecimal(input.dueGiven)).add(toDecimal(input.dueCollected)),
  );
}

/**
 * Cash handed over below what was expected (D81). The amount is only shown: it is not a shortage
 * posting and it does not move cash or any balance. Null when the handover is missing or not short.
 */
export function handoverShortOf(difference: string | null): string | null {
  if (difference === null) return null;
  const gap = toDecimal(difference);
  if (!gap.isNegative()) return null;
  return roundSettlement(gap.abs());
}
