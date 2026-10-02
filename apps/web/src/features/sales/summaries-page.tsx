"use client";

import type { DailySalesSummary } from "@bsd/contracts";
import { formatAmount, formatRate, t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { useBatches, useDailySalesSummaries, useProducts, useStaff } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { SummaryForm } from "./summary-form";

const PATH = "sales/daily-summaries";

function Amount({ label, value }: { label: string; value: string | undefined }) {
  if (value === undefined) return null;
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{formatAmount(value)}</dd>
    </div>
  );
}

/** Traceable document detail: every price split and batch allocation (guide 5.3, 9.5). */
function SummaryCard({ summary }: { summary: DailySalesSummary }) {
  return (
    <li className="rounded-lg border border-border bg-surface">
      <details>
        <summary className="flex min-h-(--touch-target) cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
          <span className="font-medium">
            {summary.number} · {toBengaliDigits(summary.businessDate)}
          </span>
          <span className="text-sm text-text-muted">{summary.dsrName}</span>
          <span className="font-semibold tabular-nums">{formatAmount(summary.netSales)}</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-4 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Amount label={t("summary.netSales")} value={summary.netSales} />
            <Amount label={t("summary.cashCollected")} value={summary.cashCollected} />
            <Amount label={t("sales.marketDue")} value={summary.marketDue} />
            <Amount label={t("summary.cogs")} value={summary.cogs} />
            <Amount label={t("summary.grossProfit")} value={summary.grossProfit} />
          </dl>
          <ul className="flex flex-col gap-3">
            {summary.lines.map((line) => (
              <li key={line.productId} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap justify-between gap-2 font-medium">
                  <span>{line.productName}</span>
                  <span className="tabular-nums">{formatAmount(line.netSales)}</span>
                </div>
                <ul className="mt-2 text-text-muted">
                  {line.priceSplits.map((split, index) => (
                    <li key={index}>
                      {toBengaliDigits(split.quantity)} × {formatRate(split.unitPrice)} ={" "}
                      {formatAmount(split.amount)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-text-muted">
                  {t("summary.allocation")}:{" "}
                  {line.allocations
                    .map(
                      (a) =>
                        `${a.lotId ?? "—"} × ${toBengaliDigits(a.quantity)}${a.unitCost ? ` @ ${formatRate(a.unitCost)}` : ""}`,
                    )
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}

function DailySummaries() {
  const { company, permissions } = useCurrentWorkspace();
  const summaries = useDailySalesSummaries(company.id);
  const products = useProducts(company.id);
  const batches = useBatches(company.id);
  const staff = useStaff(company.id);
  const [formOpen, setFormOpen] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);
  const canPost = permissions.includes("sale.post");
  const dsrs = staff.data?.filter((p) => p.kind === "dsr") ?? [];
  const ready = products.isSuccess && batches.isSuccess && staff.isSuccess;

  let body: React.ReactNode;
  if (summaries.isPending) {
    body = <ListSkeleton />;
  } else if (summaries.isError) {
    body = <QueryError error={summaries.error} onRetry={() => void summaries.refetch()} />;
  } else if (summaries.data.length === 0) {
    body = <StatePanel title={t("summary.empty")} />;
  } else {
    const newestFirst = [...summaries.data].sort((a, b) => b.postingSequence - a.postingSequence);
    body = (
      <ul className="flex flex-col gap-3">
        {newestFirst.map((s) => (
          <SummaryCard key={s.id} summary={s} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.sales.dailySummaries")}
        actions={
          canPost && !formOpen ? (
            <Button
              variant="primary"
              disabled={!ready || dsrs.length === 0}
              onClick={() => {
                setLastPosted(null);
                setFormOpen(true);
              }}
            >
              {t("summary.new")}
            </Button>
          ) : null
        }
      />
      {canPost && staff.isSuccess && dsrs.length === 0 ? (
        <div className="mb-4">
          <StatePanel tone="warning" title={t("summary.noDsr")} />
        </div>
      ) : null}
      {lastPosted ? (
        <div className="mb-4">
          <StatePanel title={`${t("common.posted")}: ${lastPosted}`} />
        </div>
      ) : null}
      {formOpen && ready ? (
        <SummaryForm
          companyId={company.id}
          products={products.data}
          batches={batches.data}
          dsrs={dsrs}
          showCost={permissions.includes("inventory.cost_view")}
          onClose={() => setFormOpen(false)}
          onPosted={(summary) => {
            setFormOpen(false);
            setLastPosted(summary.number);
          }}
        />
      ) : null}
      {body}
    </>
  );
}

export function DailySummariesPage() {
  return (
    <NavGate path={PATH}>
      <DailySummaries />
    </NavGate>
  );
}
