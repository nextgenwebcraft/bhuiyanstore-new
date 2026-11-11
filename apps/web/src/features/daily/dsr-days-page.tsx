"use client";

import type {
  DayView,
  DsrDay,
  DsrDaySaveRequest,
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
import { formatDateTime, t } from "@bsd/i18n";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { FormDialog } from "@/components/form-dialog";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
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
  CellInput,
  DateBar,
  DayGate,
  isFreeAuto,
  SectionTitle,
  clean,
  useWorkingDate,
} from "./daily-kit";
import { inputClass } from "@/components/field";
import { StatusChip, money, quantity } from "@/components/data-table";
import {
  DsrSheetEntry,
  lineKeyOf,
  markLinesActive,
  type LineDraft,
  type SheetDraft,
} from "./dsr-sheet-entry";

const PATH = "sales/daily-summaries";

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

/**
 * Net pieces that leave saleable stock for a line (D47): issued − returned. Firot returns to
 * মজুদ; damaged pieces stay inside delivered and do not reduce stock by themselves.
 */
function netOf(line: LineDraft, size: string): ReturnType<typeof toDecimal> {
  const issued = toBaseQuantity(whole(line.issuedCartons), whole(line.issuedPieces), size);
  const returned = toBaseQuantity(whole(line.returnedCartons), whole(line.returnedPieces), size);
  return toDecimal(issued).sub(toDecimal(returned));
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
  const handed = clean(draft.handedOver);
  if (handed && !isAmount(handed)) return t("validation.opening.amount");
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
    const salePrice =
      !includePrices || d.salePrice === undefined ? undefined : clean(d.salePrice);
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

const commissionOf = (lines: { commission?: string | undefined }[]) =>
  sumAmounts(["0", ...lines.map((l) => l.commission ?? "0")]);

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
  const handed = clean(handedOver);
  const settlement = dsrCashSettlement({
    sales,
    damage,
    dueGiven,
    dueCollected,
    expenses,
    operatingCost,
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
  const [error, setError] = useState<string | undefined>();
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reversePending, setReversePending] = useState(false);
  const [reverseError, setReverseError] = useState<string | undefined>();
  const action = useAsyncAction();
  const shownError = error ?? action.error;
  const posted = sheet?.status === "posted";
  const handoverLocked =
    sheet?.handoverStatus === "pending" || sheet?.handoverStatus === "approved";
  const isDsrLogin = loginRoleKind === "dsr";
  const isManagerLogin = loginRoleKind === "manager";
  // D56/D126: Super Admin alone may correct a posted sheet. Manager edits while draft only;
  // after post the sheet locks (হাতে জমা amount still open until submit). DSR never corrects.
  const canCorrect =
    !handoverLocked &&
    loginRoleKind === null &&
    permissions.includes("sale.create") &&
    permissions.includes("sale.post") &&
    permissions.includes("sale.reverse");
  const locked =
    handoverLocked ||
    !permissions.includes("sale.create") ||
    (posted && !canCorrect) ||
    (isDsrLogin && posted);
  const issuedLocked = locked || isDsrLogin;
  const priceLocked =
    locked || isManagerLogin || isDsrLogin || !permissions.includes("sale.price_override");
  // হাতে জমা is entered on a posted sheet; keep that field open until submit even when
  // the সামারি table is locked for Manager.
  const canTypeHandover =
    posted &&
    sheet?.handoverStatus === "none" &&
    permissions.includes("sale.handover_submit");
  const handoverAmountLocked = canTypeHandover ? false : locked || handoverLocked;
  const base = { date, staffId: staff.id, version: sheet?.version ?? 0 };
  const includePrices = permissions.includes("sale.price_override");
  const built = requestOf(draft, view, base, includePrices);
  const dirty =
    typeof built === "string" ||
    JSON.stringify(built) !==
      JSON.stringify(requestOf(draftOf(sheet), view, base, includePrices));
  const pending = save.isPending || command.isPending;
  // D122: engine persons are line DSRs, not the SR sheet owner.
  const sheetDsrIds = new Set(
    (typeof built === "string" ? draft.lines.map((l) => l.dsrStaffId) : built.lines.map((l) => l.dsrStaffId)),
  );
  const amounts = new Map(
    view.persons
      .filter((p) => sheetDsrIds.has(p.staffId))
      .map((p) => [p.productId, p.amount]),
  );
  const entered = typeof built === "string" ? [] : built.lines;
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
  // Dues / DSR খরচ post under the picked DSR, not the SR sheet owner — load the whole date.
  const entries = useMoneyEntries(companyId, { from: date, to: date });
  const field = fieldDay.data && fieldDay.data.visits.length > 0 ? fieldDay.data : null;
  const posts = (entries.data ?? []).filter((e) => e.status === "posted");
  const teamIds = new Set(dsrChoices.map((d) => d.id));
  const teamPosts = posts.filter((e) => e.staffId !== null && teamIds.has(e.staffId));
  const srPosts = posts.filter((e) => e.staffId === staff.id);
  /** DSRs on the sheet excluding the open SR when that person is also listed as a DSR. */
  const dsrOnlyPosts = teamPosts.filter((e) => e.staffId !== staff.id);
  const teamSum = (kind: MoneyEntry["kind"], rows: MoneyEntry[] = teamPosts) =>
    sumAmounts(["0", ...rows.filter((e) => e.kind === kind).map((e) => e.amount)]);
  const srSum = (kind: MoneyEntry["kind"]) =>
    sumAmounts(["0", ...srPosts.filter((e) => e.kind === kind).map((e) => e.amount)]);
  const srMove = (kind: "srLoan" | "srRepayment") =>
    sumAmounts([
      "0",
      ...srPosts.filter((e) => e.kind === kind && e.srLoanType !== "commission").map((e) => e.amount),
    ]);
  const operatingCost = sumAmounts([
    "0",
    ...posts.filter((e) => e.kind === "expense").map((e) => e.amount),
  ]);
  const sheetDue = (value: string | undefined) => value ?? "0";
  const cash = {
    sales: posted && !dirty ? sumAmounts(["0", ...amounts.values()]) : previewSales(entered, view),
    // Field visits (when present) own that person's due; office ShopDue rows cover the DSRs.
    dueGiven: sumAmounts([
      field ? field.totals.dueCreated : "0",
      teamSum("marketDueNew", dsrOnlyPosts),
      sheetDue(sheet?.marketDueNew),
    ]),
    dueCollected: sumAmounts([
      field ? field.totals.dueCollected : "0",
      teamSum("marketDueCollected", dsrOnlyPosts),
      sheetDue(sheet?.marketDueCollected),
    ]),
    expenses: teamSum("staffCostPaid"),
    operatingCost,
    // D79: SR অগ্রিম ও শর্ট on the open SR; DSR advance/short for other DSRs on the sheet.
    staffMoney: toDecimal(srSum("staffRepayment"))
      .add(teamSum("staffRepayment", dsrOnlyPosts))
      .add(srMove("srRepayment"))
      .sub(toDecimal(srSum("staffAdvance")))
      .sub(toDecimal(teamSum("staffAdvance", dsrOnlyPosts)))
      .sub(toDecimal(srSum("staffShortage")))
      .sub(toDecimal(teamSum("staffShortage", dsrOnlyPosts)))
      .sub(srMove("srLoan"))
      .toString(),
  };
  // হাতে জমা (D106): sales − due given + due collected, before expenses or staff money.
  const cashInHand = cashInHandOf(cash);

  // D69: the table's amounts as the profit's parts (domain `salesProfit`), pieces underneath.
  const parts = salesProfit(
    entered.map((l) => {
      const salePrice = saleOf(l, view);
      const damageRate = clean(l.damageRate ?? "");
      return {
        issued: l.issued,
        returned: l.returned,
        damaged: l.damaged,
        commission: l.commission ?? "0",
        salePrice,
        costPrice: costOf(l, view),
        ...(damageRate && isUnitPrice(damageRate) ? { damageRate } : {}),
      };
    }),
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
      await action.run(async () => {
        await save.mutateAsync(built);
        setDraft((d) => markLinesActive(d));
      }, { confirm: "dsr.sheet.correctConfirm" });
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
        if (kind === "discard") setDraft(draftOf(undefined));
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
      <DsrSheetEntry
        draft={draft}
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
      />
      <StaffCashEntry
        companyId={companyId}
        staffId={staff.id}
        date={date}
        dsrs={staffChoices}
        handoverLocked={handoverLocked}
      />
      <SrCashEntry
        companyId={companyId}
        staffId={staff.id}
        date={date}
        handoverLocked={handoverLocked}
      />
      <OperatingCostEntry companyId={companyId} date={date} handoverLocked={handoverLocked} />
      {!isDsrLogin ? (
        <CashCheck
          {...cash}
          sales={cashCheckSales(parts.netSales, parts.damageValue)}
          damage={parts.damageValue}
          handedOver={draft.handedOver}
          locked={handoverAmountLocked}
          onHandedOver={(handedOver) => setDraft((d) => ({ ...d, handedOver }))}
        />
      ) : null}
      {sheet?.handoverStatus === "pending" ? (
        <StatePanel tone="warning" title={t("dsr.handover.pendingBanner")} />
      ) : null}
      {sheet?.handoverStatus === "approved" ? (
        <StatePanel title={t("dsr.handover.approvedBanner")} />
      ) : null}
      {shownError ? <StatePanel tone="error" title={shownError} /> : null}
      <div className="flex flex-wrap gap-2">
        {!posted && !isDsrLogin && permissions.includes("sale.post") ? (
          <Button variant="primary" disabled={pending} onClick={() => void run("post")}>
            {command.isPending ? t("common.posting") : t("common.post")}
          </Button>
        ) : null}
        {sheet?.status === "draft" && permissions.includes("sale.create") && !handoverLocked ? (
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
            disabled={pending || !clean(draft.handedOver)}
            onClick={() =>
              void command.mutateAsync({
                action: "handover-submit",
                dayId: sheet.id,
                version: sheet.version,
                cashHandedOver: clean(draft.handedOver),
              })
            }
          >
            {t("dsr.handover.submit")}
          </Button>
        ) : null}
        {posted && sheet && sheet.handoverStatus === "pending" && loginRoleKind === null ? (
          <StatePanel title={t("dsr.handover.approveOnDashboard")} />
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
