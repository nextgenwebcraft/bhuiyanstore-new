import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { owedBuckets, type OwedBucket } from "./types";

/**
 * Salary recovery for distributor staff (D11, D24, D25, guide §11.6, §11.9). Recovery is
 * advance → loan → approved shortage, capped at the salary of the run; the rest carries forward.
 * Cash Pabe is salary − recovery, never entered and never negative.
 */

export const RECOVERY_ORDER = owedBuckets;

export type Recovery = Record<OwedBucket, string>;
export type OwedInput = Partial<Record<OwedBucket, DecimalInput>>;

export type RecoveryIssue =
  | { code: "negative"; bucket: OwedBucket }
  | { code: "exceedsOwed"; bucket: OwedBucket }
  | { code: "exceedsSalary" };

const ZERO = new Decimal(0);
const nonNegative = (value: DecimalInput | undefined): Decimal =>
  Decimal.max(value === undefined ? ZERO : toDecimal(value), ZERO);

/** The default recovery for one person: full available pay, in the fixed order. */
export function proposeRecovery(salary: DecimalInput, owed: OwedInput): Recovery {
  let available = nonNegative(salary);
  const recovery = { advance: "0", loan: "0", shortage: "0" } as Recovery;
  for (const bucket of RECOVERY_ORDER) {
    const take = Decimal.min(available, nonNegative(owed[bucket]));
    recovery[bucket] = take.toString();
    available = available.sub(take);
  }
  return recovery;
}

export function recoveryTotal(recovery: Partial<Record<OwedBucket, DecimalInput>>): string {
  return RECOVERY_ORDER.reduce((total, b) => total.add(nonNegative(recovery[b])), ZERO).toString();
}

/** D67: the month's salary after the absent fees entered for it; never negative. */
export function salaryAfterAbsence(salary: DecimalInput, absent: DecimalInput): string {
  return Decimal.max(toDecimal(salary).sub(toDecimal(absent)), ZERO).toString();
}

/** Cash Pabe (D25): salary still to pay after recovery. */
export function cashPay(salary: DecimalInput, recovery: Partial<Record<OwedBucket, DecimalInput>>) {
  return Decimal.max(toDecimal(salary).sub(recoveryTotal(recovery)), ZERO).toString();
}

/**
 * Problems with a recovery chosen by the manager (an override of the proposal): each part within
 * what the person owes, and the total within the salary, so cash salary is never negative.
 */
export function checkRecovery(
  salary: DecimalInput,
  owed: OwedInput,
  recovery: Partial<Record<OwedBucket, DecimalInput>>,
): RecoveryIssue[] {
  const issues: RecoveryIssue[] = [];
  for (const bucket of RECOVERY_ORDER) {
    const value = toDecimal(recovery[bucket] ?? "0");
    if (value.isNegative()) issues.push({ code: "negative", bucket });
    else if (value.gt(nonNegative(owed[bucket]))) issues.push({ code: "exceedsOwed", bucket });
  }
  if (toDecimal(recoveryTotal(recovery)).gt(nonNegative(salary))) {
    issues.push({ code: "exceedsSalary" });
  }
  return issues;
}
