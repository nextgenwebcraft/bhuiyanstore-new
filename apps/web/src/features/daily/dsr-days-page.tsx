"use client";

import type { DayView, DsrDay, DsrDaySaveRequest, MoneyEntry, StaffRecord } from "@bsd/contracts";
import {
  cashCheckSales,
  dsrCashSettlement,
  roundSettlement,
  salesProfit,
  sumAmounts,
  toBaseQuantity,
  toCartonDisplay,
  toDecimal,
} from "@bsd/domain";
import { useAsyncAction } from "@/lib/async-action";
import { formatDateTime, parseAmountInput, t } from "@bsd/i18n";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { FormDialog } from "@/components/form-dialog";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  useDsrDayCommand,
  useDsrDays,
  useDsrFieldDay,
  useDsrFieldDays,
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
  CellInput,
  DateBar,
  DayGate,
  canCorrectDsrSheet,
  dsrHandoverAmountLocked,
  dsrSheetBodyLocked,
  isFreeAuto,
  SectionTitle,
  clean,
  useWorkingDate,
} from "./daily-kit";
import {
  StatusChip,
  money,
  quantity,
  tableClass,
  tdNum,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import {
  DsrSheetEntry,
  batchStockRemaining,
  lineKeyOf,
  markLinesActive,
  type LineDraft,
  type SheetDraft,
} from "./dsr-sheet-entry";

const PATH = "sales/daily-summaries";

const isAmount = (value: string) => parseAmountInput(value) !== null;
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
function batchOptions(product: Product, _view: DayView, named: readonly string[]): BatchOption[] {
  const out = new Map<string, BatchOption>();
  for (const b of product.batches) {
    if (toDecimal(b.quantity).lte(0) && !named.includes(b.key)) continue;
    out.set(b.key, { ...b, free: isFreeAuto(b.key, b.costPrice) });
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * DSRs (D65: global master-company staff). When `date` is set, only assignments covering that
 * day are included — a future hire must not appear on earlier sheets.
 */
export function dsrsOn(records: StaffRecord[], date?: string) {
  return records.filter((s) =>
    s.assignments.some(
      (a) =>
        a.roleKind === "dsr" &&
        (date === undefined || (a.from <= date && (a.to === null || a.to >= date))),
    ),
  );
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
  const lines: LineDraft[] = (sheet?.lines ?? []).map((line) => {
    const [issuedCartons, issuedPieces] = split(line.issued, line.piecesPerCarton);
    const [returnedCartons, returnedPieces] = split(line.returned, line.piecesPerCarton);
    return {
      id: lineKeyOf(line),
      dsrStaffId: line.dsrStaffId,
      dsrStaffName: line.dsrStaffName,
      productId: line.productId,
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
      entryStatus: "active" as const,
    };
  });
  return { lines, handedOver: sheet?.cashHandedOver ?? "" };
}

const whole = (value: string) => clean(value) || "0";
const isWhole = (value: string) => /^\d+$/.test(value);

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
  /** D112: only Super Admin (sale.price_override) may send sale/cost overrides. */
  includePrices = false,
): DsrDaySaveRequest | string {
  const handed = parseAmountInput(draft.handedOver) ?? "";
  if (clean(draft.handedOver) && !handed) return t("validation.opening.amount");
  const lines: DsrDaySaveRequest["lines"] = [];
  const seen = new Set<string>();
  for (const d of draft.lines) {
    const product = view.products.find((p) => p.productId === d.productId);
    if (!product) return t("validation.daily.unknownProduct");
    const pieces = piecesOf(d, product.piecesPerCarton);
    if (!pieces) return t("validation.wholeNumber");
    const commission = clean(d.commission) || "0";
    if (!isAmount(commission)) return t("validation.opening.amount");
    const noCommission = toDecimal(commission).isZero();
    const { issued, returned, damaged } = pieces;
    if (issued === "0" && returned === "0" && damaged === "0" && noCommission) continue;
    if (!d.dsrStaffId) return t("validation.daily.lineDsrOnly");
    const key = lineKeyOf(d);
    if (seen.has(key)) {
      return `${d.dsrStaffName} · ${product.productName}: ${t("validation.daily.duplicateProduct")}`;
    }
    seen.add(key);
    const salePrice = !includePrices || d.salePrice === undefined ? undefined : clean(d.salePrice);
    const costPrice =
      !includePrices || d.costPrice === undefined || !view.canSeeCost
        ? undefined
        : clean(d.costPrice);
    if ([salePrice, costPrice].some((p) => p !== undefined && !isUnitPrice(p))) {
      return `${product.productName}: ${t("validation.unitPrice.invalid")}`;
    }
    const damageRate =
      damaged === "0"
        ? undefined
        : clean(d.damageRate ?? "") ||
          saleOf({ productId: d.productId, batchKey: d.batchKey, salePrice: d.salePrice }, view);
    if (damageRate !== undefined && !isUnitPrice(damageRate)) {
      return `${product.productName}: ${t("validation.unitPrice.invalid")}`;
    }
    lines.push({
      productId: d.productId,
      dsrStaffId: d.dsrStaffId,
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
  return { ...base, cashHandedOver: handed || null, lines };
}

/** Refuse a save/post when any named batch would end below zero after the draft. */
function stockOverflowMessage(
  draft: SheetDraft,
  view: DayView,
  baselineLines: readonly LineDraft[],
): string | undefined {
  const seen = new Set<string>();
  for (const d of draft.lines) {
    const key = `${d.productId}|${d.batchKey}`;
    if (!d.batchKey || seen.has(key)) continue;
    seen.add(key);
    const rem = batchStockRemaining(view, draft.lines, baselineLines, d.productId, d.batchKey);
    if (toDecimal(rem).lt(0)) {
      const product = view.products.find((p) => p.productId === d.productId);
      return `${product?.productName ?? d.productId}: ${t("validation.exceedsAvailable")}`;
    }
  }
  return undefined;
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
 * Live table-summary lines from the draft on screen. Unlike `requestOf`, a single bad/overflow
 * line must not wipe the whole strip to ০ (that made সামারি/মোট বিক্রি look empty while the
 * table still showed quantities).
 */
function profitLinesOfDraft(draft: SheetDraft, view: DayView) {
  const lines: {
    issued: string;
    returned: string;
    damaged: string;
    commission: string;
    salePrice: string;
    costPrice: string;
    damageRate?: string;
  }[] = [];
  for (const d of draft.lines) {
    const product = view.products.find((p) => p.productId === d.productId);
    if (!product) continue;
    const pieces = piecesOf(d, product.piecesPerCarton);
    if (!pieces) continue;
    const commission = clean(d.commission) || "0";
    if (!isAmount(commission)) continue;
    if (pieces.issued === "0" && pieces.returned === "0" && pieces.damaged === "0") {
      if (toDecimal(commission).isZero()) continue;
    }
    const salePrice = saleOf(d, view);
    const damageRate = clean(d.damageRate ?? "");
    lines.push({
      issued: pieces.issued,
      returned: pieces.returned,
      damaged: pieces.damaged,
      commission,
      salePrice,
      costPrice: costOf(d, view),
      ...(damageRate && isUnitPrice(damageRate) ? { damageRate } : {}),
    });
  }
  return lines;
}

/**
 * One SR sheet's money figures from the entries entered on it (D79, D122). Only posted rows with
 * this `sheetStaffId` count, so two SR sheets of one date never share a due, advance or খরচ.
 * Field visits own the SR's own due; office rows cover the other DSRs. One owner for the sheet's
 * cash check and the SR cards.
 */
function sheetMoneyFigures(
  entries: readonly MoneyEntry[],
  srId: string,
  sheet: Pick<DsrDay, "marketDueNew" | "marketDueCollected"> | undefined,
  fieldDue: { dueCreated: string; dueCollected: string } | null,
) {
  const posts = entries.filter((e) => e.status === "posted" && e.sheetStaffId === srId);
  const people = posts.filter((e) => e.staffId !== null);
  const srRows = people.filter((e) => e.staffId === srId);
  /** DSRs and staff on the sheet, excluding the open SR when that person is also listed. */
  const otherRows = people.filter((e) => e.staffId !== srId);
  const sum = (kind: MoneyEntry["kind"], rows: readonly MoneyEntry[]) =>
    sumAmounts(["0", ...rows.filter((e) => e.kind === kind).map((e) => e.amount)]);
  const srMove = (kind: "srLoan" | "srRepayment") =>
    sumAmounts([
      "0",
      ...srRows
        .filter((e) => e.kind === kind && e.srLoanType !== "commission")
        .map((e) => e.amount),
    ]);
  // D79: SR অগ্রিম ও শর্ট on the open SR; DSR/staff advance and short for the others on the sheet.
  const srMoney = toDecimal(sum("staffRepayment", srRows))
    .add(srMove("srRepayment"))
    .sub(toDecimal(sum("staffAdvance", srRows)))
    .sub(toDecimal(sum("staffShortage", srRows)))
    .sub(srMove("srLoan"))
    .toString();
  const dsrMoney = toDecimal(sum("staffRepayment", otherRows))
    .sub(toDecimal(sum("staffAdvance", otherRows)))
    .sub(toDecimal(sum("staffShortage", otherRows)))
    .toString();
  return {
    dueGiven: sumAmounts([
      fieldDue?.dueCreated ?? "0",
      sum("marketDueNew", otherRows),
      sheet?.marketDueNew ?? "0",
    ]),
    dueCollected: sumAmounts([
      fieldDue?.dueCollected ?? "0",
      sum("marketDueCollected", otherRows),
      sheet?.marketDueCollected ?? "0",
    ]),
    expenses: sum("staffCostPaid", people),
    operatingCost: sum("expense", posts),
    dsrMoney,
    srMoney,
    staffMoney: toDecimal(dsrMoney).add(srMoney).toString(),
  };
}

/** Day-end cash check (D39, D62): the difference is shown only, never posted. */
function CashCheck({
  sales,
  damage,
  dueGiven,
  dueCollected,
  expenses,
  operatingCost,
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
  operatingCost: string;
  staffMoney: string;
  handedOver: string;
  locked: boolean;
  onHandedOver: (value: string) => void;
}) {
  const handed = parseAmountInput(handedOver);
  const settlement = dsrCashSettlement({
    sales,
    damage,
    dueGiven,
    dueCollected,
    expenses,
    operatingCost,
    staffMoney,
    handedOver: handed,
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
            ["dsr.cash.operating", operatingCost],
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
              placeholder={settlement.expected}
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
  const { permissions, loginRoleKind } = useCurrentWorkspace();
  const save = useSaveDsrDay(companyId);
  const command = useDsrDayCommand(companyId);
  const [draft, setDraft] = useState(() => draftOf(sheet));
  /** Once the user edits হাতে জমা, stop syncing it from জমা হওয়ার কথা. */
  const [handedTouched, setHandedTouched] = useState(() => Boolean(sheet?.cashHandedOver));
  const [error, setError] = useState<string | undefined>();
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reversePending, setReversePending] = useState(false);
  const [reverseError, setReverseError] = useState<string | undefined>();
  const action = useAsyncAction();
  const shownError = error ?? action.error;
  const posted = sheet?.status === "posted";
  // Status flag for money cards / banners (Manager locks; Super Admin still edits — D114/D135).
  const handoverLocked =
    sheet?.handoverStatus === "pending" || sheet?.handoverStatus === "approved";
  const isDsrLogin = loginRoleKind === "dsr";
  const isManagerLogin = loginRoleKind === "manager";
  // D56/D135: Super Admin always corrects posted sheets (incl. after হাতে জমা). D126: Manager never.
  const canCorrect = canCorrectDsrSheet(loginRoleKind, permissions);
  const locked = dsrSheetBodyLocked({
    loginRoleKind,
    permissions,
    posted,
    handoverActive: handoverLocked,
  });
  const issuedLocked = locked || isDsrLogin;
  const priceLocked =
    locked || isManagerLogin || isDsrLogin || !permissions.includes("sale.price_override");
  // হাতে জমা: Manager/DSR until submit; Super Admin always (D135).
  const canTypeHandover =
    posted && sheet?.handoverStatus === "none" && permissions.includes("sale.handover_submit");
  const handoverAmountLocked = dsrHandoverAmountLocked({
    loginRoleKind,
    canTypeHandover,
    bodyLocked: locked,
    handoverActive: handoverLocked,
  });
  const base = { date, staffId: staff.id, version: sheet?.version ?? 0 };
  const includePrices = permissions.includes("sale.price_override");
  /** Posted lines already in day-view stock; empty while the sheet is still a draft. */
  const baselineLines = posted ? draftOf(sheet).lines : [];
  const stockError = stockOverflowMessage(draft, view, baselineLines);
  const built = stockError ?? requestOf(draft, view, base, includePrices);
  const buildError = typeof built === "string" ? built : undefined;
  const dirty =
    typeof built === "string" ||
    JSON.stringify(built) !== JSON.stringify(requestOf(draftOf(sheet), view, base, includePrices));
  const pending = save.isPending || command.isPending;
  // D122: engine persons are line DSRs, not the SR sheet owner.
  const sheetDsrIds = new Set(
    typeof built === "string"
      ? draft.lines.map((l) => l.dsrStaffId)
      : built.lines.map((l) => l.dsrStaffId),
  );
  const amounts = new Map(
    view.persons.filter((p) => sheetDsrIds.has(p.staffId)).map((p) => [p.productId, p.amount]),
  );
  const entered = typeof built === "string" ? [] : built.lines;
  const fieldDay = useDsrFieldDay(
    companyId,
    staff.id,
    date,
    staff.assignments.some((a) => a.roleKind === "dsr"),
  );
  const records = useStaffRecords(companyId);
  const dsrChoices = dsrsOn(records.data ?? [], date).map((dsr) => ({
    id: dsr.id,
    name: dsr.name,
  }));
  const staffChoices = ourStaffOn(records.data ?? []).map((person) => ({
    id: person.id,
    name: person.name,
  }));
  // Dues, advances and খরচ belong to the SR sheet they were entered on: this sheet's cash check
  // must not count another SR's entries of the same date.
  const entries = useMoneyEntries(companyId, { from: date, to: date, sheetStaffId: staff.id });
  const field = fieldDay.data && fieldDay.data.visits.length > 0 ? fieldDay.data : null;
  // D69: summary from the draft on screen — never blank the strip when save validation fails.
  const parts = salesProfit(profitLinesOfDraft(draft, view));
  const cash = {
    sales:
      posted && !dirty
        ? sumAmounts(["0", ...amounts.values()])
        : entered.length > 0
          ? previewSales(entered, view)
          : cashCheckSales(parts.netSales, parts.damageValue),
    ...sheetMoneyFigures(entries.data ?? [], staff.id, sheet, field ? field.totals : null),
  };
  // Until the user edits হাতে জমা, show জমা হওয়ার কথা (avoids missing .paisa / trailing-dot flicker).
  const cashExpected = dsrCashSettlement({
    sales: cashCheckSales(parts.netSales, parts.damageValue),
    damage: parts.damageValue,
    dueGiven: cash.dueGiven,
    dueCollected: cash.dueCollected,
    expenses: cash.expenses,
    operatingCost: cash.operatingCost,
    staffMoney: cash.staffMoney,
    handedOver: null,
  }).expected;
  const handedDisplay =
    handoverAmountLocked || handedTouched || clean(draft.handedOver)
      ? draft.handedOver
      : cashExpected;
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

  /** Drop a line; pending = local only; active = confirm then save (D56 reverse+repost if posted). */
  async function deleteLine(id: string) {
    setError(undefined);
    const line = draft.lines.find((l) => l.id === id);
    if (!line) return;
    const next: SheetDraft = { ...draft, lines: draft.lines.filter((l) => l.id !== id) };
    if (line.entryStatus !== "active") {
      setDraft(next);
      return;
    }
    const req = requestOf(next, view, base, includePrices);
    if (typeof req === "string") {
      setError(req);
      return;
    }
    await action.run(
      async () => {
        await save.mutateAsync(req);
        setDraft(markLinesActive(next));
      },
      { confirm: "dsr.entry.deleteActiveConfirm" },
    );
  }

  async function run(kind: "save" | "post" | "discard" | "reverse" | "correct") {
    setError(undefined);
    if (kind === "correct") {
      if (typeof built === "string") {
        setError(built);
        return;
      }
      await action.run(
        async () => {
          await save.mutateAsync(built);
          setDraft((d) => markLinesActive(d));
        },
        { confirm: "dsr.sheet.correctConfirm" },
      );
      return;
    }
    if (kind === "save" || kind === "post") {
      if (typeof built === "string") {
        setError(built);
        return;
      }
      await action.run(async () => {
        const current = dirty || !sheet ? await save.mutateAsync(built) : sheet;
        setDraft((d) => markLinesActive(d));
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
    if (kind === "reverse") {
      setReverseError(undefined);
      setReverseOpen(true);
      return;
    }
    await action.run(
      async () => {
        await command.mutateAsync({ action: kind, dayId: sheet.id, version: sheet.version });
        if (kind === "discard") {
          setDraft(draftOf(undefined));
          setHandedTouched(false);
        }
      },
      { confirm: "dsr.sheet.discardConfirm" },
    );
  }

  async function confirmReverse() {
    if (!sheet) return;
    setReversePending(true);
    setReverseError(undefined);
    try {
      await command.mutateAsync({
        action: "reverse",
        dayId: sheet.id,
        version: sheet.version,
      });
      setReverseOpen(false);
    } catch (e) {
      setReverseError(describeError(e, []).form);
    } finally {
      setReversePending(false);
    }
  }

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
        <StatePanel
          compact
          title={t(canCorrect ? "dsr.sheet.postedEditHint" : "dsr.sheet.postedHint")}
        />
      ) : null}
      <TableSummary label={t("table.summary")} items={sheetSummary} />
      <DsrSheetEntry
        draft={draft}
        baselineLines={baselineLines}
        view={view}
        dsrs={dsrChoices}
        sheetStaffId={staff.id}
        locked={locked}
        canEditPrices={!priceLocked}
        issuedLocked={issuedLocked}
        onChange={setDraft}
        onDeleteLine={(id) => void deleteLine(id)}
        {...(permissions.includes("sale.create") && (!posted || canCorrect)
          ? {
              onSaveAll: () => void run(posted ? "correct" : "save"),
              saveDisabled: pending || (!dirty && Boolean(sheet)),
              savePending: save.isPending || command.isPending,
            }
          : {})}
      />
      <div className="flex flex-wrap items-center gap-2">
        {posted && permissions.includes("sale.reverse") ? (
          <Button disabled={pending || reversePending} onClick={() => void run("reverse")}>
            {t("dsr.sheet.reverse")}
          </Button>
        ) : null}
      </div>
      <FormDialog
        open={reverseOpen}
        title={t("dsr.sheet.reverse")}
        error={reverseError}
        pending={reversePending}
        submitLabel={t("dsr.sheet.reverse")}
        onSubmit={() => void confirmReverse()}
        onClose={() => {
          if (!reversePending) {
            setReverseOpen(false);
            setReverseError(undefined);
          }
        }}
      >
        <p className="text-sm text-text-muted">{t("dsr.sheet.reverseConfirm")}</p>
        <p className="text-sm text-text-muted">{t("dsr.sheet.reverseConfirmDetail")}</p>
      </FormDialog>
      <p className="text-xs text-text-muted">
        {t("godown.quantityHint")} {t("dsr.sheet.hint")} {t("dsr.sheet.batchHint")}
      </p>
      <ShopDueEntry
        companyId={companyId}
        staffId={staff.id}
        date={date}
        fieldOwned={false}
        dsrs={dsrChoices}
        handoverLocked={handoverLocked}
        sheetStaffId={staff.id}
      />
      <StaffCashEntry
        companyId={companyId}
        staffId={staff.id}
        date={date}
        dsrs={staffChoices}
        handoverLocked={handoverLocked}
        sheetStaffId={staff.id}
      />
      <SrCashEntry
        companyId={companyId}
        staffId={staff.id}
        date={date}
        handoverLocked={handoverLocked}
      />
      <OperatingCostEntry
        companyId={companyId}
        date={date}
        handoverLocked={handoverLocked}
        sheetStaffId={staff.id}
      />
      {!isDsrLogin ? (
        <CashCheck
          {...cash}
          sales={cashCheckSales(parts.netSales, parts.damageValue)}
          damage={parts.damageValue}
          handedOver={handedDisplay}
          locked={handoverAmountLocked}
          onHandedOver={(handedOver) => {
            setHandedTouched(true);
            setDraft((d) => ({ ...d, handedOver }));
          }}
        />
      ) : null}
      {sheet?.handoverStatus === "pending" ? (
        <StatePanel compact tone="warning" title={t("dsr.handover.pendingBanner")} />
      ) : null}
      {sheet?.handoverStatus === "approved" ? (
        <StatePanel compact title={t("dsr.handover.approvedBanner")} />
      ) : null}
      {shownError || buildError ? (
        <StatePanel tone="error" title={shownError ?? buildError ?? ""} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!posted && !isDsrLogin && permissions.includes("sale.post") ? (
          <Button variant="primary" disabled={pending} onClick={() => void run("post")}>
            {command.isPending ? t("common.posting") : t("common.post")}
          </Button>
        ) : null}
        {sheet?.status === "draft" &&
        permissions.includes("sale.create") &&
        (!handoverLocked || loginRoleKind === null) ? (
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
        {posted &&
        sheet &&
        sheet.handoverStatus === "none" &&
        permissions.includes("sale.handover_submit") ? (
          <Button
            variant="primary"
            disabled={pending || parseAmountInput(handedDisplay) === null}
            onClick={() =>
              void command.mutateAsync({
                action: "handover-submit",
                dayId: sheet.id,
                version: sheet.version,
                cashHandedOver: parseAmountInput(handedDisplay) ?? clean(handedDisplay),
              })
            }
          >
            {t("dsr.handover.submit")}
          </Button>
        ) : null}
        {posted && sheet && sheet.handoverStatus === "pending" && loginRoleKind === null ? (
          <StatePanel compact title={t("dsr.handover.approveOnDashboard")} />
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
        <SheetsOverview
          companyId={companyId}
          date={date}
          view={view}
          srs={srs}
          live={live}
          onOpen={setOpen}
        />
      )}
    </>
  );
}

/** Every figure behind one sheet's মোট টাকা (at settlement scale, signed as they act on it). */
type SheetCash = {
  issued: string;
  returned: string;
  /** সামারি − ফেরত (display only; মোট টাকা still uses issued/returned separately). */
  sold: string;
  damage: string;
  commission: string;
  dueGiven: string;
  dueCollected: string;
  dsrMoney: string;
  srMoney: string;
  expenses: string;
  operatingCost: string;
  total: string;
};

const CASH_KEYS = [
  "issued",
  "returned",
  "sold",
  "damage",
  "commission",
  "dueGiven",
  "dueCollected",
  "dsrMoney",
  "srMoney",
  "expenses",
  "operatingCost",
  "total",
] as const satisfies readonly (keyof SheetCash)[];

/**
 * The cards of the strip and of each SR, in the order the মোট টাকা is worked out. A null cash
 * (figures still loading) shows "…".
 */
function cashItems(cash: SheetCash | null): SummaryItem[] {
  const value = (key: keyof SheetCash) => (cash ? money(cash[key]) : "…");
  return [
    { label: t("dashboard.card.issued"), value: value("issued") },
    { label: `− ${t("dashboard.card.returned")}`, value: value("returned") },
    { label: `= ${t("dashboard.card.totalSales")}`, value: value("sold") },
    { label: `− ${t("dashboard.card.damage")}`, value: value("damage") },
    { label: `− ${t("dashboard.card.commission")}`, value: value("commission") },
    { label: `− ${t("dsr.cash.dueGiven")}`, value: value("dueGiven") },
    { label: `+ ${t("dsr.cash.dueCollected")}`, value: value("dueCollected") },
    { label: `± ${t("staffCash.title")}`, value: value("dsrMoney") },
    { label: `± ${t("srCash.title")}`, value: value("srMoney") },
    { label: `− ${t("dsr.cash.expenses")}`, value: value("expenses") },
    { label: `− ${t("dsr.cash.operating")}`, value: value("operatingCost") },
    { label: `= ${t("dashboard.card.totalMoney")}`, value: value("total"), emphasis: true },
  ];
}

/**
 * The day strip and the SR cards. মোট টাকা of a card is the sheet's জমা হওয়ার কথা: সামারি − ফেরত
 * − ড্যামেজ − কমিশন, ± দোকানের বাকি/আদায়, DSR and SR অগ্রিম/শর্ট and খরচ entered on that sheet,
 * with every part shown. Each sheet counts only its own entries, so two SRs never share a due or
 * a খরচ. The strip adds up every live sheet, draft or posted.
 */
function SheetsOverview({
  companyId,
  date,
  view,
  srs,
  live,
  onOpen,
}: {
  companyId: string;
  date: string;
  view: DayView;
  srs: StaffRecord[];
  live: (staffId: string) => DsrDay | undefined;
  onOpen: (staffId: string) => void;
}) {
  const entries = useMoneyEntries(companyId, { from: date, to: date });
  const fieldIds = srs
    .filter((s) => s.assignments.some((a) => a.roleKind === "dsr"))
    .map((s) => s.id);
  const fieldDays = useDsrFieldDays(companyId, fieldIds, date);
  const ready = !entries.isPending && fieldDays.every((q) => !q.isPending);
  const fieldOf = (staffId: string) => {
    const day = fieldDays[fieldIds.indexOf(staffId)]?.data;
    return day && day.visits.length > 0 ? day.totals : null;
  };
  /** The sheet's figures, or null while they load or when the SR has no sheet. */
  const cashOf = (sr: StaffRecord): SheetCash | null => {
    const sheet = live(sr.id);
    if (!sheet || !ready) return null;
    const parts = sheetParts(sheet, view);
    const figures = sheetMoneyFigures(entries.data ?? [], sr.id, sheet, fieldOf(sr.id));
    return {
      issued: parts.issuedValue,
      returned: parts.returnValue,
      sold: roundSettlement(toDecimal(parts.issuedValue).sub(toDecimal(parts.returnValue))),
      damage: parts.damageValue,
      commission: parts.commission,
      dueGiven: figures.dueGiven,
      dueCollected: figures.dueCollected,
      dsrMoney: roundSettlement(figures.dsrMoney),
      srMoney: roundSettlement(figures.srMoney),
      expenses: figures.expenses,
      operatingCost: figures.operatingCost,
      total: dsrCashSettlement({
        sales: cashCheckSales(parts.netSales, parts.damageValue),
        damage: parts.damageValue,
        ...figures,
        handedOver: null,
      }).expected,
    };
  };
  const sheets = srs.flatMap((sr) => {
    const cash = live(sr.id) ? cashOf(sr) : null;
    return cash ? [cash] : [];
  });
  const dayCash: SheetCash | null = ready
    ? (Object.fromEntries(
        CASH_KEYS.map((key) => [key, sumAmounts(["0", ...sheets.map((cash) => cash[key])])]),
      ) as SheetCash)
    : null;
  return (
    <div className="flex flex-col gap-4">
      <DaySalesTotals columns={cashItems(dayCash)} />
      <DsrList dsrs={srs} live={live} onOpen={onOpen} items={(sr) => cashItems(cashOf(sr))} />
    </div>
  );
}

/** Day totals above the SR cards. */
function DaySalesTotals({ columns }: { columns: SummaryItem[] }) {
  return (
    <TableScroller>
      <table className={tableClass} aria-label={t("table.summary")}>
        <thead className={theadClass}>
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={`${thNum}${c.emphasis ? "bg-brand/8 text-brand" : ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            {columns.map((c) => (
              <td
                key={c.label}
                className={`${tdNum}${c.emphasis ? "bg-brand/8 font-semibold" : "font-semibold"}`}
              >
                {c.value}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </TableScroller>
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

/**
 * One SR card: that sheet's own lines only (not the day total, not other SRs).
 * Prices via saleOf/costOf — same path as the open-sheet profit strip.
 */
function sheetParts(sheet: DsrDay, view: DayView): ReturnType<typeof salesProfit> {
  return salesProfit(
    sheet.lines.map((l) => ({
      issued: l.issued,
      returned: l.returned,
      damaged: l.damaged,
      commission: l.commission ?? "0",
      salePrice: saleOf(
        { productId: l.productId, batchKey: l.batchKey, salePrice: l.salePrice ?? undefined },
        view,
      ),
      costPrice: costOf(
        { productId: l.productId, batchKey: l.batchKey, costPrice: l.costPrice ?? undefined },
        view,
      ),
      ...(l.damageRate == null ? {} : { damageRate: l.damageRate }),
    })),
  );
}

function DsrList({
  dsrs,
  live,
  onOpen: setOpen,
  items,
}: {
  dsrs: StaffRecord[];
  live: (staffId: string) => DsrDay | undefined;
  onOpen: (staffId: string) => void;
  /** The cards of an SR's sheet: every figure behind its মোট টাকা. */
  items: (sr: StaffRecord) => SummaryItem[];
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
              <TableSummary label={`${dsr.name} ${t("table.summary")}`} items={items(dsr)} />
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
