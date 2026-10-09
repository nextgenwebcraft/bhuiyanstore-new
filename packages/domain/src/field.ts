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
 * DSR cash handover (D39, display only). Expected = the DSR's sales − new due given + old due
 * collected − expenses paid from that cash; the difference is handed over − expected.
 */
export function dsrCashSettlement(input: {
  sales: DecimalInput;
  dueGiven: DecimalInput;
  dueCollected: DecimalInput;
  expenses: DecimalInput;
  handedOver: DecimalInput | null;
}): { expected: string; handedOver: string | null; difference: string | null } {
  const expected = toDecimal(input.sales)
    .sub(toDecimal(input.dueGiven))
    .add(toDecimal(input.dueCollected))
    .sub(toDecimal(input.expenses));
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
