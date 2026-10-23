"use client";

import { moneyKindPermission, type MoneyEntry, type Shop } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useId, useMemo, useState } from "react";
import { DsrSelect, type DsrChoice } from "@/features/daily/dsr-select";
import { Button } from "@/components/button";
import { Combobox, type ComboboxOption } from "@/components/combobox";
import { exactMatch } from "@/components/combobox-logic";
import {
  money,
  StatusChip,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { EmptyListNote } from "@/components/empty-list-note";
import { Field, inputClass } from "@/components/field";
import { QueryError } from "@/components/query-error";
import { ReverseCell } from "@/components/reverse-cell";
import { FormSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  useDsrFieldDay,
  useMoneyEntries,
  usePostMoneyEntry,
  useReverseMoneyEntry,
  useShops,
} from "@/data/queries";
import { clean } from "@/features/daily/daily-kit";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";
import { overLimit } from "./shops-page";

type DueKind = "marketDueNew" | "marketDueCollected";
const KINDS: readonly DueKind[] = ["marketDueNew", "marketDueCollected"];

/** Saved phone and area, with no field labels: `০১৭… | এলাকা`. */
function shopDetails(shop: Shop): string {
  const phone = shop.phone ? toBengaliDigits(shop.phone) : "";
  return [phone, shop.area].filter(Boolean).join(" | ");
}

function EntryForm({
  companyId,
  staffId,
  date,
  kinds,
  shops,
  dsr,
}: {
  companyId: string;
  staffId: string;
  date: string;
  kinds: DueKind[];
  shops: Shop[];
  dsr?: { id: string; dsrs: readonly DsrChoice[]; onChange: (staffId: string) => void };
}) {
  const id = useId();
  const post = usePostMoneyEntry(companyId);
  const [kind, setKind] = useState<DueKind>(kinds[0] ?? "marketDueNew");
  const [shopText, setShopText] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  const active = shops.filter((s) => s.status === "active");
  const options = useMemo<ComboboxOption[]>(
    () =>
      shops
        .filter((s) => s.status === "active")
        .map((s) => {
          const phoneDigits = normalizeDigits(s.phone).replace(/\D/g, "");
          const secondary = shopDetails(s);
          return {
            id: s.id,
            label: s.name,
            ...(secondary ? { secondary } : {}),
            ...(phoneDigits ? { searchText: [phoneDigits] } : {}),
            ...(s.due != null ? { trailing: money(s.due) } : {}),
            tone: overLimit(s) ? ("danger" as const) : ("default" as const),
          };
        }),
    [shops],
  );
  // A picked row, else a listed shop whose name was typed exactly; anything else is a new shop (D50).
  const pickedId = shopId ?? exactMatch(options, shopText)?.id ?? null;
  const shop = active.find((s) => s.id === pickedId);
  const newName = shop ? "" : shopText.trim();

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!shop && !newName) return setError(t("validation.shop.required"));
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    try {
      await post.mutateAsync({
        date,
        kind,
        amount: value,
        staffId,
        ...(shop ? { shopId: shop.id } : { newShop: { name: newName } }),
      });
      setAmount("");
      setShopText("");
      setShopId(null);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {kinds.length > 1 ? (
        <div role="radiogroup" aria-label={t("common.kind")} className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
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
      <div className={`grid gap-3 ${dsr ? "grid-cols-3" : "grid-cols-2"}`}>
        {dsr ? (
          <DsrSelect id={`${id}-dsr`} value={dsr.id} dsrs={dsr.dsrs} onChange={dsr.onChange} />
        ) : null}
        <Field
          id={`${id}-shop`}
          label={t("shop.label")}
          hint={
            shop
              ? [
                  shopDetails(shop),
                  shop.due != null
                    ? `${t("shop.due")}: ${money(shop.due)}${overLimit(shop) ? ` — ${t("shop.overLimit")}` : ""}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
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
            clearLabel={t("shop.clear")}
          />
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
      {error ? <StatePanel tone="error" title={error} /> : null}
      <div>
        <Button variant="primary" disabled={post.isPending} onClick={() => void submit()}>
          {post.isPending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
    </div>
  );
}

function Entries({
  companyId,
  staffId,
  date,
}: {
  companyId: string;
  staffId: string;
  date: string;
}) {
  const { permissions } = useCurrentWorkspace();
  const entries = useMoneyEntries(companyId, { from: date, to: date, staffId });
  const reverse = useReverseMoneyEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("payment.reverse");

  if (entries.isPending) return <FormSkeleton fields={1} />;
  if (entries.isError)
    return <QueryError error={entries.error} onRetry={() => void entries.refetch()} />;
  const rows: MoneyEntry[] = entries.data.filter((e) =>
    (KINDS as readonly string[]).includes(e.kind),
  );
  const total = (kind: DueKind) =>
    sumAmounts([
      "0",
      ...rows.filter((e) => e.kind === kind && e.status === "posted").map((e) => e.amount),
    ]);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{t("money.posted")}</h4>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
      {rows.length === 0 ? (
        <EmptyListNote textKey="money.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("shop.label")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.kind")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.amount")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.status")}
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">{t("common.reverse")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className={tdClass}>{entry.shopName ?? t("shop.none")}</td>
                  <td className={tdClass}>{t(`money.kind.${entry.kind as DueKind}`)}</td>
                  <td className={tdNum}>{money(entry.amount)}</td>
                  <td className={tdClass}>
                    <StatusChip status={entry.status} />
                  </td>
                  <ReverseCell
                    canReverse={canReverse && entry.dsrDayId === null}
                    posted={entry.status === "posted"}
                    pending={reverse.isPending}
                    onReverse={() =>
                      void action.run(() => reverse.mutateAsync(entry.id), {
                        confirm: "money.reverseConfirm",
                      })
                    }
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {KINDS.map((k) => (
          <div key={k} className="flex justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
            <dt className="text-text-muted">{t(`money.kind.${k}`)}</dt>
            <dd className="font-medium tabular-nums">{money(total(k))}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Shop due given and collected for one DSR on one day (D35, D50, D57): the only office place that
 * enters it. Field visits own the day's due when they exist, so the card is then read-only.
 */
export function ShopDueEntry({
  companyId,
  staffId,
  date,
  fieldOwned,
  dsrs,
}: {
  companyId: string;
  staffId: string;
  date: string;
  /** The sheet DSR has field visits that day, used when no DSR list is passed. */
  fieldOwned: boolean;
  /** DSRs the card can post for. The open sheet's DSR starts selected. */
  dsrs?: readonly DsrChoice[];
}) {
  const { permissions } = useCurrentWorkspace();
  const shops = useShops(companyId);
  const [picked, setPicked] = useState(staffId);
  const dsrList = dsrs ?? [];
  const choosing = dsrList.length > 0;
  const activeId = dsrList.some((dsr) => dsr.id === picked)
    ? picked
    : (dsrList.find((dsr) => dsr.id === staffId)?.id ?? dsrList[0]?.id ?? staffId);
  const fieldDay = useDsrFieldDay(companyId, activeId, date, choosing);
  const owned = choosing ? Boolean(fieldDay.data && fieldDay.data.visits.length > 0) : fieldOwned;
  const kinds = KINDS.filter((k) => permissions.includes(moneyKindPermission[k]));
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("shopDue.title")}</h3>
      {owned ? (
        <StatePanel title={t("validation.field.manualDueBlocked")} />
      ) : kinds.length === 0 ? null : choosing && fieldDay.isPending ? (
        <FormSkeleton fields={2} />
      ) : shops.isError ? (
        <QueryError error={shops.error} onRetry={() => void shops.refetch()} />
      ) : shops.isPending ? (
        <FormSkeleton fields={2} />
      ) : (
        <EntryForm
          key={`${activeId}-${date}`}
          companyId={companyId}
          staffId={activeId}
          date={date}
          kinds={kinds}
          shops={shops.data}
          {...(choosing ? { dsr: { id: activeId, dsrs: dsrList, onChange: setPicked } } : {})}
        />
      )}
      <Entries companyId={companyId} staffId={activeId} date={date} />
    </section>
  );
}
