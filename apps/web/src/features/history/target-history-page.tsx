"use client";

import type { OrderTargetHistoryAction, OrderTargetHistoryEntry } from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { formatBusinessDate, formatAmount, formatCount, t, type TranslationKey } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { tableClass, theadClass, thClass, tdClass, tdNum, thNum } from "@/components/data-table";
import { TableSkeleton } from "@/components/skeleton";
import { useOrderTargetHistory } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "history/targets";

const ACTION_KEYS: Record<OrderTargetHistoryAction, TranslationKey> = {
  create: "target.history.action.create",
  update: "target.history.action.update",
  archive: "target.history.action.archive",
  delete: "target.history.action.delete",
};

/** Same wording as the targets page: one product name, several names joined, or the overall label. */
function entryLabel(entry: OrderTargetHistoryEntry): string {
  if (entry.kind === "overall") return t("target.kind.overall");
  if (entry.products.length === 0) return t("target.kind.product");
  if (entry.products.length === 1) {
    const [product] = entry.products;
    if (product) return `${product.name}${product.sku ? ` (${product.sku})` : ""}`;
  }
  return entry.products.map((p) => p.name).join(" · ");
}

function HistoryBody() {
  const { company } = useCurrentWorkspace();
  const history = useOrderTargetHistory(company.id);

  if (history.isPending) return <TableSkeleton rows={6} columns={6} />;
  if (history.isError) {
    return <QueryError error={history.error} onRetry={() => void history.refetch()} />;
  }
  if (history.data.items.length === 0) {
    return <StatePanel title={t("target.history.empty")} />;
  }

  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>{t("target.history.when")}</th>
            <th className={thClass}>{t("target.history.action")}</th>
            <th className={thClass}>{t("target.history.target")}</th>
            <th className={thNum}>
              {t("target.amount")} / {t("target.cartons")}
            </th>
            <th className={thClass}>{t("target.history.period")}</th>
            <th className={thClass}>{t("target.history.by")}</th>
          </tr>
        </thead>
        <tbody>
          {history.data.items.map((entry) => (
            <tr key={entry.id} className="border-t border-border">
              <td className={tdClass}>
                {formatBusinessDate(businessDateOf(new Date(entry.createdAt)))}
              </td>
              <td className={tdClass}>{t(ACTION_KEYS[entry.action])}</td>
              <td className={tdClass}>{entryLabel(entry)}</td>
              <td className={tdNum}>
                {entry.kind === "overall"
                  ? formatAmount(entry.amount ?? "0")
                  : formatCount(entry.quantityCartons ?? "0")}
              </td>
              <td className={tdClass}>
                {formatBusinessDate(entry.startDate)} – {formatBusinessDate(entry.endDate)}
              </td>
              <td className={tdClass}>{entry.actorName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

export function TargetHistoryPage() {
  return (
    <NavGate path={PATH}>
      <PageHeader title={t("nav.history.targets")} description={t("target.history.description")} />
      <HistoryBody />
    </NavGate>
  );
}
