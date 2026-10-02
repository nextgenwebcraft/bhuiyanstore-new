import { recordStatuses, type Supplier } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { Field, inputClass } from "./field";

type RecordStatus = Supplier["status"];

/** Active/inactive picker for masters and lists: records are deactivated, never deleted (4.4). */
export function StatusField({
  id,
  value,
  onChange,
  hint,
}: {
  id: string;
  value: RecordStatus;
  onChange: (status: RecordStatus) => void;
  hint?: string;
}) {
  return (
    <Field id={id} label={t("common.status")} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as RecordStatus)}
        className={inputClass}
      >
        {recordStatuses.map((status) => (
          <option key={status} value={status}>
            {t(`common.status.${status}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export const statusOf = (active: boolean): RecordStatus => (active ? "active" : "inactive");
