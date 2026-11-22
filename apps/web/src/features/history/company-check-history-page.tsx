"use client";

import { formatDateTime, formatMoney, formatShortDate, t } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useCompanyCheckHistory } from "@/data/queries";
import { CompanyCheckLines } from "@/features/finance/company-check-lines";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/** Fully repaid cheques (D129), newest completion first, each with its dated records (D145). */
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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  {check.bankName} · {check.checkNumber}
                </h2>
                <StatusBadge tone="success">
                  {t("companyCheck.completedOn")}: {formatShortDate(check.completedDate)}
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {t("companyCheck.registeredOn")}: {formatDateTime(check.createdAt)} ·{" "}
                {t("companyCheck.chargedTotal")}: {formatMoney(check.chargedTotal)} ·{" "}
                {t("companyCheck.paidTotal")}: {formatMoney(check.paidTotal)}
              </p>
              <CompanyCheckLines lines={check.lines} className="mt-3" />
            </section>
          ))}
        </div>
      )}
    </NavGate>
  );
}
