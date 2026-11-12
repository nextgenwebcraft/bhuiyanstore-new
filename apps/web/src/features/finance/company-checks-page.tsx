"use client";

import type { CompanyCheckRecord } from "@bsd/contracts";
import { formatMoney, normalizeDigits, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { tableClass, tdClass, tdNum, thClass, theadClass } from "@/components/data-table";
import { inputClass } from "@/components/field";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useBulkCreateCompanyChecks,
  useCompanyCheckDues,
  usePostCompanyCheckPayment,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

type DraftRow = { bankName: string; checkNumber: string };

const emptyRow = (): DraftRow => ({ bankName: "", checkNumber: "" });

export function CompanyChecksPage() {
  const { company } = useCurrentWorkspace();
  const dues = useCompanyCheckDues(company.id);

  return (
    <NavGate path="finance/company-checks">
      <PageHeader
        title={t("nav.finance.companyChecks")}
        description={t("companyCheck.description")}
      />
      <BulkAdd companyId={company.id} onDone={() => void dues.refetch()} />
      {dues.isPending ? (
        <TableSkeleton rows={4} columns={5} />
      ) : dues.isError ? (
        <QueryError error={dues.error} onRetry={() => void dues.refetch()} />
      ) : (
        <DueTable companyId={company.id} items={dues.data.items} />
      )}
    </NavGate>
  );
}

function BulkAdd({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const create = useBulkCreateCompanyChecks(companyId);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);

  function set(index: number, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    setRows((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  }

  async function submit() {
    const filled = rows
      .map((row) => ({
        bankName: row.bankName.trim(),
        checkNumber: row.checkNumber.trim(),
      }))
      .filter((row) => row.bankName || row.checkNumber);
    if (filled.length === 0) {
      setError(t("companyCheck.bulkEmpty"));
      return;
    }
    if (filled.some((row) => !row.bankName || !row.checkNumber)) {
      setError(t("validation.companyCheck.bankName"));
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ rows: filled });
      setRows([emptyRow()]);
      onDone();
    } catch (caught) {
      setError(describeError(caught, []).form ?? null);
    }
  }

  return (
    <div className="mb-8 flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{t("companyCheck.bulkTitle")}</h2>
      <p className="text-sm text-text-muted">{t("companyCheck.bulkHint")}</p>
      {error ? <StatePanel tone="error" title={error} /> : null}
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>{t("companyCheck.bankName")}</th>
              <th className={thClass}>{t("companyCheck.checkNumber")}</th>
              {rows.length > 1 ? <th className={thClass} /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                <td className={tdClass}>
                  <input
                    className={inputClass}
                    value={row.bankName}
                    placeholder={t("companyCheck.bankNamePlaceholder")}
                    aria-label={t("companyCheck.bankName")}
                    onChange={(event) => set(index, { bankName: event.target.value })}
                  />
                </td>
                <td className={tdClass}>
                  <input
                    className={inputClass}
                    value={row.checkNumber}
                    placeholder={t("companyCheck.checkNumberPlaceholder")}
                    aria-label={t("companyCheck.checkNumber")}
                    onChange={(event) => set(index, { checkNumber: event.target.value })}
                  />
                </td>
                {rows.length > 1 ? (
                  <td className={tdClass}>
                    <button
                      type="button"
                      className="inline-flex size-(--touch-target) items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
                      aria-label={t("companyCheck.removeRow")}
                      onClick={() => remove(index)}
                    >
                      <Icon name="close" className="size-4" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setRows((current) => [...current, emptyRow()])}>
          {t("companyCheck.addRow")}
        </Button>
        <Button variant="primary" disabled={create.isPending} onClick={() => void submit()}>
          {t("companyCheck.bulkSubmit")}
        </Button>
      </div>
    </div>
  );
}

function DueTable({ companyId, items }: { companyId: string; items: CompanyCheckRecord[] }) {
  const pay = usePostCompanyCheckPayment(companyId);
  const today = useToday();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function submit(check: CompanyCheckRecord) {
    const raw = amounts[check.id]?.trim() ?? "";
    if (!raw) return;
    setError(null);
    setPendingId(check.id);
    try {
      await pay.mutateAsync({
        companyCheckId: check.id,
        date: today,
        amount: normalizeDigits(raw),
      });
      setAmounts((current) => ({ ...current, [check.id]: "" }));
    } catch (caught) {
      setError(describeError(caught, []).form ?? null);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{t("companyCheck.dueTitle")}</h2>
      <p className="text-sm text-text-muted">{t("companyCheck.dueHint")}</p>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{t("companyCheck.dueEmpty")}</p>
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>{t("companyCheck.bankName")}</th>
                <th className={thClass}>{t("companyCheck.checkNumber")}</th>
                <th className={thClass}>{t("companyCheck.chargedTotal")}</th>
                <th className={thClass}>{t("companyCheck.paidTotal")}</th>
                <th className={thClass}>{t("companyCheck.due")}</th>
                <th className={thClass}>{t("companyCheck.payAmount")}</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {items.map((check) => (
                <tr key={check.id} className="border-t border-border">
                  <td className={tdClass}>{check.bankName}</td>
                  <td className={tdClass}>{check.checkNumber}</td>
                  <td className={tdNum}>{formatMoney(check.chargedTotal)}</td>
                  <td className={tdNum}>{formatMoney(check.paidTotal)}</td>
                  <td className={`${tdNum} font-semibold`}>{formatMoney(check.due)}</td>
                  <td className={tdClass}>
                    <input
                      className={`${inputClass} w-32`}
                      inputMode="decimal"
                      aria-label={t("companyCheck.payAmount")}
                      value={amounts[check.id] ?? ""}
                      placeholder={check.due}
                      onChange={(event) =>
                        setAmounts((current) => ({ ...current, [check.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td className={tdClass}>
                    <Button
                      variant="primary"
                      disabled={pay.isPending && pendingId === check.id}
                      onClick={() => void submit(check)}
                    >
                      {t("companyCheck.paySubmit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}
