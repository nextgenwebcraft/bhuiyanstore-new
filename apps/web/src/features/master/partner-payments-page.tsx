"use client";

import type { PartnerPayoutMonth, PayoutMonthState } from "@bsd/contracts";
import { monthOf, shiftMonth, sumAmounts } from "@bsd/domain";
import { formatCount, formatDateTime, formatMoney, formatMonth, t } from "@bsd/i18n";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import {
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { MonthPicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import { useCancelPartnerPayout, usePartnerPayoutMonth, usePayPartners } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";
import { useToday } from "@/lib/today";
import { PreviousDueApplyForm } from "./previous-due-apply";

type Partner = PartnerPayoutMonth["partners"][number];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const nonZero = (value: string) => /[1-9]/.test(value);

function Money({ value, strong = false }: { value: string; strong?: boolean }) {
  return (
    <span
      className={`${value.startsWith("-") ? "text-error" : ""} ${strong ? "font-semibold" : ""}`}
    >
      {formatMoney(value)}
    </span>
  );
}

/**
 * অংশীদারদের পেমেন্ট (D143): pick a month, see every partner's per-company share and the one total
 * they are owed, and pay one partner or everyone left. A payment is a snapshot, kept in history.
 */
export function PartnerPaymentsPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // The month lives in the address so a reload (or a link from history) keeps it.
  const param = search.get("month");
  const month = param && MONTH.test(param) ? param : monthOf(today);
  const query = usePartnerPayoutMonth(company.id, month);

  const setMonth = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("month", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <NavGate path="master/partner-payments">
      <PageHeader
        title={t("nav.master.partnerPayments")}
        description={t("payout.description")}
        actions={
          <ButtonLink href={companyHref(company.id, "master/partner-payments/history")}>
            {t("nav.master.partnerPayments.history")}
            <Icon name="arrowRight" className="size-4" />
          </ButtonLink>
        }
      />
      <MonthBar month={month} onChange={setMonth} state={query.data?.state} />
      {query.isPending ? (
        <TableSkeleton rows={4} columns={6} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <MonthView
          companyId={company.id}
          view={query.data}
          onRefresh={() => void query.refetch()}
        />
      )}
    </NavGate>
  );
}

function MonthBar({
  month,
  onChange,
  state,
}: {
  month: string;
  onChange: (month: string) => void;
  state: PayoutMonthState | undefined;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
      <Button
        className="px-3"
        aria-label={t("payout.prevMonth")}
        title={t("payout.prevMonth")}
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <Icon name="chevronLeft" className="size-4" />
      </Button>
      <MonthPicker
        id="payout-month"
        value={month}
        label={t("payout.month")}
        onChange={onChange}
        className="w-48"
      />
      <Button
        className="px-3"
        aria-label={t("payout.nextMonth")}
        title={t("payout.nextMonth")}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <Icon name="chevronRight" className="size-4" />
      </Button>
      {state === "closed" ? (
        <StatusBadge tone="success">{t("payout.state.closed")}</StatusBadge>
      ) : null}
    </div>
  );
}

function MonthView({
  companyId,
  view,
  onRefresh,
}: {
  companyId: string;
  view: PartnerPayoutMonth;
  onRefresh: () => void;
}) {
  const cancel = useCancelPartnerPayout(companyId);
  const action = useAsyncAction();
  const [dialog, setDialog] = useState<string[] | null>(null);
  const payable = view.state !== "future";
  const unpaid = view.partners.filter((partner) => partner.active && !partner.payout);
  // A company with profit but no partner invest: nobody receives its share.
  const starved = view.companies.filter(
    (company) => !nonZero(company.invest) && nonZero(company.distributableProfit),
  );

  function cancelPayout(partner: Partner) {
    const payout = partner.payout;
    if (!payout) return;
    void action.run(() => cancel.mutateAsync(payout.id), {
      confirm: "payout.cancelConfirm",
      confirmDetail: `${partner.name} — ${formatMonth(view.month)} — ${formatMoney(payout.amount)}`,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {view.state === "current" ? (
        <StatePanel compact tone="warning" title={t("payout.state.current")} />
      ) : null}
      {view.state === "future" ? <StatePanel compact title={t("payout.state.future")} /> : null}

      <Summary view={view} />

      {starved.length > 0 ? (
        <StatePanel
          tone="warning"
          title={t("payout.unallocated.title")}
          hint={`${t("payout.unallocated.hint")} ${starved
            .map(
              (company) => `${company.companyName} (${formatMoney(company.distributableProfit)})`,
            )
            .join(", ")}`}
          action={
            <ButtonLink href={companyHref(companyId, "master/shareholders")}>
              {t("payout.unallocated.action")}
            </ButtonLink>
          }
        />
      ) : null}

      {payable ? <PreviousDueApplyForm companyId={companyId} month={view.month} /> : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{t("payout.table.title")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("payout.table.hint")}</p>
          </div>
          {payable && view.partners.length > 0 ? (
            unpaid.length > 0 ? (
              <Button
                variant="primary"
                className="print:hidden"
                onClick={() => setDialog(unpaid.map((partner) => partner.shareholderId))}
              >
                <Icon name="check" className="size-4" />
                {t("payout.payAll")} · {formatMoney(view.summary.unpaid)}
              </Button>
            ) : (
              <StatusBadge tone="success">{t("payout.allPaid")}</StatusBadge>
            )
          ) : null}
        </div>
        {action.error ? <StatePanel tone="error" title={action.error} compact /> : null}
        {view.partners.length === 0 ? (
          <StatePanel
            title={t("payout.empty.partners")}
            action={
              <ButtonLink href={companyHref(companyId, "master/shareholders")}>
                {t("share.add")}
              </ButtonLink>
            }
          />
        ) : (
          <PartnerTable
            view={view}
            payable={payable}
            busy={action.busy}
            onPay={(partner) => setDialog([partner.shareholderId])}
            onCancel={cancelPayout}
          />
        )}
      </section>

      {dialog ? (
        <PayDialog
          key={dialog.join("|")}
          companyId={companyId}
          view={view}
          initial={dialog}
          onClose={() => setDialog(null)}
          onFailed={onRefresh}
        />
      ) : null}
    </div>
  );
}

function Summary({ view }: { view: PartnerPayoutMonth }) {
  const { summary } = view;
  const unpaidCount = view.partners.filter((partner) => partner.active && !partner.payout).length;
  const people = (count: number) => `${formatCount(count)} ${t("payout.people")}`;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t("payout.summary.distributable")}
        value={formatMoney(view.distributableProfit)}
        hint={
          nonZero(view.previousDueTotal)
            ? `${t("share.total")} ${formatMoney(view.totalProfit)} − ${t("previousDue.applied")} ${formatMoney(view.previousDueTotal)}`
            : `${t("share.total")} ${formatMoney(view.totalProfit)}`
        }
      />
      <StatTile
        tone="brand"
        label={t("payout.summary.payable")}
        value={formatMoney(summary.payable)}
        hint={people(summary.partnerCount)}
      />
      <StatTile
        tone="success"
        label={t("payout.summary.paid")}
        value={formatMoney(summary.paid)}
        hint={people(summary.paidCount)}
      />
      <StatTile
        tone={unpaidCount > 0 ? "warning" : "plain"}
        label={t("payout.summary.unpaid")}
        value={formatMoney(summary.unpaid)}
        hint={people(unpaidCount)}
      />
    </dl>
  );
}

function PartnerTable({
  view,
  payable,
  busy,
  onPay,
  onCancel,
}: {
  view: PartnerPayoutMonth;
  payable: boolean;
  busy: boolean;
  onPay: (partner: Partner) => void;
  onCancel: (partner: Partner) => void;
}) {
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} ${stickyHead}`}>
              {t("payout.col.partner")}
            </th>
            <th scope="col" className={thNum}>
              {t("payout.col.invest")}
            </th>
            {view.companies.map((company) => (
              <th key={company.companyId} scope="col" className={thNum}>
                {company.companyName}
              </th>
            ))}
            <th scope="col" className={thNum}>
              {t("payout.col.total")}
            </th>
            <th scope="col" className={thClass}>
              {t("payout.col.status")}
            </th>
            <th scope="col" className={`${thClass} print:hidden`}>
              <span className="sr-only">{t("payout.col.action")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.partners.map((partner) => {
            const payout = partner.payout;
            // A paid row shows what was actually paid (the snapshot), not today's figure.
            const lines = payout ? payout.lines : partner.lines;
            return (
              <tr
                key={partner.shareholderId}
                className={`border-t border-border ${payout ? "bg-success/8" : ""}`}
              >
                <th scope="row" className={`${thClass} ${stickyCell} text-left`}>
                  <span className="font-medium">{partner.name}</span>
                  {partner.active ? null : (
                    <span className="mt-1 block">
                      <StatusBadge tone="muted">{t("payout.status.closedPartner")}</StatusBadge>
                    </span>
                  )}
                </th>
                <td className={`${tdNum} text-text-muted`}>
                  {partner.active ? formatMoney(partner.invest) : "—"}
                </td>
                {view.companies.map((company) => {
                  const line = lines.find((row) => row.companyId === company.companyId);
                  return (
                    <td key={company.companyId} className={tdNum}>
                      {line && (nonZero(line.invest) || nonZero(line.amount)) ? (
                        <>
                          <Money value={line.amount} />
                          <span className="block text-[11px] text-text-subtle">
                            {t("share.invest")} {formatMoney(line.invest)}
                          </span>
                        </>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                  );
                })}
                <td className={`${tdNum} text-base`}>
                  <Money value={payout ? payout.amount : partner.amount} strong />
                  {partner.changed ? (
                    <span className="mt-1 block max-w-48 text-xs font-normal text-warning">
                      {t("payout.changed")} {formatMoney(partner.amount)}
                    </span>
                  ) : null}
                </td>
                <td className={tdClass}>
                  {payout ? (
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge tone="success">{t("payout.status.paid")}</StatusBadge>
                      <span className="text-xs whitespace-nowrap text-text-muted">
                        {formatDateTime(payout.paidAt)}
                        {payout.paidByName ? ` · ${payout.paidByName}` : ""}
                      </span>
                      {payout.note ? (
                        <span className="max-w-56 text-xs text-text-muted italic">
                          {payout.note}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <StatusBadge tone="muted">{t("payout.status.unpaid")}</StatusBadge>
                  )}
                </td>
                <td className={`${tdClass} text-right print:hidden`}>
                  {payout ? (
                    <Button disabled={busy} onClick={() => onCancel(partner)}>
                      {t("payout.cancel")}
                    </Button>
                  ) : payable && partner.active ? (
                    <Button variant="primary" disabled={busy} onClick={() => onPay(partner)}>
                      {t("payout.pay")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border-strong bg-surface-muted">
            <th scope="row" className={`${thClass} ${stickyCell} text-left text-xs`}>
              {t("payout.row.companyPool")}
            </th>
            <td className={tdNum} />
            {view.companies.map((company) => (
              <td key={company.companyId} className={tdNum}>
                <Money value={company.distributableProfit} />
                <span
                  className={`block text-[11px] ${nonZero(company.invest) ? "text-text-subtle" : "text-warning"}`}
                >
                  {t("share.invest")} {formatMoney(company.invest)}
                </span>
              </td>
            ))}
            <td className={`${tdNum} text-base`}>
              <Money value={view.distributableProfit} strong />
            </td>
            <td colSpan={2} className="print:hidden" />
          </tr>
        </tfoot>
      </table>
    </TableScroller>
  );
}

/**
 * Confirms a payment: every unpaid partner listed with their per-company parts, the preselected
 * ones ticked. Sends the amounts on screen so the server refuses if they changed meanwhile.
 */
function PayDialog({
  companyId,
  view,
  initial,
  onClose,
  onFailed,
}: {
  companyId: string;
  view: PartnerPayoutMonth;
  initial: readonly string[];
  onClose: () => void;
  onFailed: () => void;
}) {
  const pay = usePayPartners(companyId);
  const [selected, setSelected] = useState(() => new Set(initial));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const candidates = view.partners.filter((partner) => partner.active && !partner.payout);
  const chosen = candidates.filter((partner) => selected.has(partner.shareholderId));
  const total = sumAmounts(chosen.map((partner) => partner.amount));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setError(undefined);
    try {
      const trimmed = note.trim();
      await pay.mutateAsync({
        month: view.month,
        entries: chosen.map((partner) => ({
          shareholderId: partner.shareholderId,
          amount: partner.amount,
        })),
        ...(trimmed ? { note: trimmed } : {}),
      });
      onClose();
    } catch (caught) {
      setError(describeError(caught, []).form);
      // A stale figure or a parallel payment: reload so the list shows today's numbers.
      onFailed();
    }
  }

  return (
    <FormDialog
      open
      wide
      title={`${t("payout.dialog.title")} — ${formatMonth(view.month)}`}
      error={error}
      pending={pay.isPending}
      submitLabel={`${t("payout.pay")} · ${formatMoney(total)}`}
      submitDisabled={chosen.length === 0}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className="text-sm text-text-muted">{t("payout.dialog.hint")}</p>
      {view.state === "current" ? (
        <StatePanel compact tone="warning" title={t("payout.dialog.currentWarning")} />
      ) : null}
      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {candidates.map((partner) => {
          const parts = partner.lines.filter(
            (line) => nonZero(line.invest) || nonZero(line.amount),
          );
          return (
            <li key={partner.shareholderId}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-hover">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selected.has(partner.shareholderId)}
                  onChange={() => toggle(partner.shareholderId)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{partner.name}</span>
                  {parts.length > 0 ? (
                    <span className="block text-xs text-text-muted">
                      {parts
                        .map((line) => `${line.companyName} ${formatMoney(line.amount)}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                </span>
                <span className="text-right tabular-nums">
                  <Money value={partner.amount} strong />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2.5 text-sm">
        <span>
          {t("payout.dialog.selected")} ({formatCount(chosen.length)} {t("payout.people")})
        </span>
        <span className="text-base font-semibold tabular-nums">{formatMoney(total)}</span>
      </div>
      <Field id="payout-note" label={`${t("payout.note")} (${t("common.optional")})`}>
        <input
          id="payout-note"
          className={inputClass}
          maxLength={200}
          value={note}
          placeholder={t("payout.notePlaceholder")}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}
