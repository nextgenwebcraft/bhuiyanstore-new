import { toBengaliDigits } from "./digits";

/**
 * bn-BD display of an already-rounded decimal string: Bengali digits with South Asian grouping
 * (১২,৩৪,৫৬৭.৫০). Formatting only; it never rounds or recalculates (guide 21.1).
 */
export function formatAmount(value: string): string {
  const negative = value.startsWith("-");
  const [integer = "0", fraction] = (negative ? value.slice(1) : value).split(".");
  const lastThree = integer.slice(-3);
  const rest = integer.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  const text = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return toBengaliDigits(negative ? `-${text}` : text);
}

const longDate = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** An ISO business date (YYYY-MM-DD) in long Bangla form, e.g. শুক্রবার, ২ অক্টোবর, ২০২৬. */
export function formatBusinessDate(date: string): string {
  return longDate.format(new Date(`${date}T00:00:00Z`));
}

/**
 * A unit cost/price stored at 6-place precision (D08), shown with trailing zeros trimmed to a
 * minimum of 2 places: 25.000000 → ২৫.০০, 21.645400 → ২১.৬৪৫৪. Trimming zeros never rounds.
 */
export function formatRate(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  return formatAmount(`${integer}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`);
}
