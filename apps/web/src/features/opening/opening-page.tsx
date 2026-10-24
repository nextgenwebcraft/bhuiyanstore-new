"use client";

import {
  openingSectionKinds,
  type Opening,
  type OpeningBalanceLine,
  type OpeningBalanceSectionId,
  type OpeningSectionSaveRequest,
} from "@bsd/contracts";
import { t, formatShortDate, toBengaliDigits } from "@bsd/i18n";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import {
  useOpening,
  useSaveOpeningCutoff,
  useSaveOpeningSection,
  useStaff,
  useShops,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const BALANCE_KIND_LABEL: Record<string, string> = {
  market_due: t("opening.section.marketDue"),
  shop_due: t("opening.section.shopDue"),
  advance: t("opening.balance.kind.advance"),
  loan: t("opening.balance.kind.loan"),
  shortage: t("opening.balance.kind.shortage"),
  credit: t("opening.balance.kind.credit"),
  salary_payable: t("opening.balance.kind.salary_payable"),
  sr_loan: t("opening.balance.kind.sr_loan"),
  owed_to_sr: t("opening.balance.kind.owed_to_sr"),
  company_payable: t("opening.balance.kind.company_payable"),
  company_advance: t("opening.balance.kind.company_advance"),
  cash: t("opening.section.cash"),
};

const tdClass = "border border-border px-2 py-1.5 text-sm";
const inputSm =
  "w-full rounded border border-border bg-surface px-2 py-1 text-sm text-right tabular-nums placeholder:text-text-subtle focus:border-brand focus:outline-none";
const noteInput =
  "w-full rounded border border-border bg-surface px-2 py-1 text-sm placeholder:text-text-subtle focus:border-brand focus:outline-none";

// ─── section badge ────────────────────────────────────────────────────────────

const sectionStateBg: Record<string, string> = {
  done: "bg-success/15 text-success",
  pending: "bg-warning/15 text-warning",
  optional: "bg-surface-muted text-text-muted",
};

function SectionBadge({ state }: { state: "done" | "pending" | "optional" }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${sectionStateBg[state] ?? ""}`}
    >
      {t(`opening.${state}`)}
    </span>
  );
}

// ─── cutoff section ───────────────────────────────────────────────────────────

function CutoffSection({ opening, companyId }: { opening: Opening; companyId: string }) {
  const [date, setDate] = useState(opening.cutoffDate ?? "");
  const saveCmd = useSaveOpeningCutoff(companyId);
  const [error, setError] = useState<DescribedError>({ fields: {} });
  const uid = useId();

  async function save() {
    if (!date) return;
    setError({ fields: {} });
    try {
      await saveCmd.mutateAsync({ version: opening.version, cutoffDate: date });
    } catch (err) {
      setError(describeError(err, []));
    }
  }

  const locked = opening.locked || !opening.cutoffEditable;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-base font-semibold">{t("opening.cutoff.label")}</h2>
      {locked ? (
        <p className="text-sm">{opening.cutoffDate ? formatShortDate(opening.cutoffDate) : "—"}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <DatePicker
            id={`${uid}-cutoff`}
            value={date}
            onChange={setDate}
            label={t("opening.cutoff.label")}
          />
          <Button
            variant="primary"
            disabled={!date || saveCmd.isPending}
            onClick={() => void save()}
          >
            {t("opening.cutoff.save")}
          </Button>
        </div>
      )}
      {error.form ? <p className="mt-2 text-sm text-error">{error.form}</p> : null}
      <p className="mt-2 text-xs text-text-muted">{t("opening.cutoff.hint")}</p>
    </section>
  );
}

// ─── stock section ────────────────────────────────────────────────────────────

type StockRow = {
  pieces: string;
  unitCost: string;
  salePrice: string;
  orderPrice: string;
  dueFromCompany: string;
  note: string;
};

function buildStockDraft(stock: Opening["stock"]): Record<string, StockRow> {
  return Object.fromEntries(
    stock.map((line) => [
      line.productId,
      {
        pieces: line.pieces ?? "",
        unitCost: line.unitCost ?? "",
        salePrice: line.salePrice ?? "",
        orderPrice: line.orderPrice ?? "",
        dueFromCompany: line.dueFromCompany ?? "",
        note: line.note,
      },
    ]),
  );
}

function StockSection({ opening, companyId }: { opening: Opening; companyId: string }) {
  const [draft, setDraft] = useState<Record<string, StockRow>>(() =>
    buildStockDraft(opening.stock),
  );
  const saveCmd = useSaveOpeningSection(companyId);
  const [error, setError] = useState<DescribedError>({ fields: {} });
  const section = opening.sections.find((s) => s.section === "stock");

  function set(productId: string, field: keyof StockRow, value: string) {
    setDraft((prev) => {
      const existing = prev[productId] ?? {
        pieces: "",
        unitCost: "",
        salePrice: "",
        orderPrice: "",
        dueFromCompany: "",
        note: "",
      };
      return { ...prev, [productId]: { ...existing, [field]: value } };
    });
  }

  async function save() {
    setError({ fields: {} });
    try {
      await saveCmd.mutateAsync({
        section: "stock",
        version: opening.version,
        stock: opening.stock.map((line) => {
          const row = draft[line.productId];
          return {
            productId: line.productId,
            pieces: row?.pieces || null,
            unitCost: row?.unitCost || null,
            salePrice: row?.salePrice || null,
            orderPrice: row?.orderPrice || null,
            dueFromCompany: row?.dueFromCompany || null,
            note: row?.note ?? "",
          };
        }),
      });
    } catch (err) {
      setError(describeError(err, []));
    }
  }

  if (opening.stock.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold">{t("opening.section.stock")}</h2>
          {section ? <SectionBadge state={section.state} /> : null}
        </div>
        <p className="text-sm text-text-muted">{t("opening.noProducts")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{t("opening.section.stock")}</h2>
        {section ? <SectionBadge state={section.state} /> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-muted text-xs text-text-muted">
              <th className={tdClass}>SKU</th>
              <th className={tdClass}>{t("product.name")}</th>
              <th className={`${tdClass} text-right`}>{t("product.piecesPerCarton")}</th>
              <th className={`${tdClass} text-right`}>{t("opening.stock.pieces")}</th>
              <th className={`${tdClass} text-right`}>{t("opening.stock.unitCost")}</th>
              <th className={`${tdClass} text-right`}>{t("opening.stock.salePrice")}</th>
              <th className={`${tdClass} text-right`}>{t("opening.stock.orderPrice")}</th>
              <th className={`${tdClass} text-right`}>{t("opening.stock.dueFromCompany")}</th>
            </tr>
          </thead>
          <tbody>
            {opening.stock.map((line) => {
              const row = draft[line.productId] ?? {
                pieces: "",
                unitCost: "",
                salePrice: "",
                orderPrice: "",
                dueFromCompany: "",
                note: "",
              };
              const disabled = opening.locked;
              return (
                <tr key={line.productId} className="hover:bg-surface-muted/40">
                  <td className={tdClass}>{line.sku}</td>
                  <td className={tdClass}>{line.productName}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {toBengaliDigits(line.piecesPerCarton)}
                  </td>
                  <td className={tdClass}>
                    <input
                      type="text"
                      inputMode="numeric"
                      className={inputSm}
                      value={row.pieces}
                      disabled={disabled}
                      placeholder="০"
                      onChange={(e) => set(line.productId, "pieces", e.target.value)}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={inputSm}
                      value={row.unitCost}
                      disabled={disabled}
                      placeholder="০.০০"
                      onChange={(e) => set(line.productId, "unitCost", e.target.value)}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={inputSm}
                      value={row.salePrice}
                      disabled={disabled}
                      placeholder="০.০০"
                      onChange={(e) => set(line.productId, "salePrice", e.target.value)}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={inputSm}
                      value={row.orderPrice}
                      disabled={disabled}
                      placeholder="০.০০"
                      onChange={(e) => set(line.productId, "orderPrice", e.target.value)}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="text"
                      inputMode="numeric"
                      className={inputSm}
                      value={row.dueFromCompany}
                      disabled={disabled}
                      placeholder="০"
                      onChange={(e) => set(line.productId, "dueFromCompany", e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!opening.locked ? (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" disabled={saveCmd.isPending} onClick={() => void save()}>
            {t("opening.save")}
          </Button>
          {error.form ? <span className="text-sm text-error">{error.form}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

// ─── balance section (marketDue, shopDue, staff, company, cash) ───────────────

type BalanceDraftLine = {
  kind: OpeningBalanceLine["kind"];
  staffId: string | null;
  cashAccountId: string | null;
  shopId: string | null;
  amount: string;
  note: string;
};

function emptyLine(kind: OpeningBalanceLine["kind"]): BalanceDraftLine {
  return { kind, staffId: null, cashAccountId: null, shopId: null, amount: "", note: "" };
}

function toSaveLine(line: BalanceDraftLine): OpeningBalanceLine {
  return {
    kind: line.kind,
    staffId: line.staffId,
    cashAccountId: line.cashAccountId,
    shopId: line.shopId ?? null,
    amount: line.amount || null,
    note: line.note,
  };
}

function BalanceSection({
  section,
  opening,
  companyId,
}: {
  section: OpeningBalanceSectionId;
  opening: Opening;
  companyId: string;
}) {
  const kinds = openingSectionKinds[section] as readonly OpeningBalanceLine["kind"][];
  const staffQuery = useStaff(companyId);
  const shopsQuery = useShops(companyId);

  const filterLines = (balances: Opening["balances"]) =>
    balances
      .filter((b) => (kinds as readonly string[]).includes(b.kind))
      .map((b): BalanceDraftLine => ({
        kind: b.kind,
        staffId: b.staffId,
        cashAccountId: b.cashAccountId,
        shopId: b.shopId ?? null,
        amount: b.amount ?? "",
        note: b.note,
      }));

  const [lines, setLines] = useState<BalanceDraftLine[]>(() => filterLines(opening.balances));
  const saveCmd = useSaveOpeningSection(companyId);
  const [error, setError] = useState<DescribedError>({ fields: {} });
  const sectionSummary = opening.sections.find((s) => s.section === section);

  function setLine(index: number, patch: Partial<BalanceDraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    const defaultKind = kinds[0] ?? "market_due";
    setLines((prev) => [...prev, emptyLine(defaultKind)]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setError({ fields: {} });
    try {
      const payload: OpeningSectionSaveRequest = {
        section,
        version: opening.version,
        balances: lines.map(toSaveLine),
      };
      await saveCmd.mutateAsync(payload);
    } catch (err) {
      setError(describeError(err, []));
    }
  }

  const staff = staffQuery.data ?? [];
  const shops = shopsQuery.data ?? [];
  const needsStaff = section === "marketDue" || section === "shopDue" || section === "staff";
  const needsShop = section === "shopDue";
  const isCash = section === "cash";
  const isCompany = section === "company";

  const SECTION_LABEL: Record<OpeningBalanceSectionId, string> = {
    marketDue: t("opening.section.marketDue"),
    shopDue: t("opening.section.shopDue"),
    staff: t("opening.section.staff"),
    company: t("opening.section.company"),
    cash: t("opening.section.cash"),
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{SECTION_LABEL[section]}</h2>
        {sectionSummary ? <SectionBadge state={sectionSummary.state} /> : null}
      </div>

      {isCash && !opening.cashAccountId ? (
        <p className="text-sm text-text-muted">নগদ হিসাব নেই — আগে নগদ হিসাব যোগ করুন।</p>
      ) : (
        <>
          {lines.length > 0 || isCompany || isCash ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-muted text-xs text-text-muted">
                    {kinds.length > 1 && (
                      <th className={tdClass}>
                        {t("opening.balance.kind.advance").split(" ")[0] ?? "ধরন"}
                      </th>
                    )}
                    {needsStaff && !needsShop && <th className={tdClass}>কর্মী</th>}
                    {needsShop && <th className={tdClass}>দোকান</th>}
                    <th className={`${tdClass} text-right`}>{t("opening.balance.amount")}</th>
                    <th className={tdClass}>{t("opening.balance.note")}</th>
                    {!opening.locked && <th className={tdClass}></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="hover:bg-surface-muted/40">
                      {kinds.length > 1 && (
                        <td className={tdClass}>
                          <select
                            className={`${inputClass} py-1 text-sm`}
                            value={line.kind}
                            disabled={opening.locked}
                            onChange={(e) =>
                              setLine(i, {
                                kind: e.target.value as OpeningBalanceLine["kind"],
                              })
                            }
                          >
                            {kinds.map((k) => (
                              <option key={k} value={k}>
                                {BALANCE_KIND_LABEL[k] ?? k}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {needsStaff && !needsShop && (
                        <td className={tdClass}>
                          <select
                            className={`${inputClass} py-1 text-sm`}
                            value={line.staffId ?? ""}
                            disabled={opening.locked}
                            onChange={(e) => setLine(i, { staffId: e.target.value || null })}
                          >
                            <option value="">— বেছে নিন —</option>
                            {staff.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {needsShop && (
                        <td className={tdClass}>
                          <select
                            className={`${inputClass} py-1 text-sm`}
                            value={line.shopId ?? ""}
                            disabled={opening.locked}
                            onChange={(e) => setLine(i, { shopId: e.target.value || null })}
                          >
                            <option value="">— বেছে নিন —</option>
                            {shops.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className={tdClass}>
                        <input
                          type="text"
                          inputMode="decimal"
                          className={inputSm}
                          value={line.amount}
                          disabled={opening.locked}
                          placeholder="০.০০"
                          onChange={(e) => setLine(i, { amount: e.target.value })}
                        />
                      </td>
                      <td className={tdClass}>
                        <input
                          type="text"
                          className={noteInput}
                          value={line.note}
                          disabled={opening.locked}
                          onChange={(e) => setLine(i, { note: e.target.value })}
                        />
                      </td>
                      {!opening.locked && (
                        <td className={tdClass}>
                          <button
                            type="button"
                            className="text-xs text-error hover:underline"
                            onClick={() => removeLine(i)}
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td
                        colSpan={99}
                        className="border border-border px-3 py-4 text-center text-sm text-text-muted"
                      >
                        {t("state.noResults")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {!opening.locked && !isCompany && !isCash && (
            <button
              type="button"
              className="mt-2 text-sm text-brand hover:underline"
              onClick={addLine}
            >
              + {t("opening.balance.addRow")}
            </button>
          )}

          {!opening.locked && (
            <div className="mt-3 flex items-center gap-3">
              <Button variant="primary" disabled={saveCmd.isPending} onClick={() => void save()}>
                {t("opening.save")}
              </Button>
              {error.form ? <span className="text-sm text-error">{error.form}</span> : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

function OpeningPageInner({ companyId }: { companyId: string }) {
  const router = useRouter();
  const openingQuery = useOpening(companyId);

  if (openingQuery.isPending) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <PageHeader title={t("opening.title")} description={t("opening.subtitle")} />
        <TableSkeleton rows={5} />
      </div>
    );
  }

  if (openingQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <StatePanel
          tone="error"
          title={t("state.notFoundTitle")}
          action={<Button onClick={() => void openingQuery.refetch()}>{t("state.retry")}</Button>}
        />
      </div>
    );
  }

  const opening = openingQuery.data;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader
        title={t("opening.title")}
        description={t("opening.subtitle")}
        actions={
          <Button variant="primary" onClick={() => router.push(companyHref(companyId))}>
            {t("opening.goToDashboard")}
          </Button>
        }
      />
      {opening.locked ? (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t("opening.locked.notice")}
        </div>
      ) : null}
      <div className="flex flex-col gap-4">
        <CutoffSection key={opening.version} opening={opening} companyId={companyId} />
        <StockSection key={`stock-${opening.version}`} opening={opening} companyId={companyId} />
        <BalanceSection
          key={`marketDue-${opening.version}`}
          section="marketDue"
          opening={opening}
          companyId={companyId}
        />
        <BalanceSection
          key={`shopDue-${opening.version}`}
          section="shopDue"
          opening={opening}
          companyId={companyId}
        />
        <BalanceSection
          key={`staff-${opening.version}`}
          section="staff"
          opening={opening}
          companyId={companyId}
        />
        <BalanceSection
          key={`company-${opening.version}`}
          section="company"
          opening={opening}
          companyId={companyId}
        />
        <BalanceSection
          key={`cash-${opening.version}`}
          section="cash"
          opening={opening}
          companyId={companyId}
        />
      </div>
    </div>
  );
}

/** Opening balance setup page — accessible after creating a new company (`opening.prepare`). */
export function OpeningPage() {
  const { company } = useCurrentWorkspace();
  return (
    <NavGate path="opening">
      <OpeningPageInner companyId={company.id} />
    </NavGate>
  );
}
