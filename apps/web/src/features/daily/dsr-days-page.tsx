"use client";

import type {
  DayView,
  LineAllocation,
  DsrDay,
  DsrDaySaveRequest,
  FieldDay,
  MoneyEntry,
  StaffRecord,
} from "@bsd/contracts";
import {
  cashCheckSales,
  cashInHandOf,
  dsrCashSettlement,
  salesProfit,
  sumAmounts,
  sumQuantities,
  toBaseQuantity,
  toCartonDisplay,
  toDecimal,
} from "@bsd/domain";
import { useAsyncAction } from "@/lib/async-action";
import { formatCount, formatDateTime, formatRate, t } from "@bsd/i18n";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import {
  useDsrDayCommand,
  useDsrDays,
  useDsrFieldDay,
  useMoneyEntries,
  useSaveDsrDay,
  useStaffRecords,
} from "@/data/queries";
import { ShopDueEntry } from "@/features/shops/shop-due-entry";
import { OperatingCostEntry } from "./operating-cost-entry";
import { SrCashEntry } from "./sr-cash-entry";
import { StaffCashEntry } from "./staff-cash-entry";
import { FieldReportCard } from "./field-report-card";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  batchName,
  CellInput,
  DateBar,
  DayGate,
  isFreeAuto,
  SectionTitle,
  clean,
  useWorkingDate,
} from "./daily-kit";
import { inputClass } from "@/components/field";
import {
  CartonQty,
  cartonText,
  StatusChip,
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
import { TableScroller } from "@/components/table-scroller";

const PATH = "sales/daily-summaries";

/** Each column group of the sheet gets its own tint, carried from the header into every row. */
const GROUP = {
  issued: { head: "bg-info/10 text-info", sub: "bg-info/5", cell: "bg-info/[0.03]" },
  returned: { head: "bg-success/10 text-success", sub: "bg-success/5", cell: "bg-success/[0.03]" },
  damaged: { head: "bg-error/10 text-error", sub: "bg-error/5", cell: "bg-error/[0.03]" },
  commission: {
    head: "bg-warning/10 text-warning",
    sub: "bg-warning/5",
    cell: "bg-warning/[0.03]",
  },
} as const;
const groupHead =
  "border-b border-l border-border px-3 py-2 text-center text-xs font-semibold tracking-wide";
const loneHead = "border-l border-border px-3 py-2 text-center text-xs font-semibold align-middle";
const subHead = "border-border px-2 py-1.5 text-center text-[11px] font-medium text-text-muted";
const inputCell = "border-border px-2 py-2 text-center [&_input]:mx-auto";

/** One sheet line: a product taken from one batch (D68); prices left unset are the batch's. */
type LineDraft = {
  id: string;
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
/** The lines of each product, in order; a product without lines shows one blank line. */
type SheetDraft = { lines: Record<string, LineDraft[]>; handedOver: string };

const blankLine = (id: string, batchKey: string): LineDraft => ({
  id,
  batchKey,
  issuedCartons: "",
  issuedPieces: "",
  returnedCartons: "",
  returnedPieces: "",
  damaged: "",
  commission: "",
});
const isAmount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value);
const isUnitPrice = (value: string) => /^\d+(\.\d{1,6})?$/.test(value);

type Product = DayView["products"][number];

/** A batch the sheet can take a product from: the engine's batch with its stock after the day. */
type BatchOption = {
  key: string;
  seq: number;
  quantity: string;
  costPrice: string | null;
  salePrice: string;
  free: boolean;
};

/**
 * The product's batches for the sheet: those in stock, those any sheet took from today (they may
 * be empty now) and those the draft names, oldest first.
 */
function batchOptions(product: Product, view: DayView, named: readonly string[]): BatchOption[] {
  const usedToday = new Map(
    view.persons
      .filter((p) => p.productId === product.productId)
      .flatMap((p) => p.allocations)
      .map((a) => [a.key, a]),
  );
  const out = new Map<string, BatchOption>();
  for (const b of product.batches) {
    if (toDecimal(b.quantity).lte(0) && !usedToday.has(b.key) && !named.includes(b.key)) continue;
    out.set(b.key, { ...b, free: isFreeAuto(b.key, b.costPrice) });
  }
  for (const a of usedToday.values()) {
    if (out.has(a.key)) continue;
    out.set(a.key, {
      key: a.key,
      seq: a.seq,
      quantity: "0",
      costPrice: a.costPrice,
      salePrice: a.salePrice,
      free: isFreeAuto(a.key, a.costPrice),
    });
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}

/** The batch a new line starts from: the oldest in stock not yet on the product's lines. */
function nextBatch(options: BatchOption[], taken: readonly string[]): string {
  const open = options.filter((o) => !taken.includes(o.key));
  return (open.find((o) => toDecimal(o.quantity).gt(0)) ?? open[0])?.key ?? "";
}

/** Every DSR, always (D65: DSRs are global staff of the master company; any DSR assignment counts). */
export function dsrsOn(records: StaffRecord[]) {
  return records.filter((s) => s.assignments.some((a) => a.roleKind === "dsr"));
}

/** আমাদের স্টাফ: distributor-employed people (DSR, manager, driver), not the SR list (D79). */
export function ourStaffOn(records: StaffRecord[]) {
  return records.filter((s) => s.employer === "distributor");
}

/**
 * The same people as এসআর হিসাব (D65, D79): supplier-employed, whatever the assignment
 * role is called. A supplier-employed manager still belongs on this list.
 */
export function srsOn(records: StaffRecord[]) {
  return records.filter((s) => s.employer === "supplier");
}
/** One line's batch allocation as small muted text: "ব্যাচ ১: ৪০ পিস @ ৳২০"; a net return reads "ফেরত ব্যাচ ১: ৫ পিস" (D49). */
function allocationText(allocations: LineAllocation[]): string {
  return allocations
    .filter((a) => !toDecimal(a.quantity).isZero())
    .map((a) => {
      const returned = toDecimal(a.quantity).isNegative();
      const pieces = `${formatCount(returned ? a.quantity.replace("-", "") : a.quantity)} ${t("common.pieces")}`;
      const head = `${returned ? `${t("batch.returned")} ` : ""}${batchName(a)}: ${pieces}`;
      return returned ? head : `${head} @ ${t("batch.currency")}${formatRate(a.salePrice)}`;
    })
    .join(", ");
}

/** Net pieces issued for a line (issued − returned − damaged); used for remaining stock display. */
function netOf(line: LineDraft, size: string): ReturnType<typeof toDecimal> {
  const issued = toBaseQuantity(whole(line.issuedCartons), whole(line.issuedPieces), size);
  const returned = toBaseQuantity(whole(line.returnedCartons), whole(line.returnedPieces), size);
  return toDecimal(issued)
    .sub(toDecimal(returned))
    .sub(toDecimal(whole(line.damaged)));
}

/**
 * A saved total (D89) as its carton and loose-piece fields for editing: whole cartons plus the
 * remainder, each blank when zero.
 */
function split(total: string, size: string): [string, string] {
  if (total === "0") return ["", ""];
  const { cartons, loosePieces } = toCartonDisplay(total, size);
  return [cartons === "0" ? "" : cartons, loosePieces === "0" ? "" : loosePieces];
}

const priceText = (value: string | null) =>
  value === null ? undefined : toDecimal(value).toFixed();

function draftOf(sheet: DsrDay | undefined): SheetDraft {
  const lines: Record<string, LineDraft[]> = {};
  for (const line of sheet?.lines ?? []) {
    const [issuedCartons, issuedPieces] = split(line.issued, line.piecesPerCarton);
    const [returnedCartons, returnedPieces] = split(line.returned, line.piecesPerCarton);
    (lines[line.productId] ??= []).push({
      id: `${line.productId}|${line.batchKey}`,
      batchKey: line.batchKey,
      issuedCartons,
      issuedPieces,
      returnedCartons,
      returnedPieces,
      damaged: line.damaged === "0" ? "" : line.damaged,
      damageRate: priceText(line.damageRate),
      commission: toDecimal(line.commission).isZero() ? "" : line.commission,
      salePrice: priceText(line.salePrice),
      costPrice: priceText(line.costPrice),
    });
  }
  return { lines, handedOver: sheet?.cashHandedOver ?? "" };
}

const whole = (value: string) => clean(value) || "0";
const isWhole = (value: string) => /^\d+$/.test(value);

/**
 * The product's lines in the draft, or its one blank line. A line always names a batch: one
 * without (blank, or saved before) takes the first batch in stock not on another line.
 */
function linesOf(draft: SheetDraft, product: Product, view: DayView): LineDraft[] {
  const own = draft.lines[product.productId] ?? [];
  const taken = own.map((l) => l.batchKey).filter((key) => key !== "");
  const options = batchOptions(product, view, taken);
  if (own.length === 0) return [blankLine(product.productId, nextBatch(options, []))];
  if (own.every((l) => l.batchKey !== "")) return own;
  return own.map((l) => {
    if (l.batchKey !== "") return l;
    const batchKey = nextBatch(options, taken);
    taken.push(batchKey);
    return { ...l, batchKey };
  });
}

/**
 * A line's issued/returned totals (D89: cartons × size + loose pieces, each entered on its own)
 * and damaged pieces, or null when any field is not a whole number.
 */
function piecesOf(line: LineDraft, size: string) {
  const parts = [
    line.issuedCartons,
    line.issuedPieces,
    line.returnedCartons,
    line.returnedPieces,
    line.damaged,
  ].map(whole);
  if (!parts.every(isWhole)) return null;
  const [issuedCartons, issuedPieces, returnedCartons, returnedPieces, damaged] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    issued: toBaseQuantity(issuedCartons, issuedPieces, size),
    returned: toBaseQuantity(returnedCartons, returnedPieces, size),
    damaged,
  };
}

function requestOf(
  draft: SheetDraft,
  view: DayView,
  base: { date: string; staffId: string; version: number },
): DsrDaySaveRequest | string {
  const handed = clean(draft.handedOver);
  if (handed && !isAmount(handed)) return t("validation.opening.amount");
  const lines: DsrDaySaveRequest["lines"] = [];
  for (const product of view.products) {
    const seen = new Set<string>();
    for (const d of linesOf(draft, product, view)) {
      const pieces = piecesOf(d, product.piecesPerCarton);
      if (!pieces) return t("validation.wholeNumber");
      const commission = clean(d.commission) || "0";
      if (!isAmount(commission)) return t("validation.opening.amount");
      const noCommission = toDecimal(commission).isZero();
      const { issued, returned, damaged } = pieces;
      if (issued === "0" && returned === "0" && damaged === "0" && noCommission) continue;
      if (seen.has(d.batchKey)) {
        return `${product.productName}: ${t("validation.daily.duplicateProduct")}`;
      }
      seen.add(d.batchKey);
      const salePrice = d.salePrice === undefined ? undefined : clean(d.salePrice);
      const costPrice =
        d.costPrice === undefined || !view.canSeeCost ? undefined : clean(d.costPrice);
      if ([salePrice, costPrice].some((p) => p !== undefined && !isUnitPrice(p))) {
        return `${product.productName}: ${t("validation.unitPrice.invalid")}`;
      }
      const damageRate =
        damaged === "0"
          ? undefined
          : clean(d.damageRate ?? "") ||
            saleOf(
              { productId: product.productId, batchKey: d.batchKey, salePrice: d.salePrice },
              view,
            );
      if (damageRate !== undefined && !isUnitPrice(damageRate)) {
        return `${product.productName}: ${t("validation.unitPrice.invalid")}`;
      }
      lines.push({
        productId: product.productId,
        batchKey: d.batchKey,
        issued,
        returned,
        damaged,
        commission: noCommission ? "0" : commission,
        ...(salePrice === undefined ? {} : { salePrice }),
        ...(costPrice === undefined ? {} : { costPrice }),
        ...(damageRate === undefined ? {} : { damageRate }),
      });
    }
  }
  return { ...base, cashHandedOver: handed || null, lines };
}

/** The sale price a line uses: its own, else its batch's, else the product's. */
function saleOf(
  line: { productId: string; batchKey?: string | undefined; salePrice?: string | undefined },
  view: DayView,
) {
  if (line.salePrice !== undefined) return line.salePrice;
  const product = view.products.find((p) => p.productId === line.productId);
  if (!product) return "0";
  const key = line.batchKey ?? "";
  const batch = batchOptions(product, view, [key]).find((o) => o.key === key);
  return batch?.salePrice ?? product.salePrice ?? "0";
}

/** The purchase price a line uses: its own, else its batch's, else the product's. */
function costOf(
  line: { productId: string; batchKey?: string | undefined; costPrice?: string | undefined },
  view: DayView,
) {
  if (line.costPrice !== undefined) return line.costPrice;
  const product = view.products.find((p) => p.productId === line.productId);
  if (!product) return "0";
  const key = line.batchKey ?? "";
  const batch = batchOptions(product, view, [key]).find((o) => o.key === key);
  return batch?.costPrice ?? product.costPrice ?? "0";
}

/** One line's sale amount: pieces sold × its price − commission. */
function lineAmount(l: DsrDaySaveRequest["lines"][number], view: DayView): string {
  const sold = toDecimal(l.issued).sub(toDecimal(l.returned)).sub(toDecimal(l.damaged));
  return sold
    .mul(toDecimal(saleOf(l, view)))
    .sub(toDecimal(l.commission ?? "0"))
    .toString();
}

/** Pieces sold × the line's price − commission, before posting (the engine owns the posted figure). */
function previewSales(lines: DsrDaySaveRequest["lines"], view: DayView): string {
  return sumAmounts(["0", ...lines.map((l) => lineAmount(l, view))]);
}

/**
 * বিক্রি (টাকা), per product: samari − firot only (D92) — issued − returned pieces × price, with
 * damage and commission left out. Every other figure on this page keeps the full calculation.
 */
function salariFirotAmounts(lines: DsrDaySaveRequest["lines"], view: DayView): Map<string, string> {
  const byProduct = new Map<string, string[]>();
  for (const l of lines) {
    const sold = toDecimal(l.issued).sub(toDecimal(l.returned));
    const amount = sold.mul(toDecimal(saleOf(l, view))).toString();
    const amts = byProduct.get(l.productId) ?? [];
    amts.push(amount);
    byProduct.set(l.productId, amts);
  }
  return new Map(
    [...byProduct].map(([productId, amts]) => [productId, sumAmounts(["0", ...amts])]),
  );
}

/** The seq of a line's batch, for "the last batch issued" (D68). */
function seqOf(key: string, options: BatchOption[]): number {
  return options.find((o) => o.key === key)?.seq ?? Number(/^auto:(\d+)$/.exec(key)?.[1] ?? 0);
}

const commissionOf = (lines: { commission?: string | undefined }[]) =>
  sumAmounts(["0", ...lines.map((l) => l.commission ?? "0")]);

/**
 * What the DSR recorded on the phone (D40): visits per shop, the samari still in hand and flags
 * where the office sheet disagrees with the field.
 */
function FieldEntries({
  field,
  draft,
  view,
  locked,
  onPrefill,
}: {
  field: FieldDay;
  draft: SheetDraft;
  view: DayView;
  locked: boolean;
  onPrefill: () => void;
}) {
  const prices = new Map(view.products.map((p) => [p.productId, p.salePrice]));
  const priceMismatch = field.visits.some((v) =>
    v.lines.some((l) => {
      const today = prices.get(l.productId);
      return today !== null && today !== undefined && !toDecimal(today).eq(toDecimal(l.unitPrice));
    }),
  );
  const mismatch = (kind: "returned" | "damaged") =>
    field.products.some((p) => {
      const lines = (draft.lines[p.productId] ?? []).map((d) => piecesOf(d, p.piecesPerCarton));
      if (lines.some((l) => l === null)) return true;
      const pieces = sumQuantities(["0", ...lines.map((l) => l?.[kind] ?? "0")]);
      const expected = kind === "returned" ? p.remaining : p.exchanged;
      return !toDecimal(pieces).eq(toDecimal(expected));
    });
  const flags = [
    mismatch("returned") ? t("field.office.firotMismatch") : null,
    mismatch("damaged") ? t("field.office.damagedMismatch") : null,
    priceMismatch ? t("field.office.priceMismatch") : null,
  ].filter((f): f is string => f !== null);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t("field.office.title")}</h3>
          <p className="text-xs text-text-muted">{t("field.office.hint")}</p>
        </div>
        {!locked ? <Button onClick={onPrefill}>{t("field.office.prefill")}</Button> : null}
      </div>
      {flags.length ? (
        <ul className="flex flex-col gap-1 text-sm text-warning">
          {flags.map((f) => (
            <li key={f}>⚠ {f}</li>
          ))}
        </ul>
      ) : null}
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("field.shop")}
              </th>
              <th scope="col" className={thNum}>
                {t("field.salesValue")}
              </th>
              <th scope="col" className={thNum}>
                {t("field.cashReceived")}
              </th>
              <th scope="col" className={thNum}>
                {t("field.dueCreated")}
              </th>
              <th scope="col" className={thNum}>
                {t("field.dueCollected")}
              </th>
              <th scope="col" className={thNum}>
                {t("field.exchanged")}
              </th>
            </tr>
          </thead>
          <tbody>
            {field.visits.map((v) => (
              <tr key={v.id} className="border-t border-border">
                <td className={tdClass}>{v.shopName}</td>
                <td className={tdNum}>{money(v.salesValue)}</td>
                <td className={tdNum}>{money(v.cashReceived)}</td>
                <td className={tdNum}>{money(v.dueCreated)}</td>
                <td className={tdNum}>{money(v.dueCollected)}</td>
                <td className={tdNum}>
                  {quantity(sumQuantities(["0", ...v.lines.map((l) => l.exchanged)]))}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold">
              <td className={tdClass}>{t("common.total")}</td>
              <td className={tdNum}>{money(field.totals.sales)}</td>
              <td className={tdNum}>{money(field.totals.cashReceived)}</td>
              <td className={tdNum}>{money(field.totals.dueCreated)}</td>
              <td className={tdNum}>{money(field.totals.dueCollected)}</td>
              <td className={tdNum}>
                {quantity(sumQuantities(["0", ...field.products.map((p) => p.exchanged)]))}
              </td>
            </tr>
          </tbody>
        </table>
      </TableScroller>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {field.products.map((p) => (
          <li key={p.productId} className="flex justify-between gap-2">
            <span className="truncate">{p.productName}</span>
            <span className="text-text-muted tabular-nums">
              {t("field.office.expectedFirot")}{" "}
              <CartonQty pieces={p.remaining} piecesPerCarton={p.piecesPerCarton} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-muted">{t("field.office.duesFromField")}</p>
    </section>
  );
}

/** Day-end cash check (D39, D62): the difference is shown only, never posted. */
function CashCheck({
  sales,
  damage,
  dueGiven,
  dueCollected,
  expenses,
  staffMoney,
  handedOver,
  locked,
  onHandedOver,
}: {
  sales: string;
  /** ড্যামেজ (বিক্রয় মূল্যে), subtracted from জমা হওয়ার কথা. */
  damage: string;
  dueGiven: string;
  dueCollected: string;
  expenses: string;
  staffMoney: string;
  handedOver: string;
  locked: boolean;
  onHandedOver: (value: string) => void;
}) {
  const handed = clean(handedOver);
  const settlement = dsrCashSettlement({
    sales,
    damage,
    dueGiven,
    dueCollected,
    expenses,
    staffMoney,
    handedOver: handed && /^\d+(\.\d{1,2})?$/.test(handed) ? handed : null,
  });
  const diff = settlement.difference;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("dsr.cash.title")}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {(
          [
            ["dsr.cash.sales", sales],
            ["dsr.profit.damaged", damage],
            ["dsr.cash.dueGiven", dueGiven],
            ["dsr.cash.dueCollected", dueCollected],
            ["dsr.cash.expenses", expenses],
            ["dsr.cash.staffMoney", staffMoney],
            ["dsr.cash.expected", settlement.expected],
          ] as const
        ).map(([key, value]) => (
          <div
            key={key}
            className="flex justify-between gap-2 rounded-md bg-surface-muted px-3 py-2"
          >
            <dt className="text-text-muted">{t(key)}</dt>
            <dd className="font-medium tabular-nums">{money(value)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
          <dt className="text-text-muted">{t("dsr.cash.handedOver")}</dt>
          <dd>
            <CellInput
              label={t("dsr.cash.handedOver")}
              value={handedOver}
              onChange={onHandedOver}
              disabled={locked}
              mode="decimal"
              width="w-28"
            />
          </dd>
        </div>
      </dl>
      {diff !== null ? (
        <p
          className={`text-sm font-semibold ${
            toDecimal(diff).isZero() ? "text-success" : "text-error"
          }`}
        >
          {t("dsr.cash.difference")}: {money(diff)}
          {toDecimal(diff).isNegative() ? ` (${t("dsr.cash.short")})` : ""}
          {toDecimal(diff).gt(0) ? ` (${t("dsr.cash.excess")})` : ""}
        </p>
      ) : null}
      <p className="text-xs text-text-muted">{t("dsr.cash.hint")}</p>
    </section>
  );
}

function SheetEditor({
  companyId,
  date,
  staff,
  sheet,
  history,
  view,
}: {
  companyId: string;
  date: string;
  staff: StaffRecord;
  sheet: DsrDay | undefined;
  history: DsrDay[];
  view: DayView;
}) {
  const { permissions } = useCurrentWorkspace();
  const save = useSaveDsrDay(companyId);
  const command = useDsrDayCommand(companyId);
  const [draft, setDraft] = useState(() => draftOf(sheet));
  const [error, setError] = useState<string | undefined>();
  const action = useAsyncAction();
  const shownError = error ?? action.error;
  const posted = sheet?.status === "posted";
  // D56: a posted sheet stays editable; saving it reverses it and posts the edit in its place.
  const canCorrect = (["sale.create", "sale.post", "sale.reverse"] as const).every((p) =>
    permissions.includes(p),
  );
  const locked = !permissions.includes("sale.create") || (posted && !canCorrect);
  const base = { date, staffId: staff.id, version: sheet?.version ?? 0 };
  const built = requestOf(draft, view, base);
  const dirty =
    typeof built === "string" ||
    JSON.stringify(built) !== JSON.stringify(requestOf(draftOf(sheet), view, base));
  const pending = save.isPending || command.isPending;
  const amounts = new Map(
    view.persons.filter((p) => p.staffId === staff.id).map((p) => [p.productId, p.amount]),
  );
  const allocations = new Map(
    view.persons.filter((p) => p.staffId === staff.id).map((p) => [p.productId, p.allocations]),
  );
  const entered = typeof built === "string" ? [] : built.lines;
  // বিক্রি (টাকা): samari − firot only (D92), always from the sheet's own lines.
  const salariFirot = salariFirotAmounts(entered, view);
  const salariFirotAmount = (productId: string) => salariFirot.get(productId) ?? "0";
  const fieldDay = useDsrFieldDay(
    companyId,
    staff.id,
    date,
    staff.assignments.some((a) => a.roleKind === "dsr"),
  );
  const records = useStaffRecords(companyId);
  const dsrChoices = dsrsOn(records.data ?? []).map((dsr) => ({ id: dsr.id, name: dsr.name }));
  const staffChoices = ourStaffOn(records.data ?? []).map((person) => ({
    id: person.id,
    name: person.name,
  }));
  const entries = useMoneyEntries(companyId, { from: date, to: date, staffId: staff.id });
  const field = fieldDay.data && fieldDay.data.visits.length > 0 ? fieldDay.data : null;
  const posts = (entries.data ?? []).filter((e) => e.status === "posted");
  const entrySum = (kind: MoneyEntry["kind"]) =>
    sumAmounts(["0", ...posts.filter((e) => e.kind === kind).map((e) => e.amount)]);
  const srMove = (kind: "srLoan" | "srRepayment") =>
    sumAmounts([
      "0",
      ...posts.filter((e) => e.kind === kind && e.srLoanType !== "commission").map((e) => e.amount),
    ]);
  const sheetDue = (value: string | undefined) => value ?? "0";
  const cash = {
    sales: posted && !dirty ? sumAmounts(["0", ...amounts.values()]) : previewSales(entered, view),
    dueGiven: field
      ? field.totals.dueCreated
      : sumAmounts([entrySum("marketDueNew"), sheetDue(sheet?.marketDueNew)]),
    dueCollected: field
      ? field.totals.dueCollected
      : sumAmounts([entrySum("marketDueCollected"), sheetDue(sheet?.marketDueCollected)]),
    expenses: entrySum("staffCostPaid"),
    // D79: the open person's advance and short. An SR's are srLoan (cash or shortage);
    // a DSR sheet still counts staffAdvance and staffShortage. Commission is not this line.
    staffMoney: toDecimal(entrySum("staffRepayment"))
      .add(srMove("srRepayment"))
      .sub(toDecimal(entrySum("staffAdvance")))
      .sub(toDecimal(entrySum("staffShortage")))
      .sub(srMove("srLoan"))
      .toString(),
  };
  // হাতে জমা (D106): sales − due given + due collected, before expenses or staff money.
  const cashInHand = cashInHandOf(cash);

  /**
   * Firot = samari still in hand, damaged = pieces exchanged at shops; both go on the product's
   * last batch issued (D68), the product's other lines get none.
   */
  function prefillFromField() {
    if (!field) return;
    setDraft((d) => {
      const lines = { ...d.lines };
      for (const p of field.products) {
        const product = view.products.find((v) => v.productId === p.productId);
        if (!product) continue;
        const size = product.piecesPerCarton;
        const own = linesOf(d, product, view);
        const options = batchOptions(
          product,
          view,
          own.map((l) => l.batchKey),
        );
        if (options.length === 0) continue;
        const issued = own.filter((l) => {
          const pieces = piecesOf(l, size);
          return pieces !== null && pieces.issued !== "0";
        });
        const target = (issued.length ? issued : own).reduce((best, l) =>
          seqOf(l.batchKey, options) > seqOf(best.batchKey, options) ? l : best,
        );
        const [returnedCartons, returnedPieces] = split(p.remaining, size);
        lines[p.productId] = own.map((l) =>
          l.id === target.id
            ? {
                ...l,
                returnedCartons,
                returnedPieces,
                damaged: p.exchanged === "0" ? "" : p.exchanged,
              }
            : { ...l, returnedCartons: "", returnedPieces: "", damaged: "" },
        );
      }
      return { ...d, lines };
    });
  }
  // D69: the table's amounts as the profit's parts (domain `salesProfit`), pieces underneath.
  const parts = salesProfit(
    entered.map((l) => ({
      issued: l.issued,
      returned: l.returned,
      damaged: l.damaged,
      commission: l.commission ?? "0",
      salePrice: saleOf(l, view),
      costPrice: costOf(l, view),
    })),
  );
  const pieces = (value: string) => `${quantity(value)} ${t("common.pieces")}`;
  const sheetSummary: SummaryItem[] = [
    {
      label: t("dsr.profit.issued"),
      value: money(parts.issuedValue),
      hint: pieces(parts.issued),
    },
    {
      label: `− ${t("dsr.profit.returned")}`,
      value: money(parts.returnValue),
      hint: pieces(parts.returned),
    },
    {
      label: `− ${t("dsr.profit.damaged")}`,
      value: money(parts.damageValue),
      hint: pieces(parts.damaged),
    },
    { label: `− ${t("dsr.profit.commission")}`, value: money(parts.commission) },
    { label: `= ${t("dsr.profit.netSales")}`, value: money(parts.netSales), emphasis: true },
    ...(view.canSeeCost
      ? [
          {
            label: `− ${t("dsr.profit.deliveredCost")}`,
            value: money(parts.deliveredCost),
            hint: pieces(parts.delivered),
          },
          { label: `− ${t("dsr.profit.damageMargin")}`, value: money(parts.damageMargin) },
        ]
      : []),
    ...(view.canSeeCost && view.canSeeProfit
      ? [{ label: `= ${t("dsr.profit.profit")}`, value: money(parts.profit), emphasis: true }]
      : []),
  ];

  const setLines = (productId: string, change: (lines: LineDraft[]) => LineDraft[]) =>
    setDraft((d) => {
      const own = view.products.find((p) => p.productId === productId);
      if (!own) return d;
      return { ...d, lines: { ...d.lines, [productId]: change(linesOf(d, own, view)) } };
    });
  const setLine = (productId: string, id: string, patch: Partial<LineDraft>) =>
    setLines(productId, (lines) => lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = (productId: string, options: BatchOption[]) =>
    setLines(productId, (lines) => [
      ...lines,
      blankLine(
        crypto.randomUUID(),
        nextBatch(
          options,
          lines.map((l) => l.batchKey),
        ),
      ),
    ]);
  const removeLine = (productId: string, id: string) =>
    setLines(productId, (lines) => lines.filter((l) => l.id !== id));

  async function run(kind: "save" | "post" | "discard" | "reverse" | "correct") {
    setError(undefined);
    if (kind === "correct") {
      if (typeof built === "string") {
        setError(built);
        return;
      }
      await action.run(() => save.mutateAsync(built), { confirm: "dsr.sheet.correctConfirm" });
      return;
    }
    if (kind === "save" || kind === "post") {
      if (typeof built === "string") {
        setError(built);
        return;
      }
      await action.run(async () => {
        const current = dirty || !sheet ? await save.mutateAsync(built) : sheet;
        if (kind === "post") {
          await command.mutateAsync({
            action: "post",
            dayId: current.id,
            version: current.version,
          });
        }
      });
      return;
    }
    if (!sheet) return;
    await action.run(
      async () => {
        await command.mutateAsync({ action: kind, dayId: sheet.id, version: sheet.version });
        if (kind === "discard") setDraft(draftOf(undefined));
      },
      { confirm: kind === "reverse" ? "dsr.sheet.reverseConfirm" : "dsr.sheet.discardConfirm" },
    );
  }

  type QuantityField = Exclude<
    keyof LineDraft,
    "id" | "batchKey" | "salePrice" | "costPrice" | "damageRate"
  >;
  // D89: cartons and loose pieces are entered independently; neither fills the other.
  const change = (productId: string, line: LineDraft, field: QuantityField, value: string) =>
    setLine(productId, line.id, { [field]: value });
  const cell = (
    productId: string,
    line: LineDraft,
    field: QuantityField,
    label: string,
    off: boolean,
    mode: "numeric" | "decimal" = "numeric",
  ) => (
    <CellInput
      label={label}
      value={line[field]}
      onChange={(value) => change(productId, line, field, value)}
      disabled={off}
      mode={mode}
      width={mode === "decimal" ? "w-20" : "w-14"}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {sheet?.fieldReport ? (
        <FieldReportCard
          companyId={companyId}
          sheet={sheet}
          report={sheet.fieldReport}
          canDecide={permissions.includes("sale.create") && (!posted || canCorrect)}
        />
      ) : null}
      {posted ? (
        <StatePanel title={t(canCorrect ? "dsr.sheet.postedEditHint" : "dsr.sheet.postedHint")} />
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:max-w-xs">
        <StatTile
          label={t("dsr.cash.inHand")}
          value={money(cashInHand)}
          hint={t("dsr.cash.inHandHint")}
          tone="info"
          large
        />
      </dl>
      <TableSummary label={t("table.summary")} items={sheetSummary} />
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" rowSpan={2} className={`${thClass} ${stickyHead} align-bottom`}>
                {t("godown.column.product")}
              </th>
              <th scope="col" rowSpan={2} className={`${thClass} align-bottom`}>
                {t("dsr.sheet.batch")}
              </th>
              <th scope="colgroup" colSpan={2} className={`${groupHead} ${GROUP.issued.head}`}>
                {t("dsr.sheet.issued")}
              </th>
              <th scope="colgroup" colSpan={2} className={`${groupHead} ${GROUP.returned.head}`}>
                {t("dsr.sheet.returned")}
              </th>
              <th scope="col" rowSpan={2} className={`${loneHead} ${GROUP.damaged.head}`}>
                {t("dsr.sheet.damaged")}
              </th>
              <th scope="col" rowSpan={2} className={`${loneHead} ${GROUP.damaged.head}`}>
                {t("dsr.sheet.damageRate")}
              </th>
              <th scope="col" rowSpan={2} className={`${loneHead} ${GROUP.commission.head}`}>
                {t("dsr.sheet.commission")}
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${thNum} border-l border-border align-bottom`}
              >
                {t("dsr.sheet.batchSalePrice")}
              </th>
              {view.canSeeCost ? (
                <th scope="col" rowSpan={2} className={`${thNum} align-bottom`}>
                  {t("dsr.sheet.costPrice")}
                </th>
              ) : null}
              <th scope="col" rowSpan={2} className={`${thNum} align-bottom`}>
                {t("dsr.sheet.engineAmount")}
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${thNum} border-l border-border align-bottom`}
              >
                {t("godown.column.stock")}
                <span className="block text-[10.5px] font-normal text-text-subtle">
                  {t("godown.column.pieces")}
                </span>
              </th>
            </tr>
            <tr>
              <th scope="col" className={`${subHead} border-l ${GROUP.issued.sub}`}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={`${subHead} ${GROUP.issued.sub}`}>
                {t("godown.column.pieces")}
              </th>
              <th scope="col" className={`${subHead} border-l ${GROUP.returned.sub}`}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={`${subHead} ${GROUP.returned.sub}`}>
                {t("godown.column.pieces")}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.products.flatMap((product) => {
              const lines = linesOf(draft, product, view);
              const options = batchOptions(
                product,
                view,
                lines.map((l) => l.batchKey),
              );
              const canAdd = !locked && options.length > lines.length;
              // No batch (no stock, none used today): nothing can be issued from this product.
              const noStock = options.length === 0;
              const off = locked || noStock;
              const productNet = lines.reduce(
                (sum, l) => sum.add(netOf(l, product.piecesPerCarton)),
                toDecimal("0"),
              );
              const productRemaining = toDecimal(product.stock).sub(productNet);
              return lines.map((line, index) => {
                const first = index === 0;
                const batch = options.find((o) => o.key === line.batchKey);
                const batchRemaining = batch
                  ? toDecimal(batch.quantity).sub(netOf(line, product.piecesPerCarton))
                  : null;
                const name = `${product.productName}${batch ? ` ${batchName(batch)}` : ""}`;
                return (
                  <tr
                    key={`${product.productId}-${line.id}`}
                    title={noStock ? t("dsr.sheet.noStock") : undefined}
                    className={`${first ? "border-t border-border" : "border-t border-border/40"}${noStock ? "text-text-muted" : ""}`}
                  >
                    <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                      {first ? (
                        <>
                          <div>{product.productName}</div>
                          <div className="text-xs font-normal text-text-muted">
                            {product.sku} · {t("godown.column.stock")}{" "}
                            <CartonQty
                              pieces={product.stock}
                              piecesPerCarton={product.piecesPerCarton}
                            />
                          </div>
                          {posted && allocationText(allocations.get(product.productId) ?? []) ? (
                            <div className="max-w-56 text-xs font-normal whitespace-normal text-text-muted">
                              <span className="sr-only">{t("dsr.allocation.title")}: </span>
                              {allocationText(allocations.get(product.productId) ?? [])}
                            </div>
                          ) : null}
                          {canAdd ? (
                            <Button
                              className="mt-1 px-2 py-0.5 text-xs font-normal"
                              onClick={() => addLine(product.productId, options)}
                            >
                              {t("dsr.sheet.addBatch")}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </th>
                    <td className={tdClass}>
                      <div className="flex items-center gap-1">
                        <select
                          aria-label={`${product.productName} ${t("dsr.sheet.batch")}`}
                          value={line.batchKey}
                          disabled={off}
                          onChange={(event) =>
                            setLine(product.productId, line.id, {
                              batchKey: event.target.value,
                              salePrice: undefined,
                              costPrice: undefined,
                            })
                          }
                          className={`${inputClass} min-w-44`}
                        >
                          {noStock ? <option value="">{t("dsr.sheet.noStock")}</option> : null}
                          {options.map((o) => (
                            <option key={o.key} value={o.key}>
                              {batchName(o)}
                              {o.free ? ` (${t("batch.free")})` : ""} · {t("batch.available")}{" "}
                              {cartonText(o.quantity, product.piecesPerCarton)}
                            </option>
                          ))}
                        </select>
                        {!first && !locked ? (
                          <Button
                            aria-label={t("dsr.sheet.removeBatch")}
                            title={t("dsr.sheet.removeBatch")}
                            className="px-2 py-1 text-xs"
                            onClick={() => removeLine(product.productId, line.id)}
                          >
                            ×
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${inputCell} border-l ${GROUP.issued.cell}`}>
                      {cell(
                        product.productId,
                        line,
                        "issuedCartons",
                        `${name} ${t("dsr.sheet.issued")} ${t("godown.column.cartons")}`,
                        off,
                      )}
                    </td>
                    <td className={`${inputCell} ${GROUP.issued.cell}`}>
                      {cell(
                        product.productId,
                        line,
                        "issuedPieces",
                        `${name} ${t("dsr.sheet.issued")} ${t("godown.column.pieces")}`,
                        off,
                      )}
                    </td>
                    <td className={`${inputCell} border-l ${GROUP.returned.cell}`}>
                      {cell(
                        product.productId,
                        line,
                        "returnedCartons",
                        `${name} ${t("dsr.sheet.returned")} ${t("godown.column.cartons")}`,
                        off,
                      )}
                    </td>
                    <td className={`${inputCell} ${GROUP.returned.cell}`}>
                      {cell(
                        product.productId,
                        line,
                        "returnedPieces",
                        `${name} ${t("dsr.sheet.returned")} ${t("godown.column.pieces")}`,
                        off,
                      )}
                    </td>
                    <td className={`${inputCell} border-l ${GROUP.damaged.cell}`}>
                      {cell(
                        product.productId,
                        line,
                        "damaged",
                        `${name} ${t("dsr.sheet.damaged")}`,
                        off,
                      )}
                    </td>
                    <td className={`${inputCell} ${GROUP.damaged.cell}`}>
                      <CellInput
                        label={`${name} ${t("dsr.sheet.damageRate")}`}
                        value={
                          line.damageRate ??
                          line.salePrice ??
                          priceText(batch?.salePrice ?? product.salePrice) ??
                          ""
                        }
                        onChange={(damageRate) =>
                          setLine(product.productId, line.id, { damageRate })
                        }
                        disabled={off}
                        mode="decimal"
                        width="w-24"
                      />
                    </td>
                    <td className={`${inputCell} border-l ${GROUP.commission.cell}`}>
                      {cell(
                        product.productId,
                        line,
                        "commission",
                        `${name} ${t("dsr.sheet.commission")}`,
                        off,
                        "decimal",
                      )}
                    </td>
                    <td className={`${inputCell} border-l border-border`}>
                      <CellInput
                        label={`${name} ${t("dsr.sheet.batchSalePrice")}`}
                        value={
                          line.salePrice ?? priceText(batch?.salePrice ?? product.salePrice) ?? ""
                        }
                        onChange={(salePrice) => setLine(product.productId, line.id, { salePrice })}
                        disabled={off || !batch}
                        mode="decimal"
                        width="w-24"
                      />
                    </td>
                    {view.canSeeCost ? (
                      <td className={inputCell}>
                        <CellInput
                          label={`${name} ${t("dsr.sheet.costPrice")}`}
                          value={line.costPrice ?? priceText(batch?.costPrice ?? null) ?? ""}
                          onChange={(costPrice) =>
                            setLine(product.productId, line.id, { costPrice })
                          }
                          disabled={off || !batch || batch.free}
                          mode="decimal"
                          width="w-24"
                        />
                      </td>
                    ) : null}
                    <td className={tdNum}>
                      {first ? money(salariFirotAmount(product.productId)) : null}
                    </td>
                    <td className={`${tdNum} border-l border-border`}>
                      {first ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span>{quantity(productRemaining.toFixed())}</span>
                          {batchRemaining !== null ? (
                            <span className="text-[10.5px] text-text-muted tabular-nums">
                              {quantity(batchRemaining.toFixed())}
                            </span>
                          ) : null}
                        </div>
                      ) : batchRemaining !== null ? (
                        <span className="text-[10.5px] text-text-muted tabular-nums">
                          {quantity(batchRemaining.toFixed())}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </TableScroller>
      {!posted && permissions.includes("sale.create") ? (
        <div className="flex">
          <Button disabled={pending || (!dirty && Boolean(sheet))} onClick={() => void run("save")}>
            {save.isPending ? t("common.saving") : t("dsr.sheet.saveDraft")}
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-text-muted">
        {t("godown.quantityHint")} {t("dsr.sheet.hint")} {t("dsr.sheet.batchHint")}
      </p>
      {field ? (
        <FieldEntries
          field={field}
          draft={draft}
          view={view}
          locked={locked}
          onPrefill={prefillFromField}
        />
      ) : null}
      <ShopDueEntry
        companyId={companyId}
        staffId={staff.id}
        date={date}
        fieldOwned={field !== null}
        dsrs={dsrChoices}
      />
      <StaffCashEntry companyId={companyId} staffId={staff.id} date={date} dsrs={staffChoices} />
      <SrCashEntry companyId={companyId} staffId={staff.id} date={date} />
      <OperatingCostEntry companyId={companyId} date={date} />
      <CashCheck
        {...cash}
        sales={cashCheckSales(parts.netSales, parts.damageValue)}
        damage={parts.damageValue}
        handedOver={draft.handedOver}
        locked={locked}
        onHandedOver={(handedOver) => setDraft((d) => ({ ...d, handedOver }))}
      />
      {shownError ? <StatePanel tone="error" title={shownError} /> : null}
      <div className="flex flex-wrap gap-2">
        {!posted && permissions.includes("sale.post") ? (
          <Button variant="primary" disabled={pending} onClick={() => void run("post")}>
            {command.isPending ? t("common.posting") : t("common.post")}
          </Button>
        ) : null}
        {sheet?.status === "draft" && permissions.includes("sale.create") ? (
          <Button disabled={pending} onClick={() => void run("discard")}>
            {t("dsr.sheet.discard")}
          </Button>
        ) : null}
        {posted && canCorrect ? (
          <Button
            variant="primary"
            disabled={pending || !dirty}
            onClick={() => void run("correct")}
          >
            {save.isPending ? t("common.posting") : t("dsr.sheet.correct")}
          </Button>
        ) : null}
        {posted && permissions.includes("sale.reverse") ? (
          <Button disabled={pending} onClick={() => void run("reverse")}>
            {t("dsr.sheet.reverse")}
          </Button>
        ) : null}
      </div>
      {history.length ? (
        <>
          <SectionTitle>{t("dsr.sheet.history")}</SectionTitle>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <StatusChip status={h.status} />
                {h.reversedAt ? formatDateTime(h.reversedAt) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Sheets({
  companyId,
  date,
  view,
  open,
  setOpen,
}: {
  companyId: string;
  date: string;
  view: DayView;
  open: string | null;
  setOpen: (staffId: string | null) => void;
}) {
  const records = useStaffRecords(companyId);
  const sheets = useDsrDays(companyId, date);

  if (records.isPending || sheets.isPending) return <ListSkeleton rows={4} action />;
  if (records.isError)
    return <QueryError error={records.error} onRetry={() => void records.refetch()} />;
  if (sheets.isError)
    return <QueryError error={sheets.error} onRetry={() => void sheets.refetch()} />;

  const srs = srsOn(records.data);
  const live = (staffId: string) =>
    sheets.data.find((s) => s.staffId === staffId && s.status !== "reversed");
  const selected = srs.find((d) => d.id === open);
  if (selected) {
    const sheet = live(selected.id);
    return (
      <SheetEditor
        key={`${selected.id}-${sheet?.id ?? "new"}-${sheet?.version ?? 0}`}
        companyId={companyId}
        date={date}
        staff={selected}
        sheet={sheet}
        history={sheets.data.filter((s) => s.staffId === selected.id && s.status === "reversed")}
        view={view}
      />
    );
  }
  return (
    <>
      {/* <HandoverShorts rows={view.handoverShorts} /> */}
      {srs.length === 0 ? (
        <StatePanel title={t("sr.empty")} />
      ) : (
        <DsrList dsrs={srs} live={live} view={view} onOpen={setOpen} />
      )}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- D81 feature, currently disabled
function HandoverShorts({ rows }: { rows: DayView["handoverShorts"] }) {
  if (rows.length === 0) return null;
  const total = sumAmounts(["0", ...rows.map((row) => row.amount)]);
  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold">{t("dsr.cash.shortList")}</h2>
      <p className="mt-1 text-xs text-text-muted">{t("dsr.cash.shortListHint")}</p>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <li key={row.staffId} className="flex items-center justify-between gap-3">
            <span>{row.staffName}</span>
            <span className="font-medium text-error tabular-nums">{money(row.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm font-semibold">
        {t("dsr.cash.shortTotal")}: <span className="tabular-nums">{money(total)}</span>
      </p>
    </section>
  );
}

const pieceLabel = (key: "dsr.sheet.issued" | "dsr.sheet.returned" | "dsr.sheet.damaged") =>
  `${t(key)} (${t("godown.column.pieces")})`;

/** One DSR's day: quantities from the sheet (draft or posted), sales from the engine (posted). */
function dsrSummary(sheet: DsrDay | undefined, view: DayView, staffId: string): SummaryItem[] {
  const lines = sheet?.lines ?? [];
  const sales = view.persons.filter((p) => p.staffId === staffId).map((p) => p.amount);
  return [
    { label: t("table.summary.products"), value: quantity(String(lines.length)) },
    {
      label: pieceLabel("dsr.sheet.issued"),
      value: quantity(sumQuantities(lines.map((l) => l.issued))),
    },
    {
      label: pieceLabel("dsr.sheet.returned"),
      value: quantity(sumQuantities(lines.map((l) => l.returned))),
    },
    {
      label: pieceLabel("dsr.sheet.damaged"),
      value: quantity(sumQuantities(lines.map((l) => l.damaged))),
    },
    { label: t("dsr.summary.commission"), value: money(commissionOf(lines)) },
    {
      label: t("dsr.summary.dsrSales"),
      value: sheet?.status === "posted" ? money(sumAmounts(sales)) : "—",
      emphasis: true,
    },
  ];
}

function DsrList({
  dsrs,
  live,
  view,
  onOpen: setOpen,
}: {
  dsrs: StaffRecord[];
  live: (staffId: string) => DsrDay | undefined;
  view: DayView;
  onOpen: (staffId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {dsrs.map((dsr) => {
        const sheet = live(dsr.id);
        return (
          <li
            key={dsr.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-medium">{dsr.name}</span>
                <StatusChip status={sheet?.status ?? "none"} />
                {sheet?.fieldReport ? (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                    {t("dsr.report.badge")}
                  </span>
                ) : null}
              </div>
              <Button variant={sheet ? "secondary" : "primary"} onClick={() => setOpen(dsr.id)}>
                {t(sheet ? "dsr.sheet.open" : "dsr.sheet.start")}
              </Button>
            </div>
            {sheet ? (
              <TableSummary
                label={`${dsr.name} ${t("table.summary")}`}
                items={dsrSummary(sheet, view, dsr.id)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The toolbar's left side: back to the list, the open DSR's name and the sheet's status. */
function OpenDsr({
  companyId,
  date,
  staffId,
  onBack,
}: {
  companyId: string;
  date: string;
  staffId: string;
  onBack: () => void;
}) {
  const records = useStaffRecords(companyId);
  const sheets = useDsrDays(companyId, date);
  const name = records.data?.find((s) => s.id === staffId)?.name ?? "";
  const sheet = sheets.data?.find((s) => s.staffId === staffId && s.status !== "reversed");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={onBack}>← {t("sr.sheet.back")}</Button>
      <h2 className="text-lg font-semibold">{name}</h2>
      <StatusChip status={sheet?.status ?? "none"} />
    </div>
  );
}

export function DsrDaysPage() {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // The open DSR lives in the address (?dsr=), so a reload keeps the sheet and Back returns to the list.
  const open = search.get("sr");
  const setOpen = (staffId: string | null) => {
    const query = new URLSearchParams(search.toString());
    if (staffId) query.set("sr", staffId);
    else query.delete("sr");
    const text = query.toString();
    router.push(text ? `${pathname}?${text}` : pathname, { scroll: true });
  };
  useEffect(() => {
    // Opening or leaving a sheet starts the page at its top.
    window.scrollTo({ top: 0 });
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, [open]);
  return (
    <NavGate path={PATH}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {open ? (
            <OpenDsr
              companyId={company.id}
              date={date}
              staffId={open}
              onBack={() => setOpen(null)}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <DateBar date={date} onChange={setDate} />
          <PrintButton />
        </div>
      </div>
      <PrintHeader title={t("nav.sales.dailySummaries")} from={date} />
      <DayGate companyId={company.id} date={date} skeleton={<ListSkeleton rows={4} action />}>
        {(view) => (
          <Sheets
            key={date}
            companyId={company.id}
            date={date}
            view={view}
            open={open}
            setOpen={setOpen}
          />
        )}
      </DayGate>
    </NavGate>
  );
}
