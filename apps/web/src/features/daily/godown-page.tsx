"use client";

import type { DayView, PriceKind, StockEntryKind, StockEntryPostRequest } from "@bsd/contracts";
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
import { StatTile } from "@/components/stat-tile";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  usePostStockEntries,
  useReverseStockEntry,
  useStockEntries,
  useUpdateCompany,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  CellInput,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  clean,
  useWorkingDate,
} from "./daily-kit";
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

/** Which price each godown screen can change from its date (Excel's carry-forward columns). */
const PRICES: Record<StockEntryKind, PriceKind[]> = {
  order: ["order"],
  receipt: ["cost", "sale"],
  damage: [],
  incentive: [],
};
const PRICE_FIELD = { order: "orderPrice", cost: "costPrice", sale: "salePrice" } as const;

/** A receipt is one batch: its purchase and sale price apply from that day (D29). */
const PRICE_LABEL: Record<StockEntryKind, Partial<Record<PriceKind, TranslationKey>>> = {
  order: { order: "godown.column.orderPrice" },
  receipt: { cost: "godown.column.batchCostPrice", sale: "godown.column.batchSalePrice" },
  damage: {},
  incentive: {},
};

/** The day's posted quantity of each screen's kind, from the engine's product rows. */
const POSTED_FIELD = {
  order: "ordered",
  receipt: "received",
  damage: "damaged",
  incentive: "incentiveReceived",
} as const satisfies Record<StockEntryKind, string>;
const POSTED_LABEL: Record<StockEntryKind, TranslationKey> = {
  order: "day.column.ordered",
  receipt: "day.column.received",
  damage: "day.column.damaged",
  incentive: "day.column.freeGoods",
};

type Row = { cartons: string; pieces: string } & Partial<Record<PriceKind, string>>;
const emptyRow: Row = { cartons: "", pieces: "" };

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
            {t("batch.label")} {formatCount(b.seq)} · {formatCount(b.quantity)} {t("common.pieces")}{" "}
            @{" "}
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
  kind: StockEntryKind;
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
  // D48: an order is billed at once; warn (never block) when its bill exceeds the company balance.
  const company = kind === "order" ? view.company : null;
  const orderBill = company
    ? view.products.reduce((total, product) => {
        const line = entering.find((l) => l.productId === product.productId);
        if (!line) return total;
        const typed = clean(rows[product.productId]?.order ?? "");
        const price = /^\d+(\.\d+)?$/.test(typed) ? typed : (product.orderPrice ?? "0");
        return total.add(toDecimal(line.pieces).mul(price));
      }, toDecimal("0"))
    : null;
  const overBalance = company && orderBill ? orderBill.gt(toDecimal(company.balance)) : false;
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
      {company && orderBill && orderBill.gt(0) ? (
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
      {kind === "receipt" && prices.length ? (
        <p className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm">
          {t("godown.batchHint")}
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
              <ColumnHead
                label={t(kind === "order" ? "godown.column.due" : "godown.column.stock")}
                quantity
              />
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
                        {product.sku} · {t("godown.column.size")}{" "}
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
                    <td className={tdNum}>
                      <CartonQty
                        pieces={kind === "order" ? product.dueFromCompany : product.stock}
                        piecesPerCarton={product.piecesPerCarton}
                      />
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

/** The day's posted entries of a kind as cards, shown above the entry form. */
function PostedSummary({
  companyId,
  date,
  kind,
}: {
  companyId: string;
  date: string;
  kind: StockEntryKind;
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
  kind: StockEntryKind;
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

const TITLES: Record<StockEntryKind, { title: TranslationKey; description: TranslationKey }> = {
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

export function GodownPage({ path, kind }: { path: string; kind: StockEntryKind }) {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  return (
    <NavGate path={path}>
      <PageHeader
        title={t(TITLES[kind].title)}
        description={t(TITLES[kind].description)}
        actions={<DateBar date={date} onChange={setDate} />}
      />
      {kind === "receipt" ? <StockBlockSwitch /> : null}
      <DateHeading date={date} />
      <DayGate companyId={company.id} date={date}>
        {(view) => (
          <>
            <PostedSummary companyId={company.id} date={date} kind={kind} />
            <GodownForm key={date} companyId={company.id} date={date} kind={kind} view={view} />
            <PostedEntries companyId={company.id} date={date} kind={kind} view={view} />
            {kind === "receipt" ? (
              <section className="mt-10 flex flex-col gap-2">
                <h2 className="text-base font-semibold">{t(TITLES.incentive.title)}</h2>
                <p className="text-sm text-text-muted">{t(TITLES.incentive.description)}</p>
                <PostedSummary companyId={company.id} date={date} kind="incentive" />
                <GodownForm
                  key={`incentive-${date}`}
                  companyId={company.id}
                  date={date}
                  kind="incentive"
                  view={view}
                />
                <PostedEntries companyId={company.id} date={date} kind="incentive" view={view} />
              </section>
            ) : null}
          </>
        )}
      </DayGate>
    </NavGate>
  );
}
