"use client";

import { moneyKindPermission, type Shop } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { FormSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  useMoneyEntries,
  usePostMoneyEntry,
  useReverseMoneyEntry,
  useShops,
  useStaffRecords,
} from "@/data/queries";
import {
  clean,
  DateBar,
  DateHeading,
  DayGate,
  money,
  SectionTitle,
  StatusChip,
  tableClass,
  TableScroller,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "@/features/daily/daily-kit";
import { dsrsOn } from "@/features/daily/dsr-days-page";
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
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const active = shops.filter((s) => s.status === "active");
  const shop = active.find((s) => s.name === shopText.trim());
  const dsrs = dsrsOn(records.data ?? [], companyId, date);

  async function submit() {
    setError(undefined);
    setDone(false);
    const value = clean(amount);
    if (!shop) return setError(t("validation.shop.required"));
    if (!staffId) return setError(t("validation.daily.staffRequired"));
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    try {
      await post.mutateAsync({ date, kind, amount: value, staffId, shopId: shop.id });
      setAmount("");
      setShopText("");
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
              : undefined
          }
        >
          <input
            id={`${id}-shop`}
            list={`${id}-shops`}
            value={shopText}
            autoComplete="off"
            placeholder={t("shop.pick")}
            onChange={(event) => setShopText(event.target.value)}
            className={inputClass}
          />
          <datalist id={`${id}-shops`}>
            {active.map((s) => (
              <option key={s.id} value={s.name}>
                {[s.ownerName, s.area].filter(Boolean).join(" · ")}
              </option>
            ))}
          </datalist>
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
      </div>
      {active.length === 0 ? <p className="text-xs text-text-muted">{t("shop.noneYet")}</p> : null}
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

function EntryList({ companyId, date }: { companyId: string; date: string }) {
  const { permissions } = useCurrentWorkspace();
  const entries = useMoneyEntries(companyId, { from: date });
  const reverse = useReverseMoneyEntry(companyId);
  const [error, setError] = useState<string | undefined>();
  const canReverse = permissions.includes("payment.reverse");

  async function undo(entryId: string) {
    if (!window.confirm(t("money.reverseConfirm"))) return;
    setError(undefined);
    try {
      await reverse.mutateAsync(entryId);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  if (entries.isPending) return <TableSkeleton rows={3} columns={5} />;
  if (entries.isError)
    return <QueryError error={entries.error} onRetry={() => void entries.refetch()} />;
  const rows = entries.data.filter((e) => (KINDS as readonly string[]).includes(e.kind));
  return (
    <>
      {error ? <StatePanel tone="error" title={error} /> : null}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {t("money.empty")}
        </p>
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("shop.label")}
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
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("godown.reverse")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className={tdClass}>{entry.shopName ?? t("shop.none")}</td>
                  <td className={tdClass}>{entry.staffName ?? "—"}</td>
                  <td className={tdNum}>
                    {entry.kind === "marketDueNew" ? money(entry.amount) : ""}
                  </td>
                  <td className={tdNum}>
                    {entry.kind === "marketDueCollected" ? money(entry.amount) : ""}
                  </td>
                  <td className={tdClass}>
                    <StatusChip status={entry.status} />
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {canReverse && entry.status === "posted" ? (
                      <Button disabled={reverse.isPending} onClick={() => void undo(entry.id)}>
                        {t("godown.reverse")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </>
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
              <EntryList companyId={company.id} date={date} />
            </div>
          </div>
        )}
      </DayGate>
    </NavGate>
  );
}
