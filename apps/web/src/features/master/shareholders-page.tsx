"use client";

import type { ShareholderList } from "@bsd/contracts";
import { monthOf } from "@bsd/domain";
import { normalizeDigits, t } from "@bsd/i18n";
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
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useCreateShareholder,
  useSaveInvestments,
  useShareholders,
  useUpdateShareholder,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

export function ShareholdersPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [month, setMonth] = useState(() => monthOf(today));
  const query = useShareholders(company.id, month);

  return (
    <NavGate path="master/shareholders">
      <PageHeader title={t("nav.master.shareholders")} description={t("share.holders")} />
      <div className="mb-4 print:hidden">
        <MonthPicker
          id="shareholder-month"
          value={month}
          label={t("share.fromMonth")}
          onChange={setMonth}
        />
      </div>
      {query.isPending ? (
        <TableSkeleton rows={4} columns={5} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Roster companyId={company.id} month={month} view={query.data} />
      )}
    </NavGate>
  );
}

function Roster({
  companyId,
  month,
  view,
}: {
  companyId: string;
  month: string;
  view: ShareholderList;
}) {
  const create = useCreateShareholder(companyId);
  const update = useUpdateShareholder(companyId);
  const saveInvestments = useSaveInvestments(companyId);
  const [name, setName] = useState("");
  const [newAmounts, setNewAmounts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const busy = create.isPending || update.isPending || saveInvestments.isPending;

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

      <section className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next) return;
            void run(async () => {
              const created = await create.mutateAsync({ name: next });
              const entries = view.companies
                .filter((company) => {
                  const value = (newAmounts[company.companyId] ?? "").trim();
                  return value !== "" && Number(value) !== 0;
                })
                .map((company) => ({
                  targetCompanyId: company.companyId,
                  fromMonth: month,
                  amount: newAmounts[company.companyId]?.trim() || "0",
                }));
              if (entries.length > 0) {
                await saveInvestments.mutateAsync({ shareholderId: created.id, input: { entries } });
              }
              setName("");
              setNewAmounts({});
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
          {view.companies.map((company) => (
            <Field
              key={company.companyId}
              id={`share-new-amount-${company.companyId}`}
              label={company.companyName}
              className="w-32"
            >
              <input
                id={`share-new-amount-${company.companyId}`}
                className={`${inputClass} text-right`}
                inputMode="decimal"
                value={newAmounts[company.companyId] ?? ""}
                onChange={(event) => {
                  const nextValue = normalizeDigits(event.target.value);
                  setNewAmounts((prev) => ({ ...prev, [company.companyId]: nextValue }));
                }}
              />
            </Field>
          ))}
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
                {view.companies.map((company) => (
                  <ColumnHead key={company.companyId} label={company.companyName} quantity />
                ))}
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
                  {view.companies.map((company) => {
                    const amount =
                      holder.investments.find((item) => item.companyId === company.companyId)
                        ?.amount ?? "0.00";
                    const isRowEditing = editing === holder.shareholderId;
                    return (
                      <td key={company.companyId} className={tdNum}>
                        {isRowEditing ? (
                          <input
                            className={`${inputClass} w-32 text-right`}
                            inputMode="decimal"
                            aria-label={`${holder.name} ${company.companyName}`}
                            value={draftAmounts[company.companyId] ?? amount}
                            disabled={busy}
                            onChange={(event) => {
                              const next = normalizeDigits(event.target.value);
                              setDraftAmounts((prev) => ({ ...prev, [company.companyId]: next }));
                            }}
                          />
                        ) : (
                          amount
                        )}
                      </td>
                    );
                  })}
                  <td className={`${tdClass} print:hidden`}>
                    <div className="flex flex-wrap gap-2">
                      {editing === holder.shareholderId ? (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              const nextName = draftName.trim();
                              if (nextName && nextName !== holder.name) {
                                await update.mutateAsync({
                                  shareholderId: holder.shareholderId,
                                  input: { name: nextName, active: holder.active },
                                });
                              }
                              const entries = view.companies
                                .filter((company) => {
                                  const original =
                                    holder.investments.find(
                                      (item) => item.companyId === company.companyId,
                                    )?.amount ?? "0.00";
                                  const draft = (
                                    draftAmounts[company.companyId] ?? original
                                  ).trim();
                                  return (draft || "0") !== original;
                                })
                                .map((company) => ({
                                  targetCompanyId: company.companyId,
                                  fromMonth: month,
                                  amount: draftAmounts[company.companyId]?.trim() || "0",
                                }));
                              if (entries.length > 0) {
                                await saveInvestments.mutateAsync({
                                  shareholderId: holder.shareholderId,
                                  input: { entries },
                                });
                              }
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
                            const amounts: Record<string, string> = {};
                            view.companies.forEach((company) => {
                              amounts[company.companyId] =
                                holder.investments.find(
                                  (item) => item.companyId === company.companyId,
                                )?.amount ?? "0.00";
                            });
                            setDraftAmounts(amounts);
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
