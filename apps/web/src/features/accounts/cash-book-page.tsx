"use client";

import { moneyKindPermission, type ReportRange } from "@bsd/contracts";
import { formatBusinessDate, labelOf, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { presetRange } from "@/components/calendar-math";
import { money } from "@/components/data-table";
import { DatePicker, DateRangePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useConfigList, usePostMoneyEntry, useReport } from "@/data/queries";
import { AccountSelect } from "@/features/daily/account-select";
import { clean } from "@/features/daily/daily-kit";
import { ReportTableView } from "@/features/reports/report-view";
import { NavGate } from "@/features/shell/nav-gate";
import { PageWarnings } from "@/features/shell/notifications";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const PATH = "finance/cash-book";

/** "All time" (D52): the server moves the start up to the go-live cutoff and lifts the day limit. */
const ALL_TIME_FROM = "2000-01-01";

function TransferDialog({
  companyId,
  open,
  onClose,
}: {
  companyId: string;
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const today = useToday();
  const post = usePostMoneyEntry(companyId);
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  function close() {
    setAmount("");
    setError(undefined);
    onClose();
  }

  async function submit() {
    const value = clean(amount);
    if (!from || !to) return setError(t("validation.money.accountRequired"));
    if (from === to) return setError(t("validation.money.sameAccount"));
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    setError(undefined);
    try {
      await post.mutateAsync({
        date,
        kind: "cashTransfer",
        amount: value,
        staffId: null,
        expenseCategoryId: null,
        allocation: null,
        cashAccountId: from,
        toCashAccountId: to,
      });
      close();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open={open}
      title={t("cashBook.transfer")}
      error={error}
      pending={post.isPending}
      submitLabel={t("common.post")}
      onSubmit={() => void submit()}
      onClose={close}
    >
      <p className="text-xs text-text-muted">{t("cashBook.transferHint")}</p>
      <Field id={`${id}-date`} label={t("common.date")}>
        <DatePicker id={`${id}-date`} value={date} onChange={setDate} max={today} />
      </Field>
      <AccountSelect
        id={`${id}-from`}
        label={t("money.account.from")}
        value={from}
        onChange={setFrom}
        required
        exclude={to}
      />
      <AccountSelect
        id={`${id}-to`}
        label={t("money.account.to")}
        value={to}
        onChange={setTo}
        required
        exclude={from}
      />
      <Field id={`${id}-amount`} label={t("common.amount")}>
        <input
          id={`${id}-amount`}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={inputClass}
        />
      </Field>
    </FormDialog>
  );
}

function Book({ companyId, range }: { companyId: string; range: ReportRange }) {
  const query = useReport(companyId, "cash-book", range);
  const [account, setAccount] = useState("");
  if (range.from > range.to) {
    return <StatePanel tone="error" title={t("validation.period.endBeforeStart")} />;
  }
  if (query.isPending) return <SummarySkeleton stats={3} rows={8} />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (!data.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  }
  const [summary, statement] = data.tables;
  if (!summary || !statement) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.beforeCutoff.title")}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(data.cutoffDate)}`}
      />
    );
  }
  const names = [...new Set(summary.rows.map((r) => r.cells.account ?? ""))];
  const shown = {
    ...statement,
    rows: account
      ? statement.rows.filter((r) => (r.cells.account ?? "") === account)
      : statement.rows,
  };
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-text-muted">
        {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
      </p>
      <PageWarnings warnings={data.warnings} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.rows.map((row) => (
          <StatTile
            key={row.cells.account ?? ""}
            label={labelOf(row.cells.account ?? "")}
            value={money(row.cells.closing ?? null)}
            emphasis
            hint={`${t("report.column.opening")} ${money(row.cells.opening ?? null)} · ${t("report.column.cashIn")} ${money(row.cells.cashIn ?? null)} · ${t("report.column.cashOut")} ${money(row.cells.cashOut ?? null)}`}
          />
        ))}
      </dl>
      <div className="flex items-center gap-2 print:hidden">
        <label htmlFor="cash-book-account" className="text-sm font-medium">
          {t("report.column.account")}
        </label>
        <select
          id="cash-book-account"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className={`${inputClass} max-w-64`}
        >
          <option value="">{t("cashBook.allAccounts")}</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {labelOf(name)}
            </option>
          ))}
        </select>
      </div>
      <ReportTableView table={shown} />
    </div>
  );
}

/**
 * The cash and bank book (D52): each account's opening, money in and out and closing balance,
 * with a statement and a transfer between two accounts.
 */
export function CashBookPage() {
  const { company, permissions } = useCurrentWorkspace();
  const today = useToday();
  const accounts = useConfigList("cashAccounts");
  const [picked, setRange] = useState(() => presetRange("thisMonth", today));
  const [allTime, setAllTime] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const range = allTime ? { from: ALL_TIME_FROM, to: today } : picked;
  const canTransfer = permissions.includes(moneyKindPermission.cashTransfer);
  const active = (accounts.data ?? []).filter((a) => a.active).length;
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.finance.cashBook")}
        description={t("cashBook.description")}
        actions={
          <>
            <button
              type="button"
              aria-pressed={allTime}
              onClick={() => setAllTime((on) => !on)}
              className={`inline-flex min-h-(--touch-target) items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
                allTime
                  ? "border-brand bg-brand font-semibold text-brand-foreground shadow-card"
                  : "border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-hover"
              }`}
            >
              {t("companyAccount.period.allTime")}
            </button>
            <DateRangePicker
              value={picked}
              onChange={(next) => {
                setAllTime(false);
                setRange(next);
              }}
              max={today}
            />
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t("nav.finance.cashBook")} from={range.from} to={range.to} />
      {canTransfer ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
          <Button variant="primary" disabled={active < 2} onClick={() => setTransfer(true)}>
            + {t("cashBook.transfer")}
          </Button>
          {active < 2 && accounts.isSuccess ? (
            <p className="text-xs text-text-muted">{t("cashBook.needTwoAccounts")}</p>
          ) : null}
        </div>
      ) : null}
      <Book companyId={company.id} range={range} />
      <TransferDialog companyId={company.id} open={transfer} onClose={() => setTransfer(false)} />
    </NavGate>
  );
}
