"use client";

import type { DayView } from "@bsd/contracts";
import { sumQuantities, toBaseQuantity, toCartonDisplay, toDecimal } from "@bsd/domain";
import { formatCount, formatRate, t } from "@bsd/i18n";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { Combobox, type ComboboxOption } from "@/components/combobox";
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
import { Field, inputClass } from "@/components/field";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { DsrSelect, type DsrChoice } from "@/features/daily/dsr-select";
import { batchName, clean } from "./daily-kit";

type Product = DayView["products"][number];

/**
 * One sheet line: a DSR + product + batch (D68, D122). Only entered lines exist — no blank
 * all-product grid. Prices left unset are the batch's.
 */
export type LineDraft = {
  id: string;
  dsrStaffId: string;
  dsrStaffName: string;
  productId: string;
  batchKey: string;
  issuedCartons: string;
  issuedPieces: string;
  returnedCartons: string;
  returnedPieces: string;
  damaged: string;
  damageRate?: string | undefined;
  commission: string;
  salePrice?: string | undefined;
  costPrice?: string | undefined;
};
/** Entered lines only, plus day-end cash handed over. */
export type SheetDraft = { lines: LineDraft[]; handedOver: string };

export const lineKeyOf = (l: { dsrStaffId: string; productId: string; batchKey: string }) =>
  `${l.dsrStaffId}|${l.productId}|${l.batchKey}`;

/** Batch stock for the picker: "১২ কার্টন ৫ পিস" (or pieces only when carton size is 1). */
function stockCartonPiece(pieces: string, piecesPerCarton: string): string {
  if (!/^\d+$/.test(pieces) || !/^[1-9]\d*$/.test(piecesPerCarton) || piecesPerCarton === "1") {
    return `${formatCount(pieces)} ${t("common.pieces")}`;
  }
  const { cartons, loosePieces } = toCartonDisplay(pieces, piecesPerCarton);
  const parts: string[] = [];
  if (cartons !== "0") parts.push(`${formatCount(cartons)} ${t("common.cartons")}`);
  if (loosePieces !== "0") parts.push(`${formatCount(loosePieces)} ${t("common.pieces")}`);
  return parts.length > 0 ? parts.join(" ") : `০ ${t("common.pieces")}`;
}

type BatchOption = {
  key: string;
  seq: number;
  quantity: string;
  costPrice: string | null;
  salePrice: string;
};

export type EntryKind = "samari" | "firot" | "damage" | "commission";

const ENTRY_KINDS: readonly EntryKind[] = ["samari", "firot", "damage", "commission"];

function productBatches(
  product: Product,
  view: DayView,
  named: readonly string[],
): BatchOption[] {
  const usedToday = new Map(
    view.persons
      .filter((p) => p.productId === product.productId)
      .flatMap((p) => p.allocations)
      .map((a) => [a.key, a]),
  );
  const out = new Map<string, BatchOption>();
  for (const b of product.batches) {
    if (toDecimal(b.quantity).lte(0) && !usedToday.has(b.key) && !named.includes(b.key)) continue;
    out.set(b.key, b);
  }
  for (const a of usedToday.values()) {
    if (out.has(a.key)) continue;
    out.set(a.key, {
      key: a.key,
      seq: a.seq,
      quantity: "0",
      costPrice: a.costPrice,
      salePrice: a.salePrice,
    });
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}

function emptyLine(
  dsr: DsrChoice,
  productId: string,
  batchKey: string,
): LineDraft {
  return {
    id: crypto.randomUUID(),
    dsrStaffId: dsr.id,
    dsrStaffName: dsr.name,
    productId,
    batchKey,
    issuedCartons: "",
    issuedPieces: "",
    returnedCartons: "",
    returnedPieces: "",
    damaged: "",
    commission: "",
  };
}

/** Merge a form submission into the draft (same DSR+product+batch updates that field). */
export function upsertEntry(
  draft: SheetDraft,
  kind: EntryKind,
  input: {
    dsr: DsrChoice;
    productId: string;
    batchKey: string;
    cartons?: string;
    pieces?: string;
    damaged?: string;
    damageRate?: string;
    commission?: string;
    salePrice?: string;
    costPrice?: string;
  },
): SheetDraft {
  const key = lineKeyOf({
    dsrStaffId: input.dsr.id,
    productId: input.productId,
    batchKey: input.batchKey,
  });
  const existing = draft.lines.find((l) => lineKeyOf(l) === key);
  const base = existing ?? emptyLine(input.dsr, input.productId, input.batchKey);
  let next: LineDraft = { ...base, batchKey: input.batchKey };
  if (kind === "samari") {
    next = {
      ...next,
      issuedCartons: input.cartons ?? "",
      issuedPieces: input.pieces ?? "",
      ...(input.salePrice !== undefined ? { salePrice: input.salePrice || undefined } : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice || undefined } : {}),
    };
  } else if (kind === "firot") {
    next = {
      ...next,
      returnedCartons: input.cartons ?? "",
      returnedPieces: input.pieces ?? "",
    };
  } else if (kind === "damage") {
    next = {
      ...next,
      damaged: input.damaged ?? "",
      damageRate: input.damageRate || undefined,
    };
  } else {
    next = { ...next, commission: input.commission ?? "" };
  }
  const lines = existing
    ? draft.lines.map((l) => (lineKeyOf(l) === key ? next : l))
    : [...draft.lines, next];
  return { ...draft, lines };
}

type EntryRowDraft = {
  key: string;
  dsrId: string;
  productId: string | null;
  productText: string;
  batchKey: string;
  cartons: string;
  pieces: string;
  damaged: string;
  damageRate: string;
  commission: string;
  salePrice: string;
  costPrice: string;
};

const emptyEntryRow = (dsrId = ""): EntryRowDraft => ({
  key: crypto.randomUUID(),
  dsrId,
  productId: null,
  productText: "",
  batchKey: "",
  cartons: "",
  pieces: "",
  damaged: "",
  damageRate: "",
  commission: "",
  salePrice: "",
  costPrice: "",
});

type EntryPatch = Parameters<typeof upsertEntry>[2];

function EntryFormPanel({
  kind,
  view,
  dsrs,
  canEditPrices,
  onClose,
  onSubmit,
}: {
  kind: EntryKind;
  view: DayView;
  dsrs: readonly DsrChoice[];
  canEditPrices: boolean;
  onClose: () => void;
  /** Applies every filled row in one go (so later rows see earlier upserts). */
  onSubmit: (patches: EntryPatch[]) => string | undefined;
}) {
  const id = useId();
  const [rows, setRows] = useState<EntryRowDraft[]>(() => [emptyEntryRow()]);
  const [error, setError] = useState<string | undefined>();

  const productOptions = useMemo<ComboboxOption[]>(
    () =>
      view.products.map((p) => ({
        id: p.productId,
        label: p.productName,
        secondary: p.sku,
        searchText: [p.sku, p.productName],
      })),
    [view.products],
  );

  function patchRow(key: string, patch: Partial<EntryRowDraft>) {
    setRows((cur) => cur.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const lastDsr = [...rows].reverse().find((r) => r.dsrId)?.dsrId ?? rows[0]?.dsrId ?? "";
    setRows((cur) => [...cur, emptyEntryRow(lastDsr)]);
  }

  function removeRow(key: string) {
    setRows((cur) => (cur.length <= 1 ? cur : cur.filter((row) => row.key !== key)));
  }

  function submit() {
    setError(undefined);
    const patches: EntryPatch[] = [];
    for (const row of rows) {
      const dsr = dsrs.find((d) => d.id === row.dsrId);
      const product = view.products.find((p) => p.productId === row.productId);
      const blank =
        !row.productId &&
        !clean(row.cartons) &&
        !clean(row.pieces) &&
        !clean(row.damaged) &&
        !clean(row.commission);
      if (blank) continue;
      if (!dsr) return setError(t("validation.daily.lineDsrOnly"));
      if (!product) return setError(t("validation.daily.unknownProduct"));
      const batches = productBatches(product, view, row.batchKey ? [row.batchKey] : []);
      const batch = batches.find((b) => b.key === row.batchKey) ?? batches[0];
      const key = batch?.key ?? "";
      if (!key && kind !== "damage") return setError(t("dsr.sheet.noStock"));
      const sale = canEditPrices ? clean(row.salePrice) : "";
      const cost = canEditPrices ? clean(row.costPrice) : "";
      patches.push({
        dsr,
        productId: product.productId,
        batchKey: key,
        cartons: clean(row.cartons),
        pieces: clean(row.pieces),
        damaged: clean(row.damaged),
        damageRate: clean(row.damageRate) || batch?.salePrice || product.salePrice || "",
        commission: clean(row.commission),
        ...(sale ? { salePrice: sale } : {}),
        ...(cost ? { costPrice: cost } : {}),
      });
    }
    if (patches.length === 0) return setError(t("validation.daily.unknownProduct"));
    const msg = onSubmit(patches);
    if (msg) return setError(msg);
    onClose();
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      <h3 className="font-semibold tracking-tight">{t(`dsr.entry.${kind}`)}</h3>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {rows.map((row, index) => {
        const product = view.products.find((p) => p.productId === row.productId);
        const batches = product
          ? productBatches(product, view, row.batchKey ? [row.batchKey] : [])
          : [];
        const batch = batches.find((b) => b.key === row.batchKey) ?? batches[0];
        const rid = `${id}-${row.key}`;
        const even = index % 2 === 1;
        return (
          <div
            key={row.key}
            className={`relative grid grid-cols-1 gap-3 rounded-xl p-3 pt-4 sm:grid-cols-2 lg:grid-cols-3 ${
              even ? "bg-surface-muted" : "bg-info/10"
            }`}
          >
            {rows.length > 1 ? (
              <button
                type="button"
                className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                aria-label={t("common.removeLine")}
                onClick={() => removeRow(row.key)}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="size-4"
                  aria-hidden
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            ) : null}
            <DsrSelect
              id={`${rid}-dsr`}
              value={row.dsrId}
              dsrs={dsrs}
              onChange={(dsrId) => patchRow(row.key, { dsrId })}
              label="staffCash.dsr"
              emptyLabel="staffCash.dsrEmpty"
            />
            <Field id={`${rid}-item`} label={t("dsr.entry.item")}>
              <Combobox
                id={`${rid}-item`}
                text={row.productText}
                onTextChange={(text) =>
                  patchRow(row.key, { productText: text, productId: null, batchKey: "" })
                }
                options={productOptions}
                selectedId={row.productId}
                onChoose={(choice) => {
                  if (choice.kind !== "option") return;
                  patchRow(row.key, {
                    productText: choice.option.label,
                    productId: choice.option.id,
                    batchKey: "",
                  });
                }}
                placeholder={t("dsr.entry.item")}
                emptyLabel={t("dsr.entry.itemEmpty")}
                listLabel={t("dsr.entry.item")}
                clearLabel={t("shop.clear")}
                onBlur={() => {
                  const selected = productOptions.find((o) => o.id === row.productId);
                  patchRow(row.key, { productText: selected?.label ?? "" });
                }}
              />
            </Field>
            {product ? (
              <Field id={`${rid}-batch`} label={t("dsr.sheet.batch")}>
                <select
                  id={`${rid}-batch`}
                  value={batch?.key ?? ""}
                  onChange={(event) => patchRow(row.key, { batchKey: event.target.value })}
                  className={inputClass}
                >
                  {batches.length === 0 ? (
                    <option value="">{t("dsr.sheet.noStock")}</option>
                  ) : null}
                  {batches.map((o) => (
                    <option key={o.key} value={o.key}>
                      {batchName(o)} · {t("batch.available")}{" "}
                      {stockCartonPiece(o.quantity, product.piecesPerCarton)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {kind === "samari" || kind === "firot" ? (
              <>
                <Field id={`${rid}-cartons`} label={t("godown.column.cartons")}>
                  <input
                    id={`${rid}-cartons`}
                    inputMode="numeric"
                    value={row.cartons}
                    onChange={(e) => patchRow(row.key, { cartons: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field id={`${rid}-pieces`} label={t("godown.column.pieces")}>
                  <input
                    id={`${rid}-pieces`}
                    inputMode="numeric"
                    value={row.pieces}
                    onChange={(e) => patchRow(row.key, { pieces: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </>
            ) : null}
            {kind === "samari" && canEditPrices ? (
              <>
                <Field id={`${rid}-sale`} label={t("dsr.sheet.batchSalePrice")}>
                  <input
                    id={`${rid}-sale`}
                    inputMode="decimal"
                    value={row.salePrice || batch?.salePrice || product?.salePrice || ""}
                    onChange={(e) => patchRow(row.key, { salePrice: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field id={`${rid}-cost`} label={t("dsr.sheet.costPrice")}>
                  <input
                    id={`${rid}-cost`}
                    inputMode="decimal"
                    value={row.costPrice || batch?.costPrice || ""}
                    onChange={(e) => patchRow(row.key, { costPrice: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </>
            ) : null}
            {kind === "damage" ? (
              <>
                <Field id={`${rid}-damaged`} label={t("dsr.sheet.damaged")}>
                  <input
                    id={`${rid}-damaged`}
                    inputMode="numeric"
                    value={row.damaged}
                    onChange={(e) => patchRow(row.key, { damaged: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field id={`${rid}-rate`} label={t("dsr.sheet.damageRate")}>
                  <input
                    id={`${rid}-rate`}
                    inputMode="decimal"
                    value={row.damageRate || batch?.salePrice || product?.salePrice || ""}
                    onChange={(e) => patchRow(row.key, { damageRate: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </>
            ) : null}
            {kind === "commission" ? (
              <Field id={`${rid}-commission`} label={t("dsr.sheet.commission")}>
                <input
                  id={`${rid}-commission`}
                  inputMode="decimal"
                  value={row.commission}
                  onChange={(e) => patchRow(row.key, { commission: e.target.value })}
                  className={inputClass}
                />
              </Field>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" onClick={addRow}>
          {t("dsr.entry.addMore")}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("dsr.entry.add")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ReadOnlyLinesTable({
  title,
  lines,
  view,
  locked,
  onRemove,
}: {
  title: string;
  lines: readonly LineDraft[];
  view: DayView;
  locked: boolean;
  onRemove: (id: string) => void;
}) {
  if (lines.length === 0) return null;
  const productOf = (id: string) => view.products.find((p) => p.productId === id);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={`${thClass} ${stickyHead} text-left`}>
                {t("godown.column.product")}
              </th>
              <th scope="col" className={thClass}>
                {t("dsr.sheet.batch")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.issued")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.returned")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.damaged")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.damageRate")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.commission")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.batchSalePrice")}
              </th>
              {view.canSeeCost ? (
                <th scope="col" className={thNum}>
                  {t("dsr.sheet.costPrice")}
                </th>
              ) : null}
              {!locked ? (
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("common.delete")}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const product = productOf(line.productId);
              const size = product?.piecesPerCarton ?? "1";
              const issued = toBaseQuantity(
                clean(line.issuedCartons) || "0",
                clean(line.issuedPieces) || "0",
                size,
              );
              const returned = toBaseQuantity(
                clean(line.returnedCartons) || "0",
                clean(line.returnedPieces) || "0",
                size,
              );
              return (
                <tr key={line.id} className="border-t border-border">
                  <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                    <div>{product?.productName ?? line.productId}</div>
                    <div className="text-xs font-normal text-text-muted">{product?.sku}</div>
                  </th>
                  <td className={tdClass}>{batchName({ key: line.batchKey, seq: 0 })}</td>
                  <td className={tdNum}>
                    <CartonQty pieces={issued} piecesPerCarton={size} />
                  </td>
                  <td className={tdNum}>
                    <CartonQty pieces={returned} piecesPerCarton={size} />
                  </td>
                  <td className={tdNum}>{quantity(clean(line.damaged) || "0")}</td>
                  <td className={tdNum}>
                    {line.damageRate ? formatRate(line.damageRate) : "—"}
                  </td>
                  <td className={tdNum}>{money(clean(line.commission) || "0")}</td>
                  <td className={tdNum}>
                    {line.salePrice ? formatRate(line.salePrice) : "—"}
                  </td>
                  {view.canSeeCost ? (
                    <td className={tdNum}>
                      {line.costPrice ? formatRate(line.costPrice) : "—"}
                    </td>
                  ) : null}
                  {!locked ? (
                    <td className={`${tdClass} text-right`}>
                      <Button onClick={() => onRemove(line.id)}>{t("common.delete")}</Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-text-muted">
        {formatCount(String(lines.length))} {t("warning.products")} ·{" "}
        {t("dsr.sheet.issued")}{" "}
        {quantity(
          sumQuantities(
            lines.map((l) => {
              const size = productOf(l.productId)?.piecesPerCarton ?? "1";
              return toBaseQuantity(
                clean(l.issuedCartons) || "0",
                clean(l.issuedPieces) || "0",
                size,
              );
            }),
          ),
        )}
      </p>
    </section>
  );
}

/** D122: four add-item forms + DSR-wise read-only tables and an SR total. */
export function DsrSheetEntry({
  draft,
  view,
  dsrs,
  sheetStaffId,
  locked,
  canEditPrices,
  issuedLocked,
  onChange,
}: {
  draft: SheetDraft;
  view: DayView;
  dsrs: readonly DsrChoice[];
  /** Open SR for this day sheet — never shown as a DSR group table (D122). */
  sheetStaffId: string;
  locked: boolean;
  canEditPrices: boolean;
  issuedLocked: boolean;
  onChange: (next: SheetDraft) => void;
}) {
  const [entry, setEntry] = useState<EntryKind | null>(null);
  /** Named tables only for real DSRs — legacy lines backfilled to the SR stay in এসআর মোট only. */
  const byDsr = useMemo(() => {
    const dsrIds = new Set(dsrs.map((d) => d.id));
    const map = new Map<string, { name: string; lines: LineDraft[] }>();
    for (const line of draft.lines) {
      if (line.dsrStaffId === sheetStaffId || !dsrIds.has(line.dsrStaffId)) continue;
      const group = map.get(line.dsrStaffId) ?? { name: line.dsrStaffName, lines: [] };
      group.lines.push(line);
      map.set(line.dsrStaffId, group);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "bn"));
  }, [draft.lines, dsrs, sheetStaffId]);
  const removeLine = (id: string) =>
    onChange({ ...draft, lines: draft.lines.filter((l) => l.id !== id) });

  return (
    <div className="flex flex-col gap-4">
      {!locked ? (
        <div className="flex flex-wrap gap-2">
          {ENTRY_KINDS.map((kind) => {
            if (kind === "samari" && issuedLocked) return null;
            return (
              <Button
                key={kind}
                variant={entry === kind ? "primary" : "secondary"}
                onClick={() => setEntry((cur) => (cur === kind ? null : kind))}
              >
                {t(`dsr.entry.${kind}`)}
              </Button>
            );
          })}
        </div>
      ) : null}
      {entry && !locked ? (
        <EntryFormPanel
          key={entry}
          kind={entry}
          view={view}
          dsrs={dsrs}
          canEditPrices={canEditPrices}
          onClose={() => setEntry(null)}
          onSubmit={(patches) => {
            for (const [index, input] of patches.entries()) {
              const cartons = input.cartons ?? "";
              const pieces = input.pieces ?? "";
              const label = patches.length > 1 ? `${index + 1}. ` : "";
              if (entry === "samari" || entry === "firot") {
                if ((cartons && !/^\d+$/.test(cartons)) || (pieces && !/^\d+$/.test(pieces))) {
                  return `${label}${t("validation.wholeNumber")}`;
                }
                if (!cartons && !pieces) return `${label}${t("validation.quantityPositive")}`;
              }
              if (entry === "damage") {
                if (!input.damaged || !/^\d+$/.test(input.damaged) || input.damaged === "0") {
                  return `${label}${t("validation.quantityPositive")}`;
                }
              }
              if (entry === "commission") {
                if (
                  !input.commission ||
                  !/^\d+(\.\d{1,2})?$/.test(input.commission) ||
                  !/[1-9]/.test(input.commission)
                ) {
                  return `${label}${t("validation.amountPositive")}`;
                }
              }
            }
            let next = draft;
            for (const input of patches) next = upsertEntry(next, entry, input);
            onChange(next);
            return undefined;
          }}
        />
      ) : null}
      {byDsr.map(([dsrId, group]) => (
        <ReadOnlyLinesTable
          key={dsrId}
          title={group.name}
          lines={group.lines}
          view={view}
          locked={locked}
          onRemove={removeLine}
        />
      ))}
      {draft.lines.length > 0 ? (
        <ReadOnlyLinesTable
          title={t("dsr.entry.srTotal")}
          lines={draft.lines}
          view={view}
          locked={locked || byDsr.length > 0}
          onRemove={removeLine}
        />
      ) : (
        <p className="text-sm text-text-muted">{t("dsr.entry.empty")}</p>
      )}
    </div>
  );
}
