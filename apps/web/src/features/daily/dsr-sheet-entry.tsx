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
/** UI-only: pending until Save All; active once persisted (not sent to the API). */
export type LineEntryStatus = "pending" | "active";

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
  entryStatus: LineEntryStatus;
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
    entryStatus: "pending",
  };
}

/** Mark every line active after a successful Save All. */
export function markLinesActive(draft: SheetDraft): SheetDraft {
  return {
    ...draft,
    lines: draft.lines.map((l) =>
      l.entryStatus === "active" ? l : { ...l, entryStatus: "active" },
    ),
  };
}

/** Whole qty/carton fields: blank + blank → blank; otherwise sum as integers. */
function addWhole(a: string | undefined, b: string | undefined): string {
  const left = clean(a) || "0";
  const right = clean(b) || "0";
  const sum = toDecimal(left).plus(toDecimal(right));
  return sum.isZero() ? "" : sum.toFixed(0);
}

/** Money fields (commission): sum to 2 places; blank when zero. */
function addMoney(a: string | undefined, b: string | undefined): string {
  const sum = toDecimal(clean(a) || "0").plus(toDecimal(clean(b) || "0"));
  return sum.isZero() ? "" : sum.toFixed(2);
}

/**
 * Merge a form submission into the draft. Same DSR+product+batch adds quantities
 * (carton/piece/damage/commission) instead of replacing them.
 */
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
  let next: LineDraft = { ...base, batchKey: input.batchKey, entryStatus: "pending" };
  if (kind === "samari") {
    next = {
      ...next,
      issuedCartons: addWhole(existing?.issuedCartons, input.cartons),
      issuedPieces: addWhole(existing?.issuedPieces, input.pieces),
      ...(input.salePrice !== undefined ? { salePrice: input.salePrice || undefined } : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice || undefined } : {}),
    };
  } else if (kind === "firot") {
    next = {
      ...next,
      returnedCartons: addWhole(existing?.returnedCartons, input.cartons),
      returnedPieces: addWhole(existing?.returnedPieces, input.pieces),
    };
  } else if (kind === "damage") {
    next = {
      ...next,
      damaged: addWhole(existing?.damaged, input.damaged),
      damageRate: input.damageRate || existing?.damageRate || undefined,
    };
  } else {
    next = { ...next, commission: addMoney(existing?.commission, input.commission) };
  }
  const lines = existing
    ? draft.lines.map((l) => (lineKeyOf(l) === key ? next : l))
    : [...draft.lines, next];
  return { ...draft, lines };
}

type EntryRowDraft = {
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

const emptyEntryRow = (): EntryRowDraft => ({
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

/** One product row under a sheet-level DSR; Add Item appends, fields clear, DSR stays. */
function EntryFormPanel({
  kind,
  view,
  dsr,
  canEditPrices,
  onAdd,
}: {
  kind: EntryKind;
  view: DayView;
  dsr: DsrChoice | undefined;
  canEditPrices: boolean;
  onAdd: (input: EntryPatch) => string | undefined;
}) {
  const id = useId();
  const [row, setRow] = useState<EntryRowDraft>(emptyEntryRow);
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

  const product = view.products.find((p) => p.productId === row.productId);
  const batches = product
    ? productBatches(product, view, row.batchKey ? [row.batchKey] : [])
    : [];
  const batch = batches.find((b) => b.key === row.batchKey) ?? batches[0];

  function patch(next: Partial<EntryRowDraft>) {
    setRow((cur) => ({ ...cur, ...next }));
  }

  function addItem() {
    setError(undefined);
    if (!dsr) return setError(t("validation.daily.lineDsrOnly"));
    if (!product) return setError(t("validation.daily.unknownProduct"));
    const key = batch?.key ?? "";
    if (!key && kind !== "damage") return setError(t("dsr.sheet.noStock"));
    const sale = canEditPrices ? clean(row.salePrice) : "";
    const cost = canEditPrices ? clean(row.costPrice) : "";
    const msg = onAdd({
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
    if (msg) return setError(msg);
    setRow(emptyEntryRow());
  }

  const details =
    product && batch
      ? `${product.sku} · ${product.productName} · ${t("batch.available")} ${stockCartonPiece(batch.quantity, product.piecesPerCarton)}`
      : product
        ? `${product.sku} · ${product.productName}`
        : null;

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        addItem();
      }}
      noValidate
    >
      <h3 className="font-semibold tracking-tight">{t(`dsr.entry.${kind}`)}</h3>
      {error ? <StatePanel tone="error" title={error} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={`${id}-item`} label={t("dsr.entry.item")}>
          <Combobox
            id={`${id}-item`}
            text={row.productText}
            onTextChange={(text) => patch({ productText: text, productId: null, batchKey: "" })}
            options={productOptions}
            selectedId={row.productId}
            onChoose={(choice) => {
              if (choice.kind !== "option") return;
              patch({
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
              patch({ productText: selected?.label ?? "" });
            }}
          />
        </Field>
        {kind === "samari" || kind === "firot" ? (
          <>
            <Field id={`${id}-cartons`} label={t("godown.column.cartons")}>
              <input
                id={`${id}-cartons`}
                inputMode="numeric"
                value={row.cartons}
                onChange={(e) => patch({ cartons: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field id={`${id}-pieces`} label={t("godown.column.pieces")}>
              <input
                id={`${id}-pieces`}
                inputMode="numeric"
                value={row.pieces}
                onChange={(e) => patch({ pieces: e.target.value })}
                className={inputClass}
              />
            </Field>
          </>
        ) : null}
        {kind === "damage" ? (
          <>
            <Field id={`${id}-damaged`} label={t("dsr.sheet.damaged")}>
              <input
                id={`${id}-damaged`}
                inputMode="numeric"
                value={row.damaged}
                onChange={(e) => patch({ damaged: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field id={`${id}-rate`} label={t("dsr.sheet.damageRate")}>
              <input
                id={`${id}-rate`}
                inputMode="decimal"
                value={row.damageRate || batch?.salePrice || product?.salePrice || ""}
                onChange={(e) => patch({ damageRate: e.target.value })}
                className={inputClass}
              />
            </Field>
          </>
        ) : null}
        {kind === "commission" ? (
          <Field id={`${id}-commission`} label={t("dsr.sheet.commission")}>
            <input
              id={`${id}-commission`}
              inputMode="decimal"
              value={row.commission}
              onChange={(e) => patch({ commission: e.target.value })}
              className={inputClass}
            />
          </Field>
        ) : null}
        {product ? (
          <Field id={`${id}-batch`} label={t("dsr.sheet.batch")}>
            <select
              id={`${id}-batch`}
              value={batch?.key ?? ""}
              onChange={(event) => patch({ batchKey: event.target.value })}
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
        {kind === "samari" && canEditPrices ? (
          <>
            <Field id={`${id}-sale`} label={t("dsr.sheet.batchSalePrice")}>
              <input
                id={`${id}-sale`}
                inputMode="decimal"
                value={row.salePrice || batch?.salePrice || product?.salePrice || ""}
                onChange={(e) => patch({ salePrice: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field id={`${id}-cost`} label={t("dsr.sheet.costPrice")}>
              <input
                id={`${id}-cost`}
                inputMode="decimal"
                value={row.costPrice || batch?.costPrice || ""}
                onChange={(e) => patch({ costPrice: e.target.value })}
                className={inputClass}
              />
            </Field>
          </>
        ) : null}
      </div>
      {details ? (
        <p className="text-sm text-info">
          {t("dsr.entry.itemDetails")}: {details}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary">
          {t("dsr.entry.add")}
        </Button>
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
              <th scope="col" className={thClass}>
                {t("common.status")}
              </th>
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
              const pending = line.entryStatus === "pending";
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
                  <td className={tdClass}>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                        pending
                          ? "bg-error text-white"
                          : "bg-success/15 text-success"
                      }`}
                    >
                      {t(pending ? "dsr.entry.status.pending" : "dsr.entry.status.active")}
                    </span>
                  </td>
                  {!locked ? (
                    <td className={`${tdClass} text-right`}>
                      <button
                        type="button"
                        className="inline-flex size-8 items-center justify-center rounded-md bg-error text-white transition-opacity hover:opacity-90"
                        aria-label={t("common.delete")}
                        onClick={() => onRemove(line.id)}
                      >
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          className="size-4"
                          aria-hidden
                        >
                          <path d="M5 5l10 10M15 5L5 15" />
                        </svg>
                      </button>
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

function lineMatchesSearch(line: LineDraft, view: DayView, q: string): boolean {
  if (!q) return true;
  const product = view.products.find((p) => p.productId === line.productId);
  const hay = [product?.productName, product?.sku, line.dsrStaffName, line.batchKey]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** D122: POS-style add-item under one DSR, then Save All; DSR-wise tables + SR total. */
export function DsrSheetEntry({
  draft,
  view,
  dsrs,
  sheetStaffId,
  locked,
  canEditPrices,
  issuedLocked,
  onChange,
  onSaveAll,
  saveDisabled,
  savePending,
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
  onSaveAll?: () => void;
  saveDisabled?: boolean;
  savePending?: boolean;
}) {
  const dsrFieldId = useId();
  const searchId = useId();
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const [dsrId, setDsrId] = useState("");
  const [search, setSearch] = useState("");
  const selectedDsr = dsrs.find((d) => d.id === dsrId);
  const searchQ = search.trim().toLowerCase();

  /** Named tables only for real DSRs — legacy lines backfilled to the SR stay in এসআর মোট only. */
  const byDsr = useMemo(() => {
    const dsrIds = new Set(dsrs.map((d) => d.id));
    const map = new Map<string, { name: string; lines: LineDraft[] }>();
    for (const line of draft.lines) {
      if (line.dsrStaffId === sheetStaffId || !dsrIds.has(line.dsrStaffId)) continue;
      if (!lineMatchesSearch(line, view, searchQ)) continue;
      const group = map.get(line.dsrStaffId) ?? { name: line.dsrStaffName, lines: [] };
      group.lines.push(line);
      map.set(line.dsrStaffId, group);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "bn"));
  }, [draft.lines, dsrs, sheetStaffId, view, searchQ]);

  const filteredAll = useMemo(
    () => draft.lines.filter((l) => lineMatchesSearch(l, view, searchQ)),
    [draft.lines, view, searchQ],
  );

  const removeLine = (id: string) =>
    onChange({ ...draft, lines: draft.lines.filter((l) => l.id !== id) });

  function addPatch(kind: EntryKind, input: EntryPatch): string | undefined {
    const cartons = input.cartons ?? "";
    const pieces = input.pieces ?? "";
    if (kind === "samari" || kind === "firot") {
      if ((cartons && !/^\d+$/.test(cartons)) || (pieces && !/^\d+$/.test(pieces))) {
        return t("validation.wholeNumber");
      }
      if (!cartons && !pieces) return t("validation.quantityPositive");
    }
    if (kind === "damage") {
      if (!input.damaged || !/^\d+$/.test(input.damaged) || input.damaged === "0") {
        return t("validation.quantityPositive");
      }
    }
    if (kind === "commission") {
      if (
        !input.commission ||
        !/^\d+(\.\d{1,2})?$/.test(input.commission) ||
        !/[1-9]/.test(input.commission)
      ) {
        return t("validation.amountPositive");
      }
    }
    onChange(upsertEntry(draft, kind, input));
    return undefined;
  }

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
        <div className="flex flex-col gap-3">
          <div className="max-w-sm">
            <DsrSelect
              id={dsrFieldId}
              value={dsrId}
              dsrs={dsrs}
              onChange={setDsrId}
              label="staffCash.dsr"
              emptyLabel="staffCash.dsrEmpty"
            />
            <p className="mt-1 text-xs text-text-muted">{t("dsr.entry.dsrOnceHint")}</p>
          </div>
          <EntryFormPanel
            key={entry}
            kind={entry}
            view={view}
            dsr={selectedDsr}
            canEditPrices={canEditPrices}
            onAdd={(input) => addPatch(entry, input)}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onSaveAll && !locked ? (
          <Button variant="primary" disabled={saveDisabled} onClick={onSaveAll}>
            {savePending ? t("common.saving") : t("dsr.entry.saveAll")}
          </Button>
        ) : (
          <span />
        )}
        <input
          id={searchId}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("dsr.entry.search")}
          aria-label={t("dsr.entry.search")}
          className={`${inputClass} min-w-[12rem] max-w-xs`}
        />
      </div>
      {byDsr.map(([dsrKey, group]) => (
        <ReadOnlyLinesTable
          key={dsrKey}
          title={group.name}
          lines={group.lines}
          view={view}
          locked={locked}
          onRemove={removeLine}
        />
      ))}
      {filteredAll.length > 0 ? (
        <ReadOnlyLinesTable
          title={t("dsr.entry.srTotal")}
          lines={filteredAll}
          view={view}
          locked={locked || byDsr.length > 0}
          onRemove={removeLine}
        />
      ) : (
        <p className="text-sm text-text-muted">
          {draft.lines.length > 0 ? t("dsr.entry.searchEmpty") : t("dsr.entry.empty")}
        </p>
      )}
    </div>
  );
}
