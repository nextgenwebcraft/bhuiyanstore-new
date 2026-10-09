"use client";

import type {
  DayView,
  DsrDay,
  DsrDaySaveRequest,
  FieldDay,
  MoneyEntry,
  StaffRecord,
} from "@bsd/contracts";
import {
  dsrCashSettlement,
  sumAmounts,
  sumQuantities,
  toBaseQuantity,
  toCartonDisplay,
  toDecimal,
} from "@bsd/domain";
import { formatRate, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
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
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  CartonQty,
  CellInput,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  StatusChip,
  TableScroller,
  clean,
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
  useWorkingDate,
} from "./daily-kit";

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

type LineDraft = {
  issuedCartons: string;
  issuedPieces: string;
  returnedCartons: string;
  returnedPieces: string;
  damaged: string;
  commission: string;
};
type SheetDraft = { lines: Record<string, LineDraft>; handedOver: string };

const blankLine: LineDraft = {
  issuedCartons: "",
  issuedPieces: "",
  returnedCartons: "",
  returnedPieces: "",
  damaged: "",
  commission: "",
};
const isAmount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value);

/** DSRs assigned to the company on the date (D23: product custody is DSR-only). */
export function dsrsOn(records: StaffRecord[], companyId: string, date: string) {
  return records.filter((s) =>
    s.assignments.some(
      (a) =>
        a.companyId === companyId &&
        a.roleKind === "dsr" &&
        a.from <= date &&
        (a.to === null || a.to >= date),
    ),
  );
}

function split(pieces: string, size: string): [string, string] {
  if (pieces === "0") return ["", ""];
  if (size === "1") return ["", pieces];
  const { cartons, loosePieces } = toCartonDisplay(pieces, size);
  return [cartons === "0" ? "" : cartons, loosePieces === "0" ? "" : loosePieces];
}

function draftOf(sheet: DsrDay | undefined): SheetDraft {
  const lines: Record<string, LineDraft> = {};
  for (const line of sheet?.lines ?? []) {
    const [issuedCartons, issuedPieces] = split(line.issued, line.piecesPerCarton);
    const [returnedCartons, returnedPieces] = split(line.returned, line.piecesPerCarton);
    lines[line.productId] = {
      issuedCartons,
      issuedPieces,
      returnedCartons,
      returnedPieces,
      damaged: line.damaged === "0" ? "" : line.damaged,
      commission: toDecimal(line.commission).isZero() ? "" : line.commission,
    };
  }
  return { lines, handedOver: sheet?.cashHandedOver ?? "" };
}

const whole = (value: string) => clean(value) || "0";
const isWhole = (value: string) => /^\d+$/.test(value);

function requestOf(
  draft: SheetDraft,
  view: DayView,
  base: { date: string; staffId: string; version: number },
): DsrDaySaveRequest | string {
  const handed = clean(draft.handedOver);
  if (handed && !isAmount(handed)) return t("validation.opening.amount");
  const lines: DsrDaySaveRequest["lines"] = [];
  for (const product of view.products) {
    const d = draft.lines[product.productId];
    if (!d) continue;
    const parts = [
      d.issuedCartons,
      d.issuedPieces,
      d.returnedCartons,
      d.returnedPieces,
      d.damaged,
    ].map(whole);
    if (!parts.every(isWhole)) return t("validation.wholeNumber");
    const [ic, ip, rc, rp, damaged] = parts as [string, string, string, string, string];
    const issued = toBaseQuantity(ic, ip, product.piecesPerCarton);
    const returned = toBaseQuantity(rc, rp, product.piecesPerCarton);
    const commission = clean(d.commission) || "0";
    if (!isAmount(commission)) return t("validation.opening.amount");
    const noCommission = toDecimal(commission).isZero();
    if (issued === "0" && returned === "0" && damaged === "0" && noCommission) continue;
    lines.push({
      productId: product.productId,
      issued,
      returned,
      damaged,
      commission: noCommission ? "0" : commission,
    });
  }
  return { ...base, cashHandedOver: handed || null, lines };
}

/** Pieces sold × the day's price − commission, before posting (the engine owns the posted figure). */
function previewSales(lines: DsrDaySaveRequest["lines"], view: DayView): string {
  const prices = new Map(view.products.map((p) => [p.productId, p.salePrice]));
  return sumAmounts([
    "0",
    ...lines.map((l) => {
      const sold = toDecimal(l.issued).sub(toDecimal(l.returned)).sub(toDecimal(l.damaged));
      return sold
        .mul(toDecimal(prices.get(l.productId) ?? "0"))
        .sub(toDecimal(l.commission ?? "0"))
        .toString();
    }),
  ]);
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
  const product = (id: string) => view.products.find((p) => p.productId === id);
  const mismatch = (kind: "returned" | "damaged") =>
    field.products.some((p) => {
      const d = draft.lines[p.productId] ?? blankLine;
      const size = product(p.productId)?.piecesPerCarton ?? p.piecesPerCarton;
      const entered =
        kind === "returned"
          ? [d.returnedCartons, d.returnedPieces].map(whole)
          : ["0", whole(d.damaged)];
      if (!entered.every(isWhole)) return true;
      const pieces = toBaseQuantity(entered[0] ?? "0", entered[1] ?? "0", size);
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

/** Day-end cash check (D39): display only, nothing is posted from it. */
function CashCheck({
  sales,
  dueGiven,
  dueCollected,
  expenses,
  handedOver,
  locked,
  onHandedOver,
}: {
  sales: string;
  dueGiven: string;
  dueCollected: string;
  expenses: string;
  handedOver: string;
  locked: boolean;
  onHandedOver: (value: string) => void;
}) {
  const handed = clean(handedOver);
  const settlement = dsrCashSettlement({
    sales,
    dueGiven,
    dueCollected,
    expenses,
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
            ["dsr.cash.dueGiven", dueGiven],
            ["dsr.cash.dueCollected", dueCollected],
            ["dsr.cash.expenses", expenses],
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
  onBack,
}: {
  companyId: string;
  date: string;
  staff: StaffRecord;
  sheet: DsrDay | undefined;
  history: DsrDay[];
  view: DayView;
  onBack: () => void;
}) {
  const { permissions } = useCurrentWorkspace();
  const save = useSaveDsrDay(companyId);
  const command = useDsrDayCommand(companyId);
  const [draft, setDraft] = useState(() => draftOf(sheet));
  const [error, setError] = useState<string | undefined>();
  const posted = sheet?.status === "posted";
  const locked = posted || !permissions.includes("sale.create");
  const base = { date, staffId: staff.id, version: sheet?.version ?? 0 };
  const built = requestOf(draft, view, base);
  const dirty =
    typeof built === "string" ||
    JSON.stringify(built) !== JSON.stringify(requestOf(draftOf(sheet), view, base));
  const pending = save.isPending || command.isPending;
  const amounts = new Map(
    view.persons.filter((p) => p.staffId === staff.id).map((p) => [p.productId, p.amount]),
  );
  const entered = typeof built === "string" ? [] : built.lines;
  const fieldDay = useDsrFieldDay(companyId, staff.id, date);
  const entries = useMoneyEntries(companyId, { from: date, to: date, staffId: staff.id });
  const field = fieldDay.data && fieldDay.data.visits.length > 0 ? fieldDay.data : null;
  const posts = (entries.data ?? []).filter((e) => e.status === "posted");
  const entrySum = (kind: MoneyEntry["kind"]) =>
    sumAmounts(["0", ...posts.filter((e) => e.kind === kind).map((e) => e.amount)]);
  const sheetDue = (value: string | undefined) => value ?? "0";
  const cash = {
    sales: posted ? sumAmounts(["0", ...amounts.values()]) : previewSales(entered, view),
    dueGiven: field
      ? field.totals.dueCreated
      : sumAmounts([entrySum("marketDueNew"), sheetDue(sheet?.marketDueNew)]),
    dueCollected: field
      ? field.totals.dueCollected
      : sumAmounts([entrySum("marketDueCollected"), sheetDue(sheet?.marketDueCollected)]),
    expenses: entrySum("staffCostPaid"),
  };

  /** Firot = samari still in hand, damaged = pieces exchanged at shops. */
  function prefillFromField() {
    if (!field) return;
    setDraft((d) => {
      const lines = { ...d.lines };
      for (const p of field.products) {
        const size = view.products.find((v) => v.productId === p.productId)?.piecesPerCarton;
        const [returnedCartons, returnedPieces] = split(p.remaining, size ?? p.piecesPerCarton);
        lines[p.productId] = {
          ...(lines[p.productId] ?? blankLine),
          returnedCartons,
          returnedPieces,
          damaged: p.exchanged === "0" ? "" : p.exchanged,
        };
      }
      return { ...d, lines };
    });
  }
  const sheetSummary: SummaryItem[] = [
    { label: t("table.summary.products"), value: quantity(String(entered.length)) },
    {
      label: `${t("dsr.sheet.issued")} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(entered.map((l) => l.issued))),
    },
    {
      label: `${t("dsr.sheet.returned")} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(entered.map((l) => l.returned))),
    },
    {
      label: `${t("dsr.sheet.damaged")} (${t("godown.column.pieces")})`,
      value: quantity(sumQuantities(entered.map((l) => l.damaged))),
    },
    { label: t("dsr.summary.commission"), value: money(commissionOf(entered)) },
    ...(posted
      ? [
          {
            label: t("dsr.sheet.engineAmount"),
            value: money(sumAmounts([...amounts.values()])),
            emphasis: true,
          },
        ]
      : []),
  ];

  const setLine = (productId: string, patch: Partial<LineDraft>) =>
    setDraft((d) => ({
      ...d,
      lines: { ...d.lines, [productId]: { ...(d.lines[productId] ?? blankLine), ...patch } },
    }));

  async function run(action: "save" | "post" | "discard" | "reverse") {
    setError(undefined);
    try {
      if (action === "save" || action === "post") {
        if (typeof built === "string") {
          setError(built);
          return;
        }
        const current = dirty || !sheet ? await save.mutateAsync(built) : sheet;
        if (action === "post") {
          await command.mutateAsync({
            action: "post",
            dayId: current.id,
            version: current.version,
          });
        }
        return;
      }
      if (!sheet) return;
      if (action === "reverse" && !window.confirm(t("dsr.sheet.reverseConfirm"))) return;
      if (action === "discard" && !window.confirm(t("dsr.sheet.discardConfirm"))) return;
      await command.mutateAsync({ action, dayId: sheet.id, version: sheet.version });
      if (action === "discard") setDraft(draftOf(undefined));
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  const cell = (
    productId: string,
    field: keyof LineDraft,
    label: string,
    mode: "numeric" | "decimal" = "numeric",
  ) => (
    <CellInput
      label={label}
      value={(draft.lines[productId] ?? blankLine)[field]}
      onChange={(value) => setLine(productId, { [field]: value })}
      disabled={locked}
      mode={mode}
      width={mode === "decimal" ? "w-20" : "w-14"}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onBack}>← {t("dsr.sheet.back")}</Button>
        <h2 className="text-lg font-semibold">{staff.name}</h2>
        <StatusChip status={sheet?.status ?? "none"} />
      </div>
      {posted ? <StatePanel title={t("dsr.sheet.postedHint")} /> : null}
      <TableSummary label={t("table.summary")} items={sheetSummary} />
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" rowSpan={2} className={`${thClass} ${stickyHead} align-bottom`}>
                {t("godown.column.product")}
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
              <th scope="col" rowSpan={2} className={`${loneHead} ${GROUP.commission.head}`}>
                {t("dsr.sheet.commission")}
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${thNum} border-l border-border align-bottom`}
              >
                {t("dsr.sheet.salePrice")}
              </th>
              {posted ? (
                <th scope="col" rowSpan={2} className={`${thNum} align-bottom`}>
                  {t("dsr.sheet.engineAmount")}
                </th>
              ) : null}
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
            {view.products.map((product) => {
              const name = product.productName;
              return (
                <tr key={product.productId} className="border-t border-border">
                  <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                    <div>{name}</div>
                    <div className="text-xs font-normal text-text-muted">
                      {product.sku} · {t("godown.column.stock")}{" "}
                      <CartonQty pieces={product.stock} piecesPerCarton={product.piecesPerCarton} />
                    </div>
                  </th>
                  <td className={`${inputCell} border-l ${GROUP.issued.cell}`}>
                    {cell(
                      product.productId,
                      "issuedCartons",
                      `${name} ${t("dsr.sheet.issued")} ${t("godown.column.cartons")}`,
                    )}
                  </td>
                  <td className={`${inputCell} ${GROUP.issued.cell}`}>
                    {cell(
                      product.productId,
                      "issuedPieces",
                      `${name} ${t("dsr.sheet.issued")} ${t("godown.column.pieces")}`,
                    )}
                  </td>
                  <td className={`${inputCell} border-l ${GROUP.returned.cell}`}>
                    {cell(
                      product.productId,
                      "returnedCartons",
                      `${name} ${t("dsr.sheet.returned")} ${t("godown.column.cartons")}`,
                    )}
                  </td>
                  <td className={`${inputCell} ${GROUP.returned.cell}`}>
                    {cell(
                      product.productId,
                      "returnedPieces",
                      `${name} ${t("dsr.sheet.returned")} ${t("godown.column.pieces")}`,
                    )}
                  </td>
                  <td className={`${inputCell} border-l ${GROUP.damaged.cell}`}>
                    {cell(product.productId, "damaged", `${name} ${t("dsr.sheet.damaged")}`)}
                  </td>
                  <td className={`${inputCell} border-l ${GROUP.commission.cell}`}>
                    {cell(
                      product.productId,
                      "commission",
                      `${name} ${t("dsr.sheet.commission")}`,
                      "decimal",
                    )}
                  </td>
                  <td className={`${tdNum} border-l border-border`}>
                    {product.salePrice ? formatRate(product.salePrice) : "—"}
                  </td>
                  {posted ? (
                    <td className={tdNum}>{money(amounts.get(product.productId) ?? "0")}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-text-muted">{t("dsr.sheet.hint")}</p>
      {field ? (
        <FieldEntries
          field={field}
          draft={draft}
          view={view}
          locked={locked}
          onPrefill={prefillFromField}
        />
      ) : null}
      <CashCheck
        {...cash}
        handedOver={draft.handedOver}
        locked={locked}
        onHandedOver={(handedOver) => setDraft((d) => ({ ...d, handedOver }))}
      />
      {error ? <StatePanel tone="error" title={error} /> : null}
      <div className="flex flex-wrap gap-2">
        {!posted && permissions.includes("sale.create") ? (
          <Button disabled={pending || (!dirty && Boolean(sheet))} onClick={() => void run("save")}>
            {save.isPending ? t("common.saving") : t("dsr.sheet.saveDraft")}
          </Button>
        ) : null}
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
                {h.reversedAt ? new Date(h.reversedAt).toLocaleString("bn-BD") : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Sheets({ companyId, date, view }: { companyId: string; date: string; view: DayView }) {
  const records = useStaffRecords(companyId);
  const sheets = useDsrDays(companyId, date);
  const [open, setOpen] = useState<string | null>(null);

  if (records.isPending || sheets.isPending) return <ListSkeleton rows={4} action />;
  if (records.isError)
    return <QueryError error={records.error} onRetry={() => void records.refetch()} />;
  if (sheets.isError)
    return <QueryError error={sheets.error} onRetry={() => void sheets.refetch()} />;

  const dsrs = dsrsOn(records.data, companyId, date);
  const live = (staffId: string) =>
    sheets.data.find((s) => s.staffId === staffId && s.status !== "reversed");
  const selected = dsrs.find((d) => d.id === open);
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
        onBack={() => setOpen(null)}
      />
    );
  }
  const statuses = dsrs.map((d) => live(d.id)?.status ?? "none");
  const count = (status: string) => quantity(String(statuses.filter((s) => s === status).length));
  const dayPieces = (field: "issued" | "returned" | "damaged") =>
    quantity(sumQuantities(view.products.map((p) => p[field])));
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("dsr.summary.dsrs")} value={quantity(String(dsrs.length))} />
        <StatTile label={t("dsr.summary.posted")} value={count("posted")} />
        <StatTile label={t("dsr.summary.draft")} value={count("draft")} />
        <StatTile label={t("dsr.summary.notStarted")} value={count("none")} />
        <StatTile label={pieceLabel("dsr.sheet.issued")} value={dayPieces("issued")} />
        <StatTile label={pieceLabel("dsr.sheet.returned")} value={dayPieces("returned")} />
        <StatTile label={pieceLabel("dsr.sheet.damaged")} value={dayPieces("damaged")} />
        <StatTile label={t("dsr.summary.commission")} value={money(view.money.commission)} />
        <StatTile label={t("dsr.summary.sales")} value={money(view.money.sales)} emphasis />
      </dl>
      {dsrs.length === 0 ? (
        <StatePanel title={t("dsr.sheet.noDsr")} hint={t("dsr.sheet.noDsrHint")} />
      ) : (
        <DsrList dsrs={dsrs} live={live} view={view} onOpen={setOpen} />
      )}
    </div>
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

export function DsrDaysPage() {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.sales.dailySummaries")}
        description={t("dsr.sheet.description")}
        actions={
          <>
            <DateBar date={date} onChange={setDate} />
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t("nav.sales.dailySummaries")} from={date} />
      <DateHeading date={date} />
      <DayGate companyId={company.id} date={date} skeleton={<ListSkeleton rows={4} action />}>
        {(view) => <Sheets key={date} companyId={company.id} date={date} view={view} />}
      </DayGate>
    </NavGate>
  );
}
