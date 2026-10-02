"use client";

import type { DayView, PriceKind, StockEntryKind, StockEntryPostRequest } from "@bsd/contracts";
import { toBaseQuantity } from "@bsd/domain";
import { formatRate, t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import {
  usePostStockEntries,
  useReverseStockEntry,
  useStockEntries,
  useSuppliers,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  CellInput,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  StatusChip,
  cartonText,
  clean,
  quantity,
  tableClass,
  tableShell,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "./daily-kit";

/** Which price each godown screen can change from its date (Excel's carry-forward columns). */
const PRICES: Record<StockEntryKind, PriceKind[]> = {
  order: ["order"],
  receipt: ["cost", "sale"],
  damage: [],
};
const PRICE_FIELD = { order: "orderPrice", cost: "costPrice", sale: "salePrice" } as const;

type Row = { cartons: string; pieces: string; lot: string; expiry: string } & Partial<
  Record<PriceKind, string>
>;
const emptyRow: Row = { cartons: "", pieces: "", lot: "", expiry: "" };

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
  const id = useId();
  const { permissions } = useCurrentWorkspace();
  const suppliers = useSuppliers(companyId);
  const post = usePostStockEntries(companyId);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
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
        lines.push({
          kind,
          productId: product.productId,
          pieces: total,
          supplierId: kind === "damage" ? null : supplierId || null,
          reference: reference.trim(),
          lot: kind === "receipt" && row.lot.trim() ? row.lot.trim() : null,
          expiry: kind === "receipt" && row.expiry ? row.expiry : null,
        });
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
  return (
    <div className="flex flex-col gap-4">
      {kind !== "damage" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-supplier`} label={t("godown.supplier")} hint={t("common.optional")}>
            <select
              id={`${id}-supplier`}
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {(suppliers.data ?? [])
                .filter((s) => s.status === "active")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id={`${id}-reference`} label={t("godown.reference")} hint={t("common.optional")}>
            <input
              id={`${id}-reference`}
              value={reference}
              maxLength={100}
              onChange={(event) => setReference(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      ) : null}
      <div className={tableShell}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
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
                  {t(`godown.column.${p}Price` as TranslationKey)}
                </th>
              ))}
              {kind === "receipt" ? (
                <>
                  <th scope="col" className={thClass}>
                    {t("godown.column.lot")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("godown.column.expiry")}
                  </th>
                </>
              ) : null}
              <th scope="col" className={thNum}>
                {t(kind === "order" ? "godown.column.due" : "godown.column.stock")}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.products.map((product) => {
              const row = rows[product.productId] ?? emptyRow;
              return (
                <tr key={product.productId} className="border-t border-border">
                  <th scope="row" className={`${tdClass} text-left font-medium`}>
                    <div>{product.productName}</div>
                    <div className="text-xs font-normal text-text-muted">
                      {product.sku} · {t("godown.column.size")} {quantity(product.piecesPerCarton)}
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
                  {kind === "receipt" ? (
                    <>
                      <td className={tdClass}>
                        <CellInput
                          label={`${product.productName} ${t("godown.column.lot")}`}
                          value={row.lot}
                          onChange={(lot) => set(product.productId, { lot })}
                          mode="text"
                          width="w-24"
                        />
                      </td>
                      <td className={tdClass}>
                        <input
                          type="date"
                          aria-label={`${product.productName} ${t("godown.column.expiry")}`}
                          value={row.expiry}
                          onChange={(event) =>
                            set(product.productId, { expiry: event.target.value })
                          }
                          className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm"
                        />
                      </td>
                    </>
                  ) : null}
                  <td className={tdNum}>
                    {cartonText(
                      kind === "order" ? product.dueFromCompany : product.stock,
                      product.piecesPerCarton,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const [error, setError] = useState<string | undefined>();
  const canReverse = permissions.includes("purchase.reverse");
  const sizes = new Map(view.products.map((p) => [p.productId, p.piecesPerCarton]));
  const rows = (entries.data ?? []).filter((e) => e.kind === kind);

  async function undo(entryId: string) {
    if (!window.confirm(t("godown.reverseConfirm"))) return;
    setError(undefined);
    try {
      await reverse.mutateAsync(entryId);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <>
      <SectionTitle>{t("godown.posted.title")}</SectionTitle>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {t("godown.posted.empty")}
        </p>
      ) : (
        <div className={tableShell}>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("godown.column.product")}
                </th>
                <th scope="col" className={thNum}>
                  {t("godown.column.quantity")}
                </th>
                <th scope="col" className={thClass}>
                  {t("godown.reference")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("godown.reverse")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className={tdClass}>
                    {entry.productName}
                    {entry.lot ? (
                      <span className="ml-2 text-xs text-text-muted">
                        {t("godown.column.lot")} {entry.lot}
                        {entry.expiry ? ` · ${entry.expiry}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className={tdNum}>
                    {cartonText(entry.pieces, sizes.get(entry.productId) ?? "1")}
                  </td>
                  <td className={tdClass}>{entry.reference || "—"}</td>
                  <td className={tdClass}>
                    <StatusChip status={entry.status} />
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {canReverse && entry.status === "posted" ? (
                      <Button disabled={reverse.isPending} onClick={() => void undo(entry.id)}>
                        {t("godown.reverse")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const TITLES: Record<StockEntryKind, { title: TranslationKey; description: TranslationKey }> = {
  order: { title: "nav.purchases.orders", description: "godown.description.order" },
  receipt: { title: "nav.purchases.receipts", description: "godown.description.receipt" },
  damage: { title: "nav.inventory.damage", description: "godown.description.damage" },
};

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
      <DateHeading date={date} />
      <DayGate companyId={company.id} date={date}>
        {(view) => (
          <>
            <GodownForm key={date} companyId={company.id} date={date} kind={kind} view={view} />
            <PostedEntries companyId={company.id} date={date} kind={kind} view={view} />
          </>
        )}
      </DayGate>
    </NavGate>
  );
}
