"use client";

import type { PreviousDueList, PreviousDueRecord } from "@bsd/contracts";
import { formatMoney, normalizeDigits, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { tableClass, tdClass, tdNum, thClass, theadClass } from "@/components/data-table";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useCreatePreviousDue,
  useDeletePreviousDue,
  usePreviousDues,
  useUpdatePreviousDue,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

export function PreviousDuePage() {
  const { company } = useCurrentWorkspace();
  const query = usePreviousDues(company.id);

  return (
    <NavGate path="master/previous-due">
      <PageHeader title={t("nav.master.previousDue")} description={t("previousDue.description")} />
      {query.isPending ? (
        <TableSkeleton rows={4} columns={3} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Roster companyId={company.id} view={query.data} />
      )}
    </NavGate>
  );
}

function Roster({ companyId, view }: { companyId: string; view: PreviousDueList }) {
  const create = useCreatePreviousDue(companyId);
  const update = useUpdatePreviousDue(companyId);
  const remove = useDeletePreviousDue(companyId);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftReason, setDraftReason] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const busy = create.isPending || update.isPending || remove.isPending;

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

  const startEdit = (row: PreviousDueRecord) => {
    setEditing(row.id);
    setDraftReason(row.reason);
    setDraftAmount(row.amount);
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? <StatePanel tone="error" title={error} /> : null}

      <p className="text-sm text-text-muted">
        {t("previousDue.openTotal")}:{" "}
        <span className="font-medium text-text">{formatMoney(view.openTotal)}</span>
      </p>

      <section className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            const nextReason = reason.trim();
            const nextAmount = amount.trim();
            if (!nextReason || !nextAmount) return;
            void run(async () => {
              await create.mutateAsync({ reason: nextReason, amount: nextAmount });
              setReason("");
              setAmount("");
            });
          }}
        >
          <Field id="previous-due-reason" label={t("previousDue.reason")} className="w-72">
            <input
              id="previous-due-reason"
              className={inputClass}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field id="previous-due-amount" label={t("previousDue.amount")} className="w-36">
            <input
              id="previous-due-amount"
              className={`${inputClass} text-right`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(normalizeDigits(event.target.value))}
            />
          </Field>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || reason.trim() === "" || amount.trim() === ""}
          >
            {t("previousDue.add")}
          </Button>
        </form>

        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("previousDue.reason")}
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  {t("previousDue.amount")}
                </th>
                <th scope="col" className={`${thClass} print:hidden`}>
                  {t("common.edit")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.items.length === 0 ? (
                <tr>
                  <td className={tdClass} colSpan={3}>
                    {t("previousDue.empty")}
                  </td>
                </tr>
              ) : (
                view.items.map((row) => {
                  const isEditing = editing === row.id;
                  return (
                    <tr key={row.id} className="border-t border-border">
                      <td className={tdClass}>
                        {isEditing ? (
                          <input
                            className={inputClass}
                            aria-label={t("previousDue.reason")}
                            value={draftReason}
                            onChange={(event) => setDraftReason(event.target.value)}
                          />
                        ) : (
                          <span className={row.amount === "0.00" ? "text-text-muted" : ""}>
                            {row.reason}
                          </span>
                        )}
                      </td>
                      <td className={tdNum}>
                        {isEditing ? (
                          <input
                            className={`${inputClass} w-32 text-right`}
                            inputMode="decimal"
                            aria-label={t("previousDue.amount")}
                            value={draftAmount}
                            onChange={(event) =>
                              setDraftAmount(normalizeDigits(event.target.value))
                            }
                          />
                        ) : (
                          formatMoney(row.amount)
                        )}
                      </td>
                      <td className={`${tdClass} print:hidden`}>
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="primary"
                              type="button"
                              disabled={
                                busy || draftReason.trim() === "" || draftAmount.trim() === ""
                              }
                              onClick={() => {
                                void run(async () => {
                                  await update.mutateAsync({
                                    previousDueId: row.id,
                                    input: {
                                      reason: draftReason.trim(),
                                      amount: draftAmount.trim(),
                                    },
                                  });
                                  setEditing(null);
                                });
                              }}
                            >
                              {t("common.save")}
                            </Button>
                            <Button type="button" disabled={busy} onClick={() => setEditing(null)}>
                              {t("common.cancel")}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" disabled={busy} onClick={() => startEdit(row)}>
                              {t("common.edit")}
                            </Button>
                            <Button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t("previousDue.deleteConfirm"))) return;
                                void run(async () => {
                                  await remove.mutateAsync(row.id);
                                });
                              }}
                            >
                              {t("common.delete")}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroller>
      </section>
    </div>
  );
}
