"use client";

import type { MarketDueItem, StaffMember } from "@bsd/contracts";
import { allocateOldestFirst, businessDateOf, sumAmounts, toDecimal } from "@bsd/domain";
import { formatAmount, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import {
  useMarketDues,
  useOldDueCollections,
  usePostOldDueCollection,
  useStaff,
} from "@/data/queries";
import { useRequestKey } from "@/data/use-request-key";
import { useRegisterDraftGuard } from "@/features/shell/draft-guard";
import { NavGate } from "@/features/shell/nav-gate";
import { useOnlineStatus } from "@/features/shell/use-online-status";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "sales/old-dues-collection";
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Credit / আগের বকেয়া আদায় (D04, guide 10.3): settles existing aggregate market dues, oldest
 * first, without customer records. Not revenue, and never a DSR personal due (D21).
 */
function CollectionForm({
  companyId,
  dsrs,
  openDues,
  onClose,
  onPosted,
}: {
  companyId: string;
  dsrs: StaffMember[];
  openDues: MarketDueItem[];
  onClose: () => void;
  onPosted: (number: string) => void;
}) {
  const fieldId = useId();
  const online = useOnlineStatus();
  const post = usePostOldDueCollection(companyId);
  const [requestKey] = useRequestKey();
  const [dsrId, setDsrId] = useState(dsrs[0]?.id ?? "");
  const [collectedDate, setCollectedDate] = useState(() => businessDateOf(new Date()));
  const [amount, setAmount] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dsrDues = openDues.filter((d) => d.dsrId === dsrId);
  const openTotal = sumAmounts(dsrDues.map((d) => d.remainingAmount));
  const normalized = normalizeDigits(amount.trim());
  let amountError: string | undefined;
  let preview: { dueItemId: string; amount: string }[] = [];
  if (!DECIMAL.test(normalized)) amountError = t("validation.decimal");
  else if (toDecimal(normalized).lte(0)) amountError = t("validation.amountPositive");
  else if (toDecimal(normalized).gt(toDecimal(openTotal))) amountError = t("validation.exceedsDue");
  else preview = allocateOldestFirst(dsrDues, normalized);

  async function submit(): Promise<boolean> {
    setShowErrors(true);
    if (amountError || !dsrId || !collectedDate) return false;
    setFormError(null);
    try {
      const collection = await post.mutateAsync({
        requestKey,
        dsrId,
        collectedDate,
        amount: normalized,
      });
      onPosted(collection.number);
      return true;
    } catch (error) {
      setFormError(t(`error.${errorCodeOf(error)}`));
      return false;
    }
  }

  useRegisterDraftGuard({ save: submit, discard: onClose });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t("collection.new")}
      className="mb-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-lg font-semibold">{t("collection.new")}</h2>
      <p className="text-sm text-text-muted">{t("collection.notRevenue")}</p>
      {formError ? (
        <StatePanel tone="error" title={formError} hint={t("common.retrySafe")} />
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          id={`${fieldId}-dsr`}
          label={t("summary.dsr")}
          hint={`${t("dues.open")}: ${formatAmount(openTotal)}`}
        >
          <select
            id={`${fieldId}-dsr`}
            value={dsrId}
            onChange={(event) => setDsrId(event.target.value)}
            className={inputClass}
          >
            {dsrs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${fieldId}-date`} label={t("common.date")}>
          <input
            id={`${fieldId}-date`}
            type="date"
            value={collectedDate}
            onChange={(event) => setCollectedDate(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${fieldId}-amount`}
          label={t("collection.amount")}
          error={showErrors ? amountError : undefined}
        >
          <input
            id={`${fieldId}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      {preview.length > 0 ? (
        <div className="text-sm">
          <p className="mb-1 font-medium">{t("collection.allocation")}</p>
          <ul className="text-text-muted">
            {preview.map((a) => {
              const due = dsrDues.find((d) => d.id === a.dueItemId);
              return (
                <li key={a.dueItemId}>
                  {due ? toBengaliDigits(due.businessDate) : ""} ·{" "}
                  {due?.sourceNumber ?? t("dues.opening")} → {formatAmount(a.amount)}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={post.isPending || !online}>
          {post.isPending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
    </form>
  );
}

function DuesTable({ dues }: { dues: MarketDueItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl border-collapse overflow-hidden rounded-lg bg-surface text-sm">
        <thead className="bg-surface-muted text-left">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("common.date")}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("summary.dsr")}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("dues.source")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("dues.original")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("dues.collected")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("dues.remaining")}
            </th>
          </tr>
        </thead>
        <tbody>
          {dues.map((d) => (
            <tr key={d.id} className="border-t border-border">
              <td className="px-4 py-3">{toBengaliDigits(d.businessDate)}</td>
              <td className="px-4 py-3">{d.dsrName}</td>
              <td className="px-4 py-3">{d.sourceNumber ?? t("dues.opening")}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatAmount(d.originalAmount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatAmount(d.collectedAmount)}
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {formatAmount(d.remainingAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OldDues() {
  const { company, permissions } = useCurrentWorkspace();
  const dues = useMarketDues(company.id);
  const collections = useOldDueCollections(company.id);
  const staff = useStaff(company.id);
  const [formOpen, setFormOpen] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);
  const canPost = permissions.includes("collection.post");
  const dsrs = staff.data?.filter((p) => p.kind === "dsr") ?? [];

  if (dues.isPending || collections.isPending) return <ListSkeleton />;
  if (dues.isError) return <QueryError error={dues.error} onRetry={() => void dues.refetch()} />;
  if (collections.isError) {
    return <QueryError error={collections.error} onRetry={() => void collections.refetch()} />;
  }

  const open = dues.data
    .filter((d) => toDecimal(d.remainingAmount).gt(0))
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const openTotal = sumAmounts(open.map((d) => d.remainingAmount));

  return (
    <>
      <PageHeader
        title={t("sales.oldDuesCollection")}
        description={`${t("sales.marketDue")}: ${formatAmount(openTotal)}`}
        actions={
          canPost && !formOpen ? (
            <Button
              variant="primary"
              disabled={!staff.isSuccess || open.length === 0}
              onClick={() => {
                setLastPosted(null);
                setFormOpen(true);
              }}
            >
              {t("collection.new")}
            </Button>
          ) : null
        }
      />
      {lastPosted ? (
        <div className="mb-4">
          <StatePanel title={`${t("common.posted")}: ${lastPosted}`} />
        </div>
      ) : null}
      {formOpen && staff.isSuccess ? (
        <CollectionForm
          companyId={company.id}
          dsrs={dsrs}
          openDues={open}
          onClose={() => setFormOpen(false)}
          onPosted={(number) => {
            setFormOpen(false);
            setLastPosted(number);
          }}
        />
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">{t("dues.open")}</h2>
        {open.length === 0 ? <StatePanel title={t("dues.none")} /> : <DuesTable dues={open} />}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("collection.history")}</h2>
        {collections.data.length === 0 ? (
          <StatePanel title={t("collection.empty")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {[...collections.data]
              .sort((a, b) => b.postingSequence - a.postingSequence)
              .map((c) => (
                <li key={c.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2 font-medium">
                    <span>
                      {c.number} · {toBengaliDigits(c.collectedDate)} · {c.dsrName}
                    </span>
                    <span className="tabular-nums">{formatAmount(c.amount)}</span>
                  </div>
                  <p className="mt-1 text-text-muted">
                    {c.allocations
                      .map(
                        (a) =>
                          `${toBengaliDigits(a.dueDate)} ${a.sourceNumber ?? t("dues.opening")} → ${formatAmount(a.amount)}`,
                      )
                      .join(" · ")}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function OldDuesCollectionPage() {
  return (
    <NavGate path={PATH}>
      <OldDues />
    </NavGate>
  );
}
