"use client";

import type { DayView, DsrDay, DsrDaySaveRequest, StaffRecord } from "@bsd/contracts";
import { sumAmounts, sumQuantities, toBaseQuantity, toCartonDisplay } from "@bsd/domain";
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
import { useDsrDayCommand, useDsrDays, useSaveDsrDay, useStaffRecords } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
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
};
type SheetDraft = {
  lines: Record<string, LineDraft>;
  marketDueNew: string;
  marketDueCollected: string;
};

const blankLine: LineDraft = {
  issuedCartons: "",
  issuedPieces: "",
  returnedCartons: "",
  returnedPieces: "",
  damaged: "",
};

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
    };
  }
  const amount = (value: string | undefined) =>
    value === undefined || /^0(\.0+)?$/.test(value) ? "" : value;
  return {
    lines,
    marketDueNew: amount(sheet?.marketDueNew),
    marketDueCollected: amount(sheet?.marketDueCollected),
  };
}

const whole = (value: string) => clean(value) || "0";
const isWhole = (value: string) => /^\d+$/.test(value);

function requestOf(
  draft: SheetDraft,
  view: DayView,
  base: { date: string; staffId: string; version: number },
): DsrDaySaveRequest | string {
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
    if (issued === "0" && returned === "0" && damaged === "0") continue;
    lines.push({ productId: product.productId, issued, returned, damaged });
  }
  return {
    ...base,
    marketDueNew: clean(draft.marketDueNew) || "0",
    marketDueCollected: clean(draft.marketDueCollected) || "0",
    lines,
  };
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
        actions={<DateBar date={date} onChange={setDate} />}
      />
      <DateHeading date={date} />
      <DayGate companyId={company.id} date={date} skeleton={<ListSkeleton rows={4} action />}>
        {(view) => <Sheets key={date} companyId={company.id} date={date} view={view} />}
      </DayGate>
    </NavGate>
  );
}
