"use client";

import { moneyKindPermission, type MoneyEntry, type MoneyEntryPostRequest } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { DsrSelect, type DsrChoice } from "@/features/daily/dsr-select";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm-dialog";
import {
  money,
  StatusChip,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { EmptyListNote } from "@/components/empty-list-note";
import { Field, inputClass } from "@/components/field";
import { QueryError } from "@/components/query-error";
import { FormSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import { useCorrectMoneyEntry, useMoneyEntries, usePostMoneyEntry } from "@/data/queries";
import { canEditDailyMoney, canPostDailyMoney, clean } from "@/features/daily/daily-kit";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/** D62: the kinds of the DSR sheet's staff money card; D67 adds the absent fee. */
export type StaffCashKind = "advance" | "shortage" | "advanceReturn" | "shortageReturn" | "absent";

const KINDS: readonly StaffCashKind[] = [
  "advance",
  "shortage",
  "advanceReturn",
  "shortageReturn",
  "absent",
];

const LABEL: Record<StaffCashKind, TranslationKey> = {
  advance: "staffCash.kind.advance",
  shortage: "staffCash.kind.shortage",
  advanceReturn: "staffCash.kind.advanceReturn",
  shortageReturn: "staffCash.kind.shortageReturn",
  absent: "staffCash.kind.absent",
};

/** The money entry a card kind posts: returns are repayments allocated to one bucket. */
export function staffCashRequest(
  kind: StaffCashKind,
  amount: string,
): Pick<MoneyEntryPostRequest, "kind" | "allocation"> {
  switch (kind) {
    case "advance":
      return { kind: "staffAdvance" };
    case "shortage":
      return { kind: "staffShortage" };
    case "advanceReturn":
      return { kind: "staffRepayment", allocation: { advance: amount, loan: "0", shortage: "0" } };
    case "shortageReturn":
      return { kind: "staffRepayment", allocation: { advance: "0", loan: "0", shortage: amount } };
    case "absent":
      return { kind: "staffAbsent" };
  }
}

/** The card kind of a posted entry, or null when the entry is not staff money of the card. */
export function staffCashKindOf(entry: MoneyEntry): StaffCashKind | null {
  if (entry.kind === "staffAdvance") return "advance";
  if (entry.kind === "staffShortage") return "shortage";
  if (entry.kind === "staffAbsent") return "absent";
  if (entry.kind !== "staffRepayment") return null;
  const shortage = entry.allocation?.shortage ?? "0";
  return /[1-9]/.test(shortage) ? "shortageReturn" : "advanceReturn";
}

function EntryForm({
  companyId,
  staffId,
  date,
  kinds,
  dsr,
  editing,
  onClearEdit,
}: {
  companyId: string;
  staffId: string;
  date: string;
  kinds: StaffCashKind[];
  dsr?: { id: string; dsrs: readonly DsrChoice[]; onChange: (staffId: string) => void };
  editing: MoneyEntry | null;
  onClearEdit: () => void;
}) {
  const id = useId();
  const confirm = useConfirm();
  const post = usePostMoneyEntry(companyId);
  const correct = useCorrectMoneyEntry(companyId);
  // Remounted via key when `editing` changes, so initial state comes from the row being edited.
  const [kind, setKind] = useState<StaffCashKind>(
    (editing && staffCashKindOf(editing)) || kinds[0] || "advance",
  );
  const [amount, setAmount] = useState(editing?.amount ?? "");
  const [error, setError] = useState<string | undefined>();
  const pending = post.isPending || correct.isPending;

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    const body = { date, amount: value, staffId, ...staffCashRequest(kind, value) };
    try {
      if (editing) {
        const ok = await confirm({
          title: t("common.confirmTitle"),
          message: t("money.correctConfirm"),
          confirmLabel: t("common.confirm"),
        });
        if (!ok) return;
        await correct.mutateAsync({ entryId: editing.id, body });
        onClearEdit();
      } else {
        await post.mutateAsync(body);
      }
      setAmount("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-3 ${dsr ? "grid-cols-3" : "grid-cols-2"}`}>
        {dsr ? (
          <DsrSelect
            id={`${id}-dsr`}
            value={dsr.id}
            dsrs={dsr.dsrs}
            onChange={dsr.onChange}
            label="staff.person"
            emptyLabel="staffCash.personEmpty"
          />
        ) : null}
        <Field id={`${id}-kind`} label={t("common.kind")}>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as StaffCashKind)}
            className={inputClass}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(LABEL[k])}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-amount`} label={t("common.amount")}>
          <input
            id={`${id}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            className={inputClass}
          />
        </Field>
      </div>
      {error ? <StatePanel tone="error" title={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={() => void submit()}>
          {pending
            ? t("common.posting")
            : editing
              ? t("money.correct")
              : t("common.post")}
        </Button>
        {editing ? (
          <Button disabled={pending} onClick={onClearEdit}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Entries({
  rows,
  canEdit,
  onEdit,
}: {
  rows: MoneyEntry[];
  canEdit: boolean;
  onEdit: (entry: MoneyEntry) => void;
}) {
  const total = (kind: StaffCashKind) =>
    sumAmounts([
      "0",
      ...rows
        .filter((e) => staffCashKindOf(e) === kind && e.status === "posted")
        .map((e) => e.amount),
    ]);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{t("money.posted")}</h4>
      {rows.length === 0 ? (
        <EmptyListNote textKey="money.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("staff.person")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.kind")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.amount")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                {canEdit ? (
                  <th scope="col" className={thClass}>
                    <span className="sr-only">{t("common.edit")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const kind = staffCashKindOf(entry);
                return (
                  <tr key={entry.id} className="border-t border-border">
                    <td className={tdClass}>{entry.staffName}</td>
                    <td className={tdClass}>{kind ? t(LABEL[kind]) : null}</td>
                    <td className={tdNum}>{money(entry.amount)}</td>
                    <td className={tdClass}>
                      <StatusChip status={entry.status} />
                    </td>
                    {canEdit ? (
                      <td className={`${tdClass} text-right`}>
                        {entry.status === "posted" && !entry.dsrDayId && !entry.payrollRunId ? (
                          <Button onClick={() => onEdit(entry)}>{t("common.edit")}</Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}
      <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
        {KINDS.map((k) => (
          <div key={k} className="flex justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
            <dt className="text-text-muted">{t(LABEL[k])}</dt>
            <dd className="font-medium tabular-nums">{money(total(k))}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The DSR's advance and shortage for one day (D62): posted at once as money entries of the sheet's
 * DSR and date; they move the expected cash of the day-end check below.
 */
export function StaffCashEntry({
  companyId,
  staffId,
  date,
  dsrs,
  handoverLocked,
}: {
  companyId: string;
  staffId: string;
  date: string;
  /** DSRs the card can post for. Omitted on a person's own entry dialog. */
  dsrs?: readonly DsrChoice[];
  /** D114: pass from the day sheet; omitted elsewhere hides Edit. */
  handoverLocked?: boolean;
}) {
  const { permissions, loginRoleKind } = useCurrentWorkspace();
  const [picked, setPicked] = useState(staffId);
  const [editing, setEditing] = useState<MoneyEntry | null>(null);
  const activeId = dsrs?.some((dsr) => dsr.id === picked)
    ? picked
    : (dsrs?.find((dsr) => dsr.id === staffId)?.id ?? dsrs?.[0]?.id ?? staffId);
  // Today's entries list every DSR, not only the one picked above (the form posts for that one).
  const entries = useMoneyEntries(companyId, { from: date, to: date });
  const kinds = KINDS.filter((k) =>
    permissions.includes(moneyKindPermission[staffCashRequest(k, "0").kind]),
  );
  const canEdit = canEditDailyMoney(loginRoleKind, handoverLocked);
  const canCreate = canPostDailyMoney(loginRoleKind, handoverLocked) && kinds.length > 0;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("staffCash.title")}</h3>
      {canCreate || editing ? (
        <EntryForm
          key={`${activeId}-${date}-${editing?.id ?? "new"}`}
          companyId={companyId}
          staffId={activeId}
          date={date}
          kinds={kinds}
          editing={editing}
          onClearEdit={() => setEditing(null)}
          {...(dsrs && dsrs.length > 0 ? { dsr: { id: activeId, dsrs, onChange: setPicked } } : {})}
        />
      ) : null}
      {entries.isPending ? (
        <FormSkeleton fields={1} />
      ) : entries.isError ? (
        <QueryError error={entries.error} onRetry={() => void entries.refetch()} />
      ) : (
        <Entries
          rows={entries.data.filter((e) => staffCashKindOf(e) !== null)}
          canEdit={canEdit}
          onEdit={(entry) => {
            if (entry.staffId) setPicked(entry.staffId);
            setEditing(entry);
          }}
        />
      )}
    </section>
  );
}
