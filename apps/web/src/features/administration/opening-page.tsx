"use client";

import type {
  Opening,
  OpeningBalanceKind,
  OpeningIssue,
  OpeningSaveRequest,
  StaffMember,
} from "@bsd/contracts";
import { Decimal, OPENING_KIND_EFFECTS, toBaseQuantity, toCartonDisplay } from "@bsd/domain";
import {
  formatAmount,
  formatBusinessDate,
  normalizeDigits,
  t,
  type TranslationKey,
} from "@bsd/i18n";
import { useSearchParams } from "next/navigation";
import { Suspense, useId, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Field } from "@/components/field";
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
  useOpening,
  useSaveOpening,
  useShops,
  useStaff,
} from "@/data/queries";
import { stickyCell, stickyHead } from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "admin/opening";

const stockFields = [
  "cartons",
  "loose",
  "unitCost",
  "salePrice",
  "orderPrice",
  "dueFromCompany",
] as const;
type StockField = (typeof stockFields)[number];
type StockDraft = Record<StockField, string> & { note: string };
const blankStock: StockDraft = {
  cartons: "",
  loose: "",
  unitCost: "",
  salePrice: "",
  orderPrice: "",
  dueFromCompany: "",
  note: "",
};

const sizeOf = (line: Opening["stock"][number]) => line.piecesPerCarton ?? "1";

/** Opening pieces are stored as one total; cartons + loose pieces are entry only. */
function piecesOf(line: Opening["stock"][number], d: StockDraft | undefined): string | null {
  const cartons = normalizeDigits(d?.cartons ?? "").trim();
  const loose = normalizeDigits(d?.loose ?? "").trim();
  if (cartons === "" && loose === "") return null;
  if (!/^\d+$/.test(cartons || "0") || !/^\d+$/.test(loose || "0")) return "invalid";
  return toBaseQuantity(cartons || "0", loose || "0", sizeOf(line));
}
type BalanceDraft = { amount: string; note: string };
type Draft = {
  cutoffDate: string;
  stock: Record<string, StockDraft>;
  balances: Record<string, BalanceDraft>;
};
type Party = { staffId: string | null; cashAccountId: string | null; shopId: string | null };
type Tab = "stock" | "marketDue" | "shops" | "staff" | "company" | "cash" | "review";
const tabs: Tab[] = ["stock", "marketDue", "shops", "staff", "company", "cash", "review"];
const keyOf = (kind: OpeningBalanceKind, party: Party) =>
  `${kind}|${party.shopId ?? party.staffId ?? party.cashAccountId ?? ""}`;

function draftOf(view: Opening): Draft {
  return {
    cutoffDate: view.cutoffDate ?? "",
    stock: Object.fromEntries(
      view.stock.map((l) => {
        const split = l.pieces === null ? null : toCartonDisplay(l.pieces, sizeOf(l));
        return [
          l.productId,
          {
            cartons: split ? split.cartons : "",
            loose: split ? split.loosePieces : "",
            unitCost: l.unitCost ?? "",
            salePrice: l.salePrice ?? "",
            orderPrice: l.orderPrice ?? "",
            dueFromCompany: l.dueFromCompany ?? "",
            note: l.note,
          },
        ];
      }),
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
        pieces: piecesOf(l, d),
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
          shopId: party === "shop" ? partyId || null : null,
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

const GUIDE_STEPS = [
  "opening.guide.step1",
  "opening.guide.step2",
  "opening.guide.step3",
  "opening.guide.step4",
] as const;

/** What this page is for, in four steps; open until a go-live date is chosen. */
function OpeningGuide({ open }: { open: boolean }) {
  return (
    <details
      open={open}
      className="group rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 print:hidden"
    >
      <summary className="cursor-pointer font-semibold">{t("opening.guide.title")}</summary>
      <p className="mt-2 text-sm text-text-muted">{t("opening.guide.intro")}</p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {GUIDE_STEPS.map((key, index) => (
          <li key={key} className="flex gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
              {formatAmount(String(index + 1))}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** A blank cell is "not entered yet", not a mistake: shown quietly, never as a red field. */
const BLANK_CODES = new Set(["opening.issue.stockUnknown", "opening.issue.amountUnknown"]);
const isMistake = (issue: OpeningIssue) =>
  issue.severity === "error" && !BLANK_CODES.has(issue.code);
const issueTone = (issue: OpeningIssue) =>
  BLANK_CODES.has(issue.code)
    ? "text-text-subtle"
    : issue.severity === "error"
      ? "text-error"
      : "text-warning";

function issueText(issue: OpeningIssue) {
  return t(issue.code as TranslationKey);
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
    cartons: t("opening.cartons"),
    loose: t("opening.loosePieces"),
    unitCost: t("opening.unitCost"),
    salePrice: t("opening.salePrice"),
    orderPrice: t("opening.orderPrice"),
    dueFromCompany: t("opening.dueFromCompany"),
  };

  if (view.stock.length === 0) return <StatePanel title={t("product.empty")} />;
  return (
    <div className="flex flex-col gap-3">
      <TableScroller>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-muted text-left text-xs text-text-muted">
            <tr>
              <th scope="col" className={`px-3 py-3 font-medium ${stickyHead}`}>
                {t("product.name")}
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
              const errors = issues.filter(isMistake);
              return (
                <tr key={line.productId} className="border-t border-border align-top">
                  <th scope="row" className={`px-3 py-2 text-left font-medium ${stickyCell}`}>
                    <div>{line.productName}</div>
                    <div className="text-xs font-normal text-text-subtle">
                      {line.sku}
                      {line.piecesPerCarton
                        ? ` · ${t("product.piecesPerCarton")} ${formatAmount(line.piecesPerCarton)}`
                        : ""}
                    </div>
                    {(() => {
                      const total = piecesOf(line, d);
                      return total && total !== "invalid" ? (
                        <div className="text-xs font-normal text-text-muted">
                          {t("opening.totalPieces")}: {formatAmount(total)}
                        </div>
                      ) : null;
                    })()}
                    {issues.map((issue) => (
                      <div
                        key={issue.code}
                        className={`mt-1 text-xs font-normal ${issueTone(issue)}`}
                      >
                        {issueText(issue)}
                      </div>
                    ))}
                  </th>
                  {stockFields.map((f) => (
                    <td key={f} className="px-3 py-2 text-right">
                      <CellInput
                        label={`${line.productName}: ${labels[f]}`}
                        value={d?.[f] ?? ""}
                        disabled={locked}
                        invalid={
                          ((f === "cartons" || f === "loose") && piecesOf(line, d) === "invalid") ||
                          ((f === "cartons" || f === "loose") &&
                            errors.some((e) => e.code.startsWith("opening.issue.stock"))) ||
                          (f === "unitCost" &&
                            errors.some((e) => e.code === "opening.issue.costMissing")) ||
                          (f === "dueFromCompany" &&
                            errors.some((e) => e.code === "opening.issue.dueInvalid"))
                        }
                        onChange={(value) => onChange(line.productId, f, value)}
                      />
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
  const issuesOf = (row: BalanceRow) =>
    view.issues.filter(
      (i) =>
        i.kind === row.kind &&
        (i.staffId ?? null) === row.party.staffId &&
        (i.cashAccountId ?? null) === row.party.cashAccountId &&
        (i.shopId ?? null) === row.party.shopId,
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
            const issues = issuesOf(row);
            const out: React.ReactNode[] = [];
            if (row.group && row.group !== rows[index - 1]?.group) {
              out.push(
                <tr key={`${key}-group`} className="border-t border-border bg-surface-muted/50">
                  <th colSpan={3} scope="rowgroup" className="px-3 py-2 text-left font-semibold">
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
                      className={`mt-1 text-xs font-normal ${issueTone(issue)}`}
                    >
                      {issueText(issue)}
                    </div>
                  ))}
                </th>
                <td className="px-3 py-2 text-right">
                  <CellInput
                    label={`${row.group ? `${row.group}: ` : ""}${row.label}`}
                    value={d.amount}
                    disabled={locked}
                    wide
                    invalid={issues.some(isMistake)}
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
    .map((b) => {
      const party: Party = {
        staffId: b.staffId,
        cashAccountId: b.cashAccountId,
        shopId: b.shopId,
      };
      return { kind: b.kind, party, label: kindLabel(b.kind), group: label(party) };
    });
  return [...rows, ...extra];
}

type SectionSummary = {
  tab: Exclude<Tab, "review">;
  entered: number;
  of: number;
  state: "done" | "pending" | "optional";
  amounts: { label?: string; value: string }[];
};

const STATE_BADGE = {
  done: { tone: "success", key: "opening.review.done" },
  pending: { tone: "error", key: "opening.review.pending" },
  optional: { tone: "muted", key: "opening.review.optional" },
} as const;

function SectionTable({
  sections,
  onOpen,
}: {
  sections: SectionSummary[];
  onOpen: (tab: Tab) => void;
}) {
  return (
    <TableScroller>
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">{t("opening.review.section")}</th>
            <th className="px-3 py-2 font-medium">{t("opening.review.entered")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("opening.review.amount")}</th>
            <th className="px-3 py-2 font-medium">{t("opening.review.status")}</th>
            <th className="px-3 py-2 print:hidden" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sections.map((s) => (
            <tr key={s.tab}>
              <td className="px-3 py-2 font-medium">{t(`opening.tab.${s.tab}`)}</td>
              <td className="px-3 py-2 tabular-nums">
                {formatAmount(String(s.entered))} / {formatAmount(String(s.of))}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {s.amounts.map((a) => (
                  <div key={a.label ?? "total"}>
                    {a.label ? <span className="text-text-muted">{a.label}: </span> : null}
                    {formatAmount(a.value)}
                  </div>
                ))}
              </td>
              <td className="px-3 py-2">
                <StatusBadge tone={STATE_BADGE[s.state].tone}>
                  {t(STATE_BADGE[s.state].key)}
                </StatusBadge>
              </td>
              <td className="px-3 py-2 text-right print:hidden">
                <Button onClick={() => onOpen(s.tab)}>{t("opening.review.open")}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function ReviewTab({
  view,
  sections,
  onOpen,
  staffName,
  accountName,
  productName,
  shopName,
}: {
  view: Opening;
  sections: SectionSummary[];
  onOpen: (tab: Tab) => void;
  staffName: Map<string, string>;
  accountName: Map<string, string>;
  productName: Map<string, string>;
  shopName: Map<string, string>;
}) {
  const where = (i: OpeningIssue) =>
    [
      i.productId ? productName.get(i.productId) : undefined,
      i.kind ? kindLabel(i.kind) : undefined,
      i.staffId ? staffName.get(i.staffId) : undefined,
      i.cashAccountId ? accountName.get(i.cashAccountId) : undefined,
      i.shopId ? shopName.get(i.shopId) : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  const errors = view.issues.filter(isMistake);
  const blanks = view.issues.some((i) => BLANK_CODES.has(i.code));
  const pending = sections.some((s) => s.state === "pending");
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
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("opening.review.title")}</h3>
        <SectionTable sections={sections} onOpen={onOpen} />
      </section>
      {blanks || pending ? (
        <StatePanel tone="warning" title={t("opening.review.blanksLeft")} />
      ) : errors.length === 0 ? (
        <StatePanel title={t("opening.issues.none")} />
      ) : null}
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
  const staff = useStaff(company.id);
  const shops = useShops(company.id);
  const accounts = useConfigList("cashAccounts");
  const save = useSaveOpening(company.id);
  const approve = useApproveOpening(company.id);
  const activate = useActivateOpening(company.id);
  const [draft, setDraft] = useState(() => draftOf(view));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const locked = view.status === "active" || !permissions.includes("opening.prepare");
  const dirty = isDirty(view, draft);
  const stockInvalid = view.stock.some((l) => piecesOf(l, draft.stock[l.productId]) === "invalid");
  const hasErrors = view.issues.some((i) => i.severity === "error");
  const mistakes = view.issues.filter(isMistake).length;
  const members = staff.data ?? [];
  const cashAccounts = (accounts.data ?? []).filter((a) => a.active);
  const staffName = new Map(members.map((m) => [m.id, m.name]));
  const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
  const productName = new Map(view.stock.map((l) => [l.productId, l.productName]));
  const shopName = new Map((shops.data ?? []).map((s) => [s.id, s.name]));
  const nameOf = (p: Party) =>
    (p.shopId
      ? shopName.get(p.shopId)
      : p.staffId
        ? staffName.get(p.staffId)
        : p.cashAccountId
          ? accountName.get(p.cashAccountId)
          : "") ?? "—";

  const setStock = (productId: string, field: StockField | "note", value: string) =>
    setDraft((d) => ({
      ...d,
      stock: {
        ...d.stock,
        [productId]: { ...(d.stock[productId] ?? blankStock), [field]: value },
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

  const none: Party = { staffId: null, cashAccountId: null, shopId: null };
  const marketRows = withExisting(
    [
      { kind: "market_due", party: none, label: t("opening.legacy") },
      ...members
        .filter((m) => m.kind === "dsr")
        .map((m) => ({
          kind: "market_due" as const,
          party: { ...none, staffId: m.id },
          label: m.name,
        })),
    ],
    view,
    ["market_due"],
    nameOf,
  ).map((r) => (r.group ? { ...r, label: r.group, group: undefined } : r));
  const shopRows = withExisting(
    (shops.data ?? [])
      .filter((s) => s.status === "active")
      .map((s) => ({
        kind: "shop_due" as const,
        party: { ...none, shopId: s.id },
        label: s.name,
      })),
    view,
    ["shop_due"],
    nameOf,
  ).map((r) => (r.group ? { ...r, label: r.group, group: undefined } : r));
  const staffKindList = (Object.keys(OPENING_KIND_EFFECTS) as OpeningBalanceKind[]).filter(
    (k) => OPENING_KIND_EFFECTS[k].party === "staff",
  );
  const staffRows = withExisting(
    members.flatMap((m) =>
      staffKinds(m).map((kind) => ({
        kind,
        party: { ...none, staffId: m.id },
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
      party: { ...none, cashAccountId: a.id },
      label: a.name,
    })),
    view,
    ["cash"],
    nameOf,
  ).map((r) => (r.group ? { ...r, label: r.group, group: undefined } : r));

  const totals = view.totals;
  const saved = new Map(
    view.balances.filter((b) => b.amount !== null).map((b) => [keyOf(b.kind, b), b.amount ?? "0"]),
  );
  const enteredOf = (rows: BalanceRow[]) =>
    rows.filter((r) => saved.has(keyOf(r.kind, r.party))).length;
  const sumOf = (rows: BalanceRow[]) =>
    rows
      .reduce((sum, r) => sum.plus(saved.get(keyOf(r.kind, r.party)) ?? "0"), new Decimal(0))
      .toString();
  const allOf = (entered: number, of: number) => (of > 0 && entered === of ? "done" : "pending");
  const staffEntered = members.filter((m) =>
    staffRows.some((r) => r.party.staffId === m.id && saved.has(keyOf(r.kind, r.party))),
  ).length;
  const companyEntered = enteredOf(companyRows);
  const cashEntered = enteredOf(cashRows);
  const stockEntered = view.stock.filter((l) => l.pieces !== null).length;
  const marketEntered = enteredOf(marketRows);
  const shopEntered = enteredOf(shopRows);
  const sections: SectionSummary[] = [
    {
      tab: "stock",
      entered: stockEntered,
      of: view.stock.length,
      state: allOf(stockEntered, view.stock.length),
      amounts: [{ value: totals.stockValue }],
    },
    {
      tab: "marketDue",
      entered: marketEntered,
      of: marketRows.length,
      state: marketEntered > 0 ? "done" : "optional",
      amounts: [{ value: sumOf(marketRows) }],
    },
    {
      tab: "shops",
      entered: shopEntered,
      of: shopRows.length,
      state: allOf(shopEntered, shopRows.length),
      amounts: [{ value: sumOf(shopRows) }],
    },
    {
      tab: "staff",
      entered: staffEntered,
      of: members.length,
      state: allOf(staffEntered, members.length),
      amounts: [
        { label: t("opening.review.owesUs"), value: totals.staffOwesUs },
        { label: t("opening.review.weOwe"), value: totals.staffWeOwe },
      ],
    },
    {
      tab: "company",
      entered: companyEntered,
      of: companyRows.length,
      state: companyEntered > 0 ? "done" : "pending",
      amounts: [{ value: totals.companyPayable }],
    },
    {
      tab: "cash",
      entered: cashEntered,
      of: cashRows.length,
      state: cashEntered > 0 ? "done" : "pending",
      amounts: [{ value: totals.cash }],
    },
  ];
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
            {view.status !== "draft" ? <OpeningStatus status={view.status} /> : null}
            {!locked ? (
              <Button
                variant="primary"
                disabled={!dirty || stockInvalid || save.isPending}
                onClick={() => void run(() => save.mutateAsync(requestOf(view, draft)))}
              >
                {save.isPending ? t("common.saving") : t("common.save")}
              </Button>
            ) : null}
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t("nav.administration.opening")} from={view.cutoffDate ?? undefined} />
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
        {stockInvalid ? <StatePanel tone="error" title={t("opening.cartonsInvalid")} /> : null}
        {view.status !== "active" ? <OpeningGuide open={!view.cutoffDate} /> : null}

        <div className="max-w-72">
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
              {name === "review" && mistakes > 0 ? (
                <span className="ml-1.5 rounded-full bg-error/10 px-1.5 text-xs text-error">
                  {formatAmount(String(mistakes))}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="flex flex-col gap-3">
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
            {t(`opening.tabHint.${tab}`)}
          </p>
          {tab === "stock" ? (
            <StockTab view={view} draft={draft} locked={locked} onChange={setStock} />
          ) : null}
          {tab === "marketDue" ? balanceTable(marketRows) : null}
          {tab === "shops" ? (
            shopRows.length === 0 ? (
              <StatePanel title={t("opening.shops.empty")} />
            ) : (
              balanceTable(shopRows)
            )
          ) : null}
          {tab === "staff" ? (
            members.length === 0 && staffRows.length === 0 ? (
              <StatePanel title={t("opening.staff.empty")} />
            ) : (
              balanceTable(staffRows)
            )
          ) : null}
          {tab === "company" ? balanceTable(companyRows) : null}
          {tab === "cash" ? (
            cashRows.length === 0 ? (
              <StatePanel title={t("opening.cash.empty")} />
            ) : (
              balanceTable(cashRows)
            )
          ) : null}
          {tab === "review" ? (
            <div className="flex flex-col gap-4">
              <ReviewTab
                view={view}
                sections={sections}
                onOpen={setTab}
                staffName={staffName}
                accountName={accountName}
                productName={productName}
                shopName={shopName}
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
  const requested = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(() =>
    tabs.includes(requested as Tab) ? (requested as Tab) : "stock",
  );
  if (opening.isPending) return <PageSkeleton tabs={4} />;
  if (opening.isError) {
    return (
      <>
        <PageHeader title={t("nav.administration.opening")} />
        <QueryError error={opening.error} onRetry={() => void opening.refetch()} />
      </>
    );
  }
  // A new version starts a fresh local copy of the entered values.
  return <OpeningScreen key={opening.data.version} view={opening.data} tab={tab} setTab={setTab} />;
}

export function OpeningPage() {
  return (
    <NavGate path={PATH}>
      <Suspense fallback={<PageSkeleton tabs={4} />}>
        <OpeningLoader />
      </Suspense>
    </NavGate>
  );
}
