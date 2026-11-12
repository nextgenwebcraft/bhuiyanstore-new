"use client";

import { formatMoney, monthNames, t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/skeleton";
import { useDashboardDaily, useDashboardMonthly } from "@/data/queries";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const shortMonths = monthNames("short");

type ChartTab = "days" | "months";

function compactLabel(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "০";
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    const rounded = Math.abs(k) >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${formatMoney(String(rounded))}K`;
  }
  return formatMoney(value);
}

function dayAxisLabel(date: string): string {
  const day = toBengaliDigits(String(Number(date.slice(8, 10))));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const month = shortMonths[monthIndex] ?? date.slice(5, 7);
  return `${day} ${month}`;
}

/** মোট বিক্রি chart: day-wise (last 12 days, default) or month-wise (D128). */
export function MonthlySalesChart({ year }: { year: string }) {
  const { company } = useCurrentWorkspace();
  const [tab, setTab] = useState<ChartTab>("days");
  const daily = useDashboardDaily(company.id, tab === "days");
  const monthly = useDashboardMonthly(company.id, year, tab === "months");
  const active = tab === "days" ? daily : monthly;

  const points =
    tab === "days"
      ? (daily.data?.days.map((row) => ({
          key: row.date,
          label: dayAxisLabel(row.date),
          totalSales: row.totalSales,
        })) ?? [])
      : (monthly.data?.months.map((row, index) => ({
          key: row.month,
          label: shortMonths[index] ?? row.month.slice(5),
          totalSales: row.totalSales,
        })) ?? []);

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface p-4 print:break-inside-avoid">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{t("dashboard.chart.title")}</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t(
              tab === "days" ? "dashboard.chart.subtitle.days" : "dashboard.chart.subtitle.months",
            )}
          </p>
        </div>
        <div
          role="tablist"
          aria-label={t("dashboard.chart.title")}
          className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5"
        >
          {(
            [
              ["days", "dashboard.chart.tab.days"],
              ["months", "dashboard.chart.tab.months"],
            ] as const
          ).map(([id, labelKey]) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                  selected ? "bg-surface text-text shadow-card" : "text-text-muted hover:text-text"
                }`}
                onClick={() => setTab(id)}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {active.isPending ? (
          <Skeleton className="h-56 w-full lg:h-full lg:min-h-56" />
        ) : active.isError ? (
          <QueryError error={active.error} onRetry={() => void active.refetch()} />
        ) : (
          <BarChart points={points} />
        )}
      </div>
    </section>
  );
}

function BarChart({
  points,
}: {
  points: readonly { key: string; label: string; totalSales: string }[];
}) {
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const values = points.map((row) => Number(row.totalSales) || 0);
  const max = Math.max(...values, 1);
  const width = 640;
  const height = 220;
  const padLeft = 36;
  const padRight = 12;
  const padTop = 28;
  const padBottom = 36;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const gap = 8;
  const barW = points.length > 0 ? (chartW - gap * (points.length - 1)) / points.length : chartW;
  const axisColor = "var(--color-border)";
  const barColor = "var(--color-brand)";
  const labelColor = "var(--color-text-muted)";
  const hovered = hover ? points[hover.index] : null;

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full min-w-[20rem] lg:h-full lg:min-h-56"
        role="img"
        aria-label={t("dashboard.chart.title")}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={padLeft}
          y1={padTop + chartH}
          x2={padLeft + chartW}
          y2={padTop + chartH}
          stroke={axisColor}
          strokeWidth={1}
        />
        {points.map((row, index) => {
          const value = values[index] ?? 0;
          const barH = (value / max) * chartH;
          const x = padLeft + index * (barW + gap);
          const y = padTop + chartH - barH;
          const hitTop = padTop;
          const hitHeight = chartH;
          return (
            <g key={row.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, value > 0 ? 2 : 0)}
                rx={3}
                fill={barColor}
                opacity={hover?.index === index ? 1 : 0.9}
              />
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={9} fill={labelColor}>
                {compactLabel(row.totalSales)}
              </text>
              <text
                x={x + barW / 2}
                y={padTop + chartH + 16}
                textAnchor="middle"
                fontSize={10}
                fill={labelColor}
              >
                {row.label}
              </text>
              {/* Full column hit area so empty/short bars are still hoverable. */}
              <rect
                x={x}
                y={hitTop}
                width={barW}
                height={hitHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={(event) => {
                  const svg = event.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setHover({
                    index,
                    x: ((x + barW / 2) / width) * rect.width,
                    y: (Math.min(y, padTop + 24) / height) * rect.height,
                  });
                }}
              >
                <title>{`৳${formatMoney(row.totalSales)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {hovered && hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text tabular-nums shadow-raised"
          style={{ left: hover.x, top: Math.max(hover.y - 8, 8) }}
        >
          <div className="text-[11px] font-medium text-text-muted">{hovered.label}</div>
          <div>৳{formatMoney(hovered.totalSales)}</div>
        </div>
      ) : null}
    </div>
  );
}
