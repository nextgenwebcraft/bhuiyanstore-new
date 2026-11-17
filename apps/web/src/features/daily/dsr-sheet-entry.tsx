"use client";

import type { DayView } from "@bsd/contracts";
import { sumAmounts, sumQuantities, toBaseQuantity, toCartonDisplay, toDecimal } from "@bsd/domain";
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
import { batchName, CellInput, clean } from "./daily-kit";

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

function productBatches(product: Product, _view: DayView, named: readonly string[]): BatchOption[] {
  const out = new Map<string, BatchOption>();
  for (const b of product.batches) {
    // D34: only batches with pieces left appear in pickers; keep a named empty batch so an
    // already-chosen line can still display its selection.
    if (toDecimal(b.quantity).lte(0) && !named.includes(b.key)) continue;
    out.set(b.key, b);
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}

/** Net pieces a draft line takes from its batch (issued − returned). */
export function lineNetPieces(line: LineDraft, piecesPerCarton: string): string {
  const issued = toBaseQuantity(
    clean(line.issuedCartons) || "0",
    clean(line.issuedPieces) || "0",
    piecesPerCarton,
  );
  const returned = toBaseQuantity(
    clean(line.returnedCartons) || "0",
    clean(line.returnedPieces) || "0",
    piecesPerCarton,
  );
  return toDecimal(issued).sub(toDecimal(returned)).toString();
}

/** Other SRs' same-date draft lines (D137 soft reservation). */
export type PeerDraftTake = {
  productId: string;
  batchKey: string;
  issued: string;
  returned: string;
};

/** Sum of max(0, issued − returned) for a product/batch across peer draft takes. */
export function peerDraftReservedNet(
  peers: readonly PeerDraftTake[],
  productId: string,
  batchKey: string,
): string {
  return peers
    .filter((l) => l.productId === productId && l.batchKey === batchKey)
    .reduce((sum, l) => {
      const net = toDecimal(l.issued).sub(toDecimal(l.returned));
      return net.gt(0) ? sum.add(net) : sum;
    }, toDecimal("0"))
    .toString();
}

/**
 * Remaining pieces on a batch after the sheet's current lines. `baselineLines` are the posted
 * sheet's lines already reflected in the day-view batch qty (empty while the sheet is still a
 * draft); adding them back then subtracting the draft nets keeps the figure live while editing.
 * D137: also subtract other SRs' same-date draft nets (`peerDraftTakes`).
 */
export function batchStockRemaining(
  view: DayView,
  draftLines: readonly LineDraft[],
  baselineLines: readonly LineDraft[],
  productId: string,
  batchKey: string,
  peerDraftTakes: readonly PeerDraftTake[] = [],
): string {
  const product = view.products.find((p) => p.productId === productId);
  const batch = product?.batches.find((b) => b.key === batchKey);
  const ppc = product?.piecesPerCarton ?? "1";
  const netOf = (lines: readonly LineDraft[]) =>
    lines
      .filter((l) => l.productId === productId && l.batchKey === batchKey)
      .reduce((sum, l) => sum.add(toDecimal(lineNetPieces(l, ppc))), toDecimal("0"));
  return toDecimal(batch?.quantity ?? "0")
    .add(netOf(baselineLines))
    .sub(netOf(draftLines))
    .sub(peerDraftReservedNet(peerDraftTakes, productId, batchKey))
    .toString();
}

function emptyLine(dsr: DsrChoice, productId: string, batchKey: string): LineDraft {
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
  const left = clean(a ?? "") || "0";
  const right = clean(b ?? "") || "0";
  const sum = toDecimal(left).plus(toDecimal(right));
  return sum.isZero() ? "" : sum.toFixed(0);
}

/** Money fields (commission): sum to 2 places; blank when zero. */
function addMoney(a: string | undefined, b: string | undefined): string {
  const sum = toDecimal(clean(a ?? "") || "0").plus(toDecimal(clean(b ?? "") || "0"));
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

/** Equal-width fields on the single entry row. */
const entryFieldClass = "min-w-[8rem] flex-1 basis-0";

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
  const batches = product ? productBatches(product, view, row.batchKey ? [row.batchKey] : []) : [];
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

  // Product-level stock (all batches combined); the batch dropdown still shows per-batch qty.
  const details = product
    ? `${product.sku} · ${product.productName} · ${t("batch.available")} ${stockCartonPiece(product.stock, product.piecesPerCarton)}`
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
      <div className="flex flex-nowrap items-end gap-2 overflow-x-auto pb-1">
        <Field id={`${id}-item`} label={t("dsr.entry.item")} className={entryFieldClass}>
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
            <Field
              id={`${id}-cartons`}
              label={t("godown.column.cartons")}
              className={entryFieldClass}
            >
              <input
                id={`${id}-cartons`}
                inputMode="numeric"
                value={row.cartons}
                onChange={(e) => patch({ cartons: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field
              id={`${id}-pieces`}
              label={t("godown.column.pieces")}
              className={entryFieldClass}
            >
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
            <Field id={`${id}-damaged`} label={t("dsr.sheet.damaged")} className={entryFieldClass}>
              <input
                id={`${id}-damaged`}
                inputMode="numeric"
                value={row.damaged}
                onChange={(e) => patch({ damaged: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field id={`${id}-rate`} label={t("dsr.sheet.damageRate")} className={entryFieldClass}>
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
          <Field
            id={`${id}-commission`}
            label={t("dsr.sheet.commission")}
            className={entryFieldClass}
          >
            <input
              id={`${id}-commission`}
              inputMode="decimal"
              value={row.commission}
              onChange={(e) => patch({ commission: e.target.value })}
              className={inputClass}
            />
          </Field>
        ) : null}
        <Field id={`${id}-batch`} label={t("dsr.sheet.batch")} className={entryFieldClass}>
          <select
            id={`${id}-batch`}
            value={batch?.key ?? ""}
            disabled={!product}
            onChange={(event) => patch({ batchKey: event.target.value })}
            className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {!product ? <option value="">{t("dsr.entry.item")}</option> : null}
            {product && batches.length === 0 ? (
              <option value="">{t("dsr.sheet.noStock")}</option>
            ) : null}
            {product
              ? batches.map((o) => (
                  <option key={o.key} value={o.key}>
                    {batchName(o)} · {t("batch.available")}{" "}
                    {stockCartonPiece(o.quantity, product.piecesPerCarton)}
                  </option>
                ))
              : null}
          </select>
        </Field>
        {kind === "samari" && canEditPrices ? (
          <>
            <Field
              id={`${id}-sale`}
              label={t("dsr.sheet.batchSalePrice")}
              className={entryFieldClass}
            >
              <input
                id={`${id}-sale`}
                inputMode="decimal"
                value={row.salePrice || batch?.salePrice || product?.salePrice || ""}
                onChange={(e) => patch({ salePrice: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field id={`${id}-cost`} label={t("dsr.sheet.costPrice")} className={entryFieldClass}>
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
      <div>
        <Button type="submit" variant="secondary">
          {t("dsr.entry.add")}
        </Button>
      </div>
    </form>
  );
}

/** Resolve batch seq for display (never hardcode 0). */
function batchSeqOf(view: DayView, productId: string, batchKey: string): number {
  const product = view.products.find((p) => p.productId === productId);
  const fromProduct = product?.batches.find((b) => b.key === batchKey);
  if (fromProduct) return fromProduct.seq;
  for (const person of view.persons) {
    if (person.productId !== productId) continue;
    const alloc = person.allocations.find((a) => a.key === batchKey);
    if (alloc) return alloc.seq;
  }
  return 0;
}

/** Line override, else batch, else product — same rule as sheet save. */
function displaySaleOf(line: LineDraft, view: DayView): string | null {
  if (line.salePrice) return line.salePrice;
  const product = view.products.find((p) => p.productId === line.productId);
  if (!product) return null;
  const batch = productBatches(product, view, [line.batchKey]).find((b) => b.key === line.batchKey);
  return batch?.salePrice || product.salePrice || null;
}

function displayCostOf(line: LineDraft, view: DayView): string | null {
  if (line.costPrice) return line.costPrice;
  const product = view.products.find((p) => p.productId === line.productId);
  if (!product) return null;
  const batch = productBatches(product, view, [line.batchKey]).find((b) => b.key === line.batchKey);
  return batch?.costPrice || product.costPrice || null;
}

/** Per-line বিক্রি (টাকা): সামারি − ফিরত − ড্যামেজ − কমিশন at sale / damage rates. */
function lineNetAmount(line: LineDraft, view: DayView): string {
  const product = view.products.find((p) => p.productId === line.productId);
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
  const damaged = clean(line.damaged) || "0";
  const sale = displaySaleOf(line, view) ?? "0";
  const damageRate = clean(line.damageRate ?? "") || sale;
  return toDecimal(issued)
    .mul(sale)
    .sub(toDecimal(returned).mul(sale))
    .sub(toDecimal(damaged).mul(damageRate))
    .sub(toDecimal(clean(line.commission) || "0"))
    .toString();
}

function sortLinesBySku(lines: readonly LineDraft[], view: DayView): LineDraft[] {
  return [...lines].sort((a, b) => {
    const skuA = view.products.find((p) => p.productId === a.productId)?.sku ?? "";
    const skuB = view.products.find((p) => p.productId === b.productId)?.sku ?? "";
    const cmp = skuA.localeCompare(skuB, undefined, { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp;
    return batchSeqOf(view, a.productId, a.batchKey) - batchSeqOf(view, b.productId, b.batchKey);
  });
}

/**
 * One row per product+batch in a table: sum qty/money across DSRs (এসআর মোট).
 * Draft lines stay separate by DSR in storage; this is display-only.
 */
function mergeLinesByProductBatch(lines: readonly LineDraft[]): LineDraft[] {
  const map = new Map<string, LineDraft>();
  for (const line of lines) {
    const key = `${line.productId}|${line.batchKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...line });
      continue;
    }
    map.set(key, {
      ...existing,
      issuedCartons: addWhole(existing.issuedCartons, line.issuedCartons),
      issuedPieces: addWhole(existing.issuedPieces, line.issuedPieces),
      returnedCartons: addWhole(existing.returnedCartons, line.returnedCartons),
      returnedPieces: addWhole(existing.returnedPieces, line.returnedPieces),
      damaged: addWhole(existing.damaged, line.damaged),
      commission: addMoney(existing.commission, line.commission),
      damageRate: existing.damageRate || line.damageRate,
      salePrice: existing.salePrice || line.salePrice,
      costPrice: existing.costPrice || line.costPrice,
      entryStatus:
        existing.entryStatus === "pending" || line.entryStatus === "pending" ? "pending" : "active",
    });
  }
  return [...map.values()];
}

function ReadOnlyLinesTable({
  title,
  lines,
  allDraftLines,
  baselineLines,
  peerDraftTakes,
  view,
  locked,
  canEdit,
  canEditPrices,
  issuedLocked,
  onRemove,
  onUpdate,
}: {
  title: string;
  lines: readonly LineDraft[];
  /** Full sheet draft — remaining stock sums nets across every DSR line on the batch. */
  allDraftLines: readonly LineDraft[];
  baselineLines: readonly LineDraft[];
  peerDraftTakes: readonly PeerDraftTake[];
  view: DayView;
  locked: boolean;
  canEdit: boolean;
  canEditPrices: boolean;
  issuedLocked: boolean;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<LineDraft>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<LineDraft>>({});
  if (lines.length === 0) return null;
  const productOf = (id: string) => view.products.find((p) => p.productId === id);
  const sorted = sortLinesBySku(lines, view);
  const totalAmount = sumAmounts(["0", ...sorted.map((l) => lineNetAmount(l, view))]);
  const displayLines = sorted.map((line) => {
    if (editingId !== line.id) return line;
    return { ...line, ...edit };
  });

  function startEdit(line: LineDraft) {
    setEditingId(line.id);
    setEdit({
      issuedCartons: line.issuedCartons,
      issuedPieces: line.issuedPieces,
      returnedCartons: line.returnedCartons,
      returnedPieces: line.returnedPieces,
      damaged: line.damaged,
      damageRate: line.damageRate ?? "",
      commission: line.commission,
      salePrice: line.salePrice ?? "",
      costPrice: line.costPrice ?? "",
    });
  }

  function saveEdit(id: string) {
    const line = lines.find((l) => l.id === id);
    if (line) {
      const nextLine = { ...line, ...edit };
      const stockDraft = allDraftLines.map((l) => (l.id === id ? nextLine : l));
      const rem = batchStockRemaining(
        view,
        stockDraft,
        baselineLines,
        nextLine.productId,
        nextLine.batchKey,
        peerDraftTakes,
      );
      if (toDecimal(rem).lt(0)) return;
    }
    onUpdate(id, edit);
    setEditingId(null);
    setEdit({});
  }

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
              <th scope="col" className={thNum}>
                {t("dsr.sheet.engineAmount")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.stock")}
              </th>
              <th scope="col" className={thClass}>
                {t("common.status")}
              </th>
              {canEdit || !locked ? (
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("common.edit")}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((line) => {
              const product = productOf(line.productId);
              const size = product?.piecesPerCarton ?? "1";
              const editing = editingId === line.id;
              const row = editing ? { ...line, ...edit } : line;
              const issued = toBaseQuantity(
                clean(row.issuedCartons) || "0",
                clean(row.issuedPieces) || "0",
                size,
              );
              const returned = toBaseQuantity(
                clean(row.returnedCartons) || "0",
                clean(row.returnedPieces) || "0",
                size,
              );
              const pending = line.entryStatus === "pending";
              const seq = batchSeqOf(view, line.productId, line.batchKey);
              const sale = displaySaleOf(row as LineDraft, view);
              const cost = displayCostOf(row as LineDraft, view);
              const amount = lineNetAmount(row as LineDraft, view);
              const stockLines = displayLines.map((l) =>
                l.id === line.id ? (row as LineDraft) : l,
              );
              // Prefer full-sheet lines so multi-DSR takes on one batch share one remaining figure.
              const stockDraft = allDraftLines.map((l) =>
                l.id === line.id ? (row as LineDraft) : l,
              );
              const remaining = batchStockRemaining(
                view,
                stockDraft.length > 0 ? stockDraft : stockLines,
                baselineLines,
                line.productId,
                line.batchKey,
                peerDraftTakes,
              );
              return (
                <tr key={line.id} className="border-t border-border">
                  <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                    <div>{product?.productName ?? line.productId}</div>
                    <div className="text-xs font-normal text-text-muted">{product?.sku}</div>
                  </th>
                  <td className={tdClass}>{batchName({ key: line.batchKey, seq })}</td>
                  <td className={tdNum}>
                    {editing && !issuedLocked ? (
                      <span className="inline-flex gap-1">
                        <CellInput
                          label={t("dsr.sheet.issued")}
                          value={edit.issuedCartons ?? ""}
                          onChange={(issuedCartons) => setEdit((e) => ({ ...e, issuedCartons }))}
                          width="w-14"
                        />
                        <CellInput
                          label={t("godown.column.pieces")}
                          value={edit.issuedPieces ?? ""}
                          onChange={(issuedPieces) => setEdit((e) => ({ ...e, issuedPieces }))}
                          width="w-14"
                        />
                      </span>
                    ) : (
                      <CartonQty pieces={issued} piecesPerCarton={size} />
                    )}
                  </td>
                  <td className={tdNum}>
                    {editing ? (
                      <span className="inline-flex gap-1">
                        <CellInput
                          label={t("dsr.sheet.returned")}
                          value={edit.returnedCartons ?? ""}
                          onChange={(returnedCartons) =>
                            setEdit((e) => ({ ...e, returnedCartons }))
                          }
                          width="w-14"
                        />
                        <CellInput
                          label={t("godown.column.pieces")}
                          value={edit.returnedPieces ?? ""}
                          onChange={(returnedPieces) => setEdit((e) => ({ ...e, returnedPieces }))}
                          width="w-14"
                        />
                      </span>
                    ) : (
                      <CartonQty pieces={returned} piecesPerCarton={size} />
                    )}
                  </td>
                  <td className={tdNum}>
                    {editing ? (
                      <CellInput
                        label={t("dsr.sheet.damaged")}
                        value={edit.damaged ?? ""}
                        onChange={(damaged) => setEdit((e) => ({ ...e, damaged }))}
                        width="w-16"
                      />
                    ) : (
                      quantity(clean(line.damaged) || "0")
                    )}
                  </td>
                  <td className={tdNum}>
                    {editing ? (
                      <CellInput
                        label={t("dsr.sheet.damageRate")}
                        value={edit.damageRate ?? ""}
                        onChange={(damageRate) => setEdit((e) => ({ ...e, damageRate }))}
                        mode="decimal"
                        width="w-20"
                      />
                    ) : line.damageRate ? (
                      formatRate(line.damageRate)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={tdNum}>
                    {editing ? (
                      <CellInput
                        label={t("dsr.sheet.commission")}
                        value={edit.commission ?? ""}
                        onChange={(commission) => setEdit((e) => ({ ...e, commission }))}
                        mode="decimal"
                        width="w-20"
                      />
                    ) : (
                      money(clean(line.commission) || "0")
                    )}
                  </td>
                  <td className={tdNum}>
                    {editing && canEditPrices ? (
                      <CellInput
                        label={t("dsr.sheet.batchSalePrice")}
                        value={edit.salePrice ?? ""}
                        onChange={(salePrice) => setEdit((e) => ({ ...e, salePrice }))}
                        mode="decimal"
                        width="w-20"
                      />
                    ) : sale ? (
                      formatRate(sale)
                    ) : (
                      "—"
                    )}
                  </td>
                  {view.canSeeCost ? (
                    <td className={tdNum}>
                      {editing && canEditPrices ? (
                        <CellInput
                          label={t("dsr.sheet.costPrice")}
                          value={edit.costPrice ?? ""}
                          onChange={(costPrice) => setEdit((e) => ({ ...e, costPrice }))}
                          mode="decimal"
                          width="w-20"
                        />
                      ) : cost ? (
                        formatRate(cost)
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                  <td className={tdNum}>{money(amount)}</td>
                  <td className={tdNum}>
                    <CartonQty pieces={remaining} piecesPerCarton={size} />
                  </td>
                  <td className={tdClass}>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                        pending ? "bg-error text-white" : "bg-success/15 text-success"
                      }`}
                    >
                      {t(pending ? "dsr.entry.status.pending" : "dsr.entry.status.active")}
                    </span>
                  </td>
                  {canEdit || !locked ? (
                    <td className={`${tdClass} text-right whitespace-nowrap`}>
                      {editing ? (
                        <span className="inline-flex gap-1">
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="primary"
                            onClick={() => saveEdit(line.id)}
                          >
                            {t("common.save")}
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => {
                              setEditingId(null);
                              setEdit({});
                            }}
                          >
                            {t("common.cancel")}
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          {canEdit ? (
                            <Button className="px-2 py-1 text-xs" onClick={() => startEdit(line)}>
                              {t("common.edit")}
                            </Button>
                          ) : null}
                          {!locked ? (
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
                          ) : null}
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-text-muted">
        {formatCount(String(sorted.length))} {t("warning.products")} · {t("dsr.sheet.issued")}{" "}
        {quantity(
          sumQuantities(
            sorted.map((l) => {
              const size = productOf(l.productId)?.piecesPerCarton ?? "1";
              return toBaseQuantity(
                clean(l.issuedCartons) || "0",
                clean(l.issuedPieces) || "0",
                size,
              );
            }),
          ),
        )}{" "}
        · {t("dsr.sheet.engineAmount")} {money(totalAmount)}
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
  baselineLines = [],
  peerDraftTakes = [],
  view,
  dsrs,
  sheetStaffId,
  locked,
  canEditPrices,
  issuedLocked,
  onChange,
  onDeleteLine,
  onSaveAll,
  saveDisabled,
  savePending,
}: {
  draft: SheetDraft;
  /** Posted sheet lines already in the day-view batch qty; empty for a new draft. */
  baselineLines?: readonly LineDraft[];
  /** Other SRs' same-date draft nets (D137 soft reservation). */
  peerDraftTakes?: readonly PeerDraftTake[];
  view: DayView;
  dsrs: readonly DsrChoice[];
  /** Open SR for this day sheet — never shown as a DSR group table (D122). */
  sheetStaffId: string;
  locked: boolean;
  canEditPrices: boolean;
  issuedLocked: boolean;
  onChange: (next: SheetDraft) => void;
  /** Active (saved) line: confirm + persist; pending: local remove only. */
  onDeleteLine?: (id: string) => void;
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
    () => mergeLinesByProductBatch(draft.lines.filter((l) => lineMatchesSearch(l, view, searchQ))),
    [draft.lines, view, searchQ],
  );

  const removeLine = (id: string) => {
    if (onDeleteLine) {
      onDeleteLine(id);
      return;
    }
    onChange({ ...draft, lines: draft.lines.filter((l) => l.id !== id) });
  };

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
    const next = upsertEntry(draft, kind, input);
    if (kind === "samari" || kind === "firot") {
      const rem = batchStockRemaining(
        view,
        next.lines,
        baselineLines,
        input.productId,
        input.batchKey,
        peerDraftTakes,
      );
      if (toDecimal(rem).lt(0)) return t("validation.exceedsAvailable");
    }
    onChange(next);
    return undefined;
  }

  return (
    <div className="flex flex-col gap-4">
      {!locked ? (
        <div className="flex flex-wrap gap-2">
          {ENTRY_KINDS.map((kind) => {
            if (kind === "samari" && issuedLocked) return null;
            const active = entry === kind;
            return (
              <Button
                key={kind}
                variant="secondary"
                aria-pressed={active}
                className={active ? "border-brand bg-brand/12 font-semibold text-text" : ""}
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          id={searchId}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("dsr.entry.search")}
          aria-label={t("dsr.entry.search")}
          className={`${inputClass} max-w-xs min-w-[12rem]`}
        />
      </div>
      {byDsr.map(([dsrKey, group]) => (
        <ReadOnlyLinesTable
          key={dsrKey}
          title={group.name}
          lines={group.lines}
          allDraftLines={draft.lines}
          baselineLines={baselineLines}
          peerDraftTakes={peerDraftTakes}
          view={view}
          locked={locked}
          canEdit={!locked}
          canEditPrices={canEditPrices}
          issuedLocked={issuedLocked}
          onRemove={removeLine}
          onUpdate={(id, patch) =>
            onChange({
              ...draft,
              lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
            })
          }
        />
      ))}
      {filteredAll.length > 0 ? (
        <ReadOnlyLinesTable
          title={t("dsr.entry.srTotal")}
          lines={filteredAll}
          allDraftLines={draft.lines}
          baselineLines={baselineLines}
          peerDraftTakes={peerDraftTakes}
          view={view}
          locked={locked || byDsr.length > 0}
          canEdit={!locked && byDsr.length === 0}
          canEditPrices={canEditPrices}
          issuedLocked={issuedLocked}
          onRemove={removeLine}
          onUpdate={(id, patch) =>
            onChange({
              ...draft,
              lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
            })
          }
        />
      ) : (
        <p className="text-sm text-text-muted">
          {draft.lines.length > 0 ? t("dsr.entry.searchEmpty") : t("dsr.entry.empty")}
        </p>
      )}
      {onSaveAll && !locked ? (
        <div>
          <Button variant="primary" disabled={saveDisabled} onClick={onSaveAll}>
            {savePending ? t("common.saving") : t("dsr.entry.saveAll")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
