"use client";

import { formatMoney, monthNames, t, toBengaliDigits } from "@bsd/i18n";
import { useEffect, useRef, useState } from "react";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/skeleton";
import { useDashboardDaily, useDashboardMonthly } from "@/data/queries";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const shortMonths = monthNames("short");

/** ~12 bars fit the viewport; full-month series scrolls horizontally (D140). */
const VISIBLE_DAY_BARS = 12;
const DAY_BAR_MIN_W = 28;
const DAY_BAR_GAP = 8;

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
  return toBengaliDigits(String(Number(date.slice(8, 10))));
}

/** মোট বিক্রি chart: day-wise (full selected month, scrollable) or month-wise (D128/D140). */
export function MonthlySalesChart({ year, month }: { year: string; month: string }) {
  const { company } = useCurrentWorkspace();
  const [tab, setTab] = useState<ChartTab>("days");
  const daily = useDashboardDaily(company.id, month, tab === "days");
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
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 print:break-inside-avoid">
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
      <div>
        {active.isPending ? (
          <Skeleton className="h-44 w-full sm:h-52" />
        ) : active.isError ? (
          <QueryError error={active.error} onRetry={() => void active.refetch()} />
        ) : (
          <BarChart points={points} scrollable={tab === "days"} />
        )}
      </div>
    </section>
  );
}

function BarChart({
  points,
  scrollable = false,
}: {
  points: readonly { key: string; label: string; totalSales: string }[];
  scrollable?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const values = points.map((row) => Number(row.totalSales) || 0);
  const max = Math.max(...values, 1);
  const height = 180;
  const padLeft = 36;
  const padRight = 12;
  const padTop = 24;
  const padBottom = 32;
  const viewportW = 640;
  const gap = scrollable ? DAY_BAR_GAP : 8;
  const chartH = height - padTop - padBottom;
  const fittedBarW =
    points.length > 0
      ? (viewportW - padLeft - padRight - gap * (points.length - 1)) / points.length
      : viewportW - padLeft - padRight;
  const scrollBarW = Math.max(
    DAY_BAR_MIN_W,
    (viewportW - padLeft - padRight - gap * (VISIBLE_DAY_BARS - 1)) / VISIBLE_DAY_BARS,
  );
  const barW = scrollable && points.length > VISIBLE_DAY_BARS ? scrollBarW : fittedBarW;
  const chartW =
    points.length > 0 ? points.length * barW + Math.max(points.length - 1, 0) * gap : fittedBarW;
  const width = padLeft + chartW + padRight;
  const axisColor = "var(--color-border)";
  const barColor = "var(--color-brand)";
  const labelColor = "var(--color-text-muted)";
  const hovered = hover ? points[hover.index] : null;

  useEffect(() => {
    if (!scrollable) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [scrollable, points]);

  return (
    <div ref={scrollerRef} className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={scrollable ? { width, minWidth: width } : undefined}
        className={scrollable ? "h-44 sm:h-52" : "h-44 w-full min-w-[20rem] sm:h-52"}
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
                  const scroller = scrollerRef.current;
                  if (!svg || !scroller) return;
                  const svgRect = svg.getBoundingClientRect();
                  const box = scroller.getBoundingClientRect();
                  setHover({
                    index,
                    x: svgRect.left - box.left + ((x + barW / 2) / width) * svgRect.width,
                    y: (Math.min(y, padTop + 24) / height) * svgRect.height,
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
