"use client";

import {
  damageEventKinds,
  damageOrigins,
  type DamageCase,
  type DamageEventKindId,
  type DamageOriginId,
  type PermissionId,
} from "@bsd/contracts";
import { formatBusinessDate, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import {
  useCreateDamageCase,
  useDamageCaseCommand,
  useDamageCases,
  useProducts,
  useStaffRecords,
} from "@/data/queries";
import {
  CartonQty,
  CellInput,
  ColumnHead,
  DateBar,
  StatusChip,
  cartonText,
  clean,
  money,
  stickyCell,
  stickyHead,
  tableClass,
  TableScroller,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/** Who may post each leg; mirrors the server (guide §12.2). */
const EVENT_PERMISSIONS: Record<DamageEventKindId, PermissionId[]> = {
  buyerReplacement: ["damage.report"],
  companyDispatch: ["damage.claim_settle"],
  companyAccept: ["damage.claim_settle"],
  companyReject: ["damage.claim_settle"],
  companyReplacement: ["damage.claim_settle", "inventory.cost_view"],
  writeOff: ["damage.approve"],
};

const PIECES = /^[1-9]\d*$/;

const PROGRESS_KEYS = [
  "received",
  "buyerReplaced",
  "buyerPending",
  "sent",
  "awaitingAcceptance",
  "accepted",
  "rejected",
  "companyReplaced",
  "companyPending",
  "writtenOff",
  "stillHere",
] as const;

function CreateCaseForm({ companyId, date }: { companyId: string; date: string }) {
  const id = useId();
  const products = useProducts(companyId);
  const staff = useStaffRecords(companyId);
  const create = useCreateDamageCase(companyId);
  const [caseNumber, setCaseNumber] = useState("");
  const [origin, setOrigin] = useState<DamageOriginId>("buyerExchange");
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ productId: "", quantity: "" }]);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const dsrs = (staff.data ?? []).filter((s) =>
    s.assignments.some(
      (a) =>
        a.companyId === companyId &&
        a.roleKind === "dsr" &&
        a.from <= date &&
        (a.to === null || a.to >= date),
    ),
  );

  async function submit() {
    setError(undefined);
    setDone(false);
    const filled = lines
      .map((l) => ({ productId: l.productId, quantity: clean(l.quantity) }))
      .filter((l) => l.productId || l.quantity);
    if (!caseNumber.trim() || filled.length === 0) {
      setError(t("damage.caseRequired"));
      return;
    }
    if (filled.some((l) => !l.productId || !PIECES.test(l.quantity))) {
      setError(t("damage.lineInvalid"));
      return;
    }
    try {
      await create.mutateAsync({
        caseNumber: caseNumber.trim(),
        date,
        origin,
        staffId: origin === "buyerExchange" && staffId ? staffId : null,
        note: note.trim(),
        lines: filled,
      });
      setCaseNumber("");
      setNote("");
      setLines([{ productId: "", quantity: "" }]);
      setDone(true);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t("damage.newCase")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${id}-number`} label={t("damage.caseNumber")}>
          <input
            id={`${id}-number`}
            value={caseNumber}
            maxLength={60}
            onChange={(event) => setCaseNumber(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-origin`} label={t("damage.origin")}>
          <select
            id={`${id}-origin`}
            value={origin}
            onChange={(event) => setOrigin(event.target.value as DamageOriginId)}
            className={inputClass}
          >
            {damageOrigins.map((o) => (
              <option key={o} value={o}>
                {t(`damage.origin.${o}`)}
              </option>
            ))}
          </select>
        </Field>
        {origin === "buyerExchange" ? (
          <Field id={`${id}-staff`} label={t("money.person.dsr")} hint={t("common.optional")}>
            <select
              id={`${id}-staff`}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {dsrs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field id={`${id}-note`} label={t("dsr.sheet.note")} hint={t("common.optional")}>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
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
              onChange={(quantity) =>
                setLines(lines.map((l, i) => (i === index ? { ...l, quantity } : l)))
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
      {done ? <StatePanel title={t("common.posted")} /> : null}
      <div>
        <Button variant="primary" disabled={create.isPending} onClick={() => void submit()}>
          {create.isPending ? t("common.saving") : t("damage.createCase")}
        </Button>
      </div>
    </div>
  );
}

function EventForm({ item, date }: { item: DamageCase; date: string }) {
  const id = useId();
  const { company, permissions } = useCurrentWorkspace();
  const command = useDamageCaseCommand(company.id);
  const kinds = damageEventKinds.filter(
    (k) =>
      EVENT_PERMISSIONS[k].every((p) => permissions.includes(p)) &&
      (k !== "buyerReplacement" || item.origin === "buyerExchange"),
  );
  const [lineId, setLineId] = useState(item.lines[0]?.id ?? "");
  const [kind, setKind] = useState<DamageEventKindId | "">(kinds[0] ?? "");
  const [quantity, setQuantity] = useState("");
  const [fromStock, setFromStock] = useState(true);
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | undefined>();

  if (!kind) return null;

  async function submit() {
    setError(undefined);
    const pieces = clean(quantity);
    if (!PIECES.test(pieces)) {
      setError(t("damage.lineInvalid"));
      return;
    }
    const cost = clean(unitCost);
    if (kind === "companyReplacement" && !/^\d+(\.\d{1,4})?$/.test(cost)) {
      setError(t("validation.damage.unitCostRequired"));
      return;
    }
    try {
      await command.mutateAsync({
        action: "event",
        caseId: item.id,
        input: {
          date,
          lineId,
          kind: kind as DamageEventKindId,
          quantity: pieces,
          fromStock: kind === "buyerReplacement" && fromStock,
          unitCost: kind === "companyReplacement" ? cost : null,
          reference: reference.trim(),
          note: "",
        },
      });
      setQuantity("");
      setUnitCost("");
      setReference("");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`${id}-line`} label={t("report.column.product")} className="w-56">
          <select
            id={`${id}-line`}
            value={lineId}
            onChange={(event) => setLineId(event.target.value)}
            className={inputClass}
          >
            {item.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.sku} · {l.productName}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-kind`} label={t("common.kind")} className="w-56">
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as DamageEventKindId)}
            className={inputClass}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`damage.event.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-qty`} label={t("common.pieces")} className="w-28">
          <input
            id={`${id}-qty`}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={inputClass}
          />
        </Field>
        {kind === "companyReplacement" ? (
          <Field id={`${id}-cost`} label={t("damage.unitCost")} className="w-32">
            <input
              id={`${id}-cost`}
              inputMode="decimal"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}
        <Field id={`${id}-ref`} label={t("common.reference")} className="w-40">
          <input
            id={`${id}-ref`}
            value={reference}
            maxLength={100}
            onChange={(event) => setReference(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Button variant="primary" disabled={command.isPending} onClick={() => void submit()}>
          {command.isPending ? t("common.posting") : t("common.post")}
        </Button>
      </div>
      {kind === "buyerReplacement" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fromStock}
            onChange={(event) => setFromStock(event.target.checked)}
          />
          {t("damage.fromStock")}
        </label>
      ) : null}
      {error ? <StatePanel tone="error" title={error} /> : null}
    </div>
  );
}

function CaseCard({ item, date }: { item: DamageCase; date: string }) {
  const { company, permissions } = useCurrentWorkspace();
  const command = useDamageCaseCommand(company.id);
  const [error, setError] = useState<string | undefined>();
  const posted = item.events.filter((e) => e.status === "posted");

  async function run(
    action: { action: "reverse"; eventId: string } | { action: "cancel"; caseId: string },
    confirmKey: "damage.reverseConfirm" | "damage.cancelConfirm",
  ) {
    setError(undefined);
    if (!window.confirm(t(confirmKey))) return;
    try {
      await command.mutateAsync(action);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">{item.caseNumber}</h3>
        <span className="text-sm text-text-muted">
          {formatBusinessDate(item.date)} · {t(`damage.origin.${item.origin}`)}
          {item.staffName ? ` · ${item.staffName}` : ""}
        </span>
        <span className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-medium">
          {t(`damage.status.${item.status}`)}
        </span>
        {item.status === "open" && posted.length === 0 && permissions.includes("damage.report") ? (
          <Button
            className="ml-auto"
            disabled={command.isPending}
            onClick={() => void run({ action: "cancel", caseId: item.id }, "damage.cancelConfirm")}
          >
            {t("damage.cancelCase")}
          </Button>
        ) : null}
      </div>
      {item.note ? <p className="text-sm text-text-muted">{item.note}</p> : null}
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={`${thClass} ${stickyHead}`}>
                {t("report.column.product")}
              </th>
              {PROGRESS_KEYS.map((k) => (
                <ColumnHead key={k} label={t(`damage.progress.${k}`)} quantity />
              ))}
            </tr>
          </thead>
          <tbody>
            {item.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className={`${tdClass} ${stickyCell}`}>{line.productName}</td>
                {PROGRESS_KEYS.map((k) => (
                  <td key={k} className={tdNum}>
                    <CartonQty pieces={line.progress[k]} piecesPerCarton={line.piecesPerCarton} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {item.status === "open" ? <EventForm item={item} date={date} /> : null}
      {item.events.length ? (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  {t("common.date")}
                </th>
                <th scope="col" className={thClass}>
                  {t("common.kind")}
                </th>
                <th scope="col" className={thClass}>
                  {t("report.column.product")}
                </th>
                <th scope="col" className={thNum}>
                  {t("common.pieces")}
                </th>
                <th scope="col" className={thNum}>
                  {t("damage.unitCost")}
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
              {item.events.map((event) => (
                <tr key={event.id} className="border-t border-border">
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatBusinessDate(event.date)}
                  </td>
                  <td className={tdClass}>
                    {t(`damage.event.${event.kind}`)}
                    {event.fromStock ? (
                      <div className="text-xs text-text-muted">{t("damage.fromStock")}</div>
                    ) : null}
                    {event.reference ? (
                      <div className="text-xs text-text-muted">{event.reference}</div>
                    ) : null}
                  </td>
                  <td className={tdClass}>{event.productName}</td>
                  <td className={tdNum}>{cartonText(event.quantity, "1")}</td>
                  <td className={tdNum}>{event.unitCost === null ? "—" : money(event.unitCost)}</td>
                  <td className={tdClass}>
                    <StatusChip status={event.status} />
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {event.status === "posted" &&
                    EVENT_PERMISSIONS[event.kind].every((p) => permissions.includes(p)) ? (
                      <Button
                        disabled={command.isPending}
                        onClick={() =>
                          void run(
                            { action: "reverse", eventId: event.id },
                            "damage.reverseConfirm",
                          )
                        }
                      >
                        {t("godown.reverse")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      ) : null}
      {error ? <StatePanel tone="error" title={error} /> : null}
    </section>
  );
}

/** Damage cases with independent buyer and company replacement legs (D17). */
export function DamageCasesPage({ path }: { path: string }) {
  const { company, permissions } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const [status, setStatus] = useState<"open" | "all">("open");
  const cases = useDamageCases(company.id, status);

  return (
    <NavGate path={path}>
      <PageHeader
        title={t("nav.inventory.claims")}
        description={t("damage.description")}
        actions={<DateBar date={date} onChange={setDate} />}
      />
      <div className="flex flex-col gap-6">
        {permissions.includes("damage.report") ? (
          <CreateCaseForm key={date} companyId={company.id} date={date} />
        ) : null}
        <div role="tablist" className="flex gap-2">
          {(["open", "all"] as const).map((s) => (
            <Button
              key={s}
              role="tab"
              aria-selected={status === s}
              variant={status === s ? "primary" : "secondary"}
              onClick={() => setStatus(s)}
            >
              {t(`damage.filter.${s}`)}
            </Button>
          ))}
        </div>
        {cases.isPending ? (
          <ListSkeleton rows={3} action />
        ) : cases.isError ? (
          <QueryError error={cases.error} onRetry={() => void cases.refetch()} />
        ) : cases.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            {t("damage.empty")}
          </p>
        ) : (
          cases.data.map((item) => <CaseCard key={item.id} item={item} date={date} />)
        )}
      </div>
    </NavGate>
  );
}
