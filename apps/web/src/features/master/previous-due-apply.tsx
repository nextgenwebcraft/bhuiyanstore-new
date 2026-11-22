"use client";

import { formatMoney, formatMonth, normalizeDigits, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { Icon } from "@/components/icons";
import { QueryError } from "@/components/query-error";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useApplyPreviousDueReduction, usePreviousDues } from "@/data/queries";

/**
 * D128: pick an open Previous Due and an amount; submit cuts that amount from the due balance and
 * from the given month's distributable profit. Lives on the payment month (D143) so the cut is
 * made before partners are paid. Hidden when no due is open.
 */
export function PreviousDueApplyForm({ companyId, month }: { companyId: string; month: string }) {
  const dues = usePreviousDues(companyId);
  const reduce = useApplyPreviousDueReduction(companyId);
  const [previousDueId, setPreviousDueId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Remaining balance > 0 (settled rows stay as 0.00).
  const openItems = (dues.data?.items ?? []).filter((row) => /[1-9]/.test(row.amount));
  const selectedDueId = openItems.some((row) => row.id === previousDueId)
    ? previousDueId
    : (openItems[0]?.id ?? "");
  const selected = openItems.find((row) => row.id === selectedDueId);

  async function submit() {
    if (!selectedDueId || !amount.trim()) return;
    setError(null);
    try {
      await reduce.mutateAsync({
        previousDueId: selectedDueId,
        month,
        amount: normalizeDigits(amount.trim()),
      });
      setAmount("");
    } catch (caught) {
      setError(describeError(caught, []).form ?? null);
    }
  }

  if (dues.isPending) return null;
  if (dues.isError) {
    return <QueryError error={dues.error} onRetry={() => void dues.refetch()} />;
  }
  if (openItems.length === 0) return null;

  return (
    <details className="group rounded-xl border border-border bg-surface shadow-card print:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex flex-col">
          <span className="text-sm font-semibold">
            {t("previousDue.applyTitle")} — {formatMonth(month)}
          </span>
          <span className="text-xs text-text-muted">
            {t("previousDue.openTotal")}: {formatMoney(dues.data.openTotal)}
          </span>
        </span>
        <Icon
          name="chevronDown"
          className="size-4 text-text-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
        <p className="text-sm text-text-muted">{t("previousDue.applyHint")}</p>
        {error ? <StatePanel tone="error" title={error} compact /> : null}
        <div className="flex flex-wrap items-end gap-3">
          <Field
            id="previous-due-apply-due"
            label={t("nav.master.previousDue")}
            className="min-w-56"
          >
            <select
              id="previous-due-apply-due"
              className={inputClass}
              value={selectedDueId}
              onChange={(event) => setPreviousDueId(event.target.value)}
            >
              {openItems.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.reason} — {formatMoney(row.amount)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="previous-due-apply-amount"
            label={t("previousDue.reduceAmount")}
            className="w-40"
          >
            <input
              id="previous-due-apply-amount"
              className={`${inputClass} text-right`}
              inputMode="decimal"
              value={amount}
              placeholder={selected ? selected.amount : undefined}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={reduce.isPending || !selectedDueId || !amount.trim()}
            onClick={() => void submit()}
          >
            {reduce.isPending ? <Icon name="spinner" className="size-4 animate-spin" /> : null}
            {t("previousDue.applySubmit")}
          </Button>
        </div>
      </div>
    </details>
  );
}
