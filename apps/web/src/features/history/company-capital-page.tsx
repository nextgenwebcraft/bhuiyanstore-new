"use client";

import type { CompanyCapitalYear } from "@bsd/contracts";
import { formatMoney, formatMonth, formatShortDate, t, toBengaliDigits } from "@bsd/i18n";
import { useRef, useState } from "react";
import {
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton, TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { useCompanyCapitalYear } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const FIRST_YEAR = 2026;

type CapitalDay = CompanyCapitalYear["days"][number];
type CapitalMonth = CompanyCapitalYear["months"][number];

/**
 * D146 / D150 History → সারাংশ: how much money is held in this company — আনডেলিভারি পণ্য + মজুদ
 * মাল + বাজারের বাকি — today, at each month end, and as a daily average with its lowest and
 * highest day. Every figure comes from the server.
 */
export function CompanyCapitalPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const currentYear = today.slice(0, 4);
  const years = Array.from(
    { length: Math.max(1, Number(currentYear) - FIRST_YEAR + 1) },
    (_, index) => String(FIRST_YEAR + index),
  ).reverse();
  const [year, setYear] = useState(currentYear);
  const [picked, setPicked] = useState<string | null>(null);
  const query = useCompanyCapitalYear(company.id, year);

  const yearSelect = (
    <label className="flex flex-col gap-1 text-sm print:hidden">
      <span className="text-xs font-medium text-text-muted">{t("share.filter.year")}</span>
      <select
        className={`${inputClass} w-28`}
        value={year}
        onChange={(event) => {
          setYear(event.target.value);
          setPicked(null);
        }}
      >
        {years.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <NavGate path="history/summary">
      <PageHeader
        title={t("nav.history.summary")}
        description={t("capital.description")}
        actions={yearSelect}
      />
      {query.isPending ? (
        <div className="flex flex-col gap-6">
          <SummarySkeleton />
          <TableSkeleton rows={6} columns={5} />
        </div>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <CapitalBody data={query.data} picked={picked} onPick={setPicked} />
      )}
    </NavGate>
  );
}

function CapitalBody({
  data,
  picked,
  onPick,
}: {
  data: CompanyCapitalYear;
  picked: string | null;
  onPick: (month: string) => void;
}) {
  const withStats = data.months.filter((row) => row.stats);
  const selected = withStats.find((row) => row.month === picked) ?? withStats[0] ?? null;
  const days = selected ? data.days.filter((day) => day.date.startsWith(selected.month)) : [];

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          large
          tone="brand"
          label={t("capital.total")}
          value={formatMoney(data.current.total)}
          hint={`${t("capital.asOf")} — ${formatShortDate(data.asOf)}`}
        />
        <StatTile label={t("capital.undelivered")} value={formatMoney(data.current.undelivered)} />
        <StatTile label={t("capital.stock")} value={formatMoney(data.current.stock)} />
        <StatTile label={t("capital.marketDue")} value={formatMoney(data.current.marketDue)} />
      </dl>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-base font-semibold tracking-tight">{t("capital.how.title")}</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-muted">
          <li>{t("capital.how.undelivered")}</li>
          <li>{t("capital.how.stock")}</li>
          <li>{t("capital.how.marketDue")}</li>
          <li>{t("capital.how.day")}</li>
          <li>{t("capital.how.average")}</li>
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("capital.average.title")}</h2>
            <p className="mt-1 text-sm text-text-muted">{t("capital.average.hint")}</p>
          </div>
          {withStats.length > 0 && selected ? (
            <label className="flex flex-col gap-1 text-sm print:hidden">
              <span className="text-xs font-medium text-text-muted">{t("month.picker")}</span>
              <select
                className={`${inputClass} w-40`}
                value={selected.month}
                onChange={(event) => onPick(event.target.value)}
              >
                {withStats.map((row) => (
                  <option key={row.month} value={row.month}>
                    {formatMonth(row.month)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {selected?.stats ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] lg:items-start">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <StatTile
                tone="brand"
                label={t("capital.average.daily")}
                value={formatMoney(selected.stats.average.total)}
                hint={t("capital.average.days").replace(
                  "{days}",
                  toBengaliDigits(String(selected.stats.days)),
                )}
              />
              <StatTile
                label={t("capital.average.lowest")}
                value={formatMoney(selected.stats.lowest.total)}
                hint={formatShortDate(selected.stats.lowest.date)}
              />
              <StatTile
                label={t("capital.average.highest")}
                value={formatMoney(selected.stats.highest.total)}
                hint={formatShortDate(selected.stats.highest.date)}
              />
              <div className="col-span-2 rounded-xl border border-border bg-surface p-3 text-xs text-text-muted lg:col-span-1">
                <div className="mb-1 font-medium text-text">{t("capital.average.parts")}</div>
                <div>{`${t("capital.undelivered")}: ${formatMoney(selected.stats.average.undelivered)}`}</div>
                <div>{`${t("capital.stock")}: ${formatMoney(selected.stats.average.stock)}`}</div>
                <div>{`${t("capital.marketDue")}: ${formatMoney(selected.stats.average.marketDue)}`}</div>
              </div>
            </dl>
            <CapitalLineChart days={days} month={selected} />
          </div>
        ) : (
          <StatePanel title={t("capital.empty")} />
        )}
        {data.yearStats ? (
          <p className="text-sm text-text-muted">
            {t("capital.average.year")
              .replace("{year}", toBengaliDigits(data.year))
              .replace("{amount}", formatMoney(data.yearStats.average.total))
              .replace("{low}", formatMoney(data.yearStats.lowest.total))
              .replace("{lowDate}", formatShortDate(data.yearStats.lowest.date))
              .replace("{high}", formatMoney(data.yearStats.highest.total))
              .replace("{highDate}", formatShortDate(data.yearStats.highest.date))}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("capital.monthly")}</h2>
          <p className="mt-1 text-sm text-text-muted">{t("capital.monthlyHint")}</p>
        </div>
        {data.months.length === 0 ? (
          <StatePanel title={t("capital.empty")} />
        ) : (
          <TableScroller>
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={`${thClass} ${stickyHead}`}>
                    {t("capital.col.month")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("capital.col.date")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.undelivered")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.stock")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.marketDue")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.col.monthEnd")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.average.daily")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.average.lowest")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("capital.average.highest")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((row) => (
                  <tr key={row.month} className="border-t border-border">
                    <th
                      scope="row"
                      className={`${thClass} ${stickyCell} text-left font-medium whitespace-nowrap`}
                    >
                      {formatMonth(row.month)}
                    </th>
                    <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                      {formatShortDate(row.to)}
                    </td>
                    <td className={tdNum}>{formatMoney(row.undelivered)}</td>
                    <td className={tdNum}>{formatMoney(row.stock)}</td>
                    <td className={tdNum}>{formatMoney(row.marketDue)}</td>
                    <td className={tdNum}>{formatMoney(row.total)}</td>
                    <td className={`${tdNum} font-semibold`}>
                      {row.stats ? formatMoney(row.stats.average.total) : "—"}
                    </td>
                    <td className={tdNum}>
                      {row.stats ? formatMoney(row.stats.lowest.total) : "—"}
                    </td>
                    <td className={tdNum}>
                      {row.stats ? formatMoney(row.stats.highest.total) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        )}
      </section>
    </div>
  );
}

function compact(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 100000) return `${formatMoney(String(Math.round(n / 1000) / 100))}L`;
  if (Math.abs(n) >= 1000) return `${formatMoney(String(Math.round(n / 100) / 10))}K`;
  return formatMoney(value);
}

/**
 * D150: the selected month's daily total as one thin line (display scale only — every figure on
 * the page comes from the server), the average as a dashed reference, and the lowest and highest
 * day marked and labelled. Hover shows each day.
 */
function CapitalLineChart({ days, month }: { days: readonly CapitalDay[]; month: CapitalMonth }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const stats = month.stats;
  if (!stats || days.length === 0) return null;

  const width = 640;
  const height = 200;
  const pad = { left: 12, right: 12, top: 28, bottom: 28 };
  const values = days.map((day) => Number(day.total) || 0);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(Math.abs(hi), 1);
  const yMin = lo - span * 0.15;
  const yMax = hi + span * 0.15;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index: number) =>
    pad.left + (days.length === 1 ? innerW / 2 : (index / (days.length - 1)) * innerW);
  const y = (value: number) => pad.top + innerH - ((value - yMin) / (yMax - yMin)) * innerH;
  const path = values
    .map(
      (value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
    )
    .join(" ");
  const avgY = y(Number(stats.average.total) || 0);
  const lowIndex = days.findIndex((day) => day.date === stats.lowest.date);
  const highIndex = days.findIndex((day) => day.date === stats.highest.date);
  const hovered = hover === null ? null : days[hover];
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));

  const marker = (index: number, kind: "low" | "high") => {
    const day = days[index];
    if (!day) return null;
    const cx = x(index);
    const cy = y(values[index] ?? 0);
    const anchor =
      index < days.length * 0.15 ? "start" : index > days.length * 0.85 ? "end" : "middle";
    const label = `${t(kind === "low" ? "capital.average.lowest" : "capital.average.highest")} ${compact(day.total)}`;
    return (
      <g key={kind}>
        <circle
          cx={cx}
          cy={cy}
          r={5}
          fill="var(--color-brand)"
          stroke="var(--color-surface)"
          strokeWidth={2}
        />
        <text
          x={cx}
          y={kind === "high" ? cy - 10 : cy + 18}
          textAnchor={anchor}
          fontSize={11}
          fontWeight={600}
          fill="var(--color-text)"
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <figure className="relative min-w-0 rounded-xl border border-border bg-surface p-4">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">
          {t("capital.chart.title").replace("{month}", formatMonth(month.month))}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <svg width="18" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke="var(--color-text-muted)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          </svg>
          {`${t("capital.average.daily")} ${compact(stats.average.total)}`}
        </span>
      </figcaption>
      <div ref={wrapRef} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 w-full"
          role="img"
          aria-label={t("capital.chart.title").replace("{month}", formatMonth(month.month))}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const px = ((event.clientX - rect.left) / rect.width) * width;
            const ratio = days.length === 1 ? 0 : (px - pad.left) / innerW;
            const index = Math.round(ratio * (days.length - 1));
            setHover(Math.min(days.length - 1, Math.max(0, index)));
          }}
        >
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={avgY}
            y2={avgY}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <path
            d={path}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {days.map((day, index) =>
            index % labelEvery === 0 || index === days.length - 1 ? (
              <text
                key={day.date}
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-text-muted)"
              >
                {toBengaliDigits(String(Number(day.date.slice(8, 10))))}
              </text>
            ) : null,
          )}
          {hover !== null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top - 8}
              y2={pad.top + innerH}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
          ) : null}
          {lowIndex >= 0 && lowIndex !== highIndex ? marker(lowIndex, "low") : null}
          {highIndex >= 0 ? marker(highIndex, "high") : null}
          {hover !== null ? (
            <circle
              cx={x(hover)}
              cy={y(values[hover] ?? 0)}
              r={4}
              fill="var(--color-surface)"
              stroke="var(--color-brand)"
              strokeWidth={2}
            />
          ) : null}
        </svg>
        {hovered && hover !== null ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-raised"
            style={{ left: `${(x(hover) / width) * 100}%` }}
          >
            <div className="font-medium text-text-muted">{formatShortDate(hovered.date)}</div>
            <div className="font-semibold tabular-nums">৳{formatMoney(hovered.total)}</div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
