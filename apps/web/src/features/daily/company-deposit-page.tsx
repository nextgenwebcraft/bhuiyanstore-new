"use client";

import { moneyKindPermission, type DayView, type StockEntry } from "@bsd/contracts";
import {
  damageRateKey,
  depositInvestmentPreview,
  sumAmounts,
  toBaseQuantity,
  toDecimal,
} from "@bsd/domain";
import { formatCount, formatRate, t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import {
  CartonQty,
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
import { PageHeader } from "@/components/page-header";
import { ReverseCell } from "@/components/reverse-cell";
import { FormSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { TableScroller } from "@/components/table-scroller";
import { describeError } from "@/data/ports/service-error";
import {
  usePostMoneyEntry,
  usePostStockEntries,
  useReverseStockEntry,
  useStockEntries,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useAsyncAction } from "@/lib/async-action";
import {
  CellInput,
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  clean,
  useWorkingDate,
} from "./daily-kit";
import { MoneyEntryTable } from "./money-entry-table";

const PATH = "finance/supplier-deposits";

/** D63/D105: the four kinds of the company deposit form. */
type DepositKind = "supplierDeposit" | "companyIncentive" | "damageDeposit" | "rebateClaim";
const KINDS: readonly DepositKind[] = [
  "supplierDeposit",
  "companyIncentive",
  "damageDeposit",
  "rebateClaim",
];
const KIND_LABEL = {
  supplierDeposit: "money.kind.supplierDeposit",
  companyIncentive: "money.kind.companyIncentive",
  damageDeposit: "deposit.kind.damageDeposit",
  rebateClaim: "money.kind.rebateClaim",
} as const;
const PERMISSION = {
  supplierDeposit: moneyKindPermission.supplierDeposit,
  companyIncentive: moneyKindPermission.companyIncentive,
  damageDeposit: "payment.post",
  rebateClaim: moneyKindPermission.rebateClaim,
} as const;

/** D105: these two kinds may name the product they are for. */
const PRODUCT_KINDS: readonly DepositKind[] = ["companyIncentive", "rebateClaim"];

type DamageRow = { key: number; lotKey: string; cartons: string; pieces: string };
let nextRowKey = 0;
const emptyRow = (): DamageRow => ({
  key: nextRowKey++,
  lotKey: "",
  cartons: "",
  pieces: "",
});
const amountPattern = /^\d+(\.\d{1,2})?$/;

/** One stored damage lot: a product at one rate (D109). */
type HeldLot = {
  key: string;
  productId: string;
  productName: string;
  rate: string;
  pieces: string;
  piecesPerCarton: string;
};

function heldLots(view: DayView): HeldLot[] {
  return view.products.flatMap((product) =>
    product.damageLots
      .filter((lot) => !toDecimal(lot.pieces).lte(0))
      .map((lot) => ({
        key: `${product.productId}|${damageRateKey(lot.rate)}`,
        productId: product.productId,
        productName: product.productName,
        rate: lot.rate,
        pieces: lot.pieces,
        piecesPerCarton: product.piecesPerCarton,
      })),
  );
}

/** One damage row's pieces and taka, or an error message; null when the row is empty. */
function damageLine(
  row: DamageRow,
  lot: HeldLot | undefined,
): { pieces: string; rate: string; amount: string } | { error: string } | null {
  if (!lot) return row.cartons || row.pieces ? { error: t("deposit.damage.pickProduct") } : null;
  const cartons = clean(row.cartons) || "0";
  const pieces = clean(row.pieces) || "0";
  if (!/^\d+$/.test(cartons) || !/^\d+$/.test(pieces))
    return { error: t("validation.wholeNumber") };
  const total = toBaseQuantity(cartons, pieces, lot.piecesPerCarton);
  if (total === "0") return null;
  if (toDecimal(total).gt(lot.pieces)) return { error: t("validation.daily.damageLot") };
  return {
    pieces: total,
    rate: lot.rate,
    amount: toDecimal(total).mul(lot.rate).toDecimalPlaces(2).toFixed(2),
  };
}

function DepositForm({
  companyId,
  date,
  view,
  kinds,
}: {
  companyId: string;
  date: string;
  view: DayView;
  kinds: [DepositKind, ...DepositKind[]];
}) {
  const id = useId();
  const postMoney = usePostMoneyEntry(companyId);
  const postStock = usePostStockEntries(companyId);
  const [kind, setKind] = useState<DepositKind>(kinds[0]);
  const [amount, setAmount] = useState("");
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState<DamageRow[]>(() => [emptyRow()]);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const pending = postMoney.isPending || postStock.isPending;
  const lots = heldLots(view);
  const lotOf = (key: string) => lots.find((lot) => lot.key === key);
  const lines = rows.map((row) => ({ row, line: damageLine(row, lotOf(row.lotKey)) }));
  const damageTotal = sumAmounts([
    "0",
    ...lines.flatMap(({ line }) => (line && !("error" in line) ? [line.amount] : [])),
  ]);
  const totalCash = view.company?.totalCash ?? null;
  const value = clean(amount);
  const investment =
    kind === "supplierDeposit" && totalCash !== null && amountPattern.test(value)
      ? depositInvestmentPreview(value, totalCash)
      : null;

  const setRow = (key: number, patch: Partial<DamageRow>) => {
    setDone(false);
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  async function submit() {
    setError(undefined);
    setDone(false);
    try {
      if (kind === "damageDeposit") {
        const failed = lines.find(({ line }) => line && "error" in line);
        if (failed?.line && "error" in failed.line) return setError(failed.line.error);
        const posting = lines.flatMap(({ row, line }) =>
          line && !("error" in line)
            ? [
                {
                  kind: "damageDeposit" as const,
                  productId: lotOf(row.lotKey)?.productId ?? "",
                  pieces: line.pieces,
                  unitPrice: line.rate,
                },
              ]
            : [],
        );
        if (posting.length === 0) return setError(t("godown.nothing"));
        await postStock.mutateAsync({ date, lines: posting, prices: [] });
        setRows([emptyRow()]);
      } else {
        if (!amountPattern.test(value) || !/[1-9]/.test(value)) {
          return setError(t("validation.amountPositive"));
        }
        await postMoney.mutateAsync({
          date,
          kind,
          amount: value,
          staffId: null,
          expenseCategoryId: null,
          productId: PRODUCT_KINDS.includes(kind) ? productId || null : null,
          allocation: null,
        });
        setAmount("");
        setProductId("");
      }
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={`${id}-kind`} label={t("common.kind")}>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as DepositKind);
              setProductId("");
              setError(undefined);
              setDone(false);
            }}
            className={inputClass}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABEL[k])}
              </option>
            ))}
          </select>
        </Field>
        {kind !== "damageDeposit" ? (
          <Field id={`${id}-amount`} label={t("common.amount")}>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}
        {PRODUCT_KINDS.includes(kind) ? (
          <Field id={`${id}-product`} label={t("godown.column.product")}>
            <select
              id={`${id}-product`}
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClass}
            >
              <option value="">{t("deposit.damage.pickProduct")}</option>
              {view.products.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.productName}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      {kind === "companyIncentive" ? (
        <p className="text-xs text-text-muted">{t("companyAccount.incentiveHint")}</p>
      ) : null}
      {investment && !toDecimal(investment).isZero() ? (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          {t("deposit.investmentWarning")}: <strong>{money(investment)}</strong>
        </p>
      ) : null}
      {kind === "damageDeposit" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">{t("deposit.damage.hint")}</p>
          <TableScroller>
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>
                    {t("godown.column.product")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("deposit.damage.held")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("godown.column.cartons")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("godown.column.pieces")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("deposit.damage.rate")}
                  </th>
                  <th scope="col" className={thNum}>
                    {t("common.amount")}
                  </th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">{t("common.removeLine")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ row, line }) => {
                  const lot = lotOf(row.lotKey);
                  const taken = new Set(
                    rows.filter((other) => other.key !== row.key).map((other) => other.lotKey),
                  );
                  const choices = lots.filter((option) => !taken.has(option.key));
                  return (
                    <tr key={row.key} className="border-t border-border">
                      <td className={tdClass}>
                        <select
                          aria-label={t("godown.column.product")}
                          value={row.lotKey}
                          onChange={(event) =>
                            setRow(row.key, {
                              lotKey: event.target.value,
                              cartons: "",
                              pieces: "",
                            })
                          }
                          className={`${inputClass} min-w-64`}
                        >
                          <option value="">{t("deposit.damage.pickProduct")}</option>
                          {choices.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.productName} — {formatRate(option.rate)} (
                              {formatCount(option.pieces)})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={tdNum}>
                        {lot ? (
                          <CartonQty pieces={lot.pieces} piecesPerCarton={lot.piecesPerCarton} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={tdNum}>
                        <CellInput
                          label={t("godown.column.cartons")}
                          value={row.cartons}
                          onChange={(cartons) => setRow(row.key, { cartons })}
                          width="w-16"
                        />
                      </td>
                      <td className={tdNum}>
                        <CellInput
                          label={t("godown.column.pieces")}
                          value={row.pieces}
                          onChange={(pieces) => setRow(row.key, { pieces })}
                          width="w-16"
                        />
                      </td>
                      <td className={tdNum}>{lot ? formatRate(lot.rate) : "—"}</td>
                      <td className={tdNum}>
                        {line && !("error" in line) ? money(line.amount) : "—"}
                      </td>
                      <td className={tdClass}>
                        {rows.length > 1 ? (
                          <Button
                            onClick={() =>
                              setRows((current) => current.filter((r) => r.key !== row.key))
                            }
                          >
                            {t("common.removeLine")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button onClick={() => setRows((current) => [...current, emptyRow()])}>
              + {t("deposit.damage.addRow")}
            </Button>
            <p className="text-sm">
              {t("deposit.damage.total")}: <strong>{money(damageTotal)}</strong>
            </p>
          </div>
        </div>
      ) : null}
      {error ? <StatePanel tone="error" title={error} /> : null}
      {done ? <StatePanel title={t("common.posted")} /> : null}
      <div>
        <Button variant="primary" disabled={pending} onClick={() => void submit()}>
          {pending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
    </div>
  );
}

function DamageDeposits({
  companyId,
  date,
  view,
}: {
  companyId: string;
  date: string;
  view: DayView;
}) {
  const { permissions } = useCurrentWorkspace();
  const entries = useStockEntries(companyId, date);
  const reverse = useReverseStockEntry(companyId);
  const action = useAsyncAction();
  const canReverse = permissions.includes("purchase.reverse");
  const sizes = new Map(view.products.map((p) => [p.productId, p.piecesPerCarton]));
  if (entries.isPending) return <TableSkeleton rows={2} columns={5} />;
  const rows: StockEntry[] = (entries.data ?? []).filter((e) => e.kind === "damageDeposit");
  if (rows.length === 0) return <EmptyListNote textKey="money.empty" />;
  return (
    <>
      {action.error ? <StatePanel tone="error" title={action.error} /> : null}
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("godown.column.product")}
              </th>
              <th scope="col" className={thNum}>
                {t("godown.column.quantity")}
              </th>
              <th scope="col" className={thNum}>
                {t("deposit.damage.rate")}
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
                <td className={tdClass}>{entry.productName}</td>
                <td className={tdNum}>
                  <CartonQty
                    pieces={entry.pieces}
                    piecesPerCarton={sizes.get(entry.productId) ?? "1"}
                  />
                </td>
                <td className={tdNum}>{entry.unitPrice ? formatRate(entry.unitPrice) : "—"}</td>
                <td className={tdNum}>
                  {money(
                    toDecimal(entry.pieces)
                      .mul(entry.unitPrice ?? "0")
                      .toString(),
                  )}
                </td>
                <td className={tdClass}>
                  <StatusChip status={entry.status} />
                </td>
                <ReverseCell
                  canReverse={canReverse}
                  posted={entry.status === "posted"}
                  pending={reverse.isPending}
                  onReverse={() =>
                    void action.run(() => reverse.mutateAsync(entry.id), {
                      confirm: "godown.reverseConfirm",
                    })
                  }
                />
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </>
  );
}

/** The company balance, its parts and our total cash at the end of the chosen date (D63). */
function Balances({ company }: { company: NonNullable<DayView["company"]> }) {
  return (
    <dl className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label={t("godown.company.balance")}
        value={money(company.balance)}
        hint={t("companyAccount.balanceHint")}
        emphasis
        large
      />
      <StatTile
        label={t("report.column.totalCash")}
        value={money(company.totalCash)}
        hint={t("deposit.totalCashHint")}
        large
      />
      <StatTile label={t("report.column.damageBalance")} value={money(company.damageBalance)} />
      <StatTile
        label={t("report.column.incentiveBalance")}
        value={money(company.incentiveBalance)}
      />
    </dl>
  );
}

/**
 * Money and damaged goods given to the company (D63): কোম্পানিতে জমা, the company's money
 * incentive and ড্যামেজ জমা all raise the company balance; only the deposit leaves our cash.
 */
export function SupplierDepositsPage() {
  const { company, permissions } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const [first, ...rest] = KINDS.filter((k) => permissions.includes(PERMISSION[k]));
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("finance.supplierDeposit")}
        description={t("money.description.supplierDeposit")}
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
            {view.company ? <Balances company={view.company} /> : null}
            {first ? (
              <DepositForm
                key={date}
                companyId={company.id}
                date={date}
                view={view}
                kinds={[first, ...rest]}
              />
            ) : null}
            <SectionTitle>{t("money.posted")}</SectionTitle>
            <MoneyEntryTable
              companyId={company.id}
              date={date}
              kinds={["supplierDeposit", "companyIncentive", "rebateClaim"]}
              columns={[
                {
                  label: "common.kind",
                  cell: (e) => t(`money.kind.${e.kind}` as TranslationKey),
                },
                { label: "common.amount", numeric: true, cell: (e) => money(e.amount) },
                { label: "godown.column.product", cell: (e) => e.productName ?? "—" },
              ]}
            />
            <SectionTitle>{t("deposit.kind.damageDeposit")}</SectionTitle>
            <DamageDeposits companyId={company.id} date={date} view={view} />
          </>
        )}
      </DayGate>
    </NavGate>
  );
}
