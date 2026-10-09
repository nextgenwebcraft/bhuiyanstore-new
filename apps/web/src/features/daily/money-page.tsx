"use client";

import {
  moneyAllocationKinds,
  moneyCategoryKinds,
  moneyKindPermission,
  moneyKindPerson,
  srLoanTypeKinds,
  srLoanTypes,
  type DayView,
  type MoneyEntry,
  type MoneyEntryKind,
  type SrLoanType,
  type StaffRecord,
} from "@bsd/contracts";
import { MONEY_KIND_EFFECTS } from "@bsd/domain";
import { t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { FormSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import {
  useConfigList,
  useMoneyEntries,
  usePostMoneyEntry,
  useReverseMoneyEntry,
  useStaffRecords,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  CellInput,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  StatusChip,
  clean,
  money,
  tableClass,
  TableScroller,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "./daily-kit";

const kindLabel = (kind: MoneyEntryKind) => t(`money.kind.${kind}` as TranslationKey);
const entryLabel = (entry: MoneyEntry) =>
  entry.srLoanType
    ? `${kindLabel(entry.kind)} · ${t(`money.srLoanType.${entry.srLoanType}`)}`
    : kindLabel(entry.kind);

const EMPTY_ALLOCATION = { advance: "", loan: "", shortage: "" };

/** People who may take an entry of this kind on the date (same rule as the server). */
function peopleFor(records: StaffRecord[], companyId: string, date: string, kind: MoneyEntryKind) {
  const person = moneyKindPerson[kind];
  if (!person) return [];
  return records.filter((s) =>
    s.assignments.some(
      (a) =>
        a.companyId === companyId &&
        a.from <= date &&
        (a.to === null || a.to >= date) &&
        (person === "distributor" ? a.roleKind !== "sr" : a.roleKind === person),
    ),
  );
}

function EntryForm({
  companyId,
  date,
  kinds,
}: {
  companyId: string;
  date: string;
  kinds: [MoneyEntryKind, ...MoneyEntryKind[]];
}) {
  const id = useId();
  const records = useStaffRecords(companyId);
  const categories = useConfigList("expenseCategories");
  const post = usePostMoneyEntry(companyId);
  const [kind, setKind] = useState(kinds[0]);
  const [amount, setAmount] = useState("");
  const [staffId, setStaffId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [split, setSplit] = useState(false);
  const [allocation, setAllocation] = useState(EMPTY_ALLOCATION);
  const [loanType, setLoanType] = useState<SrLoanType | "">("");
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const people = peopleFor(records.data ?? [], companyId, date, kind);
  const needsLoanType = srLoanTypeKinds.includes(kind);
  const needsPerson = Boolean(moneyKindPerson[kind]);
  const personRequired = MONEY_KIND_EFFECTS[kind].requiresStaff;
  const needsCategory = moneyCategoryKinds.includes(kind);
  const canSplit = moneyAllocationKinds.includes(kind);

  async function submit() {
    setError(undefined);
    setDone(false);
    const value = clean(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
      setError(t("validation.amountPositive"));
      return;
    }
    if (personRequired && !staffId) {
      setError(t("validation.daily.staffRequired"));
      return;
    }
    if (needsCategory && !categoryId) {
      setError(t("validation.daily.categoryRequired"));
      return;
    }
    if (needsLoanType && !loanType) {
      setError(t("validation.money.srLoanTypeRequired"));
      return;
    }
    const parts = {
      advance: clean(allocation.advance) || "0",
      loan: clean(allocation.loan) || "0",
      shortage: clean(allocation.shortage) || "0",
    };
    if (canSplit && split && Object.values(parts).some((p) => !/^\d+(\.\d{1,2})?$/.test(p))) {
      setError(t("validation.opening.amount"));
      return;
    }
    try {
      await post.mutateAsync({
        date,
        kind,
        amount: value,
        staffId: needsPerson && staffId ? staffId : null,
        expenseCategoryId: needsCategory ? categoryId : null,
        allocation: canSplit && split ? parts : null,
        srLoanType: needsLoanType && loanType ? loanType : null,
      });
      setAmount("");
      setAllocation(EMPTY_ALLOCATION);
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kinds.length > 1 ? (
          <Field id={`${id}-kind`} label={t("common.kind")}>
            <select
              id={`${id}-kind`}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as MoneyEntryKind);
                setStaffId("");
                setDone(false);
              }}
              className={inputClass}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field id={`${id}-amount`} label={t("common.amount")}>
          <input
            id={`${id}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </Field>
        {needsPerson ? (
          <Field
            id={`${id}-staff`}
            label={t(`money.person.${moneyKindPerson[kind]}` as TranslationKey)}
            hint={personRequired ? undefined : t("common.optional")}
          >
            <select
              id={`${id}-staff`}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {people.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {needsCategory ? (
          <Field id={`${id}-category`} label={t("money.category")}>
            <select
              id={`${id}-category`}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {(categories.data ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
        {needsLoanType ? (
          <Field
            id={`${id}-loan-type`}
            label={t("money.srLoanType")}
            hint={t(
              kind === "srRepayment" ? "money.srLoanType.repayHint" : "money.srLoanType.hint",
            )}
          >
            <select
              id={`${id}-loan-type`}
              value={loanType}
              onChange={(event) => setLoanType(event.target.value as SrLoanType | "")}
              className={inputClass}
            >
              <option value="">—</option>
              {srLoanTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`money.srLoanType.${type}`)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      {canSplit ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={split}
              onChange={(event) => setSplit(event.target.checked)}
            />
            {t("money.split")}
          </label>
          {split ? (
            <div className="flex flex-wrap items-center gap-3">
              {(["advance", "loan", "shortage"] as const).map((bucket) => (
                <label key={bucket} className="flex items-center gap-2 text-sm">
                  {t(`report.column.${bucket}`)}
                  <CellInput
                    label={t(`report.column.${bucket}`)}
                    value={allocation[bucket]}
                    mode="decimal"
                    width="w-28"
                    onChange={(v) => setAllocation({ ...allocation, [bucket]: v })}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">{t("money.splitHint")}</p>
          )}
        </div>
      ) : null}
      {needsPerson && people.length === 0 && records.isSuccess ? (
        <p className="text-xs text-text-muted">{t("money.noPeople")}</p>
      ) : null}
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

function EntryList({
  companyId,
  date,
  kinds,
}: {
  companyId: string;
  date: string;
  kinds: MoneyEntryKind[];
}) {
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
  const rows = entries.data.filter((e) => kinds.includes(e.kind));
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
                  {t("common.kind")}
                </th>
                <th scope="col" className={thClass}>
                  {t("money.party")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.amount")}
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
                  <td className={tdClass}>{entryLabel(entry)}</td>
                  <td className={tdClass}>{entry.staffName ?? entry.categoryName ?? "—"}</td>
                  <td className={tdNum}>{money(entry.amount)}</td>
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

export function MoneyEntriesPage({
  path,
  title,
  description,
  kinds,
  aside,
}: {
  path: string;
  title: TranslationKey;
  description: TranslationKey;
  kinds: MoneyEntryKind[];
  /** Engine figures shown above the form (e.g. outstanding market due). */
  aside?: (view: DayView) => React.ReactNode;
}) {
  const { company, permissions } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const [first, ...rest] = kinds.filter((k) => permissions.includes(moneyKindPermission[k]));
  return (
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={<DateBar date={date} onChange={setDate} />}
      />
      <DateHeading date={date} />
      <DayGate
        companyId={company.id}
        date={date}
        skeleton={
          <div className="flex flex-col gap-6">
            <FormSkeleton fields={4} />
            <TableSkeleton rows={3} columns={5} title />
          </div>
        }
      >
        {(view) => (
          <>
            {aside?.(view)}
            {first ? (
              <EntryForm key={date} companyId={company.id} date={date} kinds={[first, ...rest]} />
            ) : null}
            <SectionTitle>{t("money.posted")}</SectionTitle>
            <EntryList companyId={company.id} date={date} kinds={kinds} />
          </>
        )}
      </DayGate>
    </NavGate>
  );
}
