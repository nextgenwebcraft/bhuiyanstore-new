"use client";

import { t } from "@bsd/i18n";
import { Field, inputClass } from "@/components/field";
import { useConfigList } from "@/data/queries";

/**
 * The cash/bank account a money entry moves (D52). The empty choice is the company's default
 * account, which the server resolves when the entry is stored (the default cash account, or the
 * first bank account for a supplier deposit).
 */
export function AccountSelect({
  id,
  label = t("money.account"),
  value,
  onChange,
  required = false,
  exclude,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** No default choice (a transfer names both accounts). */
  required?: boolean;
  /** An account already taken by the other side of a transfer. */
  exclude?: string;
}) {
  const accounts = useConfigList("cashAccounts");
  const active = (accounts.data ?? []).filter((a) => a.active && a.id !== exclude);
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        {required ? (
          <option value="">—</option>
        ) : (
          <option value="">{t("money.account.default")}</option>
        )}
        {active.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
