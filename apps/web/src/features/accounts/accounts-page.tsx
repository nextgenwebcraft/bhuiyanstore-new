"use client";

import type {
  ReportRange,
  StaffAccountKind,
  StaffBalanceKey,
  StaffStatement,
} from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { formatBusinessDate, t, type TranslationKey } from "@bsd/i18n";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { presetRange } from "@/components/calendar-math";
import { DateRangePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton, TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useStaffAccounts, useStaffStatement } from "@/data/queries";
import { useService } from "@/data/service-context";
import {
  DateBar,
  money,
  tableClass,
  TableScroller,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { downloadBlob } from "@/lib/download";

/** Balance columns per account kind; SR accounts carry no salary (D18). */
const KIND_KEYS: Record<StaffAccountKind, readonly StaffBalanceKey[]> = {
  distributor: ["advance", "loan", "shortage", "credit", "salaryPayable"],
  sr: ["srLoan", "owedToSr"],
};

const balanceLabel = (key: string) => t(`report.column.${key}` as TranslationKey);

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
      {text}
    </p>
  );
}

/** Every person's balances at the end of the working date; never netted (D27). */
export function StaffAccountsPage({
  path,
  title,
  kind,
  statementPath,
}: {
  path: string;
  title: TranslationKey;
  kind: StaffAccountKind;
  statementPath: string;
}) {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const query = useStaffAccounts(company.id, kind, date);
  const keys = KIND_KEYS[kind];

  return (
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t(`accounts.description.${kind}`)}
        actions={
          <>
            <DateBar date={date} onChange={setDate} />
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t(title)} from={date} />
      {query.isPending ? (
        <TableSkeleton rows={6} columns={8} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data.cutoffDate ? (
        <StatePanel
          tone="warning"
          title={t("daily.noOpening.title")}
          hint={t("daily.noOpening.hint")}
        />
      ) : query.data.rows.length === 0 ? (
        <Empty text={t("accounts.empty")} />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.name")}
                </th>
                {keys.map((k) => (
                  <th key={k} scope="col" className={thNum}>
                    {balanceLabel(k)}
                  </th>
                ))}
                {kind === "distributor" ? (
                  <>
                    <th scope="col" className={thNum}>
                      {t("report.column.owesUs")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("report.column.weOwe")}
                    </th>
                  </>
                ) : null}
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("accounts.statement")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((row) => (
                <tr key={row.staffId} className="border-t border-border">
                  <td className={tdClass}>{row.staffName}</td>
                  {keys.map((k) => (
                    <td key={k} className={tdNum}>
                      {money(row.balances[k])}
                    </td>
                  ))}
                  {kind === "distributor" ? (
                    <>
                      <td className={`${tdNum} font-semibold`}>{money(row.owesUs)}</td>
                      <td className={`${tdNum} font-semibold`}>{money(row.weOwe)}</td>
                    </>
                  ) : null}
                  <td className={`${tdClass} text-right`}>
                    <ButtonLink
                      href={`${companyHref(company.id, statementPath)}?staff=${encodeURIComponent(row.staffId)}`}
                    >
                      {t("accounts.statement")}
                    </ButtonLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </NavGate>
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
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      </dl>
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

function StatementContent({
  path,
  title,
  kind,
}: {
  path: string;
  title: TranslationKey;
  kind: StaffAccountKind;
}) {
  const { company, permissions } = useCurrentWorkspace();
  const service = useService();
  const initial = useSearchParams().get("staff") ?? "";
  const people = useStaffAccounts(company.id, kind, businessDateOf(new Date()));
  const [staffId, setStaffId] = useState(initial);
  const [range, setRange] = useState(() => presetRange("thisMonth", businessDateOf(new Date())));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const canExport = permissions.includes("report.export");

  async function exportAs(format: "csv" | "xlsx") {
    setError(undefined);
    setBusy(true);
    try {
      const { file, fileName } = await service.downloadStaffStatement(
        company.id,
        staffId,
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
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t("accounts.statementDescription")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} max={businessDateOf(new Date())} />
            {canExport && staffId ? (
              <>
                <Button disabled={busy} onClick={() => void exportAs("csv")}>
                  {t("report.exportCsv")}
                </Button>
                <Button disabled={busy} onClick={() => void exportAs("xlsx")}>
                  {t("report.exportExcel")}
                </Button>
              </>
            ) : null}
            {staffId ? <PrintButton /> : null}
          </div>
        }
      />
      <PrintHeader
        title={`${t(title)} — ${people.data?.rows.find((p) => p.staffId === staffId)?.staffName ?? ""}`}
        {...range}
      />
      <div className="mb-6 max-w-sm print:hidden">
        <Field id="statement-person" label={t(`money.person.${kind}`)}>
          <select
            id="statement-person"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            className={inputClass}
          >
            <option value="">{t("common.select")}</option>
            {(people.data?.rows ?? []).map((p) => (
              <option key={p.staffId} value={p.staffId}>
                {p.staffName}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {people.isError ? (
        <QueryError error={people.error} onRetry={() => void people.refetch()} />
      ) : staffId ? (
        <Statement companyId={company.id} staffId={staffId} range={range} />
      ) : (
        <Empty text={t("accounts.pickPerson")} />
      )}
    </NavGate>
  );
}

/** One person's ledger lines with the running balance of every bucket. */
export function StaffStatementPage(props: {
  path: string;
  title: TranslationKey;
  kind: StaffAccountKind;
}) {
  return (
    <Suspense fallback={<SummarySkeleton stats={4} rows={8} />}>
      <StatementContent {...props} />
    </Suspense>
  );
}
