"use client";

import type { OrderTarget, OrderTargetProgressStatus } from "@bsd/contracts";
import { formatCount, t, toBengaliDigits, type TranslationKey } from "@bsd/i18n";
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

/** Format the target metric: টাকা for overall, কার্টন for product-wise (D115). */
export function targetMetric(target: OrderTarget, value: string): string {
  if (target.kind === "product") {
    return `${formatCount(value)} ${t("common.cartons")}`;
  }
  return money(value);
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

/** Full progress card body used on the Setup targets page. */
export function TargetProgressBlock({ target }: { target: OrderTarget }) {
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
        <p className="text-xs text-text-muted">
          {target.products.map((p) => p.name).join(" · ")}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] text-text-muted">{t("target.ordered")}</dt>
          <dd className="font-semibold tabular-nums">
            {targetMetric(target, target.progress.ordered)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-text-muted">
            {t(target.kind === "product" ? "target.cartons" : "target.amount")}
          </dt>
          <dd className="font-semibold tabular-nums">{targetMetric(target, goal)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-text-muted">{t("target.remaining")}</dt>
          <dd className="font-semibold tabular-nums">
            {targetMetric(target, target.progress.remaining)}
          </dd>
        </div>
        <div>
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
      <p className="mt-1.5 truncate text-[11px] text-text-muted">
        {t("target.dashboard.remainingDays")
          .replace("{amount}", targetMetric(target, target.progress.remaining))
          .replace("{days}", toBengaliDigits(String(target.progress.daysLeft)))}
      </p>
    </div>
  );
}
