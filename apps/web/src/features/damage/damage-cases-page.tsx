"use client";

import type { DamageCase, DamageEventKindId, PermissionId } from "@bsd/contracts";
import { allocationCost, businessDateOf, sumAmounts, sumQuantities } from "@bsd/domain";
import { formatBusinessDate, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary } from "@/components/table-summary";
import { describeError } from "@/data/ports/service-error";
import {
  useCreateDamageCase,
  useDamageCaseCommand,
  useDamageCases,
  useDayView,
  useProducts,
} from "@/data/queries";
import {
  CellInput,
  clean,
  money,
  quantity,
  tableClass,
  TableScroller,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/**
 * Damaged pieces handed to the company and what came back (D17, D33): money, which lowers what
 * we owe the company, or replacement goods. Each send is one case posted with its dispatch; a
 * return accepts and settles the pieces in one step. The buyer leg is not shown.
 */

const PAGE_SIZE = 20;
const PIECES = /^[1-9]\d*$/;
const PRICE = /^\d+(\.\d{1,4})?$/;

const SEND: PermissionId[] = ["damage.report", "damage.claim_settle"];
const RETURN: PermissionId[] = ["damage.claim_settle", "inventory.cost_view"];
const RETURN_KINDS = ["companyRefund", "companyReplacement"] as const;
type ReturnKind = (typeof RETURN_KINDS)[number];
const isReturn = (kind: DamageEventKindId): kind is ReturnKind =>
  (RETURN_KINDS as readonly string[]).includes(kind);

type Row = { item: DamageCase; line: DamageCase["lines"][number] };

/** Pieces sent and not yet settled by money or goods. */
const openPieces = (line: Row["line"]) =>
  sumQuantities([line.progress.awaitingAcceptance, line.progress.companyPending]);

function SendForm({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const id = useId();
  const today = businessDateOf(new Date());
  const products = useProducts(companyId);
  const create = useCreateDamageCase(companyId);
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState([{ productId: "", quantity: "" }]);
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setError(undefined);
    const filled = lines
      .map((l) => ({ productId: l.productId, quantity: clean(l.quantity) }))
      .filter((l) => l.productId || l.quantity);
    if (filled.length === 0 || filled.some((l) => !l.productId || !PIECES.test(l.quantity))) {
      setError(t("damage.lineInvalid"));
      return;
    }
    try {
      await create.mutateAsync({
        caseNumber: "",
        date,
        origin: "ownedStock",
        staffId: null,
        note: "",
        sentToCompany: true,
        lines: filled,
      });
      setLines([{ productId: "", quantity: "" }]);
      onDone();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t("damage.send.title")}</h2>
      <Field id={`${id}-date`} label={t("damage.send.date")}>
        <DatePicker id={`${id}-date`} value={date} onChange={setDate} max={today} />
      </Field>
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t("report.column.product")}
              value={line.productId}
              onChange={(event) =>
                setLines(
                  lines.map((l, i) => (i === index ? { ...l, productId: event.target.value } : l)),
                )
              }
              className={`${inputClass} w-64`}
            >
              <option value="">{t("common.select")}</option>
              {(products.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
            <CellInput
              label={t("common.pieces")}
              placeholder={t("common.pieces")}
              value={line.quantity}
              width="w-24"
              onChange={(value) =>
                setLines(lines.map((l, i) => (i === index ? { ...l, quantity: value } : l)))
              }
            />
            {lines.length > 1 ? (
              <Button onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                {t("common.removeLine")}
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button onClick={() => setLines([...lines, { productId: "", quantity: "" }])}>
            {t("common.addLine")}
          </Button>
        </div>
      </div>
      {error ? <StatePanel tone="error" title={error} /> : null}
      <div>
        <Button variant="primary" disabled={create.isPending} onClick={() => void submit()}>
          {create.isPending ? t("common.saving") : t("damage.send.submit")}
        </Button>
      </div>
    </div>
  );
}

/** Price per piece on the send date, prefilled from that day's purchase price. */
function useSendDayCost(companyId: string, row: Row) {
  const day = useDayView(companyId, row.item.date);
  const product = day.data?.products.find((p) => p.productId === row.line.productId);
  return product?.costPrice ?? null;
}

function ReturnDialog({
  companyId,
  row,
  onClose,
}: {
  companyId: string;
  row: Row;
  onClose: () => void;
}) {
  const id = useId();
  const today = businessDateOf(new Date());
  const command = useDamageCaseCommand(companyId);
  const dayCost = useSendDayCost(companyId, row);
  const remaining = openPieces(row.line);
  const [kind, setKind] = useState<ReturnKind>("companyRefund");
  const [date, setDate] = useState(today);
  const [pieces, setPieces] = useState(remaining);
  const [unitCost, setUnitCost] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const cost = unitCost ?? dayCost ?? "";
  const total =
    PIECES.test(clean(pieces)) && PRICE.test(clean(cost))
      ? allocationCost([{ quantity: clean(pieces), unitCost: clean(cost) }])
      : null;

  async function submit() {
    setError(undefined);
    const qty = clean(pieces);
    const price = clean(cost);
    if (!PIECES.test(qty)) {
      setError(t("damage.lineInvalid"));
      return;
    }
    if (!PRICE.test(price)) {
      setError(t("validation.damage.unitCostRequired"));
      return;
    }
    if (!window.confirm(t("damage.return.confirm"))) return;
    try {
      await command.mutateAsync({
        action: "event",
        caseId: row.item.id,
        input: {
          date,
          lineId: row.line.id,
          kind,
          quantity: qty,
          fromStock: false,
          unitCost: price,
          autoAccept: true,
          reference: "",
          note: "",
        },
      });
      onClose();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open
      title={`${t("damage.return.title")}: ${row.line.productName}`}
      error={error}
      pending={command.isPending}
      submitLabel={t("damage.return.submit")}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className="text-sm text-text-muted">
        {t("damage.return.sentOn")} {formatBusinessDate(row.item.date)} ·{" "}
        {t("damage.return.remaining")} {quantity(remaining)} {t("common.pieces")}
      </p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t("damage.return.kind")}</legend>
        {RETURN_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-kind`}
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {t(`damage.return.${k}`)}
          </label>
        ))}
      </fieldset>
      <Field id={`${id}-date`} label={t("damage.return.date")}>
        <DatePicker
          id={`${id}-date`}
          value={date}
          onChange={setDate}
          min={row.item.date}
          max={today}
        />
      </Field>
      <Field id={`${id}-pieces`} label={t("common.pieces")}>
        <input
          id={`${id}-pieces`}
          inputMode="numeric"
          value={pieces}
          onChange={(event) => setPieces(event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field
        id={`${id}-cost`}
        label={t("damage.return.unitCost")}
        hint={t("damage.return.costHint")}
      >
        <input
          id={`${id}-cost`}
          inputMode="decimal"
          value={cost}
          onChange={(event) => setUnitCost(event.target.value)}
          className={inputClass}
        />
      </Field>
      {total !== null ? (
        <p className="text-sm">
          {t(kind === "companyRefund" ? "damage.return.moneyTotal" : "damage.return.goodsTotal")}{" "}
          <span className="font-semibold tabular-nums">{money(total)}</span>
        </p>
      ) : null}
    </FormDialog>
  );
}

function ReturnHistory({ row }: { row: Row }) {
  const { company, permissions } = useCurrentWorkspace();
  const command = useDamageCaseCommand(company.id);
  const [error, setError] = useState<string | undefined>();
  const canReverse = RETURN.every((p) => permissions.includes(p));
  const returns = row.item.events.filter(
    (e) => e.lineId === row.line.id && e.status === "posted" && isReturn(e.kind),
  );
  if (returns.length === 0) return null;

  async function undo(eventId: string) {
    setError(undefined);
    if (!window.confirm(t("damage.reverseConfirm"))) return;
    try {
      await command.mutateAsync({ action: "reverse", eventId });
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <ul className="flex flex-col gap-1 text-xs text-text-muted">
      {returns.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2">
          <span>
            {formatBusinessDate(e.date)} · {t(`damage.event.${e.kind}`)} · {quantity(e.quantity)}{" "}
            {t("common.pieces")}
            {e.unitCost !== null
              ? ` · ${money(allocationCost([{ quantity: e.quantity, unitCost: e.unitCost }]))}`
              : ""}
          </span>
          {canReverse ? (
            <button
              type="button"
              disabled={command.isPending}
              onClick={() => void undo(e.id)}
              className="text-brand underline-offset-2 hover:underline disabled:opacity-50"
            >
              {t("godown.reverse")}
            </button>
          ) : null}
        </li>
      ))}
      {error ? <li className="text-error">{error}</li> : null}
    </ul>
  );
}

/** A send entered by mistake: while nothing came back, reverse its dispatches and cancel it. */
function UndoSend({ item }: { item: DamageCase }) {
  const { company, permissions } = useCurrentWorkspace();
  const command = useDamageCaseCommand(company.id);
  const [error, setError] = useState<string | undefined>();
  const posted = item.events.filter((e) => e.status === "posted");
  const onlySent = posted.length > 0 && posted.every((e) => e.kind === "companyDispatch");
  if (!onlySent || !SEND.every((p) => permissions.includes(p))) return null;

  async function undo() {
    setError(undefined);
    const names = item.lines.map((l) => l.productName).join(", ");
    if (!window.confirm(`${t("damage.undo.confirm")}\n${names}`)) return;
    try {
      for (const event of posted) {
        await command.mutateAsync({ action: "reverse", eventId: event.id });
      }
      await command.mutateAsync({ action: "cancel", caseId: item.id });
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={command.isPending}
        onClick={() => void undo()}
        className="text-xs text-text-muted underline-offset-2 hover:underline disabled:opacity-50"
      >
        {t("damage.undo.action")}
      </button>
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </>
  );
}

function lineStatus(line: Row["line"]): string {
  const settled = sumQuantities([line.progress.companyRefunded, line.progress.companyReplaced]);
  if (openPieces(line) === "0") return t("damage.row.returned");
  return settled === "0" ? t("damage.row.waiting") : t("damage.row.partial");
}

function moneyBack(item: DamageCase, lineId: string): string {
  return sumAmounts(
    item.events
      .filter(
        (e) =>
          e.lineId === lineId &&
          e.status === "posted" &&
          e.kind === "companyRefund" &&
          e.unitCost !== null,
      )
      .map((e) => allocationCost([{ quantity: e.quantity, unitCost: e.unitCost ?? "0" }])),
  );
}

export function DamageCasesPage({ path }: { path: string }) {
  const id = useId();
  const { company, permissions } = useCurrentWorkspace();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [sending, setSending] = useState(false);
  const [returning, setReturning] = useState<Row | null>(null);
  const cases = useDamageCases(company.id, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const canSend = SEND.every((p) => permissions.includes(p));
  const canReturn = RETURN.every((p) => permissions.includes(p));

  const rows: Row[] = (cases.data ?? [])
    .filter((c) => c.status !== "cancelled")
    .flatMap((item) =>
      item.lines.filter((line) => line.progress.sent !== "0").map((line) => ({ item, line })),
    );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  return (
    <NavGate path={path}>
      <PageHeader
        title={t("nav.inventory.claims")}
        description={t("damage.description")}
        actions={
          canSend ? (
            <Button variant="primary" onClick={() => setSending((s) => !s)}>
              {sending ? t("common.cancel") : `+ ${t("damage.send.title")}`}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {sending ? <SendForm companyId={company.id} onDone={() => setSending(false)} /> : null}
        <div className="flex flex-wrap items-end gap-3">
          <Field id={`${id}-from`} label={t("damage.filter.from")}>
            <DatePicker
              id={`${id}-from`}
              value={from}
              onChange={filter(setFrom)}
              max={to || undefined}
              clearable
              placeholder={t("damage.filter.any")}
            />
          </Field>
          <Field id={`${id}-to`} label={t("damage.filter.to")}>
            <DatePicker
              id={`${id}-to`}
              value={to}
              onChange={filter(setTo)}
              min={from || undefined}
              clearable
              placeholder={t("damage.filter.any")}
            />
          </Field>
        </div>
        {cases.isPending ? (
          <TableSkeleton rows={6} columns={6} />
        ) : cases.isError ? (
          <QueryError error={cases.error} onRetry={() => void cases.refetch()} />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            {t("damage.empty")}
          </p>
        ) : (
          <>
            <TableSummary
              label={t("table.summary")}
              items={[
                { label: t("table.summary.rows"), value: quantity(String(rows.length)) },
                {
                  label: t("damage.summary.sent"),
                  value: quantity(sumQuantities(rows.map((r) => r.line.progress.sent))),
                },
                {
                  label: t("damage.summary.waiting"),
                  value: quantity(sumQuantities(rows.map((r) => openPieces(r.line)))),
                },
                {
                  label: t("damage.summary.goods"),
                  value: quantity(sumQuantities(rows.map((r) => r.line.progress.companyReplaced))),
                },
                {
                  label: t("damage.summary.money"),
                  value: money(sumAmounts(rows.map((r) => moneyBack(r.item, r.line.id)))),
                  emphasis: true,
                },
              ]}
            />
            <TableScroller>
              <table className={tableClass}>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>
                      {t("damage.send.date")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("report.column.product")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("damage.row.sent")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("damage.summary.money")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("common.status")}
                    </th>
                    <th scope="col" className={thClass}>
                      <span className="sr-only">{t("damage.return.submit")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const open = openPieces(row.line) !== "0";
                    return (
                      <tr key={row.line.id} className="border-t border-border align-top">
                        <td className={`${tdClass} whitespace-nowrap`}>
                          {formatBusinessDate(row.item.date)}
                        </td>
                        <td className={tdClass}>
                          <div className="font-medium">{row.line.productName}</div>
                          <ReturnHistory row={row} />
                        </td>
                        <td className={tdNum}>{quantity(row.line.progress.sent)}</td>
                        <td className={tdNum}>{money(moneyBack(row.item, row.line.id))}</td>
                        <td className={tdClass}>{lineStatus(row.line)}</td>
                        <td className={`${tdClass} text-right`}>
                          <div className="flex flex-col items-end gap-1">
                            {open && canReturn && row.item.status === "open" ? (
                              <Button onClick={() => setReturning(row)}>
                                {t("damage.return.submit")}
                              </Button>
                            ) : null}
                            <UndoSend item={row.item} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
            <Pager page={current} pages={pages} onChange={setPage} />
          </>
        )}
      </div>
      {returning ? (
        <ReturnDialog
          key={returning.line.id}
          companyId={company.id}
          row={returning}
          onClose={() => setReturning(null)}
        />
      ) : null}
    </NavGate>
  );
}
