"use client";

import type { DanBasisName, ShareMonth } from "@bsd/contracts";
import { monthOf } from "@bsd/domain";
import { formatMoney, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import {
  ColumnHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  theadClass,
} from "@/components/data-table";
import { MonthPicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useCreateShareholder,
  useSaveShareHolding,
  useSaveSharePolicy,
  useShareMonth,
  useUpdateShareholder,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

/** Exact units and the per-unit rate stay visible; money is shown to paisa (D61). */
const figures = (value: string) => toBengaliDigits(value);

/**
 * Master monthly account (D76): each company's profit and cost, 2% দান, and the split by units.
 * The figures are a statement; saving a unit or a দান basis does not move cash.
 */
export function SharePage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [month, setMonth] = useState(() => monthOf(today));
  const query = useShareMonth(company.id, month);

  return (
    <NavGate path="master/monthly-account">
      <PageHeader title={t("nav.master.monthly")} description={t("share.description")} />
      <div className="mb-4 print:hidden">
        <MonthPicker id="share-month" value={month} label={t("month.picker")} onChange={setMonth} />
      </div>
      {query.isPending ? (
        <TableSkeleton rows={4} columns={5} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Statement companyId={company.id} month={month} view={query.data} />
      )}
    </NavGate>
  );
}

function Statement({
  companyId,
  month,
  view,
}: {
  companyId: string;
  month: string;
  view: ShareMonth;
}) {
  const create = useCreateShareholder(companyId);
  const update = useUpdateShareholder(companyId);
  const saveUnits = useSaveShareHolding(companyId);
  const savePolicy = useSaveSharePolicy(companyId);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const busy = create.isPending || update.isPending || saveUnits.isPending || savePolicy.isPending;

  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(describeError(caught, []).form);
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? <StatePanel tone="error" title={error} /> : null}
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("share.distributable")}
          value={formatMoney(view.totals.distributable)}
          tone="brand"
          large
        />
        <StatTile label={t("share.dan")} value={formatMoney(view.totals.dan)} />
        <StatTile label={t("share.perUnit")} value={figures(view.totals.perUnit)} />
        <StatTile label={t("share.totalUnits")} value={figures(view.totals.units)} />
      </dl>
      {view.totals.unallocated !== "0.00" ? (
        <p className="text-sm text-text-muted">
          {t("share.unallocated")}: {formatMoney(view.totals.unallocated)}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("master.month.company")}</h2>
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("master.month.company")}
                </th>
                <ColumnHead label={t("share.profit")} />
                <ColumnHead label={t("share.khoroch")} />
                <ColumnHead label={t("share.dan")} />
                <ColumnHead label={t("share.total")} />
                <th scope="col" className={thClass}>
                  {t("share.basis")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.companies.map((row) => (
                <tr key={row.companyId} className="border-t border-border">
                  <td className={tdClass}>{row.companyName}</td>
                  <td className={tdNum}>{formatMoney(row.profit)}</td>
                  <td className={tdNum}>{formatMoney(row.khoroch)}</td>
                  <td className={tdNum}>{formatMoney(row.dan)}</td>
                  <td className={tdNum}>{formatMoney(row.total)}</td>
                  <td className={tdClass}>
                    <select
                      className={inputClass}
                      aria-label={t("share.basis")}
                      value={row.danBasis}
                      disabled={busy}
                      onChange={(event) => {
                        const danBasis = event.target.value as DanBasisName;
                        void run(() =>
                          savePolicy.mutateAsync({
                            targetCompanyId: row.companyId,
                            input: { danBasis },
                          }),
                        );
                      }}
                    >
                      <option value="net">{t("share.dan.net")}</option>
                      <option value="profit">{t("share.dan.profit")}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("share.holders")}</h2>
        <form
          className="flex flex-wrap items-end gap-2 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next) return;
            void run(async () => {
              await create.mutateAsync({ name: next });
              setName("");
            });
          }}
        >
          <Field id="share-new-name" label={t("share.name")} className="w-64">
            <input
              id="share-new-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Button variant="primary" type="submit" disabled={busy || name.trim() === ""}>
            {t("share.add")}
          </Button>
        </form>
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("share.name")}
                </th>
                <ColumnHead label={t("share.units")} />
                <ColumnHead label={t("share.income")} />
                <ColumnHead label={t("share.yearIncome")} />
                <th scope="col" className={`${thClass} print:hidden`}>
                  {t("common.edit")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.shareholders.map((holder) => (
                <tr key={holder.shareholderId} className="border-t border-border">
                  <td className={tdClass}>
                    {editing === holder.shareholderId ? (
                      <input
                        className={inputClass}
                        aria-label={t("share.name")}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                    ) : (
                      <span className={holder.active ? "" : "text-text-muted"}>
                        {holder.name}
                        {holder.active ? null : ` (${t("common.status.inactive")})`}
                      </span>
                    )}
                  </td>
                  <td className={tdNum}>
                    <input
                      key={`${holder.shareholderId}-${month}-${holder.units}`}
                      className={`${inputClass} w-32 text-right`}
                      inputMode="decimal"
                      aria-label={t("share.units")}
                      defaultValue={holder.units}
                      disabled={busy}
                      onBlur={(event) => {
                        const units = normalizeDigits(event.target.value).trim();
                        if (units === holder.units) return;
                        void run(() =>
                          saveUnits.mutateAsync({
                            shareholderId: holder.shareholderId,
                            input: { fromMonth: month, units },
                          }),
                        );
                      }}
                    />
                  </td>
                  <td className={tdNum}>{formatMoney(holder.income)}</td>
                  <td className={tdNum}>{formatMoney(holder.yearIncome)}</td>
                  <td className={`${tdClass} print:hidden`}>
                    <div className="flex flex-wrap gap-2">
                      {editing === holder.shareholderId ? (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              await update.mutateAsync({
                                shareholderId: holder.shareholderId,
                                input: { name: draftName.trim(), active: holder.active },
                              });
                              setEditing(null);
                            });
                          }}
                        >
                          {t("common.save")}
                        </Button>
                      ) : (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setEditing(holder.shareholderId);
                            setDraftName(holder.name);
                          }}
                        >
                          {t("common.edit")}
                        </Button>
                      )}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            update.mutateAsync({
                              shareholderId: holder.shareholderId,
                              input: { name: holder.name, active: !holder.active },
                            }),
                          )
                        }
                      >
                        {t(holder.active ? "share.deactivate" : "share.activate")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </section>
    </div>
  );
}
