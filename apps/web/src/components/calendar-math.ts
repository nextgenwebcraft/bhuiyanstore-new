import { lastOfMonth, monthOf, shiftBusinessDate, shiftMonth } from "@bsd/domain";

/** Calendar grid and range presets; month/day arithmetic is owned by `@bsd/domain` dates. */

/** 42 dates (6 weeks, Saturday first) covering the month. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = shiftBusinessDate(first, -((weekday + 1) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftBusinessDate(start, i));
}

export type DateRange = { from: string; to: string };

type RangePreset =
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
