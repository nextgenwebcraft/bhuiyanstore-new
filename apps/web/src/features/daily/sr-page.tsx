"use client";

import { moneyKindPermission, type MoneyEntry, type StaffAccounts } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
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
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ReverseCell } from "@/components/reverse-cell";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useConfigList,
  useMoneyEntries,
  usePostMoneyEntry,
  useReverseMoneyEntry,
  useStaffAccounts,
  useStaffRecords,
} from "@/data/queries";
import { PersonDialog, type PersonDraft } from "@/features/catalog/staff-page";
import { clean, DateBar, useWorkingDate } from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";

const PATH = "sales/sr";

/**
 * D67: the SR entries of this tab; an advance lowers the day's cash, a return adds to it. D69:
 * no SR incentive paid in cash.
 */
type SrKind = "srLoan" | "srRepayment";
const SR_KINDS: readonly SrKind[] = ["srLoan", "srRepayment"];
const LABEL: Record<SrKind, TranslationKey> = {
  srLoan: "sr.entry.advance",
  srRepayment: "sr.entry.return",
};
const isSrKind = (kind: string): kind is SrKind => (SR_KINDS as readonly string[]).includes(kind);

type Row = StaffAccounts["rows"][number];

function EntryDialog({
  companyId,
  sr,
  date,
  kinds,
  onClose,
}: {
  companyId: string;
  sr: Row;
  date: string;
  kinds: SrKind[];
  onClose: () => void;
}) {
  const id = useId();
  const post = usePostMoneyEntry(companyId);
  const [kind, setKind] = useState<SrKind>(kinds[0] ?? "srLoan");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    try {
      await post.mutateAsync({
        date,
        kind,
        amount: value,
        staffId: sr.staffId,
        srLoanType: "cash",
      });
      onClose();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open
      title={`${sr.staffName} — ${t("sr.entry.title")}`}
      error={error}
      pending={post.isPending}
      submitLabel={t("common.post")}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className="text-sm text-text-muted">
        {t("sr.entry.due")}: <span className="font-semibold">{money(sr.balances.srLoan)}</span>
      </p>
      <Field id={`${id}-kind`} label={t("common.kind")}>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value as SrKind)}
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
          autoFocus
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-text-muted">{t("sr.entry.hint")}</p>
    </FormDialog>
  );
}

function DayEntries({
  companyId,
  rows,
  names,
}: {
  companyId: string;
  rows: MoneyEntry[];
  names: Map<string, string>;
}) {
  const { permissions } = useCurrentWorkspace();
  const reverse = useReverseMoneyEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("payment.reverse");
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{t("sr.entry.today")}</h2>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("common.name")}
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
              <th scope="col" className={thClass}>
                <span className="sr-only">{t("common.reverse")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id} className="border-t border-border">
                <td className={tdClass}>{names.get(entry.staffId ?? "") ?? ""}</td>
                <td className={tdClass}>{t(LABEL[entry.kind as SrKind])}</td>
                <td className={tdNum}>{money(entry.amount)}</td>
                <td className={tdClass}>
                  <StatusChip status={entry.status} />
                </td>
                <ReverseCell
                  canReverse={canReverse}
                  posted={entry.status === "posted"}
                  pending={reverse.isPending}
                  onReverse={() =>
                    void action.run(() => reverse.mutateAsync(entry.id), {
                      confirm: "money.reverseConfirm",
                    })
                  }
                />
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </section>
  );
}

/**
 * এসআর হিসাব (D67): add SRs, see what each owes, and post an advance or its return for the
 * working date from one page; the dashboard shows the totals.
 */
function SrAccounts() {
  const { company, permissions } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const accounts = useStaffAccounts(company.id, "sr", date);
  const entries = useMoneyEntries(company.id, { from: date, to: date });
  const records = useStaffRecords(company.id);
  const roles = useConfigList("staffRoles");
  const [entryFor, setEntryFor] = useState<Row | null>(null);
  const [person, setPerson] = useState<PersonDraft | null>(null);
  const canManage = permissions.includes("staff.manage");
  const kinds = SR_KINDS.filter((k) => permissions.includes(moneyKindPermission[k]));
  const srRoles = (roles.data ?? []).filter((role) => role.kind === "sr");

  const dayRows = (entries.data ?? []).filter((e) => isSrKind(e.kind) && e.staffId !== null);
  const dayTotal = (staffId: string, kind: SrKind) =>
    sumAmounts([
      "0",
      ...dayRows
        .filter((e) => e.staffId === staffId && e.kind === kind && e.status === "posted")
        .map((e) => e.amount),
    ]);
  const rows = accounts.data?.rows ?? [];
  const names = new Map(rows.map((r) => [r.staffId, r.staffName]));

  let body: React.ReactNode;
  if (accounts.isPending) body = <TableSkeleton rows={5} columns={6} />;
  else if (accounts.isError) {
    body = <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />;
  } else if (!accounts.data.cutoffDate) {
    body = (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  } else if (rows.length === 0) {
    body = <StatePanel title={t("sr.empty")} />;
  } else {
    body = (
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("common.name")}
              </th>
              <th scope="col" className={thNum}>
                {t("sr.entry.advanceToday")}
              </th>
              <th scope="col" className={thNum}>
                {t("sr.entry.returnToday")}
              </th>
              <th scope="col" className={thNum}>
                {t("sr.entry.due")}
              </th>
              <th scope="col" className={thClass}>
                <span className="sr-only">{t("sr.entry.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const record = records.data?.find((r) => r.id === row.staffId);
              return (
                <tr key={row.staffId} className="border-t border-border">
                  <td className={tdClass}>{row.staffName}</td>
                  <td className={tdNum}>{money(dayTotal(row.staffId, "srLoan"))}</td>
                  <td className={tdNum}>{money(dayTotal(row.staffId, "srRepayment"))}</td>
                  <td className={`${tdNum} font-semibold`}>{money(row.balances.srLoan)}</td>
                  <td className={`${tdClass} text-right`}>
                    <div className="flex justify-end gap-2">
                      {kinds.length > 0 ? (
                        <Button variant="primary" onClick={() => setEntryFor(row)}>
                          {t("sr.entry.open")}
                        </Button>
                      ) : null}
                      {canManage && record ? (
                        <Button
                          onClick={() =>
                            setPerson({
                              id: record.id,
                              name: record.name,
                              employer: record.employer,
                              status: record.status,
                            })
                          }
                        >
                          {t("common.edit")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-border-strong font-semibold">
              <td className={tdClass}>{t("common.total")}</td>
              <td className={tdNum}>
                {money(sumAmounts(["0", ...rows.map((r) => dayTotal(r.staffId, "srLoan"))]))}
              </td>
              <td className={tdNum}>
                {money(sumAmounts(["0", ...rows.map((r) => dayTotal(r.staffId, "srRepayment"))]))}
              </td>
              <td className={tdNum}>
                {money(sumAmounts(["0", ...rows.map((r) => r.balances.srLoan)]))}
              </td>
              <td className={tdClass} />
            </tr>
          </tbody>
        </table>
      </TableScroller>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.sales.sr")}
        description={t("sr.page.description")}
        actions={
          <>
            <DateBar date={date} onChange={setDate} />
            {canManage ? (
              <Button
                variant="primary"
                onClick={() => setPerson({ name: "", employer: "supplier", status: "active" })}
              >
                {t("sr.new")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {body}
        <DayEntries companyId={company.id} rows={dayRows} names={names} />
      </div>
      {entryFor ? (
        <EntryDialog
          companyId={company.id}
          sr={entryFor}
          date={date}
          kinds={kinds}
          onClose={() => setEntryFor(null)}
        />
      ) : null}
      {person ? (
        <PersonDialog
          companyId={company.id}
          draft={person}
          roles={srRoles}
          onClose={() => setPerson(null)}
        />
      ) : null}
    </>
  );
}

export function SrPage() {
  return (
    <NavGate path={PATH}>
      <SrAccounts />
    </NavGate>
  );
}
