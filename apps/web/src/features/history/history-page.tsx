"use client";

import type {
  DsrDay,
  HistoryMoneyKindGroup,
  HistoryStockKindGroup,
  MoneyEntry,
  StockEntry,
} from "@bsd/contracts";
import { sumQuantities } from "@bsd/domain";
import { formatShortDate, t, toBengaliDigits, type TranslationKey } from "@bsd/i18n";
import { useState } from "react";
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
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useDsrDayCommand,
  useHistoryDsrDays,
  useHistoryMoneyEntries,
  useHistoryStockEntries,
  useReverseMoneyEntry,
  useReverseStockEntry,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

type StockTab = { kind: "stock"; group: HistoryStockKindGroup; path: string; title: TranslationKey };
type MoneyTab = { kind: "money"; group: HistoryMoneyKindGroup; path: string; title: TranslationKey };
type DsrTab = { kind: "dsr"; path: string; title: TranslationKey };
export type HistoryTab = StockTab | MoneyTab | DsrTab;

export const HISTORY_TABS: Record<string, HistoryTab> = {
  orders: { kind: "stock", group: "orders", path: "history/orders", title: "nav.history.orders" },
  stock: { kind: "stock", group: "stock", path: "history/stock", title: "nav.history.stock" },
  damage: { kind: "stock", group: "damage", path: "history/damage", title: "nav.history.damage" },
  "shop-dues": {
    kind: "money",
    group: "shopDues",
    path: "history/shop-dues",
    title: "nav.history.shopDues",
  },
  "staff-cash": {
    kind: "money",
    group: "staffCash",
    path: "history/staff-cash",
    title: "nav.history.staffCash",
  },
  "sr-cash": {
    kind: "money",
    group: "srCash",
    path: "history/sr-cash",
    title: "nav.history.srCash",
  },
  expenses: {
    kind: "money",
    group: "expenses",
    path: "history/expenses",
    title: "nav.history.expenses",
  },
  "dsr-sheets": { kind: "dsr", path: "history/dsr-sheets", title: "nav.history.dsrSheets" },
};

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-text-muted">
        {t("history.of")}: {toBengaliDigits(String(total))} · {t("history.page")}{" "}
        {toBengaliDigits(String(page))}/{toBengaliDigits(String(pages))}
      </p>
      <div className="flex gap-2">
        <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("history.prev")}
        </Button>
        <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("history.next")}
        </Button>
      </div>
    </div>
  );
}

function DeleteAction({
  label,
  canDelete,
  onDelete,
}: {
  label: string;
  canDelete: boolean;
  onDelete: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  if (!canDelete) return null;

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await onDelete();
      setOpen(false);
    } catch (e) {
      setError(describeError(e, []).form);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("history.delete")}</Button>
      <FormDialog
        open={open}
        title={`${t("history.delete")}: ${label}`}
        error={error}
        pending={pending}
        submitLabel={t("history.delete")}
        onSubmit={() => void confirm()}
        onClose={() => {
          if (!pending) {
            setOpen(false);
            setError(undefined);
          }
        }}
      >
        <p className="text-sm text-text-muted">{t("history.deleteConfirm")}</p>
      </FormDialog>
    </>
  );
}

function StockHistory({
  companyId,
  group,
}: {
  companyId: string;
  group: HistoryStockKindGroup;
}) {
  const { permissions } = useCurrentWorkspace();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const list = useHistoryStockEntries(companyId, group, page, pageSize);
  const reverse = useReverseStockEntry(companyId);
  const canDelete = permissions.includes("purchase.reverse");

  if (list.isPending) return <TableSkeleton rows={8} />;
  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  const { items, total } = list.data;
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <EmptyListNote textKey="history.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.date")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.kind")}
                </th>
                <th scope="col" className={thClass}>
                  {t("godown.column.product")}
                </th>
                <th scope="col" className={thNum}>
                  {t("opening.stock.pieces")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("history.delete")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry: StockEntry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className={tdClass}>{formatShortDate(entry.date)}</td>
                  <td className={tdClass}>{t(`godown.kind.${entry.kind}` as TranslationKey)}</td>
                  <td className={tdClass}>
                    {entry.sku} · {entry.productName}
                  </td>
                  <td className={tdNum}>{toBengaliDigits(entry.pieces)}</td>
                  <td className={tdClass}>
                    <StatusChip status={entry.status} />
                  </td>
                  <td className={tdClass}>
                    <DeleteAction
                      label={`${entry.sku} ${formatShortDate(entry.date)}`}
                      canDelete={canDelete && entry.status === "posted"}
                      onDelete={() => reverse.mutateAsync(entry.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
      <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </div>
  );
}

function MoneyHistory({
  companyId,
  group,
}: {
  companyId: string;
  group: HistoryMoneyKindGroup;
}) {
  const { permissions } = useCurrentWorkspace();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const list = useHistoryMoneyEntries(companyId, group, page, pageSize);
  const reverse = useReverseMoneyEntry(companyId);
  const canDelete = permissions.includes("payment.reverse");

  if (list.isPending) return <TableSkeleton rows={8} />;
  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  const { items, total } = list.data;
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <EmptyListNote textKey="history.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.date")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.kind")}
                </th>
                <th scope="col" className={thClass}>
                  {t("staff.person")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.amount")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("history.delete")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry: MoneyEntry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className={tdClass}>{formatShortDate(entry.date)}</td>
                  <td className={tdClass}>
                    {t(`money.kind.${entry.kind}` as TranslationKey)}
                    {entry.categoryName ? ` · ${entry.categoryName}` : ""}
                    {entry.shopName ? ` · ${entry.shopName}` : ""}
                  </td>
                  <td className={tdClass}>{entry.staffName ?? "—"}</td>
                  <td className={tdNum}>{money(entry.amount)}</td>
                  <td className={tdClass}>
                    <StatusChip status={entry.status} />
                  </td>
                  <td className={tdClass}>
                    <DeleteAction
                      label={`${formatShortDate(entry.date)} ${money(entry.amount)}`}
                      canDelete={
                        canDelete &&
                        entry.status === "posted" &&
                        entry.payrollRunId === null &&
                        entry.dsrDayId === null
                      }
                      onDelete={() => reverse.mutateAsync(entry.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
      <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </div>
  );
}

function DsrHistory({ companyId }: { companyId: string }) {
  const { permissions } = useCurrentWorkspace();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const list = useHistoryDsrDays(companyId, page, pageSize);
  const command = useDsrDayCommand(companyId);
  const canDelete = permissions.includes("sale.reverse");

  if (list.isPending) return <TableSkeleton rows={8} />;
  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  const { items, total } = list.data;
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <EmptyListNote textKey="history.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.date")}
                </th>
                <th scope="col" className={thClass}>
                  {t("staff.person")}
                </th>
                <th scope="col" className={thNum}>
                  {t("dsr.sheet.issued")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("history.delete")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((sheet: DsrDay) => {
                const issued = sumQuantities(sheet.lines.map((l) => l.issued));
                return (
                  <tr key={sheet.id} className="border-t border-border">
                    <td className={tdClass}>{formatShortDate(sheet.date)}</td>
                    <td className={tdClass}>{sheet.staffName}</td>
                    <td className={tdNum}>{toBengaliDigits(issued)}</td>
                    <td className={tdClass}>
                      <StatusChip status={sheet.status} />
                    </td>
                    <td className={tdClass}>
                      <DeleteAction
                        label={`${sheet.staffName} ${formatShortDate(sheet.date)}`}
                        canDelete={canDelete && sheet.status === "posted"}
                        onDelete={() =>
                          command.mutateAsync({
                            action: "reverse",
                            dayId: sheet.id,
                            version: sheet.version,
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}
      <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </div>
  );
}

export type HistoryTabId = keyof typeof HISTORY_TABS;

/** Pass a tab id string from the route (server→client); resolve the tab on the client. */
export function HistoryPage({ tabId }: { tabId: HistoryTabId }) {
  const { company } = useCurrentWorkspace();
  const tab = HISTORY_TABS[tabId];
  if (!tab) {
    return <StatePanel tone="error" title={t("history.empty")} />;
  }
  return (
    <NavGate path={tab.path}>
      <div className="flex flex-col gap-4">
        <PageHeader title={t(tab.title)} />
        {tab.kind === "stock" ? (
          <StockHistory companyId={company.id} group={tab.group} />
        ) : tab.kind === "money" ? (
          <MoneyHistory companyId={company.id} group={tab.group} />
        ) : (
          <DsrHistory companyId={company.id} />
        )}
      </div>
    </NavGate>
  );
}
