import { shiftBusinessDate } from "@bsd/domain";

/** Calendar arithmetic on ISO strings only (YYYY-MM-DD, YYYY-MM): no Date leaks timezones. */

export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function lastOfMonth(month: string): string {
  return shiftBusinessDate(`${shiftMonth(month, 1)}-01`, -1);
}

/** 42 dates (6 weeks, Saturday first) covering the month. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = shiftBusinessDate(first, -((weekday + 1) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftBusinessDate(start, i));
}

export const clampDate = (date: string, min?: string, max?: string) =>
  min && date < min ? min : max && date > max ? max : date;

export type DateRange = { from: string; to: string };

export type RangePreset =
  "today" | "yesterday" | "last7" | "thisMonth" | "lastMonth" | "last30" | "thisYear";

export const rangePresets: readonly RangePreset[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "thisMonth",
  "lastMonth",
  "thisYear",
];

export function presetRange(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = shiftBusinessDate(today, -1);
      return { from: day, to: day };
    }
    case "last7":
      return { from: shiftBusinessDate(today, -6), to: today };
    case "last30":
      return { from: shiftBusinessDate(today, -29), to: today };
    case "thisMonth":
      return { from: `${monthOf(today)}-01`, to: today };
    case "lastMonth": {
      const month = shiftMonth(monthOf(today), -1);
      return { from: `${month}-01`, to: lastOfMonth(month) };
    }
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}
