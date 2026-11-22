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

/** One dated cheque record: an order bill charged to it or a cash repayment (D145). */
export type CheckLedgerEntry = {
  kind: "charge" | "payment";
  date: string;
  /** Tie-break within a date (creation order). */
  order: number;
  amount: DecimalInput;
};

/**
 * D145: a cheque's records oldest first (date, then creation order; a charge before a payment on
 * the same instant) with the running due after each one, floored at zero like
 * {@link checkDueRemaining}.
 */
export function checkLedger<T extends CheckLedgerEntry>(
  entries: readonly T[],
): (T & { balance: string })[] {
  const sorted = [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.order - b.order ||
      (a.kind === b.kind ? 0 : a.kind === "charge" ? -1 : 1),
  );
  let running = new Decimal(0);
  return sorted.map((entry) => {
    running =
      entry.kind === "charge"
        ? running.add(toDecimal(entry.amount))
        : running.sub(toDecimal(entry.amount));
    return { ...entry, balance: roundSettlement(Decimal.max(running, new Decimal(0))) };
  });
}
