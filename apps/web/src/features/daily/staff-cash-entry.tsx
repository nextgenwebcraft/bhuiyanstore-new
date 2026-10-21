"use client";

import { moneyKindPermission, type MoneyEntry, type MoneyEntryPostRequest } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
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
import { useMoneyEntries, usePostMoneyEntry, useReverseMoneyEntry } from "@/data/queries";
import { clean } from "@/features/daily/daily-kit";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";

/** D62: the four kinds of the DSR sheet's staff money card. */
export type StaffCashKind = "advance" | "shortage" | "advanceReturn" | "shortageReturn";

const KINDS: readonly StaffCashKind[] = ["advance", "shortage", "advanceReturn", "shortageReturn"];

const LABEL: Record<StaffCashKind, TranslationKey> = {
  advance: "staffCash.kind.advance",
  shortage: "staffCash.kind.shortage",
  advanceReturn: "staffCash.kind.advanceReturn",
  shortageReturn: "staffCash.kind.shortageReturn",
};

/** The money entry a card kind posts: returns are repayments allocated to one bucket. */
export function staffCashRequest(
  kind: StaffCashKind,
  amount: string,
): Pick<MoneyEntryPostRequest, "kind" | "allocation"> {
  switch (kind) {
    case "advance":
      return { kind: "staffAdvance" };
    case "shortage":
      return { kind: "staffShortage" };
    case "advanceReturn":
      return { kind: "staffRepayment", allocation: { advance: amount, loan: "0", shortage: "0" } };
    case "shortageReturn":
      return { kind: "staffRepayment", allocation: { advance: "0", loan: "0", shortage: amount } };
  }
}

/** The card kind of a posted entry, or null when the entry is not staff money of the card. */
export function staffCashKindOf(entry: MoneyEntry): StaffCashKind | null {
  if (entry.kind === "staffAdvance") return "advance";
  if (entry.kind === "staffShortage") return "shortage";
  if (entry.kind !== "staffRepayment") return null;
  const shortage = entry.allocation?.shortage ?? "0";
  return /[1-9]/.test(shortage) ? "shortageReturn" : "advanceReturn";
}

function EntryForm({
  companyId,
  staffId,
  date,
  kinds,
}: {
  companyId: string;
  staffId: string;
  date: string;
  kinds: StaffCashKind[];
}) {
  const id = useId();
  const post = usePostMoneyEntry(companyId);
  const [kind, setKind] = useState<StaffCashKind>(kinds[0] ?? "advance");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    try {
      await post.mutateAsync({ date, amount: value, staffId, ...staffCashRequest(kind, value) });
      setAmount("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-kind`} label={t("common.kind")}>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as StaffCashKind)}
            className={inputClass}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(LABEL[k])}
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
      {error ? <StatePanel tone="error" title={error} /> : null}
      <div>
        <Button variant="primary" disabled={post.isPending} onClick={() => void submit()}>
          {post.isPending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
    </div>
  );
}

function Entries({ rows, companyId }: { rows: MoneyEntry[]; companyId: string }) {
  const { permissions } = useCurrentWorkspace();
  const reverse = useReverseMoneyEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("payment.reverse");
  const total = (kind: StaffCashKind) =>
    sumAmounts([
      "0",
      ...rows
        .filter((e) => staffCashKindOf(e) === kind && e.status === "posted")
        .map((e) => e.amount),
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
              {rows.map((entry) => {
                const kind = staffCashKindOf(entry);
                return (
                  <tr key={entry.id} className="border-t border-border">
                    <td className={tdClass}>{kind ? t(LABEL[kind]) : null}</td>
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
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        {KINDS.map((k) => (
          <div key={k} className="flex justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
            <dt className="text-text-muted">{t(LABEL[k])}</dt>
            <dd className="font-medium tabular-nums">{money(total(k))}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The DSR's advance and shortage for one day (D62): posted at once as money entries of the sheet's
 * DSR and date; they move the expected cash of the day-end check below.
 */
export function StaffCashEntry({
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
  const kinds = KINDS.filter((k) =>
    permissions.includes(moneyKindPermission[staffCashRequest(k, "0").kind]),
  );
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("staffCash.title")}</h3>
      {kinds.length > 0 ? (
        <EntryForm
          key={`${staffId}-${date}`}
          companyId={companyId}
          staffId={staffId}
          date={date}
          kinds={kinds}
        />
      ) : null}
      {entries.isPending ? (
        <FormSkeleton fields={1} />
      ) : entries.isError ? (
        <QueryError error={entries.error} onRetry={() => void entries.refetch()} />
      ) : (
        <Entries
          companyId={companyId}
          rows={entries.data.filter((e) => staffCashKindOf(e) !== null)}
        />
      )}
    </section>
  );
}
