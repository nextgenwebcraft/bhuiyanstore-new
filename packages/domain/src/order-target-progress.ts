import { daysBetween } from "./dates";
import { Decimal, toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";

export const orderTargetProgressStatuses = ["on_track", "behind", "met", "overdue"] as const;
export type OrderTargetProgressStatus = (typeof orderTargetProgressStatuses)[number];

export type OrderTargetProgressInput = {
  targetAmount: DecimalInput;
  orderedAmount: DecimalInput;
  startDate: string;
  endDate: string;
  today: string;
};

export type OrderTargetProgressResult = {
  ordered: string;
  remaining: string;
  ratio: string;
  daysLeft: number;
  daysTotal: number;
  status: OrderTargetProgressStatus;
};

/**
 * Progress of an order-amount target over its date window (D111).
 * Ratio is ordered/target capped at 1; remaining never goes below 0.
 */
export function orderTargetProgress(input: OrderTargetProgressInput): OrderTargetProgressResult {
  const target = toDecimal(input.targetAmount);
  const ordered = toDecimal(input.orderedAmount);
  if (target.lte(0)) {
    throw new RangeError("targetAmount must be positive");
  }
  if (input.startDate > input.endDate) {
    throw new RangeError("startDate must be on or before endDate");
  }

  const daysTotal = Math.max(1, daysBetween(input.startDate, input.endDate) + 1);
  const daysLeft = Math.max(0, daysBetween(input.today, input.endDate));
  const remainingRaw = target.sub(ordered);
  const remaining = remainingRaw.lt(0) ? new Decimal(0) : remainingRaw;
  const ratio = ordered.div(target);
  const ratioCapped = ratio.gt(1) ? new Decimal(1) : ratio.lt(0) ? new Decimal(0) : ratio;

  let status: OrderTargetProgressStatus;
  if (ordered.gte(target)) {
    status = "met";
  } else if (input.today > input.endDate) {
    status = "overdue";
  } else {
    const elapsed = Math.min(daysTotal, Math.max(0, daysBetween(input.startDate, input.today) + 1));
    const expectedRatio = toDecimal(String(elapsed)).div(daysTotal);
    status = ratioCapped.lt(expectedRatio) ? "behind" : "on_track";
  }

  return {
    ordered: roundSettlement(ordered),
    remaining: roundSettlement(remaining),
    ratio: stripTrailingZeros(ratioCapped.toFixed(4)),
    daysLeft,
    daysTotal,
    status,
  };
}

function stripTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") || "0";
}
