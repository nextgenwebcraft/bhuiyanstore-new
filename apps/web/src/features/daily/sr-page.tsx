"use client";

import type { StaffAccounts } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import {
  money,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { useConfigList, useStaffAccounts, useStaffRecords } from "@/data/queries";
import { PersonDialog, type PersonDraft } from "@/features/catalog/staff-page";
import { DateBar, useWorkingDate } from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "sales/sr";

type Row = StaffAccounts["rows"][number];

/**
 * এসআর হিসাব: add an SR, see the list and what each owes, and edit. Advance and short
 * are entered on that SR's day sheet (D79), not here.
 */
function SrAccounts() {
  const { company, permissions } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const accounts = useStaffAccounts(company.id, "sr", date);
  const records = useStaffRecords(company.id);
  const roles = useConfigList("staffRoles");
  const [person, setPerson] = useState<PersonDraft | null>(null);
  const canManage = permissions.includes("staff.manage");
  const srRoles = (roles.data ?? []).filter((role) => role.kind === "sr");
  const rows = accounts.data?.rows ?? [];

  let body: React.ReactNode;
  if (accounts.isPending) body = <TableSkeleton rows={5} columns={3} />;
  else if (accounts.isError) {
    body = <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />;
  } else if (!accounts.data.cutoffDate) {
    body = (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  } else if (rows.length === 0) {
    body = <StatePanel title={t("sr.empty")} />;
  } else {
    body = (
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("common.name")}
              </th>
              <th scope="col" className={thNum}>
                {t("sr.entry.due")}
              </th>
              <th scope="col" className={thClass}>
                <span className="sr-only">{t("common.edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Row) => {
              const record = records.data?.find((item) => item.id === row.staffId);
              return (
                <tr key={row.staffId} className="border-t border-border">
                  <td className={tdClass}>{row.staffName}</td>
                  <td className={`${tdNum} font-semibold`}>{money(row.balances.srLoan)}</td>
                  <td className={`${tdClass} text-right`}>
                    {canManage && record ? (
                      <Button
                        onClick={() =>
                          setPerson({
                            id: record.id,
                            name: record.name,
                            phone: record.phone,
                            employer: record.employer,
                            status: record.status,
                          })
                        }
                      >
                        {t("common.edit")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.sales.sr")}
        description={t("sr.page.description")}
        actions={
          <>
            <DateBar date={date} onChange={setDate} />
            {canManage ? (
              <Button
                variant="primary"
                onClick={() => setPerson({ name: "", employer: "supplier", status: "active" })}
              >
                {t("sr.new")}
              </Button>
            ) : null}
          </>
        }
      />
      {body}
      {person ? (
        <PersonDialog
          companyId={company.id}
          draft={person}
          roles={srRoles}
          onClose={() => setPerson(null)}
        />
      ) : null}
    </>
  );
}

export function SrPage() {
  return (
    <NavGate path={PATH}>
      <SrAccounts />
    </NavGate>
  );
}
