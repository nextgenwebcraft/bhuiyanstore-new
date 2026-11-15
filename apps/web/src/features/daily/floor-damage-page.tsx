"use client";

import type { DayView, StockEntry, StockEntryPostRequest } from "@bsd/contracts";
import { sumAmounts, toBaseQuantity, toDecimal } from "@bsd/domain";
import { formatCount, formatRate, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import {
  CartonQty,
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
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ReverseCell } from "@/components/reverse-cell";
import { FormSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import { usePostStockEntries, useReverseStockEntry, useStockEntries } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";
import {
  CellInput,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  batchName,
  clean,
  useWorkingDate,
} from "./daily-kit";

const PATH = "inventory/floor-damage";

type Product = DayView["products"][number];
type Batch = Product["batches"][number];

type DamageRow = {
  key: number;
  productId: string;
  batchKey: string;
  cartons: string;
  pieces: string;
  unitPrice: string;
};

let nextRowKey = 0;
const emptyRow = (): DamageRow => ({
  key: nextRowKey++,
  productId: "",
  batchKey: "",
  cartons: "",
  pieces: "",
  unitPrice: "",
});

const whole = /^\d+$/;
const unitPricePattern = /^\d+(\.\d{1,6})?$/;

function stockBatches(product: Product | undefined): Batch[] {
  if (!product) return [];
  return product.batches.filter(
    (batch) => toDecimal(batch.quantity).gt(0) && !batch.key.startsWith("auto:"),
  );
}

function productsWithStock(view: DayView): Product[] {
  return view.products.filter((product) => stockBatches(product).length > 0);
}

function lineOf(
  row: DamageRow,
  product: Product | undefined,
  batch: Batch | undefined,
):
  | { pieces: string; unitPrice: string; amount: string; batchId: string; productId: string }
  | { error: string }
  | null {
  if (!row.productId && !row.cartons && !row.pieces && !row.unitPrice) return null;
  if (!product) return { error: t("floorDamage.pickProduct") };
  if (!batch) return { error: t("floorDamage.pickBatch") };
  const cartons = clean(row.cartons) || "0";
  const pieces = clean(row.pieces) || "0";
  if (!whole.test(cartons) || !whole.test(pieces)) return { error: t("validation.wholeNumber") };
  const total = toBaseQuantity(cartons, pieces, product.piecesPerCarton);
  if (total === "0") return null;
  if (toDecimal(total).gt(batch.quantity)) return { error: t("floorDamage.overStock") };
  const rate = clean(row.unitPrice);
  if (!unitPricePattern.test(rate) || !/[1-9]/.test(rate)) {
    return { error: t("validation.damage.unitCostRequired") };
  }
  return {
    pieces: total,
    unitPrice: rate,
    amount: toDecimal(total).mul(rate).toDecimalPlaces(2).toFixed(2),
    batchId: batch.key,
    productId: product.productId,
  };
}

function FloorDamageForm({
  companyId,
  date,
  view,
}: {
  companyId: string;
  date: string;
  view: DayView;
}) {
  const id = useId();
  const post = usePostStockEntries(companyId);
  const [rows, setRows] = useState<DamageRow[]>(() => [emptyRow()]);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const catalog = productsWithStock(view);
  const productOf = (productId: string) => catalog.find((p) => p.productId === productId);
  const batchOf = (product: Product | undefined, batchKey: string) =>
    stockBatches(product).find((b) => b.key === batchKey);

  const lines = rows.map((row) => {
    const product = productOf(row.productId);
    return { row, product, batch: batchOf(product, row.batchKey), line: lineOf(row, product, batchOf(product, row.batchKey)) };
  });
  const totalAmount = sumAmounts([
    "0",
    ...lines.flatMap(({ line }) => (line && !("error" in line) ? [line.amount] : [])),
  ]);

  function setRow(key: number, patch: Partial<DamageRow>) {
    setDone(false);
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        if (patch.productId !== undefined && patch.productId !== row.productId) {
          const product = productOf(patch.productId);
          const batches = stockBatches(product);
          const first = batches[0];
          next.batchKey = first?.key ?? "";
          next.unitPrice = first?.costPrice ?? product?.costPrice ?? "";
        } else if (patch.batchKey !== undefined && patch.batchKey !== row.batchKey) {
          const product = productOf(next.productId);
          const batch = batchOf(product, patch.batchKey);
          if (batch?.costPrice) next.unitPrice = batch.costPrice;
        }
        return next;
      }),
    );
  }

  async function submit() {
    setError(undefined);
    setDone(false);
    const failed = lines.find(({ line }) => line && "error" in line);
    if (failed?.line && "error" in failed.line) return setError(failed.line.error);
    const posting: NonNullable<StockEntryPostRequest["lines"]> = lines.flatMap(({ line }) =>
      line && !("error" in line)
        ? [
            {
              kind: "floorDamageDeposit" as const,
              productId: line.productId,
              pieces: line.pieces,
              batchId: line.batchId,
              unitPrice: line.unitPrice,
            },
          ]
        : [],
    );
    if (posting.length === 0) return setError(t("godown.nothing"));
    try {
      await post.mutateAsync({ date, lines: posting, prices: [] });
      setRows([emptyRow()]);
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  if (catalog.length === 0) {
    return <StatePanel title={t("floorDamage.noStock")} hint={t("floorDamage.noStockHint")} />;
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t("floorDamage.formTitle")}</h2>
      <p className="text-sm text-text-muted">{t("floorDamage.hint")}</p>
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("godown.column.product")}
              </th>
              <th scope="col" className={thClass}>
                {t("floorDamage.batch")}
              </th>
              <th scope="col" className={thNum}>
                {t("common.cartons")}
              </th>
              <th scope="col" className={thNum}>
                {t("common.pieces")}
              </th>
              <th scope="col" className={thNum}>
                {t("deposit.damage.rate")}
              </th>
              <th scope="col" className={thNum}>
                {t("common.amount")}
              </th>
              <th scope="col" className={thClass}>
                <span className="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ row, product, batch, line }) => {
              const batches = stockBatches(product);
              const amount = line && !("error" in line) ? line.amount : "0";
              return (
                <tr key={row.key} className="border-t border-border">
                  <td className={tdClass}>
                    <select
                      id={`${id}-product-${row.key}`}
                      className={inputClass}
                      value={row.productId}
                      onChange={(e) => setRow(row.key, { productId: e.target.value })}
                    >
                      <option value="">{t("floorDamage.pickProduct")}</option>
                      {catalog.map((item) => (
                        <option key={item.productId} value={item.productId}>
                          {item.sku} · {item.productName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <select
                      className={inputClass}
                      value={row.batchKey}
                      disabled={!product}
                      onChange={(e) => setRow(row.key, { batchKey: e.target.value })}
                    >
                      <option value="">{t("floorDamage.pickBatch")}</option>
                      {batches.map((item) => (
                        <option key={item.key} value={item.key}>
                          {batchName({ key: item.key, seq: item.seq })} ·{" "}
                          {formatCount(item.quantity)}
                          {item.costPrice ? ` · ৳${formatRate(item.costPrice)}` : ""}
                        </option>
                      ))}
                    </select>
                    {batch ? (
                      <span className="mt-1 block text-[11px] text-text-muted">
                        {t("floorDamage.inStock")}: {formatCount(batch.quantity)}
                      </span>
                    ) : null}
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={t("common.cartons")}
                      value={row.cartons}
                      onChange={(value) => setRow(row.key, { cartons: value })}
                      mode="numeric"
                    />
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={t("common.pieces")}
                      value={row.pieces}
                      onChange={(value) => setRow(row.key, { pieces: value })}
                      mode="numeric"
                    />
                  </td>
                  <td className={tdNum}>
                    <CellInput
                      label={t("deposit.damage.rate")}
                      value={row.unitPrice}
                      onChange={(value) => setRow(row.key, { unitPrice: value })}
                      mode="decimal"
                    />
                  </td>
                  <td className={`${tdNum} font-semibold`}>{money(amount)}</td>
                  <td className={tdClass}>
                    <Button
                      onClick={() => {
                        setDone(false);
                        setRows((current) =>
                          current.length <= 1
                            ? [emptyRow()]
                            : current.filter((item) => item.key !== row.key),
                        );
                      }}
                    >
                      {t("dsr.sheet.removeBatch")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setRows((current) => [...current, emptyRow()])}>
          {t("floorDamage.addRow")}
        </Button>
        <p className="text-sm font-semibold tabular-nums">
          {t("common.amount")}: {money(totalAmount)}
        </p>
      </div>
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="text-sm text-success">{t("common.posted")}</p> : null}
      <div>
        <Button variant="primary" disabled={post.isPending} onClick={() => void submit()}>
          {t("common.post")}
        </Button>
      </div>
    </div>
  );
}

function PostedFloorDamage({
  companyId,
  entries,
  piecesPerCarton,
}: {
  companyId: string;
  entries: StockEntry[];
  piecesPerCarton: Map<string, string>;
}) {
  const { permissions } = useCurrentWorkspace();
  const reverse = useReverseStockEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("purchase.reverse");
  const rows = entries.filter((entry) => entry.kind === "floorDamageDeposit");
  if (rows.length === 0) return <EmptyListNote textKey="floorDamage.emptyPosted" />;
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              {t("godown.column.product")}
            </th>
            <th scope="col" className={thClass}>
              {t("floorDamage.batch")}
            </th>
            <th scope="col" className={thNum}>
              {t("common.pieces")}
            </th>
            <th scope="col" className={thNum}>
              {t("deposit.damage.rate")}
            </th>
            <th scope="col" className={thNum}>
              {t("common.amount")}
            </th>
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
              <td className={tdClass}>
                {entry.sku} · {entry.productName}
              </td>
              <td className={tdClass}>
                {entry.batchSeq !== null ? batchName({ seq: entry.batchSeq }) : "—"}
              </td>
              <td className={tdNum}>
                <CartonQty
                  pieces={entry.pieces}
                  piecesPerCarton={piecesPerCarton.get(entry.productId) ?? "1"}
                />
              </td>
              <td className={tdNum}>{entry.unitPrice ? formatRate(entry.unitPrice) : "—"}</td>
              <td className={tdNum}>
                {money(
                  toDecimal(entry.pieces)
                    .mul(entry.unitPrice ?? "0")
                    .toString(),
                )}
              </td>
              <td className={tdClass}>
                <StatusChip status={entry.status} />
              </td>
              <ReverseCell
                canReverse={canReverse}
                posted={entry.status === "posted"}
                pending={reverse.isPending || action.busy}
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
  );
}

/** D131: return saleable floor stock to the company as damage-balance money. */
export function FloorDamagePage() {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.inventory.floorDamage")}
        description={t("floorDamage.description")}
        actions={<DateBar date={date} onChange={setDate} />}
      />
      <DateHeading date={date} />
      <DayGate
        companyId={company.id}
        date={date}
        skeleton={
          <div className="flex flex-col gap-6">
            <FormSkeleton fields={4} />
            <TableSkeleton rows={4} columns={6} title />
          </div>
        }
      >
        {(view) => (
          <>
            <FloorDamageForm key={date} companyId={company.id} date={date} view={view} />
            <SectionTitle>{t("floorDamage.posted")}</SectionTitle>
            <PostedFloorDamageBody companyId={company.id} date={date} view={view} />
          </>
        )}
      </DayGate>
    </NavGate>
  );
}

function PostedFloorDamageBody({
  companyId,
  date,
  view,
}: {
  companyId: string;
  date: string;
  view: DayView;
}) {
  const entries = useStockEntries(companyId, date);
  if (entries.isPending) return <TableSkeleton rows={4} columns={6} />;
  if (entries.isError) {
    return <QueryError error={entries.error} onRetry={() => void entries.refetch()} />;
  }
  return (
    <PostedFloorDamage
      companyId={companyId}
      entries={entries.data}
      piecesPerCarton={new Map(view.products.map((p) => [p.productId, p.piecesPerCarton]))}
    />
  );
}
