"use client";

import { orderFunds, type OrderFund } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import { Popover } from "@/components/date-picker";
import { money } from "@/components/data-table";
import { Icon } from "@/components/icons";

const LABEL: Record<OrderFund, TranslationKey> = {
  damage: "order.fund.damage",
  incentive: "order.fund.incentive",
};

/**
 * D63: which balance parts pay the order first (damage before incentive, the rest from মোট জমা).
 * Both may be chosen; each option shows what that part holds.
 */
export function OrderFunding({
  value,
  balances,
  onChange,
}: {
  value: readonly OrderFund[];
  balances: Record<OrderFund, string>;
  onChange: (value: OrderFund[]) => void;
}) {
  const label =
    value.length === 0
      ? t("order.fund.none")
      : orderFunds
          .filter((f) => value.includes(f))
          .map((f) => t(LABEL[f]))
          .join(" + ");
  return (
    <div className="flex flex-col gap-1" title={t("order.fund.hint")}>
      {/* Same label-line height as পেমেন্ট so the two header controls share one baseline. */}
      <span className="text-xs font-medium text-text-muted">{t("order.fund.shortLabel")}</span>
      <Popover
        label={t("order.fund.label")}
        triggerClassName="inline-flex min-h-(--touch-target) w-72 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-left text-sm shadow-card transition-colors hover:border-border-strong aria-expanded:border-brand"
        trigger={
          <>
            <span className={value.length ? "font-medium" : "text-text-muted"}>{label}</span>
            <Icon name="chevronDown" className="size-4 text-text-muted" />
          </>
        }
      >
        {() => (
          <ul role="listbox" aria-multiselectable="true" className="flex w-80 flex-col p-1">
            {orderFunds.map((fund) => {
              const checked = value.includes(fund);
              return (
                <li key={fund} role="option" aria-selected={checked}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange(
                          orderFunds.filter((f) => (f === fund ? !checked : value.includes(f))),
                        )
                      }
                    />
                    <span className="flex-1">{t(LABEL[fund])}</span>
                    <span className="text-text-muted tabular-nums">{money(balances[fund])}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Popover>
    </div>
  );
}
