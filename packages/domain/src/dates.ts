/** Business dates are calendar dates in the entity timezone, Asia/Dhaka for v1 (D08). */
export const ENTITY_TIMEZONE = "Asia/Dhaka";

/** The ISO (YYYY-MM-DD) business date of an instant in the given timezone. */
export function businessDateOf(instant: Date, timeZone: string = ENTITY_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The ISO business date `days` calendar days after (or before, when negative) `date`. */
export function shiftBusinessDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Invalid business date: ${date}`);
  }
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Calendar arithmetic on ISO strings only (YYYY-MM-DD, YYYY-MM): no local-time Date leaks. This
 * module is the single owner of month and day helpers; do not re-implement them elsewhere.
 */

const DAY_MS = 86_400_000;

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** The business date today in the entity timezone. */
export const todayBusinessDate = (now: Date = new Date()): string => businessDateOf(now);

/** The YYYY-MM month of a YYYY-MM-DD date. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The first day of a month (YYYY-MM) or of the month containing a date (YYYY-MM-DD). */
export const firstOfMonth = (monthOrDate: string): string => `${monthOf(monthOrDate)}-01`;

/** The month `by` months after (or before, when negative) `month`. */
export function shiftMonth(month: string, by: number): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last day of a month (YYYY-MM). */
export const lastOfMonth = (month: string): string =>
  shiftBusinessDate(`${shiftMonth(month, 1)}-01`, -1);

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((utcMidnight(to).getTime() - utcMidnight(from).getTime()) / DAY_MS);

/** Every date from `from` to `to`, both included (empty when `to` is before `from`). */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = shiftBusinessDate(d, 1)) dates.push(d);
  return dates;
}

/** `date` limited to the optional [min, max] bounds. */
export const clampDate = (date: string, min?: string, max?: string): string =>
  min && date < min ? min : max && date > max ? max : date;
