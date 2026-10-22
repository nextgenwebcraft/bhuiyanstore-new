"use client";

import { monthOf } from "@bsd/domain";
import { monthNames, t, toBengaliDigits } from "@bsd/i18n";
import { inputClass } from "@/components/field";
import { periodForMonth, pickedMonth, pickerYears, type Period } from "./period";

/**
 * Month and year as two separate dropdowns (D60). The month list holds only the twelve month
 * names and the year list every listed year (future included); both show the current choice, or
 * this month and this year while the filter is on today.
 */
export function PeriodPicker({
  period,
  cutoffDate,
  today,
  onChange,
}: {
  period: Period;
  cutoffDate: string | null;
  today: string;
  onChange: (period: Period) => void;
  /** Kept for callers that highlight the filter; the two fields show the choice themselves. */
  active?: boolean;
}) {
  const shown = pickedMonth(period, today) ?? monthOf(today);
  const year = period.kind === "year" ? period.year : shown.slice(0, 4);
  const month = period.kind === "year" ? monthOf(today).slice(5) : shown.slice(5);
  const years = pickerYears(cutoffDate, today);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => Number(b) - Number(a));

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="w-36">
        <select
          aria-label={t("dashboard.period.month")}
          className={inputClass}
          value={month}
          onChange={(event) => onChange(periodForMonth(`${year}-${event.target.value}`, today))}
        >
          {monthNames("long").map((name, index) => (
            <option key={name} value={String(index + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-28">
        <select
          aria-label={t("dashboard.period.year")}
          className={inputClass}
          value={year}
          onChange={(event) => onChange(periodForMonth(`${event.target.value}-${month}`, today))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {toBengaliDigits(y)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
