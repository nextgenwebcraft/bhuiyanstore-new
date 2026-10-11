"use client";

import type { MoneyEntry, MoneyEntryKind } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import { EmptyListNote } from "@/components/empty-list-note";
import { QueryError } from "@/components/query-error";
import { ReverseCell } from "@/components/reverse-cell";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import {
  StatusChip,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { useMoneyEntries, useReverseMoneyEntry } from "@/data/queries";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";

export type MoneyEntryColumn = {
  label: TranslationKey;
  numeric?: boolean;
  cell: (entry: MoneyEntry) => React.ReactNode;
};

/** The day's money entries of the given kinds with a status and reverse column; pages add the columns before them. */
export function MoneyEntryTable({
  companyId,
  date,
  kinds,
  columns,
}: {
  companyId: string;
  date: string;
  kinds: readonly MoneyEntryKind[];
  columns: MoneyEntryColumn[];
}) {
  const { permissions } = useCurrentWorkspace();
  const entries = useMoneyEntries(companyId, { from: date });
  const reverse = useReverseMoneyEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("payment.reverse");

  if (entries.isPending) return <TableSkeleton rows={3} columns={5} />;
  if (entries.isError)
    return <QueryError error={entries.error} onRetry={() => void entries.refetch()} />;
  const rows = entries.data.filter((e) => kinds.includes(e.kind));
  return (
    <>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
      {rows.length === 0 ? (
        <EmptyListNote textKey="money.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                {columns.map((column) => (
                  <th key={column.label} scope="col" className={column.numeric ? thNum : thClass}>
                    {t(column.label)}
                  </th>
                ))}
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
                  {columns.map((column) => (
                    <td key={column.label} className={column.numeric ? tdNum : tdClass}>
                      {column.cell(entry)}
                    </td>
                  ))}
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
    </>
  );
}
