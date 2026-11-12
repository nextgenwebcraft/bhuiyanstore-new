"use client";

import { formatMoney, formatShortDate, t } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { tableClass, tdClass, tdNum, thClass, theadClass } from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { useCompanyCheckHistory } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

export function CompanyCheckHistoryPage() {
  const { company } = useCurrentWorkspace();
  const query = useCompanyCheckHistory(company.id);

  return (
    <NavGate path="history/company-checks">
      <PageHeader
        title={t("nav.history.companyChecks")}
        description={t("companyCheck.historyDescription")}
      />
      {query.isPending ? (
        <TableSkeleton rows={4} columns={4} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <p className="text-sm text-text-muted">{t("companyCheck.historyEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {query.data.items.map((check) => (
            <section
              key={check.id}
              className="rounded-xl border border-border bg-surface p-4 print:break-inside-avoid"
            >
              <h2 className="text-base font-semibold">
                {check.bankName} · {check.checkNumber}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {t("companyCheck.chargedTotal")}: {formatMoney(check.chargedTotal)} ·{" "}
                {t("companyCheck.paidTotal")}: {formatMoney(check.paidTotal)}
              </p>
              <TableScroller className="mt-3">
                <table className={tableClass}>
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>{t("companyCheck.line.date")}</th>
                      <th className={thClass}>{t("companyCheck.line.kind")}</th>
                      <th className={thClass}>{t("companyCheck.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.lines.map((line) => (
                      <tr key={line.id} className="border-t border-border">
                        <td className={tdClass}>{formatShortDate(line.date)}</td>
                        <td className={tdClass}>
                          {t(
                            line.kind === "charge"
                              ? "companyCheck.line.charge"
                              : "companyCheck.line.payment",
                          )}
                        </td>
                        <td className={tdNum}>{formatMoney(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            </section>
          ))}
        </div>
      )}
    </NavGate>
  );
}
