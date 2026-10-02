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
