"use client";

import { t } from "@bsd/i18n";
import { useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/combobox";
import { Field } from "@/components/field";

export type DsrChoice = { id: string; name: string };

/** A searchable DSR pick. Choosing a row is what changes the posted person. */
export function DsrSelect({
  id,
  value,
  dsrs,
  onChange,
}: {
  id: string;
  value: string;
  dsrs: readonly DsrChoice[];
  onChange: (staffId: string) => void;
}) {
  const selected = dsrs.find((dsr) => dsr.id === value);
  const [text, setText] = useState(selected?.name ?? "");
  const options = useMemo<ComboboxOption[]>(
    () => dsrs.map((dsr) => ({ id: dsr.id, label: dsr.name })),
    [dsrs],
  );
  return (
    <Field id={id} label={t("staffCash.dsr")} className="min-w-0">
      <Combobox
        id={id}
        text={text}
        onTextChange={setText}
        options={options}
        selectedId={selected && text === selected.name ? selected.id : null}
        onChoose={(choice) => {
          if (choice.kind !== "option") return;
          setText(choice.option.label);
          onChange(choice.option.id);
        }}
        placeholder={t("staffCash.dsr")}
        emptyLabel={t("staffCash.dsrEmpty")}
        listLabel={t("staffCash.dsr")}
        clearLabel={t("shop.clear")}
        onBlur={() => setText(selected?.name ?? "")}
      />
    </Field>
  );
}
