"use client";

import type { OrderPaymentMethod } from "@bsd/contracts";
import { formatMoney, t } from "@bsd/i18n";
import { useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/combobox";
import { inputClass } from "@/components/field";
import { useCompanyCheckPicker } from "@/data/queries";

/**
 * D129: নগদ → company payable; চেক → searchable cheque picker (bill charges that cheque).
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
  const [text, setText] = useState("");
  const options: ComboboxOption[] = (picker.data?.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    searchText: [item.bankName, item.checkNumber, item.due],
  }));
  const selected = picker.data?.items.find((item) => item.id === companyCheckId);

  return (
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
              setText("");
            }
          }}
        >
          <option value="cash">{t("companyCheck.method.cash")}</option>
          <option value="check">{t("companyCheck.method.check")}</option>
        </select>
      </label>
      {method === "check" ? (
        <div className="flex w-80 min-w-72 shrink-0 flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">
            {t("companyCheck.picker")}
            {selected ? ` · ${formatMoney(selected.due)}` : ""}
          </span>
          <Combobox
            id="order-company-check"
            text={text || selected?.label || ""}
            onTextChange={(value) => {
              setText(value);
              if (companyCheckId) onCheckChange("");
            }}
            options={options}
            selectedId={companyCheckId || null}
            onChoose={(choice) => {
              if (choice.kind !== "option") return;
              onCheckChange(choice.option.id);
              setText(choice.option.label);
            }}
            emptyLabel={t("companyCheck.pickerEmpty")}
            listLabel={t("companyCheck.picker")}
            placeholder={t("companyCheck.pickerPlaceholder")}
          />
        </div>
      ) : null}
    </div>
  );
}
