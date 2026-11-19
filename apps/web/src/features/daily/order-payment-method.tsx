"use client";

import type { OrderPaymentMethod } from "@bsd/contracts";
import { formatMoney, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { describeError } from "@/data/ports/service-error";
import { useBulkCreateCompanyChecks, useCompanyCheckPicker } from "@/data/queries";

/**
 * D129: নগদ → company payable; চেক → active-cheque dropdown. When none exist, create
 * bank+number here and select the new cheque.
 */
export function OrderPaymentMethod({
  companyId,
  method,
  companyCheckId,
  onMethodChange,
  onCheckChange,
}: {
  companyId: string;
  method: OrderPaymentMethod;
  companyCheckId: string;
  onMethodChange: (method: OrderPaymentMethod) => void;
  onCheckChange: (companyCheckId: string) => void;
}) {
  const picker = useCompanyCheckPicker(companyId, method === "check");
  const create = useBulkCreateCompanyChecks(companyId);
  const items = picker.data?.items ?? [];
  const selected = items.find((item) => item.id === companyCheckId);
  const empty = !picker.isPending && items.length === 0;
  const [creating, setCreating] = useState(false);
  const [bankName, setBankName] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [error, setError] = useState<string | undefined>();
  const showCreate = method === "check" && (empty || creating);

  async function submitCreate() {
    setError(undefined);
    const bank = bankName.trim();
    const number = checkNumber.trim();
    if (!bank) {
      setError(t("validation.companyCheck.bankName"));
      return;
    }
    if (!number) {
      setError(t("validation.companyCheck.checkNumber"));
      return;
    }
    try {
      const result = await create.mutateAsync({ rows: [{ bankName: bank, checkNumber: number }] });
      const created = result.items[0];
      if (created) onCheckChange(created.id);
      setBankName("");
      setCheckNumber("");
      setCreating(false);
      await picker.refetch();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {/* Same label+control stack as OrderFunding so the two controls share one baseline. */}
        <label className="flex w-56 shrink-0 flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-text-muted">
            {t("companyCheck.paymentMethod")}
          </span>
          <select
            className={inputClass}
            value={method}
            onChange={(event) => {
              const next = event.target.value as OrderPaymentMethod;
              onMethodChange(next);
              if (next === "cash") {
                onCheckChange("");
                setCreating(false);
                setError(undefined);
              }
            }}
          >
            <option value="cash">{t("companyCheck.method.cash")}</option>
            <option value="check">{t("companyCheck.method.check")}</option>
          </select>
        </label>
        {method === "check" && !showCreate ? (
          <label className="flex w-80 min-w-72 shrink-0 flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-text-muted">
              {t("companyCheck.picker")}
              {selected ? ` · ${t("companyCheck.due")} ${formatMoney(selected.due)}` : ""}
            </span>
            <select
              className={inputClass}
              value={companyCheckId}
              disabled={picker.isPending}
              onChange={(event) => onCheckChange(event.target.value)}
            >
              <option value="">{t("companyCheck.picker")}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {/[1-9]/.test(item.due)
                    ? ` · ${t("companyCheck.due")} ${formatMoney(item.due)}`
                    : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="self-start text-xs font-medium text-brand hover:underline"
              onClick={() => {
                setCreating(true);
                setError(undefined);
              }}
            >
              {t("companyCheck.pickerCreate")}
            </button>
          </label>
        ) : null}
      </div>
      {showCreate ? (
        <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-border bg-surface-muted/40 p-3">
          <p className="text-xs text-text-muted">
            {empty ? t("companyCheck.pickerEmptyCreate") : t("companyCheck.pickerCreateHint")}
          </p>
          {error ? (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <Field
              id="order-check-bank"
              label={t("companyCheck.bankName")}
              className="min-w-[10rem] flex-1"
            >
              <input
                id="order-check-bank"
                value={bankName}
                placeholder={t("companyCheck.bankNamePlaceholder")}
                onChange={(event) => setBankName(event.target.value)}
                className={inputClass}
                autoComplete="off"
              />
            </Field>
            <Field
              id="order-check-number"
              label={t("companyCheck.checkNumber")}
              className="min-w-[10rem] flex-1"
            >
              <input
                id="order-check-number"
                value={checkNumber}
                placeholder={t("companyCheck.checkNumberPlaceholder")}
                onChange={(event) => setCheckNumber(event.target.value)}
                className={inputClass}
                autoComplete="off"
              />
            </Field>
            <Button
              variant="primary"
              className="px-3 py-2 text-sm"
              disabled={create.isPending}
              onClick={() => void submitCreate()}
            >
              {create.isPending ? t("common.saving") : t("companyCheck.pickerCreateSubmit")}
            </Button>
            {!empty ? (
              <Button
                className="px-3 py-2 text-sm"
                disabled={create.isPending}
                onClick={() => {
                  setCreating(false);
                  setError(undefined);
                }}
              >
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
