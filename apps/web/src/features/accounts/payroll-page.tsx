"use client";

import type {
  PayrollAction,
  PayrollLine,
  PayrollRun,
  PayrollSaveRequest,
  PayrollStatus,
} from "@bsd/contracts";
import { EmptyListNote } from "@/components/empty-list-note";
import { useAsyncAction } from "@/lib/async-action";
import { lastOfMonth, monthOf, type OwedBucket, owedBuckets } from "@bsd/domain";
import { formatBusinessDate, formatMonth, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { DatePicker, MonthPicker } from "@/components/date-picker";
import { Field } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { FormSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { usePayrollCommand, usePayrollRun, useSavePayrollRun } from "@/data/queries";
import { CellInput, clean } from "@/features/daily/daily-kit";
import {
  money,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

type Bucket = OwedBucket;

type Draft = {
  salary: string;
  override: boolean;
  recovery: Record<Bucket, string>;
  reason: string;
};

const AMOUNT = /^\d+(\.\d{1,2})?$/;

function draftOf(line: PayrollLine): Draft {
  const changed = owedBuckets.some((b) => line.recovery[b] !== line.proposed[b]);
  return {
    salary: line.salary === "0" ? "" : line.salary,
    override: changed,
    recovery: { ...line.recovery },
    reason: line.reason,
  };
}

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** D75: confirm one person's Pay Now: their salary, absent fee, recovery and Cash Pabe. */
function PayNowDialog({
  run,
  month,
  line,
  onClose,
}: {
  run: PayrollRun;
  month: string;
  line: PayrollLine;
  onClose: () => void;
}) {
  const { company } = useCurrentWorkspace();
  const command = usePayrollCommand(company.id, month);
  const today = useToday();
  const [payDate, setPayDate] = useState(today);
  const action = useAsyncAction();
  const rows: [string, string][] = [
    [t("payroll.salary"), money(line.salary)],
    [t("payroll.absent"), money(line.absent)],
    [t("payroll.recovery"), money(line.recoveryTotal)],
  ];

  return (
    <FormDialog
      open
      title={`${t("payroll.payNow.title")}: ${line.staffName}`}
      error={action.error}
      pending={action.busy}
      submitLabel={t("payroll.payNow")}
      onClose={onClose}
      onSubmit={() =>
        void action.run(() =>
          command.mutateAsync({
            action: "payStaff",
            input: { version: run.version, payDate, staffId: line.staffId },
          }),
        )
      }
    >
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-text-muted">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
          <dt>{t("payroll.cashPay")}</dt>
          <dd className="tabular-nums">{money(line.cashPay)}</dd>
        </div>
      </dl>
      <Field id="pay-now-date" label={t("payroll.payDate")}>
        <DatePicker
          id="pay-now-date"
          value={payDate}
          min={`${month}-01`}
          max={today}
          label={t("payroll.payDate")}
          onChange={(next) => next && setPayDate(next)}
          className="w-full"
        />
      </Field>
      <p className="text-sm text-text-muted">{t("payroll.payNow.hint")}</p>
    </FormDialog>
  );
}

function RunStatus({ status }: { status: PayrollStatus }) {
  const tone =
    status === "paid" ? "success" : status === "approved" || status === "draft" ? "brand" : "muted";
  return <StatusBadge tone={tone}>{t(`payroll.status.${status}`)}</StatusBadge>;
}

function RunEditor({ run, month }: { run: PayrollRun; month: string }) {
  const { company, permissions } = useCurrentWorkspace();
  const save = useSavePayrollRun(company.id, month);
  const command = usePayrollCommand(company.id, month);
  const editable = run.status === "none" || run.status === "draft";
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(run.lines.map((l) => [l.staffId, draftOf(l)])),
  );
  const [date, setDate] = useState(run.date);
  const today = useToday();
  const [payDate, setPayDate] = useState(() => (today < run.date ? run.date : today));
  const [error, setError] = useState<string | undefined>();
  const [paying, setPaying] = useState<PayrollLine | null>(null);
  const action = useAsyncAction();
  const shownError = error ?? action.error;
  const busy = save.isPending || command.isPending;
  const can = {
    manage: permissions.includes("compensation.manage"),
    approve: permissions.includes("dsr_due.allocate_to_salary"),
    pay: permissions.includes("payment.post"),
    reverse: permissions.includes("payment.reverse"),
  };
  const canPayNow = editable && can.manage && can.approve && can.pay;
  const somePaid = run.lines.some((l) => l.paid);

  function payNow(line: PayrollLine) {
    setError(undefined);
    const d = drafts[line.staffId];
    if (d && !sameDraft(d, draftOf(line))) {
      setError(`${line.staffName}: ${t("payroll.payNow.saveFirst")}`);
      return;
    }
    setPaying(line);
  }

  const update = (staffId: string, patch: Partial<Draft>) =>
    setDrafts((current) => {
      const existing = current[staffId];
      return existing ? { ...current, [staffId]: { ...existing, ...patch } } : current;
    });

  async function submit() {
    setError(undefined);
    const lines: PayrollSaveRequest["lines"] = [];
    for (const line of run.lines) {
      const d = drafts[line.staffId];
      if (!d) continue;
      const salary = clean(d.salary) || "0";
      if (!AMOUNT.test(salary)) {
        setError(`${line.staffName}: ${t("validation.opening.amount")}`);
        return;
      }
      if (salary === "0" && !d.override) continue;
      let recovery = null;
      if (d.override) {
        const parts = owedBuckets.map((b) => clean(d.recovery[b]) || "0");
        if (parts.some((p) => !AMOUNT.test(p))) {
          setError(`${line.staffName}: ${t("validation.opening.amount")}`);
          return;
        }
        if (!d.reason.trim()) {
          setError(`${line.staffName}: ${t("validation.payroll.reasonRequired")}`);
          return;
        }
        recovery = { advance: parts[0] ?? "0", loan: parts[1] ?? "0", shortage: parts[2] ?? "0" };
      }
      lines.push({ staffId: line.staffId, salary, recovery, reason: d.reason.trim() });
    }
    await action.run(() => save.mutateAsync({ version: run.version, date, lines }));
  }

  async function act(kind: Exclude<PayrollAction, "payStaff">) {
    setError(undefined);
    await action.run(
      () =>
        command.mutateAsync({
          action: kind,
          input: { version: run.version, payDate: kind === "pay" ? payDate : null },
        }),
      { confirm: `payroll.confirm.${kind}` },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <Field id="payroll-date" label={t("payroll.runDate")} className="w-48">
          <DatePicker
            id="payroll-date"
            value={date}
            disabled={!editable || !can.manage}
            min={`${month}-01`}
            max={lastOfMonth(month)}
            label={t("payroll.runDate")}
            onChange={(next) => next && setDate(next)}
            className="w-full"
          />
        </Field>
        {run.status === "approved" && can.pay ? (
          <Field id="payroll-pay-date" label={t("payroll.payDate")} className="w-48">
            <DatePicker
              id="payroll-pay-date"
              value={payDate}
              min={run.date}
              label={t("payroll.payDate")}
              onChange={(next) => next && setPayDate(next)}
              className="w-full"
            />
          </Field>
        ) : null}
        {run.payDate ? (
          <p className="text-sm text-text-muted">
            {t("payroll.paidOn")} {formatBusinessDate(run.payDate)}
          </p>
        ) : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("payroll.totalSalary")} value={money(run.totals.salary)} />
        <StatTile label={t("payroll.totalAbsent")} value={money(run.totals.absent)} />
        <StatTile label={t("payroll.totalRecovery")} value={money(run.totals.recovery)} />
        <StatTile label={t("payroll.totalCash")} value={money(run.totals.cashPay)} emphasis />
      </dl>
      {editable ? <p className="text-sm text-text-muted">{t("payroll.hint")}</p> : null}
      {run.lines.length === 0 ? (
        <EmptyListNote textKey="payroll.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.name")}
                </th>
                <th scope="col" className={thNum}>
                  {t("payroll.salary")}
                </th>
                <th scope="col" className={thNum}>
                  {t("payroll.absent")}
                </th>
                <th scope="col" className={thNum}>
                  {t("payroll.owed")}
                </th>
                <th scope="col" className={thNum}>
                  {t("payroll.recovery")}
                </th>
                <th scope="col" className={thNum}>
                  {t("payroll.cashPay")}
                </th>
                {editable || somePaid ? (
                  <th scope="col" className={`${thClass} print:hidden`}>
                    <span className="sr-only">{t("common.actions")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {run.lines.map((line) => {
                const d = drafts[line.staffId] ?? draftOf(line);
                const lineEditable = editable && can.manage && !line.paid;
                return (
                  <tr key={line.staffId} className="border-t border-border align-top">
                    <td className={tdClass}>
                      {line.staffName}
                      <div className="text-xs text-text-muted">{line.roleName}</div>
                    </td>
                    <td className={tdNum}>
                      {lineEditable ? (
                        <CellInput
                          label={`${line.staffName} ${t("payroll.salary")}`}
                          value={d.salary}
                          mode="decimal"
                          width="w-28"
                          onChange={(salary) => update(line.staffId, { salary })}
                        />
                      ) : (
                        money(line.salary)
                      )}
                    </td>
                    <td className={tdNum}>{money(line.absent)}</td>
                    <td className={`${tdNum} text-xs`}>
                      {owedBuckets.map((b) => (
                        <div key={b}>
                          {t(`report.column.${b}`)}: {money(line.owed[b])}
                        </div>
                      ))}
                    </td>
                    <td className={tdNum}>
                      {lineEditable && d.override ? (
                        <div className="flex flex-col items-end gap-1">
                          {owedBuckets.map((b) => (
                            <label key={b} className="flex items-center gap-2 text-xs">
                              {t(`report.column.${b}`)}
                              <CellInput
                                label={`${line.staffName} ${t(`report.column.${b}`)}`}
                                value={d.recovery[b]}
                                mode="decimal"
                                width="w-24"
                                onChange={(value) =>
                                  update(line.staffId, { recovery: { ...d.recovery, [b]: value } })
                                }
                              />
                            </label>
                          ))}
                          <CellInput
                            label={`${line.staffName} ${t("payroll.reason")}`}
                            placeholder={t("payroll.reason")}
                            value={d.reason}
                            mode="text"
                            width="w-48"
                            onChange={(reason) => update(line.staffId, { reason })}
                          />
                        </div>
                      ) : (
                        <>
                          {money(line.recoveryTotal)}
                          {line.reason ? (
                            <div className="text-xs text-text-muted">{line.reason}</div>
                          ) : null}
                        </>
                      )}
                      {lineEditable ? (
                        <label className="mt-1 flex items-center justify-end gap-1 text-xs text-text-muted">
                          <input
                            type="checkbox"
                            checked={d.override}
                            onChange={(event) =>
                              update(line.staffId, {
                                override: event.target.checked,
                                recovery: { ...line.proposed },
                              })
                            }
                          />
                          {t("payroll.override")}
                        </label>
                      ) : null}
                    </td>
                    <td className={`${tdNum} font-semibold`}>{money(line.cashPay)}</td>
                    {editable || somePaid ? (
                      <td className={`${tdClass} text-right print:hidden`}>
                        {line.paid ? (
                          <StatusBadge tone="success">{t("payroll.status.paid")}</StatusBadge>
                        ) : canPayNow ? (
                          <Button
                            variant="primary"
                            className="whitespace-nowrap"
                            disabled={busy}
                            onClick={() => payNow(line)}
                          >
                            {t("payroll.payNow")}
                          </Button>
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
      {shownError ? <StatePanel tone="error" title={shownError} /> : null}
      <div className="flex flex-wrap gap-2">
        {editable && can.manage ? (
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {save.isPending ? t("common.saving") : t("payroll.saveDraft")}
          </Button>
        ) : null}
        {run.status === "draft" && can.manage && can.approve ? (
          <Button disabled={busy} onClick={() => void act("approve")}>
            {t("payroll.approve")}
          </Button>
        ) : null}
        {run.status === "draft" && can.manage && !somePaid ? (
          <Button disabled={busy} onClick={() => void act("discard")}>
            {t("payroll.discard")}
          </Button>
        ) : null}
        {run.status === "approved" && can.manage && can.pay ? (
          <Button variant="primary" disabled={busy} onClick={() => void act("pay")}>
            {t("payroll.pay")}
          </Button>
        ) : null}
        {(run.status === "approved" ||
          run.status === "paid" ||
          (run.status === "draft" && somePaid)) &&
        can.manage &&
        can.reverse ? (
          <Button disabled={busy} onClick={() => void act("reverse")}>
            {t("payroll.reverse")}
          </Button>
        ) : null}
      </div>
      {paying ? (
        <PayNowDialog run={run} month={month} line={paying} onClose={() => setPaying(null)} />
      ) : null}
    </div>
  );
}

/** Monthly payroll: salary, recovery advance → loan → shortage, Cash Pabe (D11, D24, D25). */
export function PayrollPage({ path }: { path: string }) {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [month, setMonth] = useState(() => monthOf(today));
  const query = usePayrollRun(company.id, month);
  const run = query.data;

  return (
    <NavGate path={path}>
      <PageHeader
        title={t("dsr.salaryRecovery")}
        description={t("payroll.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker
              id="payroll-month"
              value={month}
              label={t("month.picker")}
              onChange={setMonth}
            />
            {run ? <RunStatus status={run.status} /> : null}
            <PrintButton />
          </div>
        }
      />
      <PrintHeader title={`${t("dsr.salaryRecovery")} — ${formatMonth(month)}`} />
      {query.isPending ? (
        <div className="flex flex-col gap-6">
          <FormSkeleton fields={2} />
          <TableSkeleton rows={6} columns={8} />
        </div>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data.cutoffDate ? (
        <StatePanel
          tone="warning"
          title={t("daily.noOpening.title")}
          hint={t("daily.noOpening.hint")}
        />
      ) : (
        <RunEditor
          key={`${month}:${query.data.status}:${query.data.version}`}
          run={query.data}
          month={month}
        />
      )}
    </NavGate>
  );
}
