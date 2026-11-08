"use client";

import type { OrderTarget } from "@bsd/contracts";
import { toDecimal } from "@bsd/domain";
import { t, formatCount, toBengaliDigits } from "@bsd/i18n";
import { useId, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useDayView, useOrderTargets } from "@/data/queries";
import { targetLabel, targetMetric } from "@/features/targets/target-progress";
import { useToday } from "@/lib/today";
import { useCurrentWorkspace } from "./workspace-context";

/** Kept so page call sites stay valid; the bell no longer shows engine page warnings (D121). */
export function PageWarnings(_props: { warnings: readonly unknown[] }) {
  return null;
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  return children;
}

/** Active targets at least this far along (not yet met) count as “কাছাকাছি”. */
const NEAR_TARGET_RATIO = 0.8;

type Alert = {
  id: string;
  title: string;
  detail?: string;
};

function outOfStockAlerts(
  products: readonly { productId: string; productName: string; stock: string }[],
): Alert[] {
  const empty = products.filter((p) => !toDecimal(p.stock).gt(0));
  if (empty.length === 0) return [];
  const names = empty.slice(0, 8).map((p) => p.productName);
  const rest = empty.length - names.length;
  const detail =
    rest > 0
      ? `${names.join(", ")} ${t("warning.andMore")} ${formatCount(rest)}`
      : names.join(", ");
  return [
    {
      id: "out-of-stock",
      title: t("notifications.outOfStock"),
      detail: `${detail} · ${formatCount(empty.length)} ${t("warning.products")}`,
    },
  ];
}

function nearTargetAlerts(targets: readonly OrderTarget[]): Alert[] {
  return targets
    .filter((target) => {
      if (target.status !== "active") return false;
      if (target.progress.status === "met") return false;
      const ratio = Number(target.progress.ratio);
      return Number.isFinite(ratio) && ratio >= NEAR_TARGET_RATIO;
    })
    .map((target) => ({
      id: `target-${target.id}`,
      title: t("notifications.nearTarget"),
      detail: `${targetLabel(target)} · ${toBengaliDigits(String(Math.round(Number(target.progress.ratio) * 100)))}% · ${t("target.remaining")}: ${targetMetric(target, target.progress.remaining)}`,
    }));
}

function AlertList({ alerts }: { alerts: readonly Alert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="px-2 py-4 text-center text-sm text-text-muted">{t("notifications.empty")}</p>
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {alerts.map((alert) => (
        <li key={alert.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-sm">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
          <div className="min-w-0">
            <span className="font-medium">{alert.title}</span>
            {alert.detail ? <p className="mt-0.5 text-text-muted">{alert.detail}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Header bell: out-of-stock products and near order targets (D121). */
export function NotificationBell() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const operating = !company.isMaster;
  const day = useDayView(company.id, today, operating);
  const targets = useOrderTargets(company.id, false, operating);
  const alerts = useMemo(() => {
    if (!operating) return [];
    return [
      ...outOfStockAlerts(day.data?.products ?? []),
      ...nearTargetAlerts(targets.data?.items ?? []),
    ];
  }, [operating, day.data?.products, targets.data?.items]);
  const count = alerts.length;
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("notifications.open")}
        title={t("notifications.title")}
        onClick={() => setOpen((value) => !value)}
        className={`relative inline-flex size-10 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover hover:text-text ${
          open ? "bg-surface-hover text-text" : "text-text-muted"
        }`}
      >
        <Icon name="bell" />
        {count > 0 ? (
          <span className="absolute top-1 right-1 inline-flex min-w-4.5 items-center justify-center rounded-full bg-warning px-1 text-[10px] leading-4.5 font-semibold text-surface tabular-nums">
            {formatCount(count)}
          </span>
        ) : null}
      </button>
      <span role="status" className="sr-only">
        {count > 0 ? `${t("notifications.title")}: ${formatCount(count)}` : ""}
      </span>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("notifications.title")}
          className="absolute top-full right-0 z-40 mt-1.5 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-surface p-1.5 shadow-raised"
        >
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-text-muted">
            {t("notifications.title")}
          </p>
          <div className="min-h-0 overflow-y-auto">
            <AlertList alerts={alerts} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
