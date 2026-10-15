"use client";

import type { DayView, StockEntryPostRequest } from "@bsd/contracts";
import { sumQuantities, toBaseQuantity, toDecimal } from "@bsd/domain";
import { formatRate, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import {
  CartonQty,
  ColumnHead,
  money,
  quantity,
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { TableScroller } from "@/components/table-scroller";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import { usePostStockEntries } from "@/data/queries";
import { CellInput, clean } from "./daily-kit";

/**
 * The company order (D57): per product the paid cartons + pieces, the taka per carton and the free
 * goods the company gives with it. The bill and the per-piece cost are previews of what the month
 * engine calculates when the goods arrive.
 */
type Row = {
  cartons: string;
  pieces: string;
  rate?: string;
  freeCartons: string;
  freePieces: string;
};
const emptyRow: Row = { cartons: "", pieces: "", freeCartons: "", freePieces: "" };
const whole = /^\d+$/;
const amount = /^\d+(\.\d{1,2})?$/;

type Product = DayView["products"][number];

/** The current order price as a taka-per-carton starting value; blank without a price. */
const defaultRate = (product: Product) =>
  product.orderPrice
    ? toDecimal(product.orderPrice).mul(product.piecesPerCarton).toDecimalPlaces(2).toString()
    : "";

type Draft =
  | { error: string }
  | {
      paid: string;
      free: string;
      rate: string;
      bill: ReturnType<typeof toDecimal>;
      unitCost: ReturnType<typeof toDecimal>;
    };

export function OrderForm({
  companyId,
  date,
  view,
}: {
  companyId: string;
  date: string;
  view: DayView;
}) {
  const post = usePostStockEntries(companyId);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const set = (productId: string, patch: Partial<Row>) => {
    setDone(false);
    setRows((current) => ({
      ...current,
      [productId]: { ...(current[productId] ?? emptyRow), ...patch },
    }));
  };

  /** What one row would post, or a message when the row is wrong; null when it is empty. */
  function draftOf(product: Product): Draft | null {
    const row = rows[product.productId];
    if (!row) return null;
    const [cartons, pieces, freeCartons, freePieces] = [
      row.cartons,
      row.pieces,
      row.freeCartons,
      row.freePieces,
    ].map((v) => clean(v) || "0") as [string, string, string, string];
    if (![cartons, pieces, freeCartons, freePieces].every((v) => whole.test(v))) {
      return { error: t("validation.wholeNumber") };
    }
    const paid = toBaseQuantity(cartons, pieces, product.piecesPerCarton);
    const free = toBaseQuantity(freeCartons, freePieces, product.piecesPerCarton);
    if (paid === "0" && free === "0") return null;
    const rate = clean(row.rate ?? defaultRate(product));
    if (paid !== "0" && !amount.test(rate)) return { error: t("godown.order.rateMissing") };
    const bill =
      paid === "0" ? toDecimal("0") : toDecimal(paid).mul(rate).div(product.piecesPerCarton);
    const all = toDecimal(paid).add(free);
    return {
      paid,
      free,
      rate: paid === "0" ? "0" : rate,
      bill,
      unitCost: all.isZero() ? toDecimal("0") : bill.div(all),
    };
  }

  function request(): StockEntryPostRequest | string {
    const lines: StockEntryPostRequest["lines"] = [];
    for (const product of view.products) {
      const draft = draftOf(product);
      if (!draft) continue;
      if ("error" in draft) return draft.error;
      lines.push({
        kind: "order",
        productId: product.productId,
        pieces: draft.paid,
        freePieces: draft.free,
        cartonRate: draft.rate,
      });
    }
    if (lines.length === 0) return t("godown.nothing");
    return { date, lines, prices: [] };
  }

  async function submit() {
    const built = request();
    if (typeof built === "string") {
      setError(built);
      return;
    }
    setError(undefined);
    try {
      await post.mutateAsync(built);
      setRows({});
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  const drafts = view.products.map((product) => ({ product, draft: draftOf(product) }));
  const entering = drafts.flatMap(({ draft }) => (draft && !("error" in draft) ? [draft] : []));
  const orderBill = entering.reduce((total, d) => total.add(d.bill), toDecimal("0"));
  // D48: an order is billed at once; warn (never block) when its bill exceeds the company balance.
  const company = view.company;
  const overBalance = company ? orderBill.gt(toDecimal(company.balance)) : false;
  const summary: SummaryItem[] = [
    { label: t("table.summary.products"), value: quantity(String(view.products.length)) },
    { label: t("godown.summary.entering"), value: quantity(String(entering.length)) },
    {
      label: `${t("godown.summary.enteringPieces")} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(entering.flatMap((d) => [d.paid, d.free]))),
      emphasis: true,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {company ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label={t("godown.company.balance")}
            value={money(company.balance)}
            hint={t("companyAccount.balanceHint")}
            emphasis
            large
          />
          <StatTile
            label={t("godown.company.undelivered")}
            value={money(company.undeliveredValue)}
            hint={`${quantity(company.undeliveredPieces)} ${t("common.pieces")}`}
          />
        </dl>
      ) : null}
      {company && orderBill.gt(0) ? (
        <p
          role={overBalance ? "alert" : undefined}
          className={`rounded-lg border px-4 py-3 text-sm ${
            overBalance ? "border-warning/40 bg-warning/10" : "border-border bg-surface"
          }`}
        >
          {t("godown.company.orderTotal")}: <strong>{money(orderBill.toString())}</strong>
          {overBalance ? ` — ${t("godown.company.warning")}` : ""}
        </p>
      ) : null}
      <TableSummary label={t("table.summary")} items={summary} />
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={`${thClass} ${stickyHead}`}>
                {t("godown.column.product")}
              </th>
              <th scope="col" className={thNum} colSpan={2}>
                {t("godown.order.paid")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.order.cartonRate")}
              </th>
              <th scope="col" className={thNum} colSpan={2}>
                {t("godown.order.free")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.order.bill")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.order.unitCost")}
              </th>
              <ColumnHead label={t("godown.order.due")} quantity />
            </tr>
          </thead>
          <tbody>
            {drafts.map(({ product, draft }) => {
              const row = rows[product.productId] ?? emptyRow;
              const label = product.productName;
              const preview = draft && !("error" in draft) ? draft : null;
              return (
                <tr key={product.productId} className="border-t border-border">
                  <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                    <div>{product.productName}</div>
                    <div className="text-xs font-normal text-text-muted">
                      {product.sku} · {t("godown.column.size")} {quantity(product.piecesPerCarton)}
                    </div>
                  </th>
                  <td className={tdNum}>
                    <CellInput
                      label={`${label} ${t("godown.column.cartons")}`}
                      value={row.cartons}
                      onChange={(cartons) => set(product.productId, { cartons })}
                      width="w-16"
                    />
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={`${label} ${t("godown.column.pieces")}`}
                      value={row.pieces}
                      onChange={(pieces) => set(product.productId, { pieces })}
                      width="w-16"
                    />
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={`${label} ${t("godown.order.cartonRate")}`}
                      value={row.rate ?? defaultRate(product)}
                      onChange={(rate) => set(product.productId, { rate })}
                      mode="decimal"
                      width="w-24"
                    />
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={`${label} ${t("godown.order.free")} ${t("godown.column.cartons")}`}
                      value={row.freeCartons}
                      onChange={(freeCartons) => set(product.productId, { freeCartons })}
                      width="w-16"
                    />
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={`${label} ${t("godown.order.free")} ${t("godown.column.pieces")}`}
                      value={row.freePieces}
                      onChange={(freePieces) => set(product.productId, { freePieces })}
                      width="w-16"
                    />
                  </td>
                  <td className={tdNum}>{preview ? money(preview.bill.toString()) : ""}</td>
                  <td className={tdNum}>
                    {preview ? formatRate(preview.unitCost.toDecimalPlaces(4).toString()) : ""}
                  </td>
                  <td className={tdNum}>
                    <CartonQty
                      pieces={product.dueFromCompany}
                      piecesPerCarton={product.piecesPerCarton}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-text-muted">
        {t("godown.quantityHint")} {t("godown.order.hint")}
      </p>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {done ? <StatePanel title={t("common.posted")} /> : null}
      <div>
        <Button variant="primary" disabled={post.isPending} onClick={() => void submit()}>
          {post.isPending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
    </div>
  );
}
