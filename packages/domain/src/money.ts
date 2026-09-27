import { toDecimal, type DecimalInput } from "./decimal";

/** BDT settlement/display precision (D08). */
export const SETTLEMENT_SCALE = 2;
/** Internal unit-cost precision; the workbook contains values such as 21.6454 (D08). */
export const COST_SCALE = 6;

export function roundSettlement(amount: DecimalInput): string {
  return toDecimal(amount).toFixed(SETTLEMENT_SCALE);
}

export function roundCost(amount: DecimalInput): string {
  return toDecimal(amount).toFixed(COST_SCALE);
}
