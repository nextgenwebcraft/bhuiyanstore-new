"use client";

import type {
  DsrDay,
  HistoryMoneyKindGroup,
  HistoryStatusFilter,
  HistoryStockDateSummary,
  HistoryStockKindGroup,
  HistoryStockLine,
  MoneyEntry,
} from "@bsd/contracts";
import { historyStatusFilters, historyStockDateCardGroups } from "@bsd/contracts";
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
import { DatePicker } from "@/components/date-picker";
import { EmptyListNote } from "@/components/empty-list-note";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { Skeleton, SummarySkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { TableSummary } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  useDsrDayCommand,
  useHistoryDsrDays,
  useHistoryMoneyEntries,
  useHistoryStockDateSummaries,
  useHistoryStockEntries,
  useReverseMoneyEntry,
  useReverseStockEntry,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

type StockTab = {
  kind: "stock";
  group: HistoryStockKindGroup;
  path: string;
  title: TranslationKey;
};
type MoneyTab = {
  kind: "money";
  group: HistoryMoneyKindGroup;
  path: string;
  title: TranslationKey;
};
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

const STATUS_TAB_KEYS: Record<HistoryStatusFilter, TranslationKey> = {
  all: "history.filter.all",
  posted: "daily.status.posted",
  reversed: "daily.status.reversed",
};

const PAGE_SIZE = 25;

function usesDateCards(group: HistoryStockKindGroup): boolean {
  return (historyStockDateCardGroups as readonly string[]).includes(group);
}

function useHistoryFilters() {
  const [page, setPage] = useState(1);
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<HistoryStatusFilter>("posted");

  function changeDate(next: string) {
    setDate(next);
    setPage(1);
  }

  function changeStatus(next: HistoryStatusFilter) {
    setStatus(next);
    setPage(1);
  }

  return {
    page,
    setPage,
    pageSize: PAGE_SIZE,
    date: date || undefined,
    dateValue: date,
    changeDate,
    status,
    changeStatus,
  };
}

function StatusTabs({
  status,
  onStatus,
}: {
  status: HistoryStatusFilter;
  onStatus: (status: HistoryStatusFilter) => void;
}) {
  return (
    <div role="tablist" aria-label={t("common.status")} className="flex flex-wrap gap-2">
      {historyStatusFilters.map((id) => (
        <Button
          key={id}
          role="tab"
          aria-selected={id === status}
          variant={id === status ? "primary" : "secondary"}
          onClick={() => onStatus(id)}
        >
          {t(STATUS_TAB_KEYS[id])}
        </Button>
      ))}
    </div>
  );
}

function HistoryFilters({
  date,
  onDate,
  status,
  onStatus,
}: {
  date: string;
  onDate: (date: string) => void;
  status: HistoryStatusFilter;
  onStatus: (status: HistoryStatusFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <DatePicker
        id="history-date-filter"
        value={date}
        clearable
        label={t("history.filter.date")}
        placeholder={t("history.filter.date")}
        onChange={onDate}
      />
      <StatusTabs status={status} onStatus={onStatus} />
    </div>
  );
}

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

function DateCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <span className="sr-only">{t("state.loading")}</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card"
        >
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-20" />
          <div className="mt-1 grid grid-cols-3 gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DateSummaryCards({
  items,
  onOpen,
}: {
  items: HistoryStockDateSummary[];
  onOpen: (date: string) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.date}>
          <button
            type="button"
            onClick={() => onOpen(item.date)}
            className="flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left shadow-card transition-[border-color,background-color,box-shadow] hover:border-border-strong hover:bg-surface-hover"
          >
            <span className="text-base font-semibold">{formatShortDate(item.date)}</span>
            <span className="text-xs text-text-muted">
              {t("table.summary.rows")}: {toBengaliDigits(String(item.count))}
            </span>
            <dl className="mt-1 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-[11px] text-text-muted">{t("common.cartons")}</dt>
                <dd className="font-semibold tabular-nums">{toBengaliDigits(item.cartons)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-text-muted">{t("common.pieces")}</dt>
                <dd className="font-semibold tabular-nums">{toBengaliDigits(item.pieces)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-text-muted">{t("common.amount")}</dt>
                <dd className="font-semibold tabular-nums">{money(item.amount)}</dd>
              </div>
            </dl>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StockEntryTable({
  items,
  showDateColumn,
  canDelete,
  onDelete,
}: {
  items: HistoryStockLine[];
  showDateColumn: boolean;
  canDelete: boolean;
  onDelete: (id: string) => Promise<unknown>;
}) {
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            {showDateColumn ? (
              <th scope="col" className={thClass}>
                {t("common.date")}
              </th>
            ) : null}
            <th scope="col" className={thClass}>
              {t("common.kind")}
            </th>
            <th scope="col" className={thClass}>
              {t("godown.column.product")}
            </th>
            <th scope="col" className={thNum}>
              {t("common.cartons")}
            </th>
            <th scope="col" className={thNum}>
              {t("common.pieces")}
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
          {items.map((entry) => (
            <tr key={entry.id} className="border-t border-border">
              {showDateColumn ? <td className={tdClass}>{formatShortDate(entry.date)}</td> : null}
              <td className={tdClass}>{t(`godown.kind.${entry.kind}` as TranslationKey)}</td>
              <td className={tdClass}>
                {entry.sku} · {entry.productName}
              </td>
              <td className={tdNum}>{toBengaliDigits(entry.cartons)}</td>
              <td className={tdNum}>{toBengaliDigits(entry.loosePieces)}</td>
              <td className={tdNum}>{money(entry.amount)}</td>
              <td className={tdClass}>
                <StatusChip status={entry.status} />
              </td>
              <td className={tdClass}>
                <DeleteAction
                  label={`${entry.sku} ${formatShortDate(entry.date)}`}
                  canDelete={canDelete && entry.status === "posted"}
                  onDelete={() => onDelete(entry.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

/** Orders / stock: date cards first, then drill-in table with summary (no date picker). */
function StockDateCardHistory({
  companyId,
  group,
}: {
  companyId: string;
  group: HistoryStockKindGroup;
}) {
  const { permissions } = useCurrentWorkspace();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<HistoryStatusFilter>("posted");
  const pageSize = PAGE_SIZE;

  const dates = useHistoryStockDateSummaries(companyId, group, status);
  const list = useHistoryStockEntries(
    companyId,
    group,
    page,
    pageSize,
    selectedDate ?? undefined,
    status,
    true,
  );
  const reverse = useReverseStockEntry(companyId);
  const canDelete = permissions.includes("purchase.reverse");
  const daySummary = selectedDate
    ? dates.data?.items.find((d) => d.date === selectedDate)
    : undefined;

  function changeStatus(next: HistoryStatusFilter) {
    setStatus(next);
    setPage(1);
  }

  function openDate(date: string) {
    setSelectedDate(date);
    setPage(1);
  }

  if (selectedDate === null) {
    return (
      <div className="flex flex-col gap-3">
        {dates.isPending ? (
          <DateCardsSkeleton />
        ) : dates.isError ? (
          <QueryError error={dates.error} onRetry={() => void dates.refetch()} />
        ) : dates.data.items.length === 0 ? (
          <EmptyListNote textKey="history.empty" />
        ) : (
          <DateSummaryCards items={dates.data.items} onOpen={openDate} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          onClick={() => {
            setSelectedDate(null);
            setPage(1);
          }}
        >
          {t("history.backToDates")}
        </Button>
        <StatusTabs status={status} onStatus={changeStatus} />
      </div>
      <p className="text-base font-semibold">{formatShortDate(selectedDate)}</p>
      {list.isPending ? (
        <SummarySkeleton stats={4} rows={8} />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          {daySummary ? (
            <TableSummary
              label={t("table.summary")}
              items={[
                {
                  label: t("table.summary.rows"),
                  value: toBengaliDigits(String(daySummary.count)),
                },
                {
                  label: t("common.cartons"),
                  value: toBengaliDigits(daySummary.cartons),
                },
                {
                  label: t("common.pieces"),
                  value: toBengaliDigits(daySummary.pieces),
                  emphasis: true,
                },
                {
                  label: t("common.amount"),
                  value: money(daySummary.amount),
                  emphasis: true,
                },
              ]}
            />
          ) : null}
          {list.data.items.length === 0 ? (
            <EmptyListNote textKey="history.empty" />
          ) : (
            <StockEntryTable
              items={list.data.items}
              showDateColumn={false}
              canDelete={canDelete}
              onDelete={(id) => reverse.mutateAsync(id)}
            />
          )}
          <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** Damage (and any stock group without date cards): flat table with date filter. */
function StockFlatHistory({
  companyId,
  group,
}: {
  companyId: string;
  group: HistoryStockKindGroup;
}) {
  const { permissions } = useCurrentWorkspace();
  const { page, setPage, pageSize, date, dateValue, changeDate, status, changeStatus } =
    useHistoryFilters();
  const list = useHistoryStockEntries(companyId, group, page, pageSize, date, status);
  const reverse = useReverseStockEntry(companyId);
  const canDelete = permissions.includes("purchase.reverse");

  return (
    <div className="flex flex-col gap-3">
      <HistoryFilters
        date={dateValue}
        onDate={changeDate}
        status={status}
        onStatus={changeStatus}
      />
      {list.isPending ? (
        <TableSkeleton rows={8} />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyListNote textKey="history.empty" />
      ) : (
        <StockEntryTable
          items={list.data.items}
          showDateColumn
          canDelete={canDelete}
          onDelete={(id) => reverse.mutateAsync(id)}
        />
      )}
      {list.data ? (
        <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} />
      ) : null}
    </div>
  );
}

function StockHistory({ companyId, group }: { companyId: string; group: HistoryStockKindGroup }) {
  return usesDateCards(group) ? (
    <StockDateCardHistory companyId={companyId} group={group} />
  ) : (
    <StockFlatHistory companyId={companyId} group={group} />
  );
}

function MoneyHistory({ companyId, group }: { companyId: string; group: HistoryMoneyKindGroup }) {
  const { permissions } = useCurrentWorkspace();
  const { page, setPage, pageSize, date, dateValue, changeDate, status, changeStatus } =
    useHistoryFilters();
  const list = useHistoryMoneyEntries(companyId, group, page, pageSize, date, status);
  const reverse = useReverseMoneyEntry(companyId);
  const canDelete = permissions.includes("payment.reverse");

  return (
    <div className="flex flex-col gap-3">
      <HistoryFilters
        date={dateValue}
        onDate={changeDate}
        status={status}
        onStatus={changeStatus}
      />
      {list.isPending ? (
        <TableSkeleton rows={8} />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
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
              {list.data.items.map((entry: MoneyEntry) => (
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
      {list.data ? (
        <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} />
      ) : null}
    </div>
  );
}

function DsrHistory({ companyId }: { companyId: string }) {
  const { permissions } = useCurrentWorkspace();
  const { page, setPage, pageSize, date, dateValue, changeDate, status, changeStatus } =
    useHistoryFilters();
  const list = useHistoryDsrDays(companyId, page, pageSize, date, status);
  const command = useDsrDayCommand(companyId);
  const canDelete = permissions.includes("sale.reverse");

  return (
    <div className="flex flex-col gap-3">
      <HistoryFilters
        date={dateValue}
        onDate={changeDate}
        status={status}
        onStatus={changeStatus}
      />
      {list.isPending ? (
        <TableSkeleton rows={8} />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
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
              {list.data.items.map((sheet: DsrDay) => {
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
      {list.data ? (
        <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} />
      ) : null}
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
