"use client";

import { moneyKindPermission, type Shop } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { Combobox, type ComboboxOption } from "@/components/combobox";
import { exactMatch } from "@/components/combobox-logic";
import { Field, inputClass } from "@/components/field";
import { AccountSelect } from "@/features/daily/account-select";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { FormSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import { usePostMoneyEntry, useShops, useStaffRecords } from "@/data/queries";
import {
  clean,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  useWorkingDate,
} from "@/features/daily/daily-kit";
import { money } from "@/components/data-table";
import { dsrsOn } from "@/features/daily/dsr-days-page";
import { MoneyEntryTable } from "@/features/daily/money-entry-table";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { overLimit } from "./shops-page";

const PATH = "sales/old-dues-collection";
type DueKind = "marketDueNew" | "marketDueCollected";
const KINDS: readonly DueKind[] = ["marketDueNew", "marketDueCollected"];

function EntryForm({
  companyId,
  date,
  kinds,
  shops,
}: {
  companyId: string;
  date: string;
  kinds: DueKind[];
  shops: Shop[];
}) {
  const id = useId();
  const records = useStaffRecords(companyId);
  const post = usePostMoneyEntry(companyId);
  const [kind, setKind] = useState<DueKind>(kinds[0] ?? "marketDueNew");
  const [shopText, setShopText] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const active = shops.filter((s) => s.status === "active");
  const options = useMemo<ComboboxOption[]>(
    () =>
      shops
        .filter((s) => s.status === "active")
        .map((s) => ({
          id: s.id,
          label: s.name,
          secondary: [s.ownerName, s.area].filter(Boolean).join(" · "),
          ...(s.due != null ? { trailing: money(s.due) } : {}),
          tone: overLimit(s) ? ("danger" as const) : ("default" as const),
        })),
    [shops],
  );
  // A picked row, else a listed shop whose name was typed exactly; anything else is a new shop (D50).
  const pickedId = shopId ?? exactMatch(options, shopText)?.id ?? null;
  const shop = active.find((s) => s.id === pickedId);
  const newName = shop ? "" : shopText.trim();
  const dsrs = dsrsOn(records.data ?? [], companyId, date);

  async function submit() {
    setError(undefined);
    setDone(false);
    const value = clean(amount);
    if (!shop && !newName) return setError(t("validation.shop.required"));
    if (!staffId) return setError(t("validation.daily.staffRequired"));
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    try {
      await post.mutateAsync({
        date,
        kind,
        amount: value,
        staffId,
        cashAccountId: accountId || null,
        ...(shop ? { shopId: shop.id } : { newShop: { name: newName } }),
      });
      setAmount("");
      setShopText("");
      setShopId(null);
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      {kinds.length > 1 ? (
        <div role="radiogroup" aria-label={t("common.kind")} className="flex gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setDone(false);
              }}
              className={`min-h-10 rounded-lg border px-4 text-sm font-medium ${
                kind === k
                  ? "border-brand bg-brand/12 text-text"
                  : "border-border text-text-muted hover:border-border-strong hover:text-text"
              }`}
            >
              {t(`money.kind.${k}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          id={`${id}-shop`}
          label={t("shop.label")}
          hint={
            shop?.due != null
              ? `${t("shop.due")}: ${money(shop.due)}${overLimit(shop) ? ` — ${t("shop.overLimit")}` : ""}`
              : newName
                ? t("shop.combobox.createHint")
                : undefined
          }
        >
          <Combobox
            id={`${id}-shop`}
            text={shopText}
            onTextChange={(text) => {
              setShopText(text);
              setShopId(null);
            }}
            options={options}
            selectedId={pickedId}
            onChoose={(choice) => {
              if (choice.kind === "option") {
                setShopText(choice.option.label);
                setShopId(choice.option.id);
              } else {
                setShopText(choice.text);
                setShopId(null);
              }
            }}
            createLabel={(text) => `＋ ${t("shop.combobox.create")}: “${text}”`}
            placeholder={t("shop.pick")}
            emptyLabel={t("shop.combobox.empty")}
            listLabel={t("shop.label")}
          />
        </Field>
        <Field id={`${id}-staff`} label={t("money.person.dsr")}>
          <select
            id={`${id}-staff`}
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            className={inputClass}
          >
            <option value="">{t("common.select")}</option>
            {dsrs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-amount`} label={t("common.amount")}>
          <input
            id={`${id}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            className={inputClass}
          />
        </Field>
        <AccountSelect id={`${id}-account`} value={accountId} onChange={setAccountId} />
      </div>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {done ? <StatePanel title={t("common.posted")} /> : null}
      <div>
        <Button variant="primary" disabled={post.isPending} onClick={() => void submit()}>
          {post.isPending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Daily বাকি by shop (D35): due given to or collected from a shop, with the DSR who handled it.
 * The engine counts it in the day's cash and in market due like any market due entry.
 */
export function ShopDuePage() {
  const { company, permissions } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const shops = useShops(company.id);
  const kinds = KINDS.filter((k) => permissions.includes(moneyKindPermission[k]));
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("sales.oldDuesCollection")}
        description={t("shop.due.description")}
        actions={<DateBar date={date} onChange={setDate} />}
      />
      <DateHeading date={date} />
      <DayGate
        companyId={company.id}
        date={date}
        skeleton={
          <div className="flex flex-col gap-6">
            <FormSkeleton fields={3} />
            <TableSkeleton rows={3} columns={5} title />
          </div>
        }
      >
        {(view) => (
          <div className="flex flex-col gap-6">
            <TableSummary
              items={[
                { label: t("money.kind.marketDueNew"), value: money(view.money.marketDueNew) },
                {
                  label: t("money.kind.marketDueCollected"),
                  value: money(view.money.marketDueCollected),
                },
                {
                  label: t("money.marketOutstanding"),
                  value: money(view.marketDueOutstanding),
                  emphasis: true,
                },
              ]}
            />
            {kinds.length > 0 ? (
              shops.isError ? (
                <QueryError error={shops.error} onRetry={() => void shops.refetch()} />
              ) : shops.isPending ? (
                <FormSkeleton fields={3} />
              ) : (
                <EntryForm
                  key={date}
                  companyId={company.id}
                  date={date}
                  kinds={kinds}
                  shops={shops.data}
                />
              )
            ) : null}
            <div>
              <SectionTitle>{t("money.posted")}</SectionTitle>
              <MoneyEntryTable
                companyId={company.id}
                date={date}
                kinds={KINDS}
                columns={[
                  { label: "shop.label", cell: (e) => e.shopName ?? t("shop.none") },
                  { label: "money.person.dsr", cell: (e) => e.staffName ?? "—" },
                  {
                    label: "money.kind.marketDueNew",
                    numeric: true,
                    cell: (e) => (e.kind === "marketDueNew" ? money(e.amount) : ""),
                  },
                  {
                    label: "money.kind.marketDueCollected",
                    numeric: true,
                    cell: (e) => (e.kind === "marketDueCollected" ? money(e.amount) : ""),
                  },
                ]}
              />
            </div>
          </div>
        )}
      </DayGate>
    </NavGate>
  );
}
