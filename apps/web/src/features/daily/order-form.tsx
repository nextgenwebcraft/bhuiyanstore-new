"use client";

import type { DayView, OrderFund, StockEntryPostRequest } from "@bsd/contracts";
import {
  orderBatchCostPrice,
  orderFundingPreview,
  orderJoinsLatestBatch,
  pieceFromCarton,
  sumQuantities,
  toBaseQuantity,
  toDecimal,
} from "@bsd/domain";
import { t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import {
  CartonQty,
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
import {
  CellInput,
  clean,
  pairFromCarton,
  pairFromPiece,
  pairOf,
  PriceCells,
  type PricePair,
} from "./daily-kit";

/**
 * The company order (D57, D68): per product the paid cartons + pieces, the purchase and sale
 * price (per carton or per piece, each filling the other) and the free goods the company gives
 * with it. The prices start at the product's latest batch; changed purchase/sale or a free mix
 * that changes effective piece cost makes a new batch. Free goods stay on that order's batch.
 */
type Row = {
  cartons: string;
  pieces: string;
  freeCartons: string;
  freePieces: string;
  buy?: PricePair;
  sale?: PricePair;
};
const thCenter = `${thClass} text-center`;
const tdCenter = `${tdClass} text-center`;
const freeTint = "bg-surface-muted/50";
const emptyRow: Row = { cartons: "", pieces: "", freeCartons: "", freePieces: "" };
const whole = /^\d+$/;
const amount = /^\d+(\.\d{1,2})?$/;
const unitPrice = /^\d+(\.\d{1,6})?$/;

type Product = DayView["products"][number];

/** The product's latest batch: the prices the next order starts from. */
const latestLot = (product: Product) => product.lots.at(-1);

const defaultBuy = (product: Product) =>
  pairOf(
    latestLot(product)?.costPrice ?? product.orderPrice ?? product.costPrice,
    product.piecesPerCarton,
  );

const defaultSale = (product: Product) =>
  pairOf(latestLot(product)?.salePrice ?? product.salePrice, product.piecesPerCarton);

type Draft =
  | { error: string }
  | {
      paid: string;
      free: string;
      rate: string;
      salePrice: string;
      bill: ReturnType<typeof toDecimal>;
      /** Effective cost per piece = bill ÷ (paid + free); equals nominal when no free goods. */
      effectivePieceCost: ReturnType<typeof toDecimal>;
      hasFree: boolean;
      /** The order's batch number when the prices match the latest batch, else null (new). */
      batchSeq: number | null;
    };

export function OrderForm({
  companyId,
  date,
  view,
  fundFrom,
  setFundFrom,
}: {
  companyId: string;
  date: string;
  view: DayView;
  /** The balances that pay the order first; chosen in the page header (D63). */
  fundFrom: OrderFund[];
  setFundFrom: (value: OrderFund[]) => void;
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
    const rate = clean((row.buy ?? defaultBuy(product)).carton);
    const salePrice = clean((row.sale ?? defaultSale(product)).piece);
    if (!amount.test(rate) || !unitPrice.test(salePrice)) {
      return { error: t("godown.order.priceMissing") };
    }
    const bill =
      paid === "0" ? toDecimal("0") : toDecimal(paid).mul(rate).div(product.piecesPerCarton);
    const hasFree = toDecimal(free).gt(0);
    // D68: batch cost = bill ÷ (paid + free) when free > 0, else carton rate ÷ ppc.
    const batchCost =
      orderBatchCostPrice({
        paid,
        free,
        cartonRate: rate,
        piecesPerCarton: product.piecesPerCarton,
      }) ?? pieceFromCarton(rate, product.piecesPerCarton);
    const effectivePieceCost = toDecimal(batchCost);
    const lot = latestLot(product);
    const same = orderJoinsLatestBatch(lot, {
      paid,
      free,
      cartonRate: rate,
      piecesPerCarton: product.piecesPerCarton,
      salePrice,
    });
    return {
      paid,
      free,
      rate,
      salePrice,
      bill,
      effectivePieceCost,
      hasFree,
      batchSeq: same && lot ? lot.seq : null,
    };
  }

  function request(): StockEntryPostRequest | string {
    const lines: StockEntryPostRequest["lines"] = [];
    for (const product of view.products) {
      const draft = draftOf(product);
      if (!draft) continue;
      if ("error" in draft) return `${product.productName}: ${draft.error}`;
      lines.push({
        kind: "order",
        productId: product.productId,
        pieces: draft.paid,
        freePieces: draft.free,
        cartonRate: draft.rate,
        salePrice: draft.salePrice,
      });
    }
    if (lines.length === 0) return t("godown.nothing");
    return { date, lines, prices: [], fundFrom };
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
      setFundFrom([]);
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
  const split = company
    ? orderFundingPreview(orderBill.toString(), fundFrom, {
        damage: company.damageBalance,
        incentive: company.incentiveBalance,
      })
    : null;
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
        <div
          role={overBalance ? "alert" : undefined}
          className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm ${
            overBalance ? "border-warning/40 bg-warning/10" : "border-border bg-surface"
          }`}
        >
          <p>
            {t("godown.company.orderTotal")}: <strong>{money(orderBill.toString())}</strong>
            {overBalance ? ` — ${t("godown.company.warning")}` : ""}
          </p>
          {split && fundFrom.length ? (
            <p className="text-text-muted">
              {t("report.line.company.orderFromDamage")}: {money(split.damage)} ·{" "}
              {t("report.line.company.orderFromIncentive")}: {money(split.incentive)} ·{" "}
              {t("report.line.company.orderFromDeposit")}: {money(split.deposit)}
            </p>
          ) : null}
        </div>
      ) : null}
      <TableSummary label={t("table.summary")} items={summary} />
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" rowSpan={2} className={`${thClass} ${stickyHead}`}>
                {t("godown.column.product")}
              </th>
              <th scope="col" colSpan={2} className={`${thCenter} border-b border-l border-border`}>
                {t("godown.order.paidGroup")}
              </th>
              <th scope="col" colSpan={2} className={`${thCenter} border-b border-l border-border`}>
                {t("godown.order.freeGroup")}
              </th>
              <th scope="col" colSpan={2} className={`${thCenter} border-b border-l border-border`}>
                {t("godown.order.purchaseGroup")}
              </th>
              <th scope="col" colSpan={2} className={`${thCenter} border-b border-l border-border`}>
                {t("godown.order.saleGroup")}
              </th>
              <th scope="col" rowSpan={2} className={`${thNum} border-l border-border`}>
                {t("godown.order.bill")}
              </th>
              <th scope="col" rowSpan={2} className={thCenter}>
                {t("godown.order.batch")}
              </th>
              <th scope="col" rowSpan={2} className={`${thNum} whitespace-nowrap`}>
                {t("godown.order.due")}
                <span className="block text-[10.5px] font-normal text-text-subtle">
                  {t("common.cartonPiece")}
                </span>
              </th>
            </tr>
            <tr>
              <th scope="col" className={`${thCenter} border-l border-border`}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={thCenter}>
                {t("godown.column.pieces")}
              </th>
              <th scope="col" className={`${thCenter} border-l border-border`}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={thCenter}>
                {t("godown.column.pieces")}
              </th>
              <th scope="col" className={`${thCenter} border-l border-border`}>
                {t("godown.price.carton")}
              </th>
              <th scope="col" className={thCenter}>
                {t("godown.price.piece")}
              </th>
              <th scope="col" className={`${thCenter} border-l border-border`}>
                {t("godown.price.carton")}
              </th>
              <th scope="col" className={thCenter}>
                {t("godown.price.piece")}
              </th>
            </tr>
          </thead>
          <tbody>
            {drafts.map(({ product, draft }) => {
              const row = rows[product.productId] ?? emptyRow;
              const label = product.productName;
              const preview = draft && !("error" in draft) ? draft : null;
              const wrong = draft !== null && "error" in draft;
              return (
                <tr key={product.productId} className="border-t border-border">
                  <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                    <div>{product.productName}</div>
                    <div className="text-xs font-normal text-text-muted">
                      {product.sku} · {t("godown.column.size")} {quantity(product.piecesPerCarton)}
                    </div>
                  </th>
                  <td className={`${tdCenter} border-l border-border`}>
                    <CellInput
                      label={`${label} ${t("godown.column.cartons")}`}
                      placeholder={t("godown.column.cartons")}
                      value={row.cartons}
                      onChange={(cartons) => set(product.productId, { cartons })}
                      width="w-16"
                    />
                  </td>
                  <td className={tdCenter}>
                    <CellInput
                      label={`${label} ${t("godown.column.pieces")}`}
                      placeholder={t("godown.column.pieces")}
                      value={row.pieces}
                      onChange={(pieces) => set(product.productId, { pieces })}
                      width="w-16"
                    />
                  </td>
                  <td className={`${tdCenter} ${freeTint} border-l border-border`}>
                    <CellInput
                      label={`${label} ${t("godown.order.free")} ${t("godown.column.cartons")}`}
                      placeholder={t("godown.column.cartons")}
                      value={row.freeCartons}
                      onChange={(freeCartons) => set(product.productId, { freeCartons })}
                      width="w-16"
                    />
                  </td>
                  <td className={`${tdCenter} ${freeTint}`}>
                    <CellInput
                      label={`${label} ${t("godown.order.free")} ${t("godown.column.pieces")}`}
                      placeholder={t("godown.column.pieces")}
                      value={row.freePieces}
                      onChange={(freePieces) => set(product.productId, { freePieces })}
                      width="w-16"
                    />
                  </td>
                  <td className={`${tdClass} border-l border-border text-center`}>
                    <CellInput
                      label={`${label} ${t("godown.order.purchaseGroup")} ${t("godown.price.carton")}`}
                      placeholder="৳"
                      value={(row.buy ?? defaultBuy(product)).carton}
                      onChange={(carton) =>
                        set(product.productId, {
                          buy: pairFromCarton(carton, product.piecesPerCarton),
                        })
                      }
                      invalid={wrong}
                      mode="decimal"
                      width="w-24"
                    />
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <CellInput
                      label={`${label} ${t("godown.order.purchaseGroup")} ${t("godown.price.piece")}`}
                      placeholder="৳"
                      value={
                        preview?.hasFree
                          ? preview.effectivePieceCost.toDecimalPlaces(6).toFixed()
                          : (row.buy ?? defaultBuy(product)).piece
                      }
                      onChange={(piece) =>
                        set(product.productId, {
                          buy: pairFromPiece(piece, product.piecesPerCarton),
                        })
                      }
                      disabled={preview?.hasFree ?? false}
                      invalid={wrong}
                      mode="decimal"
                      width="w-24"
                    />
                  </td>
                  <PriceCells
                    label={`${label} ${t("godown.order.saleGroup")}`}
                    value={row.sale ?? defaultSale(product)}
                    piecesPerCarton={product.piecesPerCarton}
                    onChange={(sale) => set(product.productId, { sale })}
                    invalid={wrong}
                    className="border-l border-border"
                  />
                  <td className={`${tdNum} border-l border-border`}>
                    {preview ? (
                      <span>{money(preview.bill.toString())}</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className={`${tdCenter} whitespace-nowrap`}>
                    {preview ? (
                      preview.batchSeq === null ? (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium">
                          {t("godown.order.newBatch")}
                        </span>
                      ) : (
                        `${t("godown.order.batch")} ${quantity(String(preview.batchSeq))}`
                      )
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
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
        {t("godown.quantityHint")} {t("godown.order.hint")} {t("godown.order.batchHint")}
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
