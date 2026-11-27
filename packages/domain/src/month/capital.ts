import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { roundSettlement } from "../money";

/**
 * D146 / D150 History → সারাংশ: the money held in a company on one day — আনডেলিভারি পণ্য (billed
 * value of goods ordered and not received) + মজুদ মাল at batch cost (floor stock) + বাজারের বাকি
 * (market dues still open), each at the end of that day. Read from engine day results; never
 * stored.
 */

export type CapitalDay = {
  date: string;
  undelivered: string;
  stock: string;
  marketDue: string;
  /** undelivered + stock + marketDue. */
  total: string;
};

type DayLike = {
  date: string;
  products: readonly { dueFromCompanyValue: DecimalInput; stockValue: DecimalInput }[];
  money: { marketDueNew: DecimalInput; marketDueCollected: DecimalInput };
};

const sum = (values: readonly DecimalInput[]) =>
  values.reduce<Decimal>((total, v) => total.add(toDecimal(v)), new Decimal(0));

/**
 * Each day's closing capital. Market due walks from `marketDueOpening` (the run's opening) by the
 * day's new dues − collections, the same walk the engine's month closing ends on.
 */
export function capitalDays(
  days: readonly DayLike[],
  marketDueOpening: DecimalInput,
): CapitalDay[] {
  let marketDue = toDecimal(marketDueOpening);
  return days.map((day) => {
    marketDue = marketDue
      .add(toDecimal(day.money.marketDueNew))
      .sub(toDecimal(day.money.marketDueCollected));
    const undelivered = sum(day.products.map((p) => p.dueFromCompanyValue));
    const stock = sum(day.products.map((p) => p.stockValue));
    return {
      date: day.date,
      undelivered: roundSettlement(undelivered),
      stock: roundSettlement(stock),
      marketDue: roundSettlement(marketDue),
      total: roundSettlement(undelivered.add(stock).add(marketDue)),
    };
  });
}

export type CapitalStats = {
  days: number;
  /** Σ daily totals ÷ days, rounded to paisa; components averaged the same way. */
  average: { undelivered: string; stock: string; marketDue: string; total: string };
  /** The day with the lowest / highest total (the earliest such day on a tie). */
  lowest: { date: string; total: string };
  highest: { date: string; total: string };
};

/** D150: the daily average, lowest and highest day of a run of capital days; null when empty. */
export function capitalStats(days: readonly CapitalDay[]): CapitalStats | null {
  const first = days[0];
  if (!first) return null;
  const count = new Decimal(days.length);
  const avg = (pick: (d: CapitalDay) => string) => roundSettlement(sum(days.map(pick)).div(count));
  let lowest = first;
  let highest = first;
  for (const day of days) {
    if (toDecimal(day.total).lt(toDecimal(lowest.total))) lowest = day;
    if (toDecimal(day.total).gt(toDecimal(highest.total))) highest = day;
  }
  return {
    days: days.length,
    average: {
      undelivered: avg((d) => d.undelivered),
      stock: avg((d) => d.stock),
      marketDue: avg((d) => d.marketDue),
      total: avg((d) => d.total),
    },
    lowest: { date: lowest.date, total: lowest.total },
    highest: { date: highest.date, total: highest.total },
  };
}
