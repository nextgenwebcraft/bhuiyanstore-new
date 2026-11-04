"use client";

import type { MoneyEntry } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { t } from "@bsd/i18n";
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
import { EmptyListNote } from "@/components/empty-list-note";
import { Field, inputClass } from "@/components/field";
import { QueryError } from "@/components/query-error";
import { FormSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useConfigList,
  useCorrectMoneyEntry,
  useMoneyEntries,
  usePostMoneyEntry,
} from "@/data/queries";
import { canEditDailyMoney, canPostDailyMoney, clean } from "@/features/daily/daily-kit";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/**
 * Operating cost for the day (owner change request, formerly on বেতন ও খরচ): শুধু খরচের খাত ও
 * টাকা, no kind picker (always the plain `expense` kind). Feeds the same operating-cost figure
 * everywhere else already reads it (dashboard, Company Hishab Reports) — no engine change.
 * Per-row edit (D114) lives on this card; day reverse still cascades expenses with the sheet.
 */
export function OperatingCostEntry({
  companyId,
  date,
  handoverLocked,
}: {
  companyId: string;
  date: string;
  /** D114: pass from the day sheet; omitted elsewhere hides Edit. */
  handoverLocked?: boolean;
}) {
  const id = useId();
  const { permissions, loginRoleKind } = useCurrentWorkspace();
  const categories = useConfigList("expenseCategories");
  const post = usePostMoneyEntry(companyId);
  const correct = useCorrectMoneyEntry(companyId);
  const entries = useMoneyEntries(companyId, { from: date, to: date });
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<MoneyEntry | null>(null);
  const canEdit = canEditDailyMoney(loginRoleKind, handoverLocked);
  const canCreate =
    canPostDailyMoney(loginRoleKind, handoverLocked) && permissions.includes("payment.post");
  const pending = post.isPending || correct.isPending;

  function startEdit(entry: MoneyEntry) {
    setCategoryId(entry.expenseCategoryId ?? "");
    setAmount(entry.amount);
    setError(undefined);
    setEditing(entry);
  }

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      setError(t("validation.amountPositive"));
      return;
    }
    if (!categoryId) {
      setError(t("validation.daily.categoryRequired"));
      return;
    }
    const body = {
      date,
      kind: "expense" as const,
      amount: value,
      expenseCategoryId: categoryId,
    };
    try {
      if (editing) {
        if (!window.confirm(t("money.correctConfirm"))) return;
        await correct.mutateAsync({ entryId: editing.id, body });
        setEditing(null);
      } else {
        await post.mutateAsync(body);
      }
      setAmount("");
      setCategoryId("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("dsr.operatingCost.title")}</h3>
      {canCreate || editing ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${id}-category`} label={t("money.category")}>
            <select
              id={`${id}-category`}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {(categories.data ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id={`${id}-amount`} label={t("common.amount")}>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              className={inputClass}
            />
          </Field>
        </div>
      ) : null}
      {error ? <StatePanel tone="error" title={error} /> : null}
      {canCreate || editing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={() => void submit()}>
            {pending
              ? t("common.posting")
              : editing
                ? t("money.correct")
                : t("common.post")}
          </Button>
          {editing ? (
            <Button
              disabled={pending}
              onClick={() => {
                setEditing(null);
                setAmount("");
                setCategoryId("");
              }}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {entries.isPending ? (
        <FormSkeleton fields={1} />
      ) : entries.isError ? (
        <QueryError error={entries.error} onRetry={() => void entries.refetch()} />
      ) : (
        <Entries
          rows={(entries.data ?? []).filter((e) => e.kind === "expense")}
          canEdit={canEdit}
          onEdit={startEdit}
        />
      )}
    </section>
  );
}

function Entries({
  rows,
  canEdit,
  onEdit,
}: {
  rows: MoneyEntry[];
  canEdit: boolean;
  onEdit: (entry: MoneyEntry) => void;
}) {
  const total = sumAmounts([
    "0",
    ...rows.filter((e) => e.status === "posted").map((e) => e.amount),
  ]);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{t("money.posted")}</h4>
      {rows.length === 0 ? (
        <EmptyListNote textKey="money.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("money.category")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.amount")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                {canEdit ? (
                  <th scope="col" className={thClass}>
                    <span className="sr-only">{t("common.edit")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className={tdClass}>{entry.categoryName}</td>
                  <td className={tdNum}>{money(entry.amount)}</td>
                  <td className={tdClass}>
                    <StatusChip status={entry.status} />
                  </td>
                  {canEdit ? (
                    <td className={`${tdClass} text-right`}>
                      {entry.status === "posted" && !entry.dsrDayId && !entry.payrollRunId ? (
                        <Button onClick={() => onEdit(entry)}>{t("common.edit")}</Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
      <p className="text-sm font-semibold">
        {t("dsr.operatingCost.title")}: <span className="tabular-nums">{money(total)}</span>
      </p>
    </div>
  );
}
