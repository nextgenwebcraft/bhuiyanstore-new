"use client";

import type { DayView, ProductLot, StockEntryPostRequest } from "@bsd/contracts";
import { sumAmounts, sumQuantities, toBaseQuantity, toDecimal } from "@bsd/domain";
import { formatRate, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import {
  CartonQty,
  cartonText,
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
import { inputClass } from "@/components/field";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import { usePostStockEntries } from "@/data/queries";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { batchName, CellInput, clean, pairOf, PriceCells, type PricePair } from "./daily-kit";

/**
 * Receiving ordered goods (D68, D118, D125): one row per batch that still has order/free due.
 * Batches with nothing due are not listed. A secondary row can be hidden with × and restored
 * with “+ আরেক ব্যাচ” under the product name. Paid and free are entered separately; neither may
 * exceed its due. Manager cannot reprice; Super Admin may.
 */
type Product = DayView["products"][number];
type Edit = {
  batchId?: string | undefined;
  cartons?: string;
  pieces?: string;
  freeCartons?: string;
  freePieces?: string;
  buy?: PricePair | undefined;
  sale?: PricePair | undefined;
};
type Line = {
  key: string;
  product: Product;
  lots: ProductLot[];
  lot: ProductLot;
  /** The product's first line; the others were added for a second batch. */
  first: boolean;
  cartons: string;
  pieces: string;
  freeCartons: string;
  freePieces: string;
  buy: PricePair;
  sale: PricePair;
};
type PostLine = NonNullable<StockEntryPostRequest["lines"]>[number];
type Draft =
  | { error: string }
  | { pieces: string; free: string; costAmount: string; line: PostLine };

const whole = /^\d+$/;
const unitPrice = /^\d+(\.\d{1,6})?$/;
const thCenter = `${thClass} text-center`;
const freeTint = "bg-surface-muted/50";

const dueLots = (product: Product) =>
  product.lots.filter((lot) => toDecimal(lot.undelivered).gt(0));

function lotLabel(lot: ProductLot, piecesPerCarton: string, showCost: boolean): string {
  const parts = [
    batchName(lot),
    `${t("godown.receipt.due")} ${cartonText(lot.undeliveredPaid, piecesPerCarton)}`,
  ];
  if (toDecimal(lot.undeliveredFree).gt(0)) {
    parts.push(
      `${t("godown.receipt.freeDue")} ${cartonText(lot.undeliveredFree, piecesPerCarton)}`,
    );
  }
  if (showCost && lot.costPrice !== null) {
    parts.push(`${t("batch.costShort")} ${t("batch.currency")}${formatRate(lot.costPrice)}`);
  }
  return parts.join(" · ");
}

function ReadPriceCells({
  label,
  value,
  className = "",
}: {
  label: string;
  value: PricePair;
  className?: string;
}) {
  return (
    <>
      <td className={`${tdNum} ${className}`} title={`${label} ${t("godown.price.carton")}`}>
        {value.carton ? formatRate(value.carton) : "—"}
      </td>
      <td className={tdNum} title={`${label} ${t("godown.price.piece")}`}>
        {value.piece ? formatRate(value.piece) : "—"}
      </td>
    </>
  );
}

export function ReceiptForm({
  companyId,
  date,
  view,
}: {
  companyId: string;
  date: string;
  view: DayView;
}) {
  const { loginRoleKind } = useCurrentWorkspace();
  const post = usePostStockEntries(companyId);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  /** Due-batch rows the user hid with ×; “+ আরেক ব্যাচ” brings one back. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const showCost = view.canSeeCost;
  /** Super Admin alone may change batch rates on receive; Manager sees them read-only. */
  const canEditPrices = loginRoleKind === null;

  const edit = (key: string, patch: Edit) => {
    setDone(false);
    setEdits((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  /** Stable row key for a due lot: the product's first lot uses productId (D125). */
  const dueKey = (productId: string, lotId: string, index: number) =>
    index === 0 ? productId : `${productId}#due:${lotId}`;

  /**
   * One row per due batch (D125/D68). Only batches with order/free due appear. Hiding a row
   * with × and restoring with “+ আরেক ব্যাচ” under the product name keeps the day-sheet pattern.
   */
  const lines: Line[] = view.products.flatMap((product) => {
    const lots = dueLots(product);
    if (lots.length === 0) return [];
    const keys = lots
      .map((lot, index) => dueKey(product.productId, lot.id, index))
      .filter((key) => !hidden.has(key));
    const used = new Set<string>();
    return keys.flatMap((key, index) => {
      const own = edits[key] ?? {};
      const preferredId = key.includes("#due:") ? key.slice(key.indexOf("#due:") + 5) : undefined;
      const lot =
        lots.find((l) => l.id === own.batchId && !used.has(l.id)) ??
        (preferredId
          ? lots.find((l) => l.id === preferredId && !used.has(l.id))
          : undefined) ??
        lots.find((l) => !used.has(l.id)) ??
        lots[0];
      if (!lot) return [];
      used.add(lot.id);
      return {
        key,
        product,
        lots,
        lot,
        first: index === 0,
        cartons: own.cartons ?? "",
        pieces: own.pieces ?? "",
        freeCartons: own.freeCartons ?? "",
        freePieces: own.freePieces ?? "",
        buy: own.buy ?? pairOf(lot.costPrice, product.piecesPerCarton),
        sale: own.sale ?? pairOf(lot.salePrice, product.piecesPerCarton),
      };
    });
  });

  /** Each line's request, or a message; null when the line is empty. Checks paid/free due. */
  function draftsOf(): Map<string, Draft | null> {
    const takenPaid = new Map<string, ReturnType<typeof toDecimal>>();
    const takenFree = new Map<string, ReturnType<typeof toDecimal>>();
    const out = new Map<string, Draft | null>();
    for (const line of lines) {
      const [cartons, pieces, freeCartons, freePieces] = [
        line.cartons,
        line.pieces,
        line.freeCartons,
        line.freePieces,
      ].map((v) => clean(v) || "0") as [string, string, string, string];
      if (![cartons, pieces, freeCartons, freePieces].every((v) => whole.test(v))) {
        out.set(line.key, { error: t("validation.wholeNumber") });
        continue;
      }
      const paid = toBaseQuantity(cartons, pieces, line.product.piecesPerCarton);
      const free = toBaseQuantity(freeCartons, freePieces, line.product.piecesPerCarton);
      if (paid === "0" && free === "0") {
        out.set(line.key, null);
        continue;
      }
      const paidSum = (takenPaid.get(line.lot.id) ?? toDecimal("0")).add(paid);
      const freeSum = (takenFree.get(line.lot.id) ?? toDecimal("0")).add(free);
      takenPaid.set(line.lot.id, paidSum);
      takenFree.set(line.lot.id, freeSum);
      if (paidSum.gt(toDecimal(line.lot.undeliveredPaid))) {
        out.set(line.key, { error: t("godown.receipt.overDue") });
        continue;
      }
      if (freeSum.gt(toDecimal(line.lot.undeliveredFree))) {
        out.set(line.key, { error: t("godown.receipt.overDue") });
        continue;
      }
      const salePrice = clean(line.sale.piece);
      const costPrice = clean(line.buy.piece);
      if (!unitPrice.test(salePrice) || (showCost && !unitPrice.test(costPrice))) {
        out.set(line.key, { error: t("godown.order.priceMissing") });
        continue;
      }
      const costAmount =
        showCost && unitPrice.test(costPrice)
          ? toDecimal(paid).add(free).mul(costPrice).toString()
          : "0";
      out.set(line.key, {
        pieces: paid,
        free,
        costAmount,
        line: {
          kind: "receipt",
          productId: line.product.productId,
          pieces: paid,
          ...(free !== "0" ? { freePieces: free } : {}),
          batchId: line.lot.id,
          ...(canEditPrices ? { salePrice, ...(showCost ? { costPrice } : {}) } : {}),
        },
      });
    }
    return out;
  }

  const drafts = draftsOf();

  function request(): StockEntryPostRequest | string {
    const posted: PostLine[] = [];
    for (const line of lines) {
      const draft = drafts.get(line.key);
      if (!draft) continue;
      if ("error" in draft) return `${line.product.productName}: ${draft.error}`;
      posted.push(draft.line);
    }
    if (posted.length === 0) return t("godown.nothing");
    return { date, lines: posted, prices: [] };
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
      setEdits({});
      setHidden(new Set());
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  if (lines.length === 0) return <StatePanel title={t("godown.receipt.noBatch")} />;
  const entering = [...drafts.values()].flatMap((d) => (d && !("error" in d) ? [d] : []));
  const enteringCost = sumAmounts(["0", ...entering.map((d) => d.costAmount)]);
  const summary: SummaryItem[] = [
    { label: t("table.summary.products"), value: quantity(String(lines.length)) },
    { label: t("godown.summary.entering"), value: quantity(String(entering.length)) },
    {
      label: `${t("godown.summary.enteringPieces")} (${t("godown.column.pieces")})`,
      value: quantity(
        sumQuantities(entering.flatMap((d) => [d.pieces, d.free === "0" ? [] : [d.free]].flat())),
      ),
    },
    {
      label: `${t("day.column.received")} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(view.products.map((p) => p.received))),
      emphasis: !showCost,
    },
    ...(showCost
      ? [
          {
            label: t("godown.summary.enteringCost"),
            value: money(enteringCost),
            emphasis: true as const,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <TableSummary label={t("table.summary")} items={summary} />
      <p className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm">
        {t("godown.receipt.batchHint")}
      </p>
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" rowSpan={2} className={`${thClass} ${stickyHead}`}>
                {t("godown.column.product")}
              </th>
              <th scope="col" rowSpan={2} className={thClass}>
                {t("godown.receipt.batch")}
              </th>
              <th
                scope="col"
                colSpan={2}
                className={`${thCenter} border-b border-l border-border`}
              >
                {t("godown.receipt.paidGroup")}
              </th>
              <th
                scope="col"
                colSpan={2}
                className={`${thCenter} border-b border-l border-border ${freeTint}`}
              >
                {t("godown.order.freeGroup")}
              </th>
              {showCost ? (
                <th
                  scope="col"
                  colSpan={2}
                  className={`${thCenter} border-b border-l border-border`}
                >
                  {t("godown.order.purchaseGroup")}
                </th>
              ) : null}
              <th scope="col" colSpan={2} className={`${thCenter} border-b border-l border-border`}>
                {t("godown.order.saleGroup")}
              </th>
              {showCost ? (
                <th scope="col" rowSpan={2} className={`${thNum} whitespace-nowrap`}>
                  {t("godown.receipt.costAmount")}
                </th>
              ) : null}
              <th scope="col" rowSpan={2} className={`${thNum} whitespace-nowrap`}>
                {t("godown.column.stock")}
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
              <th scope="col" className={`${thCenter} border-l border-border ${freeTint}`}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={`${thCenter} ${freeTint}`}>
                {t("godown.column.pieces")}
              </th>
              {(showCost ? ["buy", "sale"] : ["sale"]).map((group) => (
                <PriceHeads key={group} />
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const { product, lot } = line;
              const label = `${product.productName} ${batchName(lot)}`;
              const draft = drafts.get(line.key);
              const wrong = draft !== null && draft !== undefined && "error" in draft;
              const rows = lines.filter((l) => l.product.productId === product.productId);
              const hiddenForProduct = [...hidden].filter((key) =>
                key === product.productId || key.startsWith(`${product.productId}#`),
              );
              const canAdd = line.first && hiddenForProduct.length > 0;
              const takenIds = new Set(
                rows.filter((l) => l.key !== line.key).map((l) => l.lot.id),
              );
              const freeOff = toDecimal(lot.undeliveredFree).lte(0);
              const costAmount =
                draft && !("error" in draft) ? draft.costAmount : previewCost(line);
              return (
                <tr
                  key={line.key}
                  className={line.first ? "border-t border-border" : "border-t border-border/40"}
                >
                  <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                    {line.first ? (
                      <>
                        <div>{product.productName}</div>
                        <div className="text-xs font-normal text-text-muted">
                          {product.sku} · {t("godown.column.size")}{" "}
                          {quantity(product.piecesPerCarton)}
                        </div>
                        {canAdd ? (
                          <Button
                            className="mt-2 px-2 py-1 text-xs"
                            onClick={() => {
                              const restore = hiddenForProduct[0];
                              if (!restore) return;
                              setHidden((current) => {
                                const next = new Set(current);
                                next.delete(restore);
                                return next;
                              });
                              setDone(false);
                            }}
                          >
                            {t("dsr.sheet.addBatch")}
                          </Button>
                        ) : (
                          <div className="mt-1 text-xs font-normal text-text-muted">
                            {t("godown.receipt.noOtherBatch")}
                          </div>
                        )}
                      </>
                    ) : (
                      <Button
                        aria-label={t("dsr.sheet.removeBatch")}
                        title={t("dsr.sheet.removeBatch")}
                        className="px-2 py-1 text-xs"
                        onClick={() => {
                          setHidden((current) => new Set(current).add(line.key));
                          setEdits((current) =>
                            Object.fromEntries(
                              Object.entries(current).filter(([key]) => key !== line.key),
                            ),
                          );
                          setDone(false);
                        }}
                      >
                        ×
                      </Button>
                    )}
                  </th>
                  <td className={tdClass}>
                    <select
                      aria-label={`${product.productName} ${t("godown.receipt.batch")}`}
                      value={lot.id}
                      onChange={(event) =>
                        edit(line.key, {
                          batchId: event.target.value,
                          buy: undefined,
                          sale: undefined,
                        })
                      }
                      className={`${inputClass} min-w-56`}
                    >
                      {line.lots.map((l) => (
                        <option key={l.id} value={l.id} disabled={takenIds.has(l.id)}>
                          {lotLabel(l, product.piecesPerCarton, showCost)}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[10.5px] text-text-muted">
                      {t("godown.receipt.due")}{" "}
                      {cartonText(lot.undeliveredPaid, product.piecesPerCarton)}
                      {toDecimal(lot.undeliveredFree).gt(0) ? (
                        <>
                          {" · "}
                          {t("godown.receipt.freeDue")}{" "}
                          {cartonText(lot.undeliveredFree, product.piecesPerCarton)}
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${tdClass} border-l border-border text-center`}>
                    <CellInput
                      label={`${label} ${t("godown.receipt.paidGroup")} ${t("godown.column.cartons")}`}
                      value={line.cartons}
                      onChange={(cartons) => edit(line.key, { cartons })}
                      invalid={wrong}
                      width="w-16"
                    />
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <CellInput
                      label={`${label} ${t("godown.receipt.paidGroup")} ${t("godown.column.pieces")}`}
                      value={line.pieces}
                      onChange={(pieces) => edit(line.key, { pieces })}
                      invalid={wrong}
                      width="w-16"
                    />
                  </td>
                  <td className={`${tdClass} border-l border-border text-center ${freeTint}`}>
                    <CellInput
                      label={`${label} ${t("godown.order.free")} ${t("godown.column.cartons")}`}
                      value={line.freeCartons}
                      onChange={(freeCartons) => edit(line.key, { freeCartons })}
                      invalid={wrong}
                      disabled={freeOff}
                      width="w-16"
                    />
                  </td>
                  <td className={`${tdClass} text-center ${freeTint}`}>
                    <CellInput
                      label={`${label} ${t("godown.order.free")} ${t("godown.column.pieces")}`}
                      value={line.freePieces}
                      onChange={(freePieces) => edit(line.key, { freePieces })}
                      invalid={wrong}
                      disabled={freeOff}
                      width="w-16"
                    />
                  </td>
                  {showCost ? (
                    canEditPrices ? (
                      <PriceCells
                        label={`${label} ${t("godown.order.purchaseGroup")}`}
                        value={line.buy}
                        piecesPerCarton={product.piecesPerCarton}
                        onChange={(buy) => edit(line.key, { buy })}
                        className="border-l border-border"
                      />
                    ) : (
                      <ReadPriceCells
                        label={`${label} ${t("godown.order.purchaseGroup")}`}
                        value={line.buy}
                        className="border-l border-border"
                      />
                    )
                  ) : null}
                  {canEditPrices ? (
                    <PriceCells
                      label={`${label} ${t("godown.order.saleGroup")}`}
                      value={line.sale}
                      piecesPerCarton={product.piecesPerCarton}
                      onChange={(sale) => edit(line.key, { sale })}
                      className="border-l border-border"
                    />
                  ) : (
                    <ReadPriceCells
                      label={`${label} ${t("godown.order.saleGroup")}`}
                      value={line.sale}
                      className="border-l border-border"
                    />
                  )}
                  {showCost ? <td className={tdNum}>{money(costAmount)}</td> : null}
                  <td className={tdNum}>
                    {line.first ? (
                      <CartonQty pieces={product.stock} piecesPerCarton={product.piecesPerCarton} />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-text-muted">
        {t("godown.quantityHint")} {t("godown.receipt.freeHint")}
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

function previewCost(line: Line): string {
  const vals = [line.cartons, line.pieces, line.freeCartons, line.freePieces].map(
    (v) => clean(v) || "0",
  );
  if (!vals.every((v) => whole.test(v))) return "0";
  const costPrice = clean(line.buy.piece);
  if (!unitPrice.test(costPrice)) return "0";
  const paid = toBaseQuantity(vals[0]!, vals[1]!, line.product.piecesPerCarton);
  const free = toBaseQuantity(vals[2]!, vals[3]!, line.product.piecesPerCarton);
  return toDecimal(paid).add(free).mul(costPrice).toString();
}

function PriceHeads() {
  return (
    <>
      <th scope="col" className={`${thCenter} border-l border-border`}>
        {t("godown.price.carton")}
      </th>
      <th scope="col" className={thCenter}>
        {t("godown.price.piece")}
      </th>
    </>
  );
}
