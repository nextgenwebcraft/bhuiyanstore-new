"use client";

import type {
  DayView,
  PriceKind,
  StockEntry,
  StockEntryKind,
  StockEntryPostRequest,
  OrderFund,
} from "@bsd/contracts";
import { EmptyListNote } from "@/components/empty-list-note";
import { ReverseCell } from "@/components/reverse-cell";
import { useAsyncAction } from "@/lib/async-action";
import { sumQuantities, toBaseQuantity, toDecimal } from "@bsd/domain";
import { formatCount, formatRate, t, type TranslationKey } from "@bsd/i18n";
import { Fragment, useState } from "react";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  usePostStockEntries,
  useReverseStockEntry,
  useStockEntries,
  useUpdateCompany,
  useDayView,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { CellInput, DateBar, DayGate, SectionTitle, clean, useWorkingDate } from "./daily-kit";
import {
  CartonQty,
  ColumnHead,
  StatusChip,
  quantity,
  stickyCell,
  stickyHead,
  money,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { visibleBatches } from "./day-report-page";
import { OrderForm } from "./order-form";
import { OrderFunding } from "./order-funding";

/** D63: damage deposits are entered on the company deposit page, not here. */
type GodownKind = Exclude<StockEntryKind, "damageDeposit">;

/** Which price each godown screen can change from its date (Excel's carry-forward columns). */
const PRICES: Record<GodownKind, PriceKind[]> = {
  // D57: an order sets its carton rate on the order line; a receipt's cost comes from the order.
  order: [],
  receipt: ["sale"],
  damage: [],
  incentive: [],
};
const PRICE_FIELD = { order: "orderPrice", cost: "costPrice", sale: "salePrice" } as const;

/** A receipt is one batch: its purchase and sale price apply from that day (D29). */
const PRICE_LABEL: Record<GodownKind, Partial<Record<PriceKind, TranslationKey>>> = {
  order: { order: "godown.column.orderPrice" },
  receipt: { sale: "godown.column.batchSalePrice" },
  damage: {},
  incentive: {},
};

/** The day's posted quantity of each screen's kind, from the engine's product rows. */
const POSTED_FIELD = {
  order: "ordered",
  receipt: "received",
  damage: "damaged",
  incentive: "incentiveReceived",
} as const satisfies Record<GodownKind, string>;
const POSTED_LABEL: Record<GodownKind, TranslationKey> = {
  order: "day.column.ordered",
  receipt: "day.column.received",
  damage: "day.column.damaged",
  incentive: "day.column.freeGoods",
};

type Row = { cartons: string; pieces: string } & Partial<Record<PriceKind, string>>;
const emptyRow: Row = { cartons: "", pieces: "" };

/**
 * D57: the receipt's cost per piece is the average of the goods still due (their billed value Ã·
 * pieces, free pieces counted); shown read-only. Blank when nothing is due.
 */
function orderCost(product: DayView["products"][number]): string {
  const due = toDecimal(product.dueFromCompany);
  if (due.lte(0)) return "";
  return `${t("batch.currency")}${formatRate(
    toDecimal(product.dueFromCompanyValue).div(due).toDecimalPlaces(4).toString(),
  )}`;
}

/** The product's live batches, one line each, collapsed under the product name (D49). */
function CurrentBatches({ product }: { product: DayView["products"][number] }) {
  const batches = visibleBatches(product);
  if (batches.length === 0) return null;
  return (
    <details className="mt-1 text-xs font-normal text-text-muted">
      <summary className="cursor-pointer">{t("batch.current")}</summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {batches.map((b) => (
          <li key={b.seq}>
            {t("batch.label")} {formatCount(b.seq)} Â· {formatCount(b.quantity)}{" "}
            {t("common.pieces")} @{" "}
            {b.costPrice === null
              ? ""
              : `${t("batch.costShort")} ${t("batch.currency")}${formatRate(b.costPrice)} / `}
            {t("batch.saleShort")} {t("batch.currency")}
            {formatRate(b.salePrice)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function GodownForm({
  companyId,
  date,
  kind,
  view,
}: {
  companyId: string;
  date: string;
  kind: GodownKind;
  view: DayView;
}) {
  const { permissions } = useCurrentWorkspace();
  const post = usePostStockEntries(companyId);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const canPrice = permissions.includes("product.edit");
  const prices = canPrice ? PRICES[kind] : [];

  const set = (productId: string, patch: Partial<Row>) => {
    setDone(false);
    setRows((current) => ({
      ...current,
      [productId]: { ...(current[productId] ?? emptyRow), ...patch },
    }));
  };

  function request(): StockEntryPostRequest | string {
    const lines: StockEntryPostRequest["lines"] = [];
    const priceLines: NonNullable<StockEntryPostRequest["prices"]> = [];
    for (const product of view.products) {
      const row = rows[product.productId];
      if (!row) continue;
      const cartons = clean(row.cartons) || "0";
      const pieces = clean(row.pieces) || "0";
      if (!/^\d+$/.test(cartons) || !/^\d+$/.test(pieces)) return t("validation.wholeNumber");
      const total = toBaseQuantity(cartons, pieces, product.piecesPerCarton);
      if (total !== "0") {
        lines.push({ kind, productId: product.productId, pieces: total });
      }
      for (const priceKind of prices) {
        const value = clean(row[priceKind] ?? "");
        if (value) priceLines.push({ productId: product.productId, kind: priceKind, price: value });
      }
    }
    if (lines.length + priceLines.length === 0) return t("godown.nothing");
    return { date, lines, prices: priceLines };
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

  if (view.products.length === 0) return <StatePanel title={t("product.empty")} />;
  const draft = request();
  const entering = typeof draft === "string" ? [] : (draft.lines ?? []);
  const summary: SummaryItem[] = [
    { label: t("table.summary.products"), value: quantity(String(view.products.length)) },
    { label: t("godown.summary.entering"), value: quantity(String(entering.length)) },
    {
      label: `${t("godown.summary.enteringPieces")} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(entering.map((l) => l.pieces))),
    },
    {
      label: `${t(POSTED_LABEL[kind])} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(view.products.map((p) => p[POSTED_FIELD[kind]]))),
      emphasis: true,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <TableSummary label={t("table.summary")} items={summary} />
      {kind === "receipt" && prices.length ? (
        <p className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm">
          {t("godown.receipt.costHint")}
          <span className="mt-1 block text-text-muted">{t("batch.receiptHint")}</span>
        </p>
      ) : null}
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={`${thClass} ${stickyHead}`}>
                {t("godown.column.product")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.column.pieces")}
              </th>
              {prices.map((p) => (
                <th key={p} scope="col" className={thNum}>
                  {t(PRICE_LABEL[kind][p] ?? (`godown.column.${p}Price` as TranslationKey))}
                </th>
              ))}
              {kind === "receipt" ? (
                <ColumnHead label={t("godown.receipt.costByOrder")} quantity />
              ) : null}
              <ColumnHead label={t("godown.column.stock")} quantity />
            </tr>
          </thead>
          <tbody>
            {view.products.map((product) => {
              const row = rows[product.productId] ?? emptyRow;
              return (
                <Fragment key={product.productId}>
                  <tr className="border-t border-border">
                    <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                      <div>{product.productName}</div>
                      <div className="text-xs font-normal text-text-muted">
                        {product.sku} Â· {t("godown.column.size")}{" "}
                        {quantity(product.piecesPerCarton)}
                      </div>
                      {kind === "receipt" ? <CurrentBatches product={product} /> : null}
                    </th>
                    <td className={tdNum}>
                      <CellInput
                        label={`${product.productName} ${t("godown.column.cartons")}`}
                        value={row.cartons}
                        onChange={(cartons) => set(product.productId, { cartons })}
                        width="w-16"
                      />
                    </td>
                    <td className={tdNum}>
                      <CellInput
                        label={`${product.productName} ${t("godown.column.pieces")}`}
                        value={row.pieces}
                        onChange={(pieces) => set(product.productId, { pieces })}
                        width="w-16"
                      />
                    </td>
                    {prices.map((p) => {
                      const current = product[PRICE_FIELD[p]];
                      return (
                        <td key={p} className={tdNum}>
                          <CellInput
                            label={`${product.productName} ${t(`godown.column.${p}Price` as TranslationKey)}`}
                            value={row[p] ?? ""}
                            placeholder={current ? formatRate(current) : undefined}
                            onChange={(value) => set(product.productId, { [p]: value })}
                            mode="decimal"
                            width="w-24"
                          />
                        </td>
                      );
                    })}
                    {kind === "receipt" ? <td className={tdNum}>{orderCost(product)}</td> : null}
                    <td className={tdNum}>
                      <CartonQty pieces={product.stock} piecesPerCarton={product.piecesPerCarton} />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-text-muted">
        {t("godown.quantityHint")} {prices.length ? t("godown.priceHint") : ""}
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

/** An order's bill: paid pieces Ã— carton rate Ã· the carton size at posting (D57). */
function orderBill(entry: StockEntry): string {
  if (entry.cartonRate === null || entry.piecesPerCarton === null) return "0";
  return toDecimal(entry.pieces)
    .mul(entry.cartonRate)
    .div(entry.piecesPerCarton)
    .toDecimalPlaces(2)
    .toString();
}

/** The day's posted entries of a kind as cards, shown above the entry form. */
function PostedSummary({
  companyId,
  date,
  kind,
}: {
  companyId: string;
  date: string;
  kind: GodownKind;
}) {
  const entries = useStockEntries(companyId, date);
  const rows = (entries.data ?? []).filter((e) => e.kind === kind);
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-text-muted">{t("godown.posted.title")}</h3>
      <TableSummary
        label={t("godown.posted.title")}
        items={[
          { label: t("table.summary.rows"), value: quantity(String(rows.length)) },
          {
            label: `${t("godown.summary.postedPieces")} (${t("godown.column.pieces")})`,
            value: quantity(
              sumQuantities(rows.filter((e) => e.status === "posted").map((e) => e.pieces)),
            ),
            emphasis: true,
          },
        ]}
      />
    </div>
  );
}

function PostedEntries({
  companyId,
  date,
  kind,
  view,
}: {
  companyId: string;
  date: string;
  kind: GodownKind;
  view: DayView;
}) {
  const { permissions } = useCurrentWorkspace();
  const entries = useStockEntries(companyId, date);
  const reverse = useReverseStockEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("purchase.reverse");
  const sizes = new Map(view.products.map((p) => [p.productId, p.piecesPerCarton]));
  const rows = (entries.data ?? []).filter((e) => e.kind === kind);

  return (
    <>
      <SectionTitle>{t("godown.posted.title")}</SectionTitle>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
      {entries.isPending ? (
        <TableSkeleton rows={3} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyListNote textKey="godown.posted.empty" />
      ) : (
        <>
          <TableScroller>
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={`${thClass} ${stickyHead}`}>
                    {t("godown.column.product")}
                  </th>
                  <ColumnHead label={t("godown.column.quantity")} quantity />
                  {kind === "order" ? (
                    <>
                      <ColumnHead label={t("godown.posted.free")} quantity />
                      <ColumnHead label={t("godown.posted.rate")} quantity />
                      <ColumnHead label={t("godown.posted.bill")} quantity />
                    </>
                  ) : null}
                  <th scope="col" className={thClass}>
                    {t("common.status")}
                  </th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">{t("common.reverse")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className={`${tdClass} ${stickyCell}`}>{entry.productName}</td>
                    <td className={tdNum}>
                      <CartonQty
                        pieces={entry.pieces}
                        piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                      />
                    </td>
                    {kind === "order" ? (
                      <>
                        <td className={tdNum}>
                          <CartonQty
                            pieces={entry.freePieces ?? "0"}
                            piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                          />
                        </td>
                        <td className={tdNum}>
                          {entry.cartonRate === null ? "" : money(entry.cartonRate)}
                        </td>
                        <td className={tdNum}>{money(orderBill(entry))}</td>
                      </>
                    ) : null}
                    <td className={tdClass}>
                      <StatusChip status={entry.status} />
                    </td>
                    <ReverseCell
                      canReverse={canReverse}
                      posted={entry.status === "posted"}
                      pending={reverse.isPending}
                      onReverse={() =>
                        void action.run(() => reverse.mutateAsync(entry.id), {
                          confirm: "godown.reverseConfirm",
                        })
                      }
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </>
      )}
    </>
  );
}

const TITLES: Record<GodownKind, { title: TranslationKey; description: TranslationKey }> = {
  order: { title: "nav.purchases.orders", description: "godown.description.order" },
  receipt: { title: "nav.purchases.receipts", description: "godown.description.receipt" },
  damage: { title: "nav.inventory.damage", description: "godown.description.damage" },
  incentive: { title: "godown.freeGoods.title", description: "godown.freeGoods.hint" },
};

/** D34 switch: refuse postings that would take stock below zero. */
function StockBlockSwitch() {
  const { company, permissions } = useCurrentWorkspace();
  const update = useUpdateCompany(company.id);
  const [error, setError] = useState<string | undefined>();
  if (!permissions.includes("company.manage")) return null;
  const on = company.blockNegativeStock;

  async function toggle() {
    setError(undefined);
    try {
      await update.mutateAsync({
        name: company.name,
        theme: company.theme,
        modules: company.modules,
        blockNegativeStock: !on,
      });
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={update.isPending}
          onChange={() => void toggle()}
          className="mt-1"
        />
        <span>
          <span className="font-medium">{t("godown.block.label")}</span>
          <span className="block text-text-muted">{t("godown.block.hint")}</span>
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function GodownPage({ path, kind }: { path: string; kind: GodownKind }) {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const [fundFrom, setFundFrom] = useState<OrderFund[]>([]);
  const day = useDayView(company.id, date);
  const funding = kind === "order" ? day.data?.company : undefined;
  return (
    <NavGate path={path}>
      <PageHeader
        title={t(TITLES[kind].title)}
        description={t(TITLES[kind].description)}
        actions={
          <>
            <DateBar date={date} onChange={setDate} />
            {funding ? (
              <OrderFunding
                value={fundFrom}
                balances={{ damage: funding.damageBalance, incentive: funding.incentiveBalance }}
                onChange={setFundFrom}
              />
            ) : null}
          </>
        }
      />
      {kind === "receipt" ? <StockBlockSwitch /> : null}
      <DayGate companyId={company.id} date={date}>
        {(view) => (
          <>
            <PostedSummary companyId={company.id} date={date} kind={kind} />
            {kind === "order" ? (
              <OrderForm
                key={date}
                companyId={company.id}
                date={date}
                view={view}
                fundFrom={fundFrom}
                setFundFrom={setFundFrom}
              />
            ) : (
              <GodownForm key={date} companyId={company.id} date={date} kind={kind} view={view} />
            )}
            <PostedEntries companyId={company.id} date={date} kind={kind} view={view} />
          </>
        )}
      </DayGate>
    </NavGate>
  );
}
