"use client";

import type {
  Opening,
  OpeningBalanceKind,
  OpeningIssue,
  OpeningSaveRequest,
  OpeningWorkbookSheets,
  StaffMember,
} from "@bsd/contracts";
import { OPENING_KIND_EFFECTS } from "@bsd/domain";
import {
  formatAmount,
  formatBusinessDate,
  formatRate,
  normalizeDigits,
  t,
  type TranslationKey,
} from "@bsd/i18n";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { PageSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useActivateOpening,
  useApproveOpening,
  useConfigList,
  useImportOpeningWorkbook,
  useInspectOpeningWorkbook,
  useOpening,
  useSaveOpening,
  useStaff,
} from "@/data/queries";
import { useService } from "@/data/service-context";
import { downloadBlob } from "@/lib/download";
import { stickyCell, stickyHead } from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "admin/opening";

const stockFields = ["pieces", "unitCost", "salePrice", "orderPrice", "dueFromCompany"] as const;
type StockField = (typeof stockFields)[number];
type StockDraft = Record<StockField, string> & { note: string };
type BalanceDraft = { amount: string; note: string };
type Draft = {
  cutoffDate: string;
  stock: Record<string, StockDraft>;
  balances: Record<string, BalanceDraft>;
};
type Party = { staffId: string | null; cashAccountId: string | null };
type Tab = "stock" | "marketDue" | "staff" | "company" | "cash" | "review";
const tabs: Tab[] = ["stock", "marketDue", "staff", "company", "cash", "review"];

const keyOf = (kind: OpeningBalanceKind, party: Party) =>
  `${kind}|${party.staffId ?? party.cashAccountId ?? ""}`;

function draftOf(view: Opening): Draft {
  return {
    cutoffDate: view.cutoffDate ?? "",
    stock: Object.fromEntries(
      view.stock.map((l) => [
        l.productId,
        {
          pieces: l.pieces ?? "",
          unitCost: l.unitCost ?? "",
          salePrice: l.salePrice ?? "",
          orderPrice: l.orderPrice ?? "",
          dueFromCompany: l.dueFromCompany ?? "",
          note: l.note,
        },
      ]),
    ),
    balances: Object.fromEntries(
      view.balances.map((b) => [keyOf(b.kind, b), { amount: b.amount ?? "", note: b.note }]),
    ),
  };
}

const blankToNull = (value: string) => {
  const v = normalizeDigits(value).trim();
  return v === "" ? null : v;
};

/** The request for the entered values; rows the user never touched stay out of the snapshot. */
function requestOf(view: Opening, draft: Draft): OpeningSaveRequest {
  const existing = new Set(view.balances.map((b) => keyOf(b.kind, b)));
  return {
    version: view.version,
    cutoffDate: blankToNull(draft.cutoffDate),
    stock: view.stock.map((l) => {
      const d = draft.stock[l.productId];
      return {
        productId: l.productId,
        pieces: blankToNull(d?.pieces ?? ""),
        unitCost: blankToNull(d?.unitCost ?? ""),
        salePrice: blankToNull(d?.salePrice ?? ""),
        orderPrice: blankToNull(d?.orderPrice ?? ""),
        dueFromCompany: blankToNull(d?.dueFromCompany ?? ""),
        note: d?.note.trim() ?? "",
      };
    }),
    balances: Object.entries(draft.balances)
      .filter(([key, b]) => existing.has(key) || b.amount.trim() !== "" || b.note.trim() !== "")
      .map(([key, b]) => {
        const [kind = "", partyId = ""] = key.split("|");
        const party = OPENING_KIND_EFFECTS[kind as OpeningBalanceKind].party;
        return {
          kind: kind as OpeningBalanceKind,
          staffId: party === "staff" || party === "optionalStaff" ? partyId || null : null,
          cashAccountId: party === "cashAccount" ? partyId || null : null,
          amount: blankToNull(b.amount),
          note: b.note.trim(),
        };
      }),
  };
}

const isDirty = (view: Opening, draft: Draft) =>
  JSON.stringify(requestOf(view, draft)) !== JSON.stringify(requestOf(view, draftOf(view)));

// ---------------------------------------------------------------- small pieces

function OpeningStatus({ status }: { status: Opening["status"] }) {
  const tone = status === "active" ? "success" : status === "approved" ? "brand" : "muted";
  return <StatusBadge tone={tone}>{t(`opening.status.${status}`)}</StatusBadge>;
}

function CellInput({
  label,
  value,
  onChange,
  disabled,
  invalid = false,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid?: boolean;
  wide?: boolean;
}) {
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-9 rounded-md border bg-surface px-2 text-right tabular-nums disabled:bg-surface-muted ${
        wide ? "w-32" : "w-24"
      } ${invalid ? "border-error" : "border-border"}`}
    />
  );
}

function issueText(issue: OpeningIssue) {
  return t(issue.code as TranslationKey);
}

// ---------------------------------------------------------------- import dialog

function ImportDialog({
  companyId,
  version,
  onClose,
}: {
  companyId: string;
  version: number;
  onClose: () => void;
}) {
  const id = useId();
  const inspect = useInspectOpeningWorkbook(companyId);
  const run = useImportOpeningWorkbook(companyId);
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<OpeningWorkbookSheets | null>(null);
  const [sheet, setSheet] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function choose(next: File | null) {
    setFile(next);
    setFound(null);
    setError(undefined);
    if (!next) return;
    try {
      const result = await inspect.mutateAsync(next);
      setFound(result);
      setSheet(result.sheets[0] ?? "");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  async function submit() {
    if (!file || !found) {
      setError(t("validation.required"));
      return;
    }
    if (!found.template && !sheet) {
      setError(t("validation.opening.sheet"));
      return;
    }
    try {
      await run.mutateAsync({
        file,
        fileName: file.name,
        sheet: found.template ? null : sheet,
        version,
      });
      onClose();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open
      title={t("opening.import.title")}
      error={error}
      pending={inspect.isPending || run.isPending}
      submitLabel={run.isPending ? t("opening.import.running") : t("opening.import.run")}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-file`} label={t("opening.import.file")}>
        <input
          id={`${id}-file`}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </Field>
      {inspect.isPending ? (
        <p className="text-sm text-text-muted">{t("opening.import.reading")}</p>
      ) : null}
      {found?.template ? <StatePanel title={t("opening.import.template")} /> : null}
      {found && !found.template && found.sheets.length === 0 ? (
        <StatePanel tone="warning" title={t("opening.import.noSheets")} />
      ) : null}
      {found && !found.template && found.sheets.length > 0 ? (
        <Field
          id={`${id}-sheet`}
          label={t("opening.import.sheet")}
          hint={`${t("opening.import.sheetHint")} ${t("opening.import.keepsEdits")}`}
        >
          <select
            id={`${id}-sheet`}
            value={sheet}
            onChange={(event) => setSheet(event.target.value)}
            className={inputClass}
          >
            {found.sheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- tabs

function StockTab({
  view,
  draft,
  locked,
  onChange,
}: {
  view: Opening;
  draft: Draft;
  locked: boolean;
  onChange: (productId: string, field: StockField | "note", value: string) => void;
}) {
  const issuesBy = useMemo(() => {
    const map = new Map<string, OpeningIssue[]>();
    for (const issue of view.issues) {
      if (!issue.productId) continue;
      map.set(issue.productId, [...(map.get(issue.productId) ?? []), issue]);
    }
    return map;
  }, [view.issues]);
  const labels: Record<StockField, string> = {
    pieces: t("opening.pieces"),
    unitCost: t("opening.unitCost"),
    salePrice: t("opening.salePrice"),
    orderPrice: t("opening.orderPrice"),
    dueFromCompany: t("opening.dueFromCompany"),
  };

  if (view.stock.length === 0) return <StatePanel title={t("product.empty")} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t("opening.unknownHint")}</p>
      <TableScroller>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-muted text-left text-xs text-text-muted">
            <tr>
              <th scope="col" className={`px-3 py-3 font-medium ${stickyHead}`}>
                {t("product.name")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                {t("opening.fromExcel")}
              </th>
              {stockFields.map((f) => (
                <th key={f} scope="col" className="px-3 py-3 text-right font-medium">
                  {labels[f]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {view.stock.map((line) => {
              const d = draft.stock[line.productId];
              const issues = issuesBy.get(line.productId) ?? [];
              const errors = issues.filter((i) => i.severity === "error");
              const differs =
                line.source?.pieces != null && (d?.pieces ?? "") !== line.source.pieces;
              return (
                <tr key={line.productId} className="border-t border-border align-top">
                  <th scope="row" className={`px-3 py-2 text-left font-medium ${stickyCell}`}>
                    <div>{line.productName}</div>
                    <div className="text-xs font-normal text-text-subtle">
                      {line.sku}
                      {line.piecesPerCarton
                        ? ` · ${t("common.cartons")} ${formatAmount(line.piecesPerCarton)}`
                        : ""}
                    </div>
                    {issues.map((issue) => (
                      <div
                        key={issue.code}
                        className={`mt-1 text-xs font-normal ${
                          issue.severity === "error" ? "text-error" : "text-warning"
                        }`}
                      >
                        {issueText(issue)}
                      </div>
                    ))}
                  </th>
                  <td
                    className={`px-3 py-2 text-right ${differs ? "text-warning" : "text-text-muted"}`}
                  >
                    {line.source?.pieces != null ? formatAmount(line.source.pieces) : "—"}
                  </td>
                  {stockFields.map((f) => (
                    <td key={f} className="px-3 py-2 text-right">
                      <CellInput
                        label={`${line.productName}: ${labels[f]}`}
                        value={d?.[f] ?? ""}
                        disabled={locked}
                        invalid={
                          (f === "pieces" &&
                            errors.some((e) => e.code.startsWith("opening.issue.stock"))) ||
                          (f === "unitCost" &&
                            errors.some((e) => e.code === "opening.issue.costMissing")) ||
                          (f === "dueFromCompany" &&
                            errors.some((e) => e.code === "opening.issue.dueInvalid"))
                        }
                        onChange={(value) => onChange(line.productId, f, value)}
                      />
                      {line.source?.[f] != null &&
                      f !== "pieces" &&
                      line.source[f] !== (d?.[f] ?? "") ? (
                        <div className="mt-0.5 text-xs text-text-subtle">
                          {t("opening.fromExcel")}{" "}
                          {f === "dueFromCompany"
                            ? formatAmount(line.source[f] ?? "")
                            : formatRate(line.source[f] ?? "")}
                        </div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
    </div>
  );
}

type BalanceRow = {
  kind: OpeningBalanceKind;
  party: Party;
  label: string;
  group?: string | undefined;
};

function BalanceTable({
  rows,
  view,
  draft,
  locked,
  onChange,
}: {
  rows: BalanceRow[];
  view: Opening;
  draft: Draft;
  locked: boolean;
  onChange: (key: string, field: keyof BalanceDraft, value: string) => void;
}) {
  const sourceOf = new Map(view.balances.map((b) => [keyOf(b.kind, b), b.sourceAmount]));
  const issuesOf = (row: BalanceRow) =>
    view.issues.filter(
      (i) =>
        i.kind === row.kind &&
        (i.staffId ?? null) === row.party.staffId &&
        (i.cashAccountId ?? null) === row.party.cashAccountId,
    );
  return (
    <TableScroller>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-muted text-left text-xs text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-3 font-medium">
              {t("common.kind")}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              {t("opening.fromExcel")}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              {t("opening.amount")}
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              {t("opening.note")}
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.flatMap((row, index) => {
            const key = keyOf(row.kind, row.party);
            const d = draft.balances[key] ?? { amount: "", note: "" };
            const source = sourceOf.get(key);
            const issues = issuesOf(row);
            const out: React.ReactNode[] = [];
            if (row.group && row.group !== rows[index - 1]?.group) {
              out.push(
                <tr key={`${key}-group`} className="border-t border-border bg-surface-muted/50">
                  <th colSpan={4} scope="rowgroup" className="px-3 py-2 text-left font-semibold">
                    {row.group}
                  </th>
                </tr>,
              );
            }
            out.push(
              <tr key={key} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {row.label}
                  {issues.map((issue) => (
                    <div
                      key={issue.code}
                      className={`mt-1 text-xs font-normal ${
                        issue.severity === "error" ? "text-error" : "text-warning"
                      }`}
                    >
                      {issueText(issue)}
                    </div>
                  ))}
                </th>
                <td className="px-3 py-2 text-right text-text-muted">
                  {source != null ? formatAmount(source) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <CellInput
                    label={`${row.group ? `${row.group}: ` : ""}${row.label}`}
                    value={d.amount}
                    disabled={locked}
                    wide
                    invalid={issues.some((i) => i.severity === "error")}
                    onChange={(value) => onChange(key, "amount", value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    aria-label={`${row.label}: ${t("opening.note")}`}
                    value={d.note}
                    disabled={locked}
                    onChange={(event) => onChange(key, "note", event.target.value)}
                    className="min-h-9 w-full min-w-40 rounded-md border border-border bg-surface px-2 disabled:bg-surface-muted"
                  />
                </td>
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}

const kindLabel = (kind: OpeningBalanceKind) => t(`opening.kind.${kind}`);

function staffKinds(member: StaffMember): OpeningBalanceKind[] {
  return (Object.keys(OPENING_KIND_EFFECTS) as OpeningBalanceKind[]).filter((kind) => {
    const effect = OPENING_KIND_EFFECTS[kind];
    if (effect.party !== "staff") return false;
    return (effect.personKind === "sr") === (member.kind === "sr");
  });
}

/** Lines already in the snapshot for people no longer listed still show, so nothing hides. */
function withExisting(
  rows: BalanceRow[],
  view: Opening,
  kinds: OpeningBalanceKind[],
  label: (b: Party) => string,
) {
  const shown = new Set(rows.map((r) => keyOf(r.kind, r.party)));
  const extra = view.balances
    .filter((b) => kinds.includes(b.kind) && !shown.has(keyOf(b.kind, b)))
    .map((b) => ({ kind: b.kind, party: b, label: kindLabel(b.kind), group: label(b) }));
  return [...rows, ...extra];
}

function ReviewTab({
  view,
  staffName,
  accountName,
  productName,
}: {
  view: Opening;
  staffName: Map<string, string>;
  accountName: Map<string, string>;
  productName: Map<string, string>;
}) {
  const where = (i: OpeningIssue) =>
    [
      i.productId ? productName.get(i.productId) : undefined,
      i.kind ? kindLabel(i.kind) : undefined,
      i.staffId ? staffName.get(i.staffId) : undefined,
      i.cashAccountId ? accountName.get(i.cashAccountId) : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  const errors = view.issues.filter((i) => i.severity === "error");
  const warnings = view.issues.filter((i) => i.severity === "warning");
  const list = (items: OpeningIssue[], tone: string) => (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
      {items.map((i, n) => (
        <li
          key={`${i.code}-${n}`}
          className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm"
        >
          <span className={tone}>{issueText(i)}</span>
          <span className="text-text-muted">{where(i)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4">
      {errors.length === 0 ? <StatePanel title={t("opening.issues.none")} /> : null}
      {errors.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {t("opening.issues.errors")} ({formatAmount(String(errors.length))})
          </h3>
          {list(errors, "text-error")}
        </section>
      ) : null}
      {warnings.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {t("opening.issues.warnings")} ({formatAmount(String(warnings.length))})
          </h3>
          {list(warnings, "text-warning")}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- page

function OpeningScreen({
  view,
  tab,
  setTab,
}: {
  view: Opening;
  tab: Tab;
  setTab: (tab: Tab) => void;
}) {
  const id = useId();
  const { company, permissions } = useCurrentWorkspace();
  const service = useService();
  const staff = useStaff(company.id);
  const accounts = useConfigList("cashAccounts");
  const save = useSaveOpening(company.id);
  const approve = useApproveOpening(company.id);
  const activate = useActivateOpening(company.id);
  const [draft, setDraft] = useState(() => draftOf(view));
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const locked = view.status === "active" || !permissions.includes("opening.prepare");
  const dirty = isDirty(view, draft);
  const hasErrors = view.issues.some((i) => i.severity === "error");
  const members = staff.data ?? [];
  const cashAccounts = (accounts.data ?? []).filter((a) => a.active);
  const staffName = new Map(members.map((m) => [m.id, m.name]));
  const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
  const productName = new Map(view.stock.map((l) => [l.productId, l.productName]));
  const nameOf = (p: Party) =>
    (p.staffId
      ? staffName.get(p.staffId)
      : p.cashAccountId
        ? accountName.get(p.cashAccountId)
        : "") ?? "—";

  const setStock = (productId: string, field: StockField | "note", value: string) =>
    setDraft((d) => ({
      ...d,
      stock: {
        ...d.stock,
        [productId]: {
          ...(d.stock[productId] ?? {
            pieces: "",
            unitCost: "",
            salePrice: "",
            orderPrice: "",
            dueFromCompany: "",
            note: "",
          }),
          [field]: value,
        },
      },
    }));
  const setBalance = (key: string, field: keyof BalanceDraft, value: string) =>
    setDraft((d) => ({
      ...d,
      balances: {
        ...d.balances,
        [key]: { ...(d.balances[key] ?? { amount: "", note: "" }), [field]: value },
      },
    }));

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  const none: Party = { staffId: null, cashAccountId: null };
  const marketRows = withExisting(
    [
      { kind: "market_due", party: none, label: t("opening.legacy") },
      ...members
        .filter((m) => m.kind === "dsr")
        .map((m) => ({
          kind: "market_due" as const,
          party: { staffId: m.id, cashAccountId: null },
          label: m.name,
        })),
    ],
    view,
    ["market_due"],
    nameOf,
  ).map((r) => (r.group ? { ...r, label: r.group, group: undefined } : r));
  const staffKindList = (Object.keys(OPENING_KIND_EFFECTS) as OpeningBalanceKind[]).filter(
    (k) => OPENING_KIND_EFFECTS[k].party === "staff",
  );
  const staffRows = withExisting(
    members.flatMap((m) =>
      staffKinds(m).map((kind) => ({
        kind,
        party: { staffId: m.id, cashAccountId: null },
        label: kindLabel(kind),
        group: m.name,
      })),
    ),
    view,
    staffKindList,
    nameOf,
  );
  const companyRows: BalanceRow[] = [
    { kind: "company_payable", party: none, label: kindLabel("company_payable") },
    { kind: "company_advance", party: none, label: kindLabel("company_advance") },
  ];
  const cashRows = withExisting(
    cashAccounts.map((a) => ({
      kind: "cash" as const,
      party: { staffId: null, cashAccountId: a.id },
      label: a.name,
    })),
    view,
    ["cash"],
    nameOf,
  ).map((r) => (r.group ? { ...r, label: r.group, group: undefined } : r));

  const totals = view.totals;
  const tiles: { label: string; value: string }[] = [
    { label: t("opening.total.stockValue"), value: formatAmount(totals.stockValue) },
    {
      label: t("opening.total.valuedRows"),
      value: `${formatAmount(String(totals.valuedRows))} / ${formatAmount(String(view.stock.length))}`,
    },
    { label: t("opening.total.marketDue"), value: formatAmount(totals.marketDue) },
    { label: t("opening.total.staffOwesUs"), value: formatAmount(totals.staffOwesUs) },
    { label: t("opening.total.staffWeOwe"), value: formatAmount(totals.staffWeOwe) },
    { label: t("opening.total.companyPayable"), value: formatAmount(totals.companyPayable) },
    { label: t("opening.total.cash"), value: formatAmount(totals.cash) },
    { label: t("opening.total.dueFromCompany"), value: formatAmount(totals.dueFromCompanyPieces) },
  ];

  const balanceTable = (rows: BalanceRow[]) => (
    <BalanceTable rows={rows} view={view} draft={draft} locked={locked} onChange={setBalance} />
  );

  return (
    <>
      <PageHeader
        title={t("nav.administration.opening")}
        description={t("opening.description")}
        actions={
          <>
            <OpeningStatus status={view.status} />
            {!locked ? (
              <Button
                disabled={dirty}
                title={dirty ? t("opening.saveFirst") : undefined}
                onClick={() => setImporting(true)}
              >
                {t("opening.import")}
              </Button>
            ) : null}
            <Button
              onClick={() =>
                void run(async () => {
                  const { fileName, file } = await service.downloadOpeningTemplate(company.id);
                  downloadBlob(file, fileName);
                })
              }
            >
              {t("opening.template.download")}
            </Button>
            {!locked ? (
              <Button
                variant="primary"
                disabled={!dirty || save.isPending}
                onClick={() => void run(() => save.mutateAsync(requestOf(view, draft)))}
              >
                {save.isPending ? t("common.saving") : t("common.save")}
              </Button>
            ) : null}
          </>
        }
      />
      {importing ? (
        <ImportDialog
          companyId={company.id}
          version={view.version}
          onClose={() => setImporting(false)}
        />
      ) : null}
      {confirming ? (
        <FormDialog
          open
          title={t("opening.activate")}
          pending={activate.isPending}
          submitLabel={t("opening.activate")}
          onSubmit={() =>
            void run(async () => {
              await activate.mutateAsync(view.version);
              setConfirming(false);
            })
          }
          onClose={() => setConfirming(false)}
          error={error}
        >
          <p className="text-sm">{t("opening.activateConfirm")}</p>
          {view.cutoffDate ? (
            <p className="text-sm font-medium">
              {t("opening.cutoffDate")}: {formatBusinessDate(view.cutoffDate)}
            </p>
          ) : null}
        </FormDialog>
      ) : null}

      <div className="flex flex-col gap-5">
        {error && !confirming ? <StatePanel tone="error" title={error} /> : null}
        {view.status === "active" ? <StatePanel title={t("opening.activeHint")} /> : null}
        {dirty ? <StatePanel tone="warning" title={t("opening.unsaved")} /> : null}

        <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_1fr]">
          <Field id={`${id}-cutoff`} label={t("opening.cutoffDate")} hint={t("opening.cutoffHint")}>
            <DatePicker
              id={`${id}-cutoff`}
              value={draft.cutoffDate}
              disabled={locked}
              clearable
              label={t("opening.cutoffDate")}
              onChange={(cutoffDate) => setDraft((d) => ({ ...d, cutoffDate }))}
              className="w-full"
            />
          </Field>
          <section className="rounded-xl border border-border bg-surface p-4 text-sm shadow-card">
            <h2 className="mb-1 font-semibold">{t("opening.source.title")}</h2>
            {view.source ? (
              <div className="flex flex-col gap-2">
                <p className="text-text-muted">
                  {view.source.fileName} · {t("opening.source.sheet")}: {view.source.sheet}
                </p>
                {view.source.unmatchedProducts.length > 0 ? (
                  <div>
                    <p className="font-medium text-warning">
                      {t("opening.source.unmatchedProducts")}
                    </p>
                    <p className="text-text-muted">{view.source.unmatchedProducts.join(", ")}</p>
                  </div>
                ) : null}
                {view.source.unmatchedPersons.length > 0 ? (
                  <div>
                    <p className="font-medium text-warning">
                      {t("opening.source.unmatchedPersons")}
                    </p>
                    <ul className="text-text-muted">
                      {view.source.unmatchedPersons.map((p) => (
                        <li key={p.label}>
                          {p.label}: {p.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {view.source.notes.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {t("opening.source.notes")} ({formatAmount(String(view.source.notes.length))})
                    </summary>
                    <ul className="mt-1 list-disc pl-5 text-text-muted">
                      {view.source.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="text-text-muted">{t("opening.source.none")}</p>
            )}
          </section>
        </div>

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </dl>

        <div
          role="tablist"
          aria-label={t("nav.administration.opening")}
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`-mb-px min-h-(--touch-target) border-b-2 px-3 text-sm font-medium ${
                tab === name
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              {t(`opening.tab.${name}`)}
              {name === "review" && hasErrors ? (
                <span className="ml-1.5 rounded-full bg-error/10 px-1.5 text-xs text-error">
                  {formatAmount(String(view.issues.filter((i) => i.severity === "error").length))}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === "stock" ? (
            <StockTab view={view} draft={draft} locked={locked} onChange={setStock} />
          ) : null}
          {tab === "marketDue" ? balanceTable(marketRows) : null}
          {tab === "staff" ? (
            members.length === 0 && staffRows.length === 0 ? (
              <StatePanel title={t("opening.staff.empty")} />
            ) : (
              balanceTable(staffRows)
            )
          ) : null}
          {tab === "company" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">{t("opening.company.hint")}</p>
              {balanceTable(companyRows)}
            </div>
          ) : null}
          {tab === "cash" ? (
            cashRows.length === 0 ? (
              <StatePanel title={t("opening.cash.empty")} />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-text-muted">{t("opening.cash.hint")}</p>
                {balanceTable(cashRows)}
              </div>
            )
          ) : null}
          {tab === "review" ? (
            <div className="flex flex-col gap-4">
              <ReviewTab
                view={view}
                staffName={staffName}
                accountName={accountName}
                productName={productName}
              />
              {view.status !== "active" ? (
                <div className="flex flex-wrap items-center gap-3">
                  {view.status === "draft" && permissions.includes("opening.approve") ? (
                    <Button
                      variant="primary"
                      disabled={dirty || hasErrors || approve.isPending}
                      onClick={() => void run(() => approve.mutateAsync(view.version))}
                    >
                      {t("opening.approve")}
                    </Button>
                  ) : null}
                  {view.status === "approved" && permissions.includes("opening.activate") ? (
                    <Button
                      variant="primary"
                      disabled={dirty || hasErrors}
                      onClick={() => {
                        setError(undefined);
                        setConfirming(true);
                      }}
                    >
                      {t("opening.activate")}
                    </Button>
                  ) : null}
                  <p className="text-sm text-text-muted">
                    {dirty ? t("opening.saveFirst") : t("opening.approveHint")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function OpeningLoader() {
  const { company } = useCurrentWorkspace();
  const opening = useOpening(company.id);
  const [tab, setTab] = useState<Tab>("stock");
  if (opening.isPending) return <PageSkeleton tabs={4} />;
  if (opening.isError) {
    return (
      <>
        <PageHeader title={t("nav.administration.opening")} />
        <QueryError error={opening.error} onRetry={() => void opening.refetch()} />
      </>
    );
  }
  // A new version (save or import) starts a fresh local copy of the entered values.
  return <OpeningScreen key={opening.data.version} view={opening.data} tab={tab} setTab={setTab} />;
}

export function OpeningPage() {
  return (
    <NavGate path={PATH}>
      <OpeningLoader />
    </NavGate>
  );
}
