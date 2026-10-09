"use client";

import { moneyKindPermission, type MoneyEntryKind, type ReportRange } from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { formatBusinessDate, labelOf, t, type TranslationKey } from "@bsd/i18n";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { presetRange } from "@/components/calendar-math";
import { DatePicker, DateRangePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { usePostMoneyEntry, useReport } from "@/data/queries";
import { clean, money } from "@/features/daily/daily-kit";
import { ReportTableView } from "@/features/reports/report-page";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { PageWarnings } from "@/features/shell/notifications";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "finance/company-account";

/** The money movements with the company entered here; damage money comes from the damage page. */
const ENTRY_KINDS = ["supplierDeposit", "companyIncentive"] as const satisfies MoneyEntryKind[];
type EntryKind = (typeof ENTRY_KINDS)[number];

const kindLabel = (kind: EntryKind) => t(`money.kind.${kind}` as TranslationKey);

function EntryDialog({
  companyId,
  kind,
  onClose,
}: {
  companyId: string;
  kind: EntryKind | null;
  onClose: () => void;
}) {
  const id = useId();
  const today = businessDateOf(new Date());
  const post = usePostMoneyEntry(companyId);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  function close() {
    setAmount("");
    setError(undefined);
    onClose();
  }

  async function submit() {
    if (!kind) return;
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      setError(t("validation.amountPositive"));
      return;
    }
    setError(undefined);
    try {
      await post.mutateAsync({
        date,
        kind,
        amount: value,
        staffId: null,
        expenseCategoryId: null,
        allocation: null,
      });
      close();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open={kind !== null}
      title={kind ? kindLabel(kind) : ""}
      error={error}
      pending={post.isPending}
      submitLabel={t("common.post")}
      onSubmit={() => void submit()}
      onClose={close}
    >
      {kind === "companyIncentive" ? (
        <p className="text-xs text-text-muted">{t("companyAccount.incentiveHint")}</p>
      ) : null}
      <Field id={`${id}-date`} label={t("common.date")}>
        <DatePicker id={`${id}-date`} value={date} onChange={setDate} max={today} />
      </Field>
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

function Account({ companyId, range }: { companyId: string; range: ReportRange }) {
  const query = useReport(companyId, "company-account", range);
  if (range.from > range.to)
    return <StatePanel tone="error" title={t("validation.period.endBeforeStart")} />;
  if (query.isPending) return <SummarySkeleton stats={6} rows={8} />;
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
  const cells = summary.rows[0]?.cells ?? {};
  return (
    <div className="flex flex-col gap-6">
      {data.from !== range.from ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
        </p>
      ) : null}
      <PageWarnings warnings={data.warnings} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.columns.map((c) => (
          <StatTile
            key={c.key}
            label={labelOf(c.label)}
            value={money(cells[c.key] ?? null)}
            emphasis={c.key === "closing"}
          />
        ))}
      </dl>
      <ReportTableView table={statement} />
    </div>
  );
}

/**
 * Everything settled with the company in one place (D33): goods received raise what we owe;
 * bank deposits, money incentives and damage money returns lower it.
 */
export function CompanyAccountPage() {
  const { company, permissions } = useCurrentWorkspace();
  const [range, setRange] = useState(() => presetRange("thisMonth", businessDateOf(new Date())));
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const allowed = ENTRY_KINDS.filter((k) => permissions.includes(moneyKindPermission[k]));
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.finance.companyAccount")}
        description={t("companyAccount.description")}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} max={businessDateOf(new Date())} />
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t("nav.finance.companyAccount")} from={range.from} to={range.to} />
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        {allowed.map((kind) => (
          <Button key={kind} variant="primary" onClick={() => setEntry(kind)}>
            + {kindLabel(kind)}
          </Button>
        ))}
        <Link
          href={companyHref(company.id, "inventory/claims")}
          className="text-sm text-brand underline-offset-2 hover:underline"
        >
          {t("companyAccount.damageLink")}
        </Link>
      </div>
      <Account companyId={company.id} range={range} />
      <EntryDialog companyId={company.id} kind={entry} onClose={() => setEntry(null)} />
    </NavGate>
  );
}
