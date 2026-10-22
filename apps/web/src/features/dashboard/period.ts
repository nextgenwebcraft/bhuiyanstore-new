import { monthSchema } from "@bsd/contracts";
import { lastOfMonth, monthOf, shiftMonth } from "@bsd/domain";

/**
 * The dashboard's period filter (PLAN §5 navigation): today, this month, last month, one earlier
 * month or one year. Pure date arithmetic on Dhaka business dates; the range never passes today.
 */
export type Period =
  | { kind: "today" }
  | { kind: "this-month" }
  | { kind: "last-month" }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string };

export const TODAY_PERIOD: Period = { kind: "today" };

const YEAR_PARAM = /^\d{4}$/;

/** The `?period=` value for a period. */
export function periodParam(period: Period): string {
  switch (period.kind) {
    case "month":
      return period.month;
    case "year":
      return period.year;
    default:
      return period.kind;
  }
}

/** Reads `?period=`; anything invalid or in the future is today. */
export function parsePeriod(value: string | null | undefined, today: string): Period {
  switch (value) {
    case "today":
    case "this-month":
    case "last-month":
      return { kind: value };
  }
  if (value && monthSchema.safeParse(value).success) {
    return periodForMonth(value, today);
  }
  if (value && YEAR_PARAM.test(value) && value >= "1900") {
    return { kind: "year", year: value };
  }
  return TODAY_PERIOD;
}

const monthRange = (month: string, today: string) => {
  const last = lastOfMonth(month);
  // A future month is shown whole (D60): it simply has no entries yet.
  if (month > monthOf(today)) return { from: `${month}-01`, to: last };
  return { from: `${month}-01`, to: last > today ? today : last };
};

/** Inclusive business-date range of a period, stopped at `today`. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  switch (period.kind) {
    case "today":
      return { from: today, to: today };
    case "this-month":
      return monthRange(monthOf(today), today);
    case "last-month":
      return monthRange(shiftMonth(monthOf(today), -1), today);
    case "month":
      return monthRange(period.month, today);
    case "year": {
      const last = `${period.year}-12-31`;
      if (period.year > today.slice(0, 4)) return { from: `${period.year}-01-01`, to: last };
      return { from: `${period.year}-01-01`, to: last > today ? today : last };
    }
  }
}

/** The period that shows exactly this month (the named ones when they match). */
export function periodForMonth(month: string, today: string): Period {
  if (month === monthOf(today)) return { kind: "this-month" };
  if (month === shiftMonth(monthOf(today), -1)) return { kind: "last-month" };
  return { kind: "month", month };
}

/** The month a period lies in, for linking to the month screen; null for a year. */
export function periodMonth(period: Period, today: string): string | null {
  switch (period.kind) {
    case "year":
      return null;
    case "month":
      return period.month;
    case "last-month":
      return shiftMonth(monthOf(today), -1);
    default:
      return monthOf(today);
  }
}

/** How far back the picker lists years; any earlier year can still be typed (D60). */
const LISTED_YEARS = 15;
const FUTURE_YEARS = 5;

/**
 * Years the period picker lists, newest first: 5 years after this year back 15 years before it, and back to the cutoff
 * year when that is older.
 */
export function pickerYears(cutoffDate: string | null, today: string): string[] {
  const thisYear = Number(today.slice(0, 4));
  const newest = thisYear + FUTURE_YEARS;
  const cutoffYear = cutoffDate ? Number(cutoffDate.slice(0, 4)) : thisYear;
  const oldest = Math.min(thisYear - LISTED_YEARS, cutoffYear);
  const years: string[] = [];
  for (let year = newest; year >= oldest; year -= 1) years.push(String(year));
  return years;
}

/** A typed year the picker accepts: four digits from 1900 to 2999 (future years allowed). */
export function validYear(text: string): string | null {
  return /^\d{4}$/.test(text) && text >= "1900" && text <= "2999" ? text : null;
}

/** The month of a period, or null for today and a whole year (the picker's highlighted month). */
export function pickedMonth(period: Period, today: string): string | null {
  return period.kind === "today" || period.kind === "year" ? null : periodMonth(period, today);
}
