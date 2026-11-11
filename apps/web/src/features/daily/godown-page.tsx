"use client";

import type {
  DayView,
  StockEntry,
  StockEntryKind,
  StockEntryPostRequest,
  OrderFund,
} from "@bsd/contracts";
import { EmptyListNote } from "@/components/empty-list-note";
import { ReverseCell } from "@/components/reverse-cell";
import { useAsyncAction } from "@/lib/async-action";
import { orderBatchCostPrice, sumQuantities, toBaseQuantity, toDecimal } from "@bsd/domain";
import { formatRate, t, type TranslationKey } from "@bsd/i18n";
import { Fragment, useState } from "react";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  useApprovePendingOrders,
  useDiscardPendingOrder,
  usePostStockEntries,
  useReverseStockEntry,
  useStockEntries,
  useUpdateCompany,
  useDayView,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useConfirm } from "@/components/confirm-dialog";
import {
  batchName,
  CellInput,
  DateBar,
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
import { OrderForm } from "./order-form";
import { ReceiptForm } from "./receipt-form";
import { OrderFunding } from "./order-funding";

/** D63: damage deposits are entered on the company deposit page, not here. */
type GodownKind = Exclude<StockEntryKind, "damageDeposit">;
/** Godown damage and company free goods: plain quantities, no batch or price (D68). */
type PlainKind = Exclude<GodownKind, "order" | "receipt">;

/** The day's posted quantity of each plain screen's kind, from the engine's product rows. */
const POSTED_FIELD = {
  damage: "damaged",
  incentive: "incentiveReceived",
} as const satisfies Record<PlainKind, string>;
const POSTED_LABEL: Record<PlainKind, TranslationKey> = {
  damage: "day.column.damaged",
  incentive: "day.column.freeGoods",
};

type Row = { cartons: string; pieces: string };
const emptyRow: Row = { cartons: "", pieces: "" };

function GodownForm({
  companyId,
  date,
  kind,
  view,
}: {
  companyId: string;
  date: string;
  kind: PlainKind;
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

  function request(): StockEntryPostRequest | string {
    const lines: StockEntryPostRequest["lines"] = [];
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
                        {product.sku} · {t("godown.column.size")}{" "}
                        {quantity(product.piecesPerCarton)}
                      </div>
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
      <p className="text-xs text-text-muted">{t("godown.quantityHint")}</p>
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

/** An order's bill: paid pieces × carton rate ÷ the carton size at posting (D57). */
function orderBill(entry: StockEntry): string {
  if (entry.cartonRate === null || entry.piecesPerCarton === null) return "0";
  return toDecimal(entry.pieces)
    .mul(entry.cartonRate)
    .div(entry.piecesPerCarton)
    .toDecimalPlaces(2)
    .toString();
}

/** The batch an order (paid and free pieces) or receipt went into (D68). */
function entryBatches(entry: StockEntry): string {
  return entry.batchSeq === null ? "—" : batchName({ seq: entry.batchSeq });
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
  const { permissions, loginRoleKind } = useCurrentWorkspace();
  const confirm = useConfirm();
  const entries = useStockEntries(companyId, date);
  const reverse = useReverseStockEntry(companyId);
  const approve = useApprovePendingOrders(companyId);
  const discard = useDiscardPendingOrder(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("purchase.reverse");
  const canApprove = permissions.includes("purchase.approve");
  const canDiscardPending =
    permissions.includes("purchase.create") || permissions.includes("purchase.approve");
  const sizes = new Map(view.products.map((p) => [p.productId, p.piecesPerCarton]));
  const rows = (entries.data ?? []).filter((e) => e.kind === kind);
  const pendingRows = rows.filter((e) => e.status === "pending");
  const liveRows = rows.filter((e) => e.status !== "pending");

  return (
    <>
      {kind === "order" && pendingRows.length > 0 ? (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">{t("godown.order.pending")}</h3>
              <p className="text-sm text-text-muted">{t("godown.order.pendingHint")}</p>
            </div>
            {canApprove ? (
              <Button
                variant="primary"
                disabled={approve.isPending}
                onClick={() =>
                  void (async () => {
                    const ok = await confirm({
                      message: t("godown.order.approveConfirm"),
                      confirmLabel: t("godown.order.approve"),
                    });
                    if (!ok) return;
                    await approve.mutateAsync(date);
                  })()
                }
              >
                {approve.isPending ? t("common.posting") : t("godown.order.approve")}
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {pendingRows.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {entry.productName} ·{" "}
                  <CartonQty
                    pieces={entry.pieces}
                    piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                  />
                  {entry.freePieces && entry.freePieces !== "0" ? (
                    <>
                      {" "}
                      (+{t("godown.posted.free")}{" "}
                      <CartonQty
                        pieces={entry.freePieces}
                        piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                      />
                      )
                    </>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <StatusChip status="pending" />
                  {canDiscardPending || loginRoleKind === "tsm" ? (
                    <Button
                      className="px-2 py-1 text-xs"
                      disabled={discard.isPending}
                      onClick={() =>
                        void action.run(() => discard.mutateAsync(entry.id), {
                          confirm: "godown.reverseConfirm",
                        })
                      }
                    >
                      {t("common.delete")}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SectionTitle>{t("godown.posted.title")}</SectionTitle>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
      {entries.isPending ? (
        <TableSkeleton rows={3} columns={5} />
      ) : liveRows.length === 0 ? (
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
                  {kind === "order" || kind === "receipt" ? (
                    <th scope="col" className={thClass}>
                      {t("godown.posted.batch")}
                    </th>
                  ) : null}
                  {kind === "receipt" ? (
                    <>
                      <ColumnHead label={t("godown.posted.free")} quantity />
                      {view.canSeeCost ? <ColumnHead label={t("batch.costShort")} /> : null}
                      <ColumnHead label={t("batch.saleShort")} />
                    </>
                  ) : null}
                  {kind === "order" ? (
                    <>
                      <ColumnHead label={t("godown.posted.free")} quantity />
                      <ColumnHead label={t("godown.posted.rate")} />
                      <ColumnHead label={t("godown.posted.pieceRate")} />
                      <ColumnHead label={t("godown.posted.bill")} />
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
                {liveRows.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className={`${tdClass} ${stickyCell}`}>{entry.productName}</td>
                    <td className={tdNum}>
                      <CartonQty
                        pieces={entry.pieces}
                        piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                      />
                    </td>
                    {kind === "order" || kind === "receipt" ? (
                      <td className={`${tdClass} whitespace-nowrap`}>{entryBatches(entry)}</td>
                    ) : null}
                    {kind === "receipt" ? (
                      <>
                        <td className={tdNum}>
                          <CartonQty
                            pieces={entry.freePieces ?? "0"}
                            piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                          />
                        </td>
                        {view.canSeeCost ? (
                          <td className={tdNum}>
                            {entry.costPrice === null ? "" : formatRate(entry.costPrice)}
                          </td>
                        ) : null}
                        <td className={tdNum}>
                          {entry.salePrice === null ? "" : formatRate(entry.salePrice)}
                        </td>
                      </>
                    ) : null}
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
                        <td className={tdNum}>
                          {entry.cartonRate === null
                            ? ""
                            : formatRate(
                                orderBatchCostPrice({
                                  paid: entry.pieces,
                                  free: entry.freePieces ?? "0",
                                  cartonRate: entry.cartonRate,
                                  piecesPerCarton: sizes.get(entry.productId) ?? "1",
                                }) ?? entry.costPrice ?? "0",
                              )}
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
            ) : kind === "receipt" ? (
              <ReceiptForm key={date} companyId={company.id} date={date} view={view} />
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
