"use client";

import { t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { tableClass, tdClass, theadClass, thClass } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { TableScroller } from "@/components/table-scroller";
import { useWorkspaces } from "@/data/queries";
import { CompanyForm } from "@/features/company-picker/company-form";
import { DeleteCompanyDialog } from "@/features/company-picker/delete-company-dialog";
import { CompanyMark } from "@/features/shell/company-mark";
import { NavGate } from "@/features/shell/nav-gate";
import type { Company } from "@bsd/contracts";

/** Master-panel company add/edit/delete (D90): every company, reusing the picker's own forms. */
export function MasterCompaniesPage() {
  const workspaces = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  return (
    <NavGate path="master/companies">
      <PageHeader
        title={t("nav.master.companies")}
        description={t("company.chooseHint")}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("company.new")}
          </Button>
        }
      />
      {creating ? <CompanyForm onClose={() => setCreating(false)} /> : null}
      {editing ? <CompanyForm company={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <DeleteCompanyDialog company={deleting} onClose={() => setDeleting(null)} />
      ) : null}
      {workspaces.isPending ? (
        <TableSkeleton rows={4} columns={2} />
      ) : workspaces.isError ? (
        <QueryError error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("company.name")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("common.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workspaces.data.map(({ company }) => (
                <tr key={company.id} className="border-t border-border">
                  <td className={tdClass}>
                    <div className="flex items-center gap-3">
                      <CompanyMark company={company} />
                      <span className="font-medium">{company.name}</span>
                    </div>
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setEditing(company)}>{t("common.edit")}</Button>
                      <Button
                        className="text-error"
                        onClick={() => setDeleting({ id: company.id, name: company.name })}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </NavGate>
  );
}
