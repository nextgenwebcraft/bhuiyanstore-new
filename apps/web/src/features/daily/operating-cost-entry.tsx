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
import { ReverseCell } from "@/components/reverse-cell";
import { FormSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useConfigList,
  useMoneyEntries,
  usePostMoneyEntry,
  useReverseMoneyEntry,
} from "@/data/queries";
import { clean } from "@/features/daily/daily-kit";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";

/**
 * Operating cost for the day (owner change request, formerly on বেতন ও খরচ): শুধু খরচের খাত ও
 * টাকা, no kind picker (always the plain `expense` kind). Feeds the same operating-cost figure
 * everywhere else already reads it (dashboard, Company Hishab Reports) — no engine change.
 */
export function OperatingCostEntry({ companyId, date }: { companyId: string; date: string }) {
  const id = useId();
  const { permissions } = useCurrentWorkspace();
  const categories = useConfigList("expenseCategories");
  const post = usePostMoneyEntry(companyId);
  const reverse = useReverseMoneyEntry(companyId);
  const action = useAsyncAction();
  const entries = useMoneyEntries(companyId, { from: date, to: date });
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const canPost = permissions.includes("payment.post");
  const canReverse = permissions.includes("payment.reverse");

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
    try {
      await post.mutateAsync({
        date,
        kind: "expense",
        amount: value,
        expenseCategoryId: categoryId,
      });
      setAmount("");
      setCategoryId("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("dsr.operatingCost.title")}</h3>
      {canPost ? (
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
      {canPost ? (
        <div>
          <Button variant="primary" disabled={post.isPending} onClick={() => void submit()}>
            {post.isPending ? t("common.posting") : t("common.post")}
          </Button>
        </div>
      ) : null}
      {entries.isPending ? (
        <FormSkeleton fields={1} />
      ) : entries.isError ? (
        <QueryError error={entries.error} onRetry={() => void entries.refetch()} />
      ) : (
        <Entries
          companyId={companyId}
          rows={(entries.data ?? []).filter((e) => e.kind === "expense")}
          canReverse={canReverse}
          reverse={reverse}
          action={action}
        />
      )}
    </section>
  );
}

function Entries({
  rows,
  canReverse,
  reverse,
  action,
}: {
  companyId: string;
  rows: MoneyEntry[];
  canReverse: boolean;
  reverse: ReturnType<typeof useReverseMoneyEntry>;
  action: ReturnType<typeof useAsyncAction>;
}) {
  const total = sumAmounts([
    "0",
    ...rows.filter((e) => e.status === "posted").map((e) => e.amount),
  ]);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{t("money.posted")}</h4>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
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
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("common.reverse")}</span>
                </th>
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
                  <ReverseCell
                    canReverse={canReverse}
                    posted={entry.status === "posted"}
                    pending={reverse.isPending}
                    onReverse={() =>
                      void action.run(() => reverse.mutateAsync(entry.id), {
                        confirm: "money.reverseConfirm",
                      })
                    }
                  />
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
