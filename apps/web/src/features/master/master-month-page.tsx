"use client";

import type { MasterMonth } from "@bsd/contracts";
import { monthOf } from "@bsd/domain";
import { labelOf, t, type TranslationKey } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { tableClass, tdClass, thClass, theadClass } from "@/components/data-table";
import { MonthPicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { TableScroller } from "@/components/table-scroller";
import { useMasterMonth, useMasterMonthCommand } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";
import { useToday } from "@/lib/today";

const PATH = "master/month-close";

function Status({ status }: { status: MasterMonth["companies"][number]["status"] }) {
  const tone = status === "closed" ? "success" : status === "open" ? "brand" : "muted";
  return <StatusBadge tone={tone}>{t(`month.status.${status}` as TranslationKey)}</StatusBadge>;
}

/**
 * Month close for the whole business (D66): every company, then the master, close together;
 * reopening goes the other way. Blocked when any company can't close yet.
 */
export function MasterMonthPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [month, setMonth] = useState(() => monthOf(today));
  const query = useMasterMonth(company.id, month);
  const command = useMasterMonthCommand(company.id);
  const action = useAsyncAction();
  const view = query.data;

  const run = (kind: "close" | "reopen") =>
    action.run(() => command.mutateAsync({ action: kind, month }), {
      confirm: kind === "close" ? "master.month.closeConfirm" : "master.month.reopenConfirm",
    });

  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.flow.monthClose")}
        description={t("master.month.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker
              id="master-month"
              value={month}
              label={t("month.picker")}
              onChange={setMonth}
            />
            <Button
              variant="primary"
              disabled={command.isPending || !view?.canCloseAll}
              onClick={() => void run("close")}
            >
              {t("master.month.closeAll")}
            </Button>
            <Button
              disabled={command.isPending || !view?.canReopenAll}
              onClick={() => void run("reopen")}
            >
              {t("master.month.reopenAll")}
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        {action.error ? <StatePanel tone="error" title={action.error} /> : null}
        {query.isPending ? (
          <TableSkeleton rows={3} columns={3} />
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <TableScroller>
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>
                    {t("master.month.company")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("common.status")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("month.closeBlocked")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.companies.map((c) => (
                  <tr key={c.companyId} className="border-t border-border">
                    <td className={tdClass}>
                      {c.isMaster ? t("nav.master.dashboard") : c.companyName}
                    </td>
                    <td className={tdClass}>
                      <Status status={c.status} />
                    </td>
                    <td className={tdClass}>
                      {c.closeBlockedBy ? labelOf(c.closeBlockedBy) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        )}
      </div>
    </NavGate>
  );
}
