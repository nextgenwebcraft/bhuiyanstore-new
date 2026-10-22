"use client";

import type {
  ReportRange,
  StaffAccountKind,
  StaffBalanceKey,
  StaffStatement,
} from "@bsd/contracts";
import { formatBusinessDate, t, type TranslationKey } from "@bsd/i18n";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { presetRange } from "@/components/calendar-math";
import { DatePicker, DateRangePicker, Popover } from "@/components/date-picker";
import { Field } from "@/components/field";
import { Icon } from "@/components/icons";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useStaffStatement } from "@/data/queries";
import { useService } from "@/data/service-context";
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
import { StaffCashEntry } from "@/features/daily/staff-cash-entry";
import type { RowAction } from "@/features/reports/report-view";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { downloadBlob } from "@/lib/download";
import { useToday } from "@/lib/today";

/** Balance columns per account kind; SR accounts carry no salary (D18). */
const KIND_KEYS: Record<StaffAccountKind, readonly StaffBalanceKey[]> = {
  distributor: ["advance", "loan", "shortage", "credit", "salaryPayable"],
  sr: ["srLoan", "owedToSr"],
};

const balanceLabel = (key: string) => t(`report.column.${key}` as TranslationKey);

export type StaffPerson = { staffId: string; staffName: string };

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
      {text}
    </p>
  );
}

function StatementBody({ statement }: { statement: StaffStatement }) {
  const keys = KIND_KEYS[statement.kind];
  return (
    <div className="flex flex-col gap-6">
      {statement.from !== statement.to ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(statement.from)} –{" "}
          {formatBusinessDate(statement.to)}
        </p>
      ) : null}
      {/* <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((k) => (
          <StatTile
            key={k}
            label={`${balanceLabel(k)} (${t("report.column.closing")})`}
            value={money(statement.closing[k])}
          />
        ))}
        {statement.kind === "distributor" ? (
          <>
            <StatTile label={t("report.column.owesUs")} value={money(statement.owesUs)} emphasis />
            <StatTile label={t("report.column.weOwe")} value={money(statement.weOwe)} emphasis />
          </>
        ) : null}
      </dl> */}
      {statement.lines.length === 0 ? (
        <Empty text={t("report.empty")} />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.date")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.kind")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.amount")}
                </th>
                {keys.map((k) => (
                  <th key={k} scope="col" className={thNum}>
                    {balanceLabel(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border bg-surface-muted/50">
                <td className={tdClass} colSpan={3}>
                  {t("report.column.opening")}
                </td>
                {keys.map((k) => (
                  <td key={k} className={tdNum}>
                    {money(statement.opening[k])}
                  </td>
                ))}
              </tr>
              {statement.lines.map((line, index) => (
                <tr key={line.entryId ?? index} className="border-t border-border">
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatBusinessDate(line.date)}
                  </td>
                  <td className={tdClass}>
                    {t(`money.kind.${line.kind}` as TranslationKey)}
                    {line.srLoanType ? (
                      <div className="text-xs text-text-muted">
                        {t(`money.srLoanType.${line.srLoanType}`)}
                      </div>
                    ) : null}
                    {line.payrollRunId ? (
                      <div className="text-xs text-text-muted">{t("payroll.fromRun")}</div>
                    ) : null}
                  </td>
                  <td className={tdNum}>{money(line.amount)}</td>
                  {keys.map((k) => {
                    const change = line.change[k];
                    return (
                      <td key={k} className={tdNum}>
                        {money(line.balances[k])}
                        {change !== "0" ? (
                          <div className="text-xs text-text-muted">
                            {change.startsWith("-") ? "" : "+"}
                            {money(change)}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}

function Statement({
  companyId,
  staffId,
  range,
}: {
  companyId: string;
  staffId: string;
  range: ReportRange;
}) {
  const query = useStaffStatement(companyId, staffId, range);
  if (range.from > range.to)
    return <StatePanel tone="error" title={t("validation.period.endBeforeStart")} />;
  if (query.isPending) return <SummarySkeleton stats={4} rows={8} />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  }
  return <StatementBody statement={query.data} />;
}

/** A modal `<dialog>` opened on mount; closing it (Esc, the close button) calls `onClose`. */
export function StaffDialog({
  person,
  description,
  printTitle,
  actions,
  onClose,
  children,
}: {
  person: StaffPerson;
  description: string;
  /** Print heading; the dialog prints only when given. */
  printTitle?: { title: string; range?: ReportRange };
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      data-print={printTitle ? true : undefined}
      onClose={onClose}
      aria-label={person.staffName}
      className="m-auto w-full max-w-5xl rounded-2xl border border-border bg-surface p-0 text-text shadow-raised"
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{person.staffName}</h2>
            <p className="text-sm text-text-muted">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {actions}
            {printTitle ? <PrintButton /> : null}
            <Button onClick={() => ref.current?.close()}>{t("nav.close")}</Button>
          </div>
        </div>
        {printTitle ? <PrintHeader title={printTitle.title} {...printTitle.range} /> : null}
        {children}
      </div>
    </dialog>
  );
}

const menuItem =
  "flex min-h-(--touch-target) w-full items-center px-4 text-left text-sm hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";

/**
 * D75: the ⋮ menu of a staff balance row (এন্ট্রি, বিবরণী) and the dialog it opens. Rows without
 * an id get no menu.
 */
export function useStaffRowActions(): { rowAction: RowAction; dialog: React.ReactNode } {
  const { permissions } = useCurrentWorkspace();
  const canEnter = permissions.includes("payment.post");
  const [open, setOpen] = useState<{ person: StaffPerson; mode: "entry" | "statement" } | null>(
    null,
  );
  const rowAction: RowAction = (row) => {
    if (!row.id) return null;
    const person = { staffId: row.id, staffName: row.cells.staff ?? "" };
    const pick = (mode: "entry" | "statement", close: () => void) => {
      close();
      setOpen({ person, mode });
    };
    return (
      <Popover
        label={`${person.staffName}: ${t("common.actions")}`}
        align="end"
        triggerClassName="inline-flex size-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text aria-expanded:bg-surface-muted"
        trigger={<Icon name="dots" />}
      >
        {({ close }) => (
          <div className="flex min-w-40 flex-col py-1">
            {canEnter ? (
              <button type="button" className={menuItem} onClick={() => pick("entry", close)}>
                {t("staffEntry.entry")}
              </button>
            ) : null}
            <button type="button" className={menuItem} onClick={() => pick("statement", close)}>
              {t("accounts.statement")}
            </button>
          </div>
        )}
      </Popover>
    );
  };
  const dialog = !open ? null : open.mode === "entry" ? (
    <EntryDialog person={open.person} onClose={() => setOpen(null)} />
  ) : (
    <StatementDialog person={open.person} onClose={() => setOpen(null)} />
  );
  return { rowAction, dialog };
}

/** D75: a staff member's advance, shortage, returns and absent fee for a chosen date. */
export function EntryDialog({ person, onClose }: { person: StaffPerson; onClose: () => void }) {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [date, setDate] = useState(today);
  return (
    <StaffDialog person={person} description={t("staffEntry.description")} onClose={onClose}>
      <Field id="staff-entry-date" label={t("common.date")} className="w-56">
        <DatePicker
          id="staff-entry-date"
          value={date}
          max={today}
          label={t("common.date")}
          onChange={(next) => next && setDate(next)}
          className="w-full"
        />
      </Field>
      <StaffCashEntry companyId={company.id} staffId={person.staffId} date={date} />
    </StaffDialog>
  );
}

/** One person's ledger lines, date by date, with the running balance of every bucket (D73). */
export function StatementDialog({ person, onClose }: { person: StaffPerson; onClose: () => void }) {
  const { company, permissions } = useCurrentWorkspace();
  const service = useService();
  const today = useToday();
  const [range, setRange] = useState(() => presetRange("thisMonth", today));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const canExport = permissions.includes("report.export");

  async function exportAs(format: "csv" | "xlsx") {
    setError(undefined);
    setBusy(true);
    try {
      const { file, fileName } = await service.downloadStaffStatement(
        company.id,
        person.staffId,
        range,
        format,
      );
      downloadBlob(file, fileName);
    } catch (e) {
      setError(describeError(e, []).form);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffDialog
      person={person}
      description={t("accounts.statementDescription")}
      printTitle={{ title: `${t("accounts.statement")} — ${person.staffName}`, range }}
      onClose={onClose}
      actions={
        canExport ? (
          <>
            <Button disabled={busy} onClick={() => void exportAs("csv")}>
              {t("report.exportCsv")}
            </Button>
            <Button disabled={busy} onClick={() => void exportAs("xlsx")}>
              {t("report.exportExcel")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="print:hidden">
        <DateRangePicker value={range} onChange={setRange} max={today} />
      </div>
      {error ? <StatePanel tone="error" title={error} /> : null}
      <Statement companyId={company.id} staffId={person.staffId} range={range} />
    </StaffDialog>
  );
}
