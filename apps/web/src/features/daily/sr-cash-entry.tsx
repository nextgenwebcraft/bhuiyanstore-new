"use client";

import { moneyKindPermission, type MoneyEntry } from "@bsd/contracts";
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

/** D79: advance and short for the SR whose sheet is open. No absent fee, no SR picker. */
type SrCashKind = "advance" | "shortage" | "advanceReturn" | "shortageReturn";
const KINDS: readonly SrCashKind[] = ["advance", "shortage", "advanceReturn", "shortageReturn"];
const LABEL: Record<SrCashKind, TranslationKey> = {
  advance: "staffCash.kind.advance",
  shortage: "staffCash.kind.shortage",
  advanceReturn: "staffCash.kind.advanceReturn",
  shortageReturn: "staffCash.kind.shortageReturn",
};

function requestOf(kind: SrCashKind): {
  kind: "srLoan" | "srRepayment";
  srLoanType: "cash" | "shortage";
} {
  const shortage = kind === "shortage" || kind === "shortageReturn";
  return {
    kind: kind === "advance" || kind === "shortage" ? "srLoan" : "srRepayment",
    srLoanType: shortage ? "shortage" : "cash",
  };
}

function postedKind(entry: MoneyEntry): SrCashKind | "commission" | null {
  if (entry.kind !== "srLoan" && entry.kind !== "srRepayment") return null;
  if (entry.srLoanType === "shortage") {
    return entry.kind === "srLoan" ? "shortage" : "shortageReturn";
  }
  if (entry.srLoanType === "commission") return "commission";
  return entry.kind === "srLoan" ? "advance" : "advanceReturn";
}

export function SrCashEntry({
  companyId,
  staffId,
  date,
}: {
  companyId: string;
  staffId: string;
  date: string;
}) {
  const id = useId();
  const { permissions } = useCurrentWorkspace();
  const post = usePostMoneyEntry(companyId);
  const reverse = useReverseMoneyEntry(companyId);
  const action = useAsyncAction();
  const entries = useMoneyEntries(companyId, { from: date, to: date, staffId });
  const canLoan = permissions.includes(moneyKindPermission.srLoan);
  const canRepay = permissions.includes(moneyKindPermission.srRepayment);
  const kinds = KINDS.filter((kind) =>
    kind === "advance" || kind === "shortage" ? canLoan : canRepay,
  );
  const [kind, setKind] = useState<SrCashKind>(kinds[0] ?? "advance");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const canReverse = permissions.includes("payment.reverse");
  const rows = (entries.data ?? []).filter((entry) => postedKind(entry) !== null);
  const total = (cardKind: SrCashKind) =>
    sumAmounts([
      "0",
      ...rows
        .filter((entry) => postedKind(entry) === cardKind && entry.status === "posted")
        .map((entry) => entry.amount),
    ]);

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    try {
      await post.mutateAsync({ date, amount: value, staffId, ...requestOf(kind) });
      setAmount("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("srCash.title")}</h3>
      {kinds.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${id}-kind`} label={t("common.kind")}>
              <select
                id={`${id}-kind`}
                value={kinds.includes(kind) ? kind : kinds[0]}
                onChange={(event) => setKind(event.target.value as SrCashKind)}
                className={inputClass}
              >
                {kinds.map((cardKind) => (
                  <option key={cardKind} value={cardKind}>
                    {t(LABEL[cardKind])}
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
      ) : null}
      {entries.isPending ? (
        <FormSkeleton fields={1} />
      ) : entries.isError ? (
        <QueryError error={entries.error} onRetry={() => void entries.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t("money.posted")}</h4>
          {action.error ? <StatePanel tone="error" title={action.error} /> : null}
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">{t("money.empty")}</p>
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
                    const cardKind = postedKind(entry);
                    return (
                      <tr key={entry.id} className="border-t border-border">
                        <td className={tdClass}>
                          {cardKind === "commission"
                            ? t("money.srLoanType.commission")
                            : cardKind
                              ? t(LABEL[cardKind])
                              : null}
                        </td>
                        <td className={tdNum}>{money(entry.amount)}</td>
                        <td className={tdClass}>
                          <StatusChip status={entry.status} />
                        </td>
                        <ReverseCell
                          canReverse={canReverse}
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
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {KINDS.map((cardKind) => (
              <div
                key={cardKind}
                className="flex justify-between gap-2 rounded-md bg-surface-muted px-3 py-2"
              >
                <dt className="text-text-muted">{t(LABEL[cardKind])}</dt>
                <dd className="font-medium tabular-nums">{money(total(cardKind))}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
