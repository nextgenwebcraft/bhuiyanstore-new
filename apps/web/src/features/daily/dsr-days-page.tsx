"use client";

import type { DayView, DsrDay, DsrDaySaveRequest, StaffRecord } from "@bsd/contracts";
import { toBaseQuantity, toCartonDisplay } from "@bsd/domain";
import { formatRate, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useDsrDayCommand, useDsrDays, useSaveDsrDay, useStaffRecords } from "@/data/queries";
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
  money,
  tableClass,
  tableShell,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "./daily-kit";

const PATH = "sales/daily-summaries";

type LineDraft = {
  issuedCartons: string;
  issuedPieces: string;
  returnedCartons: string;
  returnedPieces: string;
  damaged: string;
  splitQuantity: string;
  splitPrice: string;
};
type SheetDraft = {
  lines: Record<string, LineDraft>;
  marketDueNew: string;
  marketDueCollected: string;
  note: string;
};

const blankLine: LineDraft = {
  issuedCartons: "",
  issuedPieces: "",
  returnedCartons: "",
  returnedPieces: "",
  damaged: "",
  splitQuantity: "",
  splitPrice: "",
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
    const first = line.splits[0];
    lines[line.productId] = {
      issuedCartons,
      issuedPieces,
      returnedCartons,
      returnedPieces,
      damaged: line.damaged === "0" ? "" : line.damaged,
      splitQuantity: first?.quantity ?? "",
      splitPrice: first?.unitPrice ?? "",
    };
  }
  const amount = (value: string | undefined) =>
    value === undefined || /^0(\.0+)?$/.test(value) ? "" : value;
  return {
    lines,
    marketDueNew: amount(sheet?.marketDueNew),
    marketDueCollected: amount(sheet?.marketDueCollected),
    note: sheet?.note ?? "",
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
    const quantity = clean(d.splitQuantity);
    const price = clean(d.splitPrice);
    if ((quantity === "") !== (price === "")) return t("dsr.sheet.splitBoth");
    const issued = toBaseQuantity(ic, ip, product.piecesPerCarton);
    const returned = toBaseQuantity(rc, rp, product.piecesPerCarton);
    if (issued === "0" && returned === "0" && damaged === "0" && !quantity) continue;
    lines.push({
      productId: product.productId,
      issued,
      returned,
      damaged,
      splits: quantity ? [{ quantity, unitPrice: price }] : [],
    });
  }
  return {
    ...base,
    marketDueNew: clean(draft.marketDueNew) || "0",
    marketDueCollected: clean(draft.marketDueCollected) || "0",
    note: draft.note.trim(),
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
  const id = useId();
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
      <div className={tableShell}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" rowSpan={2} className={thClass}>
                {t("godown.column.product")}
              </th>
              <th scope="colgroup" colSpan={2} className={`${thNum} text-center`}>
                {t("dsr.sheet.issued")}
              </th>
              <th scope="colgroup" colSpan={2} className={`${thNum} text-center`}>
                {t("dsr.sheet.returned")}
              </th>
              <th scope="col" rowSpan={2} className={thNum}>
                {t("dsr.sheet.damaged")}
              </th>
              <th scope="colgroup" colSpan={2} className={`${thNum} text-center`}>
                {t("dsr.sheet.split")}
              </th>
              <th scope="col" rowSpan={2} className={thNum}>
                {t("dsr.sheet.salePrice")}
              </th>
              {posted ? (
                <th scope="col" rowSpan={2} className={thNum}>
                  {t("dsr.sheet.engineAmount")}
                </th>
              ) : null}
            </tr>
            <tr>
              <th scope="col" className={thNum}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.column.pieces")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.column.cartons")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.column.pieces")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.splitQty")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.sheet.splitPrice")}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.products.map((product) => {
              const name = product.productName;
              return (
                <tr key={product.productId} className="border-t border-border">
                  <th scope="row" className={`${tdClass} text-left font-medium`}>
                    <div>{name}</div>
                    <div className="text-xs font-normal text-text-muted">
                      {product.sku} · {t("godown.column.stock")}{" "}
                      {cartonText(product.stock, product.piecesPerCarton)}
                    </div>
                  </th>
                  <td className={tdNum}>
                    {cell(
                      product.productId,
                      "issuedCartons",
                      `${name} ${t("dsr.sheet.issued")} ${t("godown.column.cartons")}`,
                    )}
                  </td>
                  <td className={tdNum}>
                    {cell(
                      product.productId,
                      "issuedPieces",
                      `${name} ${t("dsr.sheet.issued")} ${t("godown.column.pieces")}`,
                    )}
                  </td>
                  <td className={tdNum}>
                    {cell(
                      product.productId,
                      "returnedCartons",
                      `${name} ${t("dsr.sheet.returned")} ${t("godown.column.cartons")}`,
                    )}
                  </td>
                  <td className={tdNum}>
                    {cell(
                      product.productId,
                      "returnedPieces",
                      `${name} ${t("dsr.sheet.returned")} ${t("godown.column.pieces")}`,
                    )}
                  </td>
                  <td className={tdNum}>
                    {cell(product.productId, "damaged", `${name} ${t("dsr.sheet.damaged")}`)}
                  </td>
                  <td className={tdNum}>
                    {cell(product.productId, "splitQuantity", `${name} ${t("dsr.sheet.splitQty")}`)}
                  </td>
                  <td className={tdNum}>
                    {cell(
                      product.productId,
                      "splitPrice",
                      `${name} ${t("dsr.sheet.splitPrice")}`,
                      "decimal",
                    )}
                  </td>
                  <td className={tdNum}>
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
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${id}-due`} label={t("dsr.sheet.marketDueNew")}>
          <input
            id={`${id}-due`}
            inputMode="decimal"
            value={draft.marketDueNew}
            disabled={locked}
            onChange={(event) => setDraft({ ...draft, marketDueNew: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-collected`} label={t("dsr.sheet.marketDueCollected")}>
          <input
            id={`${id}-collected`}
            inputMode="decimal"
            value={draft.marketDueCollected}
            disabled={locked}
            onChange={(event) => setDraft({ ...draft, marketDueCollected: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-note`} label={t("dsr.sheet.note")} hint={t("common.optional")}>
          <input
            id={`${id}-note`}
            value={draft.note}
            maxLength={500}
            disabled={locked}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
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

  if (records.isPending || sheets.isPending) return <ListSkeleton />;
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
  if (dsrs.length === 0) {
    return <StatePanel title={t("dsr.sheet.noDsr")} hint={t("dsr.sheet.noDsrHint")} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {dsrs.map((dsr) => {
        const sheet = live(dsr.id);
        return (
          <li
            key={dsr.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex items-center gap-3">
              <span className="font-medium">{dsr.name}</span>
              <StatusChip status={sheet?.status ?? "none"} />
            </div>
            <Button variant={sheet ? "secondary" : "primary"} onClick={() => setOpen(dsr.id)}>
              {t(sheet ? "dsr.sheet.open" : "dsr.sheet.start")}
            </Button>
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
      <DayGate companyId={company.id} date={date}>
        {(view) => <Sheets key={date} companyId={company.id} date={date} view={view} />}
      </DayGate>
    </NavGate>
  );
}
