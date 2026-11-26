"use client";

import type { OrderTarget, OrderTargetProgressStatus } from "@bsd/contracts";
import {
  formatCompactAmount,
  formatCount,
  t,
  toBengaliDigits,
  type TranslationKey,
} from "@bsd/i18n";
import { money } from "@/components/data-table";

const STATUS_TONE: Record<OrderTargetProgressStatus, string> = {
  on_track: "bg-success",
  behind: "bg-warning",
  met: "bg-brand",
  overdue: "bg-error",
};

const STATUS_KEY: Record<OrderTargetProgressStatus, TranslationKey> = {
  on_track: "target.status.onTrack",
  behind: "target.status.behind",
  met: "target.status.met",
  overdue: "target.status.overdue",
};

function ratioPercent(ratio: string): number {
  const n = Number(ratio);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 100));
}

/**
 * Format the target metric: টাকা for overall, কার্টন for product-wise (D115). `compact` shortens
 * large টাকা to লাখ/কোটি for narrow dashboard cards; pair it with the full value as a title.
 */
export function targetMetric(target: OrderTarget, value: string, compact = false): string {
  if (target.kind === "product") {
    return `${formatCount(value)} ${t("common.cartons")}`;
  }
  return compact ? formatCompactAmount(value) : money(value);
}

function Metric({
  target,
  value,
  compact,
}: {
  target: OrderTarget;
  value: string;
  compact: boolean;
}) {
  const full = targetMetric(target, value);
  const shown = targetMetric(target, value, compact);
  return (
    <dd className="truncate font-semibold tabular-nums" title={shown === full ? undefined : full}>
      {shown}
    </dd>
  );
}

export function targetGoal(target: OrderTarget): string {
  return target.kind === "product" ? (target.quantityCartons ?? "0") : (target.amount ?? "0");
}

export function targetLabel(target: OrderTarget): string {
  if (target.kind === "product") {
    if (target.products.length === 0) return t("target.kind.product");
    if (target.products.length === 1) {
      const [product] = target.products;
      if (product) return `${product.name}${product.sku ? ` (${product.sku})` : ""}`;
    }
    return `${t("target.productScope.multi")} (${formatCount(target.products.length)})`;
  }
  return t("target.kind.overall");
}

/** Full progress card body: Setup targets page, and (compact amounts) the dashboard column. */
export function TargetProgressBlock({
  target,
  compact = false,
}: {
  target: OrderTarget;
  compact?: boolean;
}) {
  const pct = ratioPercent(target.progress.ratio);
  const goal = targetGoal(target);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-text-muted">{t(STATUS_KEY[target.progress.status])}</p>
        <p className="text-sm font-semibold tabular-nums">{toBengaliDigits(String(pct))}%</p>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={targetLabel(target)}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${STATUS_TONE[target.progress.status]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {target.kind === "product" && target.products.length > 1 ? (
        <p className="text-xs text-text-muted">{target.products.map((p) => p.name).join(" · ")}</p>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[11px] text-text-muted">{t("target.ordered")}</dt>
          <Metric target={target} value={target.progress.ordered} compact={compact} />
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-text-muted">
            {t(target.kind === "product" ? "target.cartons" : "target.amount")}
          </dt>
          <Metric target={target} value={goal} compact={compact} />
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-text-muted">{t("target.remaining")}</dt>
          <Metric target={target} value={target.progress.remaining} compact={compact} />
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-text-muted">{t("target.daysLeft")}</dt>
          <dd className="font-semibold tabular-nums">
            {toBengaliDigits(String(target.progress.daysLeft))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Compact strip widget for the dashboard header. */
export function TargetProgressCompact({ target }: { target: OrderTarget }) {
  const pct = ratioPercent(target.progress.ratio);
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-text">{targetLabel(target)}</p>
        <p className="shrink-0 text-[11px] text-text-muted tabular-nums">
          {toBengaliDigits(String(pct))}%
        </p>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={targetLabel(target)}
      >
        <div
          className={`h-full rounded-full ${STATUS_TONE[target.progress.status]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className="mt-1.5 truncate text-[11px] text-text-muted"
        title={targetMetric(target, target.progress.remaining)}
      >
        {t("target.dashboard.remainingDays")
          .replace("{amount}", targetMetric(target, target.progress.remaining, true))
          .replace("{days}", toBengaliDigits(String(target.progress.daysLeft)))}
      </p>
    </div>
  );
}
