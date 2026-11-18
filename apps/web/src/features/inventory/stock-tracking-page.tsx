"use client";

import type { StockTrackingDay } from "@bsd/contracts";
import { toDecimal } from "@bsd/domain";
import { formatShortDate, t, toBengaliDigits } from "@bsd/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useId, useState } from "react";
import { Button } from "@/components/button";
import {
  CartonQty,
  ColumnHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  theadClass,
} from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { Skeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { useStockTrackingProduct, useStockTrackingProducts } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "history/stock-tracking";
const CARD_PAGE_SIZE = 24;
const DAY_PAGE_SIZE = 30;

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
  if (total <= pageSize) return null;
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

function Qty({ pieces, ppc }: { pieces: string; ppc: string }) {
  if (toDecimal(pieces).isZero()) return "—";
  return <CartonQty pieces={pieces} piecesPerCarton={ppc} />;
}

function DayTable({
  days,
  piecesPerCarton,
}: {
  days: StockTrackingDay[];
  piecesPerCarton: string;
}) {
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              {t("stockTracking.column.date")}
            </th>
            <ColumnHead label={t("stockTracking.column.opening")} quantity />
            <ColumnHead label={t("stockTracking.column.ordered")} quantity />
            <ColumnHead label={t("stockTracking.column.received")} quantity />
            <ColumnHead label={t("stockTracking.column.incentive")} quantity />
            <ColumnHead label={t("stockTracking.column.issued")} quantity />
            <ColumnHead label={t("stockTracking.column.returned")} quantity />
            <ColumnHead label={t("stockTracking.column.godownDamaged")} quantity />
            <ColumnHead label={t("stockTracking.column.closing")} quantity />
            <ColumnHead label={t("stockTracking.column.due")} quantity />
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={`${day.date}-${day.isOpening ? "open" : "move"}`} className="border-t border-border">
              <th scope="row" className={`${tdClass} text-left font-medium`}>
                {formatShortDate(day.date)}
                {day.isOpening ? (
                  <span className="mt-0.5 block text-xs font-normal text-text-muted">
                    {t("stockTracking.openingRow")}
                  </span>
                ) : null}
              </th>
              <td className={tdNum}>
                <Qty pieces={day.openingStock} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.ordered} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.received} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.incentiveReceived} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.issued} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.returned} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.godownDamaged} ppc={piecesPerCarton} />
              </td>
              <td className={`${tdNum} font-semibold`}>
                <Qty pieces={day.closingStock} ppc={piecesPerCarton} />
              </td>
              <td className={tdNum}>
                <Qty pieces={day.dueFromCompany} ppc={piecesPerCarton} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function ProductDetail({
  companyId,
  productId,
  onBack,
}: {
  companyId: string;
  productId: string;
  onBack: () => void;
}) {
  const [page, setPage] = useState(1);
  const detail = useStockTrackingProduct(companyId, productId, page, DAY_PAGE_SIZE);

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <TableSkeleton rows={8} />
      </div>
    );
  }
  if (detail.isError) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return null;

  const data = detail.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button onClick={onBack}>{t("stockTracking.back")}</Button>
          <h2 className="mt-3 text-lg font-semibold text-text">{data.productName}</h2>
          <p className="text-sm text-text-muted">
            {data.sku} · {t("stockTracking.currentStock")}:{" "}
            <span className="font-medium text-text">
              <CartonQty pieces={data.currentStock} piecesPerCarton={data.piecesPerCarton} />
            </span>
          </p>
        </div>
      </div>
      {data.days.length === 0 ? (
        <StatePanel title={t("stockTracking.emptyDays")} />
      ) : (
        <DayTable days={data.days} piecesPerCarton={data.piecesPerCarton} />
      )}
      <Pager page={page} pageSize={DAY_PAGE_SIZE} total={data.total} onPage={setPage} />
    </div>
  );
}

function ProductCards({
  companyId,
  onSelect,
}: {
  companyId: string;
  onSelect: (productId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const searchId = useId();
  useEffect(() => {
    setPage(1);
  }, [deferredQuery]);
  const list = useStockTrackingProducts(companyId, page, CARD_PAGE_SIZE, deferredQuery);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-md">
        <label htmlFor={searchId} className="mb-1 block text-sm font-medium">
          {t("stockTracking.search")}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("stockTracking.searchHint")}
          autoComplete="off"
          className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
        />
      </div>
      {list.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? null : list.data.total === 0 ? (
        <StatePanel
          title={deferredQuery ? t("state.noResults") : t("stockTracking.emptyProducts")}
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.products.map((product) => (
              <li key={product.productId}>
                <button
                  type="button"
                  onClick={() => onSelect(product.productId)}
                  className="flex h-full w-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[0_6px_20px_-8px_var(--action)]"
                >
                  <span className="text-base font-semibold text-text">{product.productName}</span>
                  <span className="text-xs text-text-muted">{product.sku}</span>
                  <span className="mt-auto text-sm text-text-muted">
                    {t("stockTracking.currentStock")}:{" "}
                    <span className="font-medium tabular-nums text-text">
                      <CartonQty pieces={product.stock} piecesPerCarton={product.piecesPerCarton} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={CARD_PAGE_SIZE} total={list.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function StockTrackingPage() {
  const { company } = useCurrentWorkspace();
  const router = useRouter();
  const search = useSearchParams();
  const productId = search.get("product") ?? "";

  const openProduct = (id: string) => {
    router.push(`${companyHref(company.id, PATH)}?product=${encodeURIComponent(id)}`);
  };
  const backToCards = () => {
    router.push(companyHref(company.id, PATH));
  };

  return (
    <NavGate path={PATH}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title={t("nav.history.stockTracking")}
          description={t("stockTracking.description")}
        />
        {productId ? (
          <ProductDetail companyId={company.id} productId={productId} onBack={backToCards} />
        ) : (
          <ProductCards companyId={company.id} onSelect={openProduct} />
        )}
      </div>
    </NavGate>
  );
}
