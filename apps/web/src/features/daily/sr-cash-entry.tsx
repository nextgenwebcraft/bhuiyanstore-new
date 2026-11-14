"use client";

import { moneyKindPermission, type MoneyEntry } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm-dialog";
import {
  money,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { Field, inputClass } from "@/components/field";
import { QueryError } from "@/components/query-error";
import { FormSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import { useCorrectMoneyEntry, useMoneyEntries, usePostMoneyEntry } from "@/data/queries";
import { canEditDailyMoney, canPostDailyMoney, clean } from "@/features/daily/daily-kit";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

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
  handoverLocked,
}: {
  companyId: string;
  staffId: string;
  date: string;
  /** D114: pass from the day sheet; omitted elsewhere hides Edit. */
  handoverLocked?: boolean;
}) {
  const id = useId();
  const confirm = useConfirm();
  const { permissions, loginRoleKind } = useCurrentWorkspace();
  const post = usePostMoneyEntry(companyId);
  const correct = useCorrectMoneyEntry(companyId);
  const entries = useMoneyEntries(companyId, {
    from: date,
    to: date,
    staffId,
    sheetStaffId: staffId,
  });
  const canLoan = permissions.includes(moneyKindPermission.srLoan);
  const canRepay = permissions.includes(moneyKindPermission.srRepayment);
  const kinds = KINDS.filter((kind) =>
    kind === "advance" || kind === "shortage" ? canLoan : canRepay,
  );
  const [kind, setKind] = useState<SrCashKind>(kinds[0] ?? "advance");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<MoneyEntry | null>(null);
  // Day sheet: only live posted rows — corrected (বাতিল) history stays off this card.
  const rows = (entries.data ?? []).filter(
    (entry) => entry.status === "posted" && postedKind(entry) !== null,
  );
  const total = (cardKind: SrCashKind) =>
    sumAmounts([
      "0",
      ...rows
        .filter((entry) => postedKind(entry) === cardKind && entry.status === "posted")
        .map((entry) => entry.amount),
    ]);
  const canEdit = canEditDailyMoney(loginRoleKind, handoverLocked);
  const canCreate = canPostDailyMoney(loginRoleKind, handoverLocked) && kinds.length > 0;
  const pending = post.isPending || correct.isPending;

  function startEdit(entry: MoneyEntry) {
    const cardKind = postedKind(entry);
    if (cardKind && cardKind !== "commission") setKind(cardKind);
    setAmount(entry.amount);
    setError(undefined);
    setEditing(entry);
  }

  async function submit() {
    setError(undefined);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      return setError(t("validation.amountPositive"));
    }
    const body = { date, amount: value, staffId, sheetStaffId: staffId, ...requestOf(kind) };
    try {
      if (editing) {
        const ok = await confirm({
          title: t("common.confirmTitle"),
          message: t("money.correctConfirm"),
          confirmLabel: t("common.confirm"),
        });
        if (!ok) return;
        await correct.mutateAsync({ entryId: editing.id, body });
        setEditing(null);
      } else {
        await post.mutateAsync(body);
      }
      setAmount("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t("srCash.title")}</h3>
      {canCreate || editing ? (
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
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending} onClick={() => void submit()}>
              {pending
                ? t("common.posting")
                : editing
                  ? t("money.correct")
                  : t("common.post")}
            </Button>
            {editing ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setEditing(null);
                  setAmount("");
                }}
              >
                {t("common.cancel")}
              </Button>
            ) : null}
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
                    {canEdit ? (
                      <th scope="col" className={thClass}>
                        <span className="sr-only">{t("common.edit")}</span>
                      </th>
                    ) : null}
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
                        {canEdit ? (
                          <td className={`${tdClass} text-right`}>
                            {!entry.dsrDayId &&
                            !entry.payrollRunId &&
                            cardKind !== "commission" ? (
                              <Button onClick={() => startEdit(entry)}>{t("common.edit")}</Button>
                            ) : null}
                          </td>
                        ) : null}
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
