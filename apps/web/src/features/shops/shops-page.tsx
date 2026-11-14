"use client";

import type { RecordStatus, Shop } from "@bsd/contracts";
import { firstOfMonth, toDecimal } from "@bsd/domain";
import { t, toBengaliDigits, formatBusinessDate, formatCount } from "@bsd/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { DeleteButton } from "@/components/delete-button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { StatusField } from "@/components/status-field";
import { TableSummary } from "@/components/table-summary";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import { useDeleteShop, useSaveShop, useShopStatement, useShops } from "@/data/queries";
import { clean } from "@/features/daily/daily-kit";
import {
  money,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const PATH = "sales/shops";
const noErrors: DescribedError = { fields: {} };

type Draft = {
  id?: string;
  name: string;
  ownerName: string;
  phone: string;
  area: string;
  address: string;
  dueLimit: string;
  status: RecordStatus;
};

const emptyDraft: Draft = {
  name: "",
  ownerName: "",
  phone: "",
  area: "",
  address: "",
  dueLimit: "",
  status: "active",
};

/** The shop's due is above its limit (the engine's figure against the master's limit). */
export function overLimit(shop: Shop): boolean {
  return (
    shop.due !== null && shop.dueLimit !== null && toDecimal(shop.due).gt(toDecimal(shop.dueLimit))
  );
}

function ShopDialog({
  companyId,
  draft,
  onClose,
}: {
  companyId: string;
  draft: Draft;
  onClose: () => void;
}) {
  const id = useId();
  const save = useSaveShop(companyId);
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState(noErrors);
  const set = (patch: Partial<Draft>) => setValues({ ...values, ...patch });

  async function submit() {
    const limit = clean(values.dueLimit);
    const fields: Partial<Record<string, string>> = {};
    if (!values.name.trim()) fields.name = t("validation.required");
    if (limit && !/^\d+(\.\d{1,2})?$/.test(limit)) fields.dueLimit = t("validation.opening.amount");
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    setErrors(noErrors);
    const input = {
      name: values.name.trim(),
      ownerName: values.ownerName.trim(),
      phone: clean(values.phone),
      area: values.area.trim(),
      address: values.address.trim(),
      dueLimit: limit || null,
      status: values.status,
    };
    try {
      await save.mutateAsync(values.id ? { shopId: values.id, input } : { input });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["name", "phone", "area", "address", "dueLimit"]));
    }
  }

  const text = (key: "name" | "ownerName" | "phone" | "area", inputMode?: "tel") => (
    <Field id={`${id}-${key}`} label={t(`shop.field.${key}`)} error={errors.fields[key]}>
      <input
        id={`${id}-${key}`}
        value={values[key]}
        inputMode={inputMode}
        onChange={(event) => set({ [key]: event.target.value })}
        className={inputClass}
      />
    </Field>
  );

  return (
    <FormDialog
      open
      wide
      title={t(values.id ? "shop.form.editTitle" : "shop.form.createTitle")}
      error={errors.form}
      pending={save.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text("name")}
        {text("ownerName")}
        {text("phone", "tel")}
        {text("area")}
      </div>
      <Field id={`${id}-address`} label={t("shop.field.address")} error={errors.fields.address}>
        <textarea
          id={`${id}-address`}
          rows={2}
          value={values.address}
          onChange={(event) => set({ address: event.target.value })}
          className={`${inputClass} py-2`}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${id}-limit`}
          label={t("shop.field.dueLimit")}
          hint={t("shop.field.dueLimitHint")}
          error={errors.fields.dueLimit}
        >
          <input
            id={`${id}-limit`}
            inputMode="decimal"
            value={values.dueLimit}
            onChange={(event) => set({ dueLimit: event.target.value })}
            className={inputClass}
          />
        </Field>
        <StatusField
          id={`${id}-status`}
          value={values.status}
          onChange={(status) => set({ status })}
        />
      </div>
    </FormDialog>
  );
}

function HistoryDialog({
  companyId,
  shop,
  onClose,
}: {
  companyId: string;
  shop: Shop;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const today = useToday();
  const [range, setRange] = useState({ from: firstOfMonth(today), to: today });
  const statement = useShopStatement(companyId, shop.id, range);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  let body: React.ReactNode;
  if (statement.isPending) body = <TableSkeleton rows={4} columns={5} />;
  else if (statement.isError) {
    body = <QueryError error={statement.error} onRetry={() => void statement.refetch()} />;
  } else {
    const s = statement.data;
    body = (
      <div className="flex flex-col gap-4">
        <TableSummary
          items={[
            { label: t("shop.statement.opening"), value: money(s.opening) },
            { label: t("money.kind.marketDueNew"), value: money(s.added) },
            { label: t("money.kind.marketDueCollected"), value: money(s.collected) },
            { label: t("shop.statement.closing"), value: money(s.closing), emphasis: true },
          ]}
        />
        {s.lines.length === 0 ? (
          <StatePanel title={t("shop.statement.empty")} />
        ) : (
          <TableScroller>
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>
                    {t("common.date")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("money.person.dsr")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("money.kind.marketDueNew")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("money.kind.marketDueCollected")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("shop.statement.balance")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((line) => (
                  <tr key={line.entryId} className="border-t border-border">
                    <td className={tdClass}>{formatBusinessDate(line.date)}</td>
                    <td className={tdClass}>{line.staffName ?? "—"}</td>
                    <td className={tdNum}>
                      {line.kind === "marketDueNew" ? money(line.amount) : ""}
                    </td>
                    <td className={tdNum}>
                      {line.kind === "marketDueCollected" ? money(line.amount) : ""}
                    </td>
                    <td className={`${tdNum} font-medium`}>{money(line.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        )}
      </div>
    );
  }

  return (
    <dialog
      ref={ref}
      data-print
      onClose={onClose}
      aria-label={shop.name}
      className="m-auto w-full max-w-3xl rounded-2xl border border-border bg-surface p-0 text-text shadow-raised"
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{shop.name}</h2>
            <p className="text-sm text-text-muted">
              {[shop.ownerName, shop.phone && toBengaliDigits(shop.phone), shop.area]
                .filter(Boolean)
                .join(" · ") || t("shop.statement.title")}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <PrintButton />
            <Button onClick={() => ref.current?.close()}>{t("nav.close")}</Button>
          </div>
        </div>
        <PrintHeader title={`${t("shop.statement.title")} — ${shop.name}`} {...range} />
        <div className="flex flex-wrap items-end gap-3">
          <Field id={`${id}-from`} label={t("common.from")}>
            <DatePicker
              id={`${id}-from`}
              value={range.from}
              max={range.to}
              label={t("common.from")}
              onChange={(from) => from && setRange({ ...range, from })}
            />
          </Field>
          <Field id={`${id}-to`} label={t("common.to")}>
            <DatePicker
              id={`${id}-to`}
              value={range.to}
              min={range.from}
              max={today}
              label={t("common.to")}
              onChange={(to) => to && setRange({ ...range, to })}
            />
          </Field>
        </div>
        {body}
      </div>
    </dialog>
  );
}

function Shops() {
  const { company, permissions } = useCurrentWorkspace();
  const shops = useShops(company.id);
  const deleteShop = useDeleteShop(company.id);
  const canManage = permissions.includes("shop.manage");
  const canSeeDue = permissions.includes("sale.view");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Shop | null>(null);
  const [search, setSearch] = useState("");

  let body: React.ReactNode;
  if (shops.isPending) body = <TableSkeleton rows={6} columns={6} />;
  else if (shops.isError) {
    body = <QueryError error={shops.error} onRetry={() => void shops.refetch()} />;
  } else if (shops.data.length === 0) {
    body = <StatePanel title={t("shop.empty")} />;
  } else {
    const needle = search.trim().toLowerCase();
    const rows = shops.data.filter((s) =>
      [s.name, s.ownerName, s.phone, s.area].some((v) => v.toLowerCase().includes(needle)),
    );
    const totalDue = rows.reduce((sum, s) => sum.add(toDecimal(s.due ?? "0")), toDecimal("0"));
    body = (
      <div className="flex flex-col gap-4">
        <TableSummary
          items={[
            { label: t("shop.summary.count"), value: formatCount(rows.length) },
            ...(canSeeDue
              ? [
                  { label: t("shop.summary.totalDue"), value: money(totalDue.toFixed(2)) },
                  {
                    label: t("shop.summary.overLimit"),
                    value: formatCount(rows.filter(overLimit).length),
                    emphasis: rows.some(overLimit),
                  },
                ]
              : []),
          ]}
        />
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("shop.field.name")}
                </th>
                <th scope="col" className={thClass}>
                  {t("shop.field.phone")}
                </th>
                <th scope="col" className={thClass}>
                  {t("shop.field.area")}
                </th>
                {canSeeDue ? (
                  <th scope="col" className={thNum}>
                    {t("shop.due")}
                  </th>
                ) : null}
                <th scope="col" className={thNum}>
                  {t("shop.field.dueLimit")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("common.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((shop) => (
                <tr key={shop.id} className="border-t border-border hover:bg-surface-hover/50">
                  <td className={tdClass}>
                    <div className="font-medium">{shop.name}</div>
                    {shop.ownerName ? (
                      <div className="text-xs text-text-muted">{shop.ownerName}</div>
                    ) : null}
                  </td>
                  <td className={tdClass}>{shop.phone ? toBengaliDigits(shop.phone) : "—"}</td>
                  <td className={tdClass}>{shop.area || "—"}</td>
                  {canSeeDue ? (
                    <td
                      className={`${tdNum} font-medium ${overLimit(shop) ? "text-error" : ""}`}
                      title={overLimit(shop) ? t("shop.overLimit") : undefined}
                    >
                      {money(shop.due)}
                    </td>
                  ) : null}
                  <td className={tdNum}>{shop.dueLimit ? money(shop.dueLimit) : "—"}</td>
                  <td className={tdClass}>
                    <StatusBadge tone={shop.status === "active" ? "success" : "muted"}>
                      {t(`common.status.${shop.status}`)}
                    </StatusBadge>
                  </td>
                  <td className={`${tdClass} text-right whitespace-nowrap`}>
                    <div className="inline-flex gap-2">
                      {canSeeDue ? (
                        <Button onClick={() => setHistory(shop)}>{t("shop.history")}</Button>
                      ) : null}
                      {canManage ? (
                        <Button
                          onClick={() =>
                            setDraft({
                              id: shop.id,
                              name: shop.name,
                              ownerName: shop.ownerName,
                              phone: shop.phone,
                              area: shop.area,
                              address: shop.address,
                              dueLimit: shop.dueLimit ?? "",
                              status: shop.status,
                            })
                          }
                        >
                          {t("common.edit")}
                        </Button>
                      ) : null}
                      {canManage ? (
                        <DeleteButton
                          name={shop.name}
                          message={t("shop.delete.confirm")}
                          onDelete={() => deleteShop.mutateAsync(shop.id)}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.sales.shops")}
        description={t("shop.description")}
        actions={
          <>
            <label className="relative">
              <span className="sr-only">{t("shop.search")}</span>
              <Icon
                name="search"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle"
              />
              <input
                type="search"
                value={search}
                placeholder={t("shop.search")}
                onChange={(event) => setSearch(event.target.value)}
                className={`${inputClass} w-64 pl-9`}
              />
            </label>
            {canManage ? (
              <Button variant="primary" onClick={() => setDraft(emptyDraft)}>
                {t("shop.new")}
              </Button>
            ) : null}
          </>
        }
      />
      {draft ? (
        <ShopDialog companyId={company.id} draft={draft} onClose={() => setDraft(null)} />
      ) : null}
      {history ? (
        <HistoryDialog companyId={company.id} shop={history} onClose={() => setHistory(null)} />
      ) : null}
      {body}
    </>
  );
}

export function ShopsPage() {
  return (
    <NavGate path={PATH}>
      <Shops />
    </NavGate>
  );
}
