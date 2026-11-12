import { Decimal, toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";

/**
 * D129: remaining due on a company cheque = posted charges − posted payments (never below zero
 * for display; callers must refuse payments that would go negative).
 */
export function checkDueRemaining(
  charges: readonly DecimalInput[],
  payments: readonly DecimalInput[],
): string {
  let total = new Decimal(0);
  for (const amount of charges) total = total.add(toDecimal(amount));
  for (const amount of payments) total = total.sub(toDecimal(amount));
  return roundSettlement(Decimal.max(total, new Decimal(0)));
}

/** True when the cheque has been charged and fully repaid (hide from active due list). */
export function checkIsCompleted(
  charges: readonly DecimalInput[],
  payments: readonly DecimalInput[],
): boolean {
  if (charges.length === 0) return false;
  let charged = new Decimal(0);
  for (const amount of charges) charged = charged.add(toDecimal(amount));
  if (charged.lte(0)) return false;
  return toDecimal(checkDueRemaining(charges, payments)).isZero();
}
