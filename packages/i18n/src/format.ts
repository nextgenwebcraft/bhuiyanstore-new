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

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const shortDate = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const monthYear = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const monthLong = new Intl.DateTimeFormat("bn-BD", { timeZone: "UTC", month: "long" });
const monthShort = new Intl.DateTimeFormat("bn-BD", { timeZone: "UTC", month: "short" });
const weekdayShort = new Intl.DateTimeFormat("bn-BD", { timeZone: "UTC", weekday: "short" });

/** An ISO business date in short Bangla form, e.g. ৩ অক্টো, ২০২৬. */
export function formatShortDate(date: string): string {
  return shortDate.format(utc(date));
}

/** A month (YYYY-MM) in Bangla, e.g. সেপ্টেম্বর ২০২৬. */
export function formatMonth(month: string): string {
  return monthYear.format(utc(`${month}-01`));
}

/** Bangla month names, January first. */
export const monthNames = (style: "long" | "short" = "long"): string[] =>
  Array.from({ length: 12 }, (_, i) =>
    (style === "long" ? monthLong : monthShort).format(
      utc(`2026-${String(i + 1).padStart(2, "0")}-01`),
    ),
  );

/** Short Bangla weekday names starting on Saturday, the first day of the Bangladesh week. */
export const weekdayNames = (): string[] =>
  // 2026-10-03 is a Saturday.
  Array.from({ length: 7 }, (_, i) => weekdayShort.format(utc(`2026-10-0${3 + i}`)));

/**
 * A unit cost/price stored at 6-place precision (D08), shown with trailing zeros trimmed to a
 * minimum of 2 places: 25.000000 → ২৫.০০, 21.645400 → ২১.৬৪৫৪. Trimming zeros never rounds.
 */
export function formatRate(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  return formatAmount(`${integer}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`);
}

/** A whole number or count in Bengali digits, no grouping or decimals (e.g. ১২, ৩৪৫). */
export function formatCount(value: number | string): string {
  return toBengaliDigits(String(value));
}

/**
 * A decimal string cut to 2 places, half away from zero like the engine's ROUND_HALF_UP; values
 * with 2 places or fewer are returned unchanged. Display only: the value itself stays exact.
 */
function toMoneyPlaces(value: string): string {
  const negative = value.startsWith("-");
  const [integer = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (fraction.length <= 2) return value;
  const digits = (integer + fraction.slice(0, 2)).split("").map(Number);
  if (Number(fraction[2]) >= 5) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === 9) {
      digits[i] = 0;
      i -= 1;
    }
    if (i < 0) digits.unshift(1);
    else digits[i] = (digits[i] ?? 0) + 1;
  }
  const text = digits.join("");
  const rounded = `${text.slice(0, -2)}.${text.slice(-2)}`;
  return negative && /[1-9]/.test(rounded) ? `-${rounded}` : rounded;
}

/** Money for display, at most 2 decimal places; `null` (hidden or unknown) shows a dash. */
export function formatMoney(value: string | null): string {
  return value === null ? "—" : formatAmount(toMoneyPlaces(value));
}

// Mirrors ENTITY_TIMEZONE in @bsd/domain (the owner, D08); i18n does not depend on domain.
const ENTITY_TIMEZONE = "Asia/Dhaka";
const dateTime = new Intl.DateTimeFormat("bn-BD", {
  timeZone: ENTITY_TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** An instant (Date or ISO string) as Bangla date and time in Asia/Dhaka. */
export function formatDateTime(instant: Date | string): string {
  return dateTime.format(typeof instant === "string" ? new Date(instant) : instant);
}
