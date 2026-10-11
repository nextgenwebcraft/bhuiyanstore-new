"use client";

import {
  isFieldOnly,
  type FieldDay,
  type FieldProduct,
  type FieldVisit,
  type FieldVisitSaveRequest,
} from "@bsd/contracts";
import {
  fieldVisitTotals,
  lineValue,
  roundSettlement,
  toBaseQuantity,
  toCartonDisplay,
  toDecimal,
} from "@bsd/domain";
import { formatAmount, matchesSearch, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import {
  useCreateFieldShop,
  useDeleteFieldVisit,
  useFieldDay,
  useSaveFieldVisit,
} from "@/data/queries";
import { clean, DateBar, useWorkingDate } from "@/features/daily/daily-kit";
import { CartonQty, StatusChip } from "@/components/data-table";
import { NavGate } from "@/features/shell/nav-gate";
import { FIELD_PATH } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const noErrors: DescribedError = { fields: {} };
const WHOLE = /^\d+$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** Blank counts as zero; anything else must be whole pieces. */
const pieces = (value: string) => clean(value) || "0";

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg bg-surface-muted px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={`tabular-nums ${strong ? "text-lg font-semibold" : "font-medium"}`}>
        {formatAmount(value)}
      </div>
    </div>
  );
}

function Totals({ day }: { day: FieldDay }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat label={t("field.salesValue")} value={day.totals.sales} />
      <Stat label={t("field.cashReceived")} value={day.totals.cashReceived} />
      <Stat label={t("field.dueCreated")} value={day.totals.dueCreated} />
      <Stat label={t("field.dueCollected")} value={day.totals.dueCollected} />
      <div className="col-span-2">
        <Stat label={t("field.cashInHand")} value={day.totals.cashInHand} strong />
      </div>
    </div>
  );
}

function VisitCard({
  visit,
  editable,
  onEdit,
  onDelete,
}: {
  visit: FieldVisit;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const exchanged = visit.lines.filter((l) => l.exchanged !== "0");
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{visit.shopName}</div>
          <div className="text-xs text-text-muted">
            {t("field.salesValue")} {formatAmount(visit.salesValue)} · {t("field.cashReceived")}{" "}
            {formatAmount(visit.cashReceived)} · {t("field.dueCreated")}{" "}
            {formatAmount(visit.dueCreated)}
            {visit.dueCollected !== "0"
              ? ` · ${t("field.dueCollected")} ${formatAmount(visit.dueCollected)}`
              : ""}
          </div>
        </div>
        <StatusBadge tone={visit.status === "open" ? "brand" : "muted"}>
          {t(`field.status.${visit.status}`)}
        </StatusBadge>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {visit.lines
          .filter((l) => l.delivered !== "0")
          .map((l) => (
            <li key={l.productId} className="flex justify-between gap-2">
              <span className="truncate">{l.productName}</span>
              <span className="tabular-nums">
                <CartonQty pieces={l.delivered} piecesPerCarton={l.piecesPerCarton} /> ·{" "}
                {formatAmount(l.value)}
              </span>
            </li>
          ))}
        {exchanged.map((l) => (
          <li key={`x-${l.productId}`} className="flex justify-between gap-2 text-text-muted">
            <span className="truncate">
              {t("field.exchanged")}: {l.productName}
            </span>
            <span className="tabular-nums">{formatAmount(l.exchanged)}</span>
          </li>
        ))}
      </ul>
      {visit.note ? <p className="mt-2 text-xs text-text-muted">{visit.note}</p> : null}
      {editable ? (
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" onClick={onEdit}>
            {t("common.edit")}
          </Button>
          <Button className="flex-1" onClick={onDelete}>
            {t("field.delete")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ShopDialog({
  companyId,
  onCreated,
  onClose,
}: {
  companyId: string;
  onCreated: (shopId: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const create = useCreateFieldShop(companyId);
  const [values, setValues] = useState({ name: "", ownerName: "", phone: "", area: "" });
  const [errors, setErrors] = useState(noErrors);

  async function submit() {
    if (!values.name.trim()) {
      setErrors({ fields: { name: t("validation.required") } });
      return;
    }
    setErrors(noErrors);
    try {
      const shop = await create.mutateAsync(values);
      onCreated(shop.id);
    } catch (error) {
      setErrors(describeError(error, ["name", "ownerName", "phone", "area"]));
    }
  }

  const input = (key: keyof typeof values, label: string, mode?: "tel") => (
    <Field id={`${id}-${key}`} label={label} error={errors.fields[key]}>
      <input
        id={`${id}-${key}`}
        inputMode={mode}
        value={values[key]}
        onChange={(event) => setValues({ ...values, [key]: event.target.value })}
        className={inputClass}
      />
    </Field>
  );

  return (
    <FormDialog
      open
      title={t("field.addShop")}
      error={errors.form}
      pending={create.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {input("name", t("field.shopName"))}
      {input("ownerName", t("field.ownerName"))}
      {input("phone", t("field.phone"), "tel")}
      {input("area", t("field.area"))}
    </FormDialog>
  );
}

type LineDraft = { cartons: string; loose: string; exchanged: string };

function draftOf(product: FieldProduct, visit: FieldVisit | null): LineDraft {
  const line = visit?.lines.find((l) => l.productId === product.productId);
  const split =
    line && line.delivered !== "0"
      ? toCartonDisplay(line.delivered, product.piecesPerCarton)
      : { cartons: "0", loosePieces: "0" };
  return {
    cartons: split.cartons === "0" ? "" : split.cartons,
    loose: split.loosePieces === "0" ? "" : split.loosePieces,
    exchanged: line && line.exchanged !== "0" ? line.exchanged : "",
  };
}

/** Pieces of a draft line, or null while the input is not whole pieces. */
function deliveredOf(draft: LineDraft, piecesPerCarton: string): string | null {
  const cartons = pieces(draft.cartons);
  const loose = pieces(draft.loose);
  if (!WHOLE.test(cartons) || !WHOLE.test(loose)) return null;
  return toBaseQuantity(cartons, loose, piecesPerCarton);
}

function VisitEditor({
  companyId,
  day,
  visit,
  onDone,
}: {
  companyId: string;
  day: FieldDay;
  visit: FieldVisit | null;
  onDone: () => void;
}) {
  const id = useId();
  const save = useSaveFieldVisit(companyId);
  const [shopId, setShopId] = useState(visit?.shopId ?? "");
  const [search, setSearch] = useState("");
  const [addingShop, setAddingShop] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(day.products.map((p) => [p.productId, draftOf(p, visit)])),
  );
  const [cash, setCash] = useState(visit && visit.cashReceived !== "0" ? visit.cashReceived : "");
  const [collected, setCollected] = useState(
    visit && visit.dueCollected !== "0" ? visit.dueCollected : "",
  );
  const [note, setNote] = useState(visit?.note ?? "");
  const [errors, setErrors] = useState(noErrors);

  const shop = day.shops.find((s) => s.id === shopId);
  const shopMatches = day.shops.filter((s) => matchesSearch(search, [s.name, s.area]));

  /** In hand for this visit: what is left plus what this visit already holds. */
  const inHand = (p: FieldProduct) => {
    const own = visit?.lines.find((l) => l.productId === p.productId);
    return toDecimal(p.remaining)
      .add(toDecimal(own?.delivered ?? "0"))
      .add(toDecimal(own?.exchanged ?? "0"))
      .toString();
  };

  const rows = day.products.map((p) => {
    const draft = drafts[p.productId] ?? { cartons: "", loose: "", exchanged: "" };
    const delivered = deliveredOf(draft, p.piecesPerCarton);
    const exchanged = pieces(draft.exchanged);
    const validExchange = WHOLE.test(exchanged);
    const used =
      delivered !== null && validExchange
        ? toDecimal(delivered).add(toDecimal(exchanged))
        : toDecimal("0");
    return {
      product: p,
      draft,
      delivered,
      exchanged: validExchange ? exchanged : null,
      over: used.gt(toDecimal(inHand(p))),
      value:
        delivered !== null && p.unitPrice
          ? lineValue({ delivered, exchanged: "0", unitPrice: p.unitPrice })
          : "0",
    };
  });

  const cashText = clean(cash) || "0";
  const collectedText = clean(collected) || "0";
  const totals = fieldVisitTotals(
    rows.map((r) => ({
      delivered: r.delivered ?? "0",
      exchanged: "0",
      unitPrice: r.product.unitPrice ?? "0",
    })),
    AMOUNT.test(cashText) ? cashText : "0",
  );

  async function submit() {
    const fields: Partial<Record<string, string>> = {};
    if (!shopId) fields.shopId = t("validation.required");
    if (!AMOUNT.test(cashText)) fields.cashReceived = t("validation.opening.amount");
    if (!AMOUNT.test(collectedText)) fields.dueCollected = t("validation.opening.amount");
    rows.forEach((r) => {
      if (r.delivered === null || r.exchanged === null) {
        fields[`line.${r.product.productId}`] = t("validation.wholeNumber");
      } else if (r.over) fields[`line.${r.product.productId}`] = t("field.exceedsHand");
    });
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    setErrors(noErrors);
    const lines = rows
      .filter((r) => r.delivered !== "0" || r.exchanged !== "0")
      .map((r) => ({
        productId: r.product.productId,
        delivered: r.delivered ?? "0",
        exchanged: r.exchanged ?? "0",
      }));
    const input: FieldVisitSaveRequest = {
      date: day.date,
      shopId,
      version: visit?.version ?? 0,
      cashReceived: cashText,
      dueCollected: collectedText,
      note: note.trim(),
      lines,
    };
    try {
      await save.mutateAsync({ ...(visit ? { visitId: visit.id } : {}), input });
      onDone();
    } catch (error) {
      setErrors(describeError(error, ["shopId", "cashReceived", "dueCollected"]));
    }
  }

  const setDraft = (productId: string, patch: Partial<LineDraft>) =>
    setDrafts((all) => ({
      ...all,
      [productId]: { ...(all[productId] ?? { cartons: "", loose: "", exchanged: "" }), ...patch },
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t(visit ? "field.editVisit" : "field.newVisit")}</h1>
        <Button onClick={onDone}>{t("field.back")}</Button>
      </div>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <Field id={`${id}-shop`} label={t("field.shop")} error={errors.fields.shopId}>
          {shop ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{shop.name}</span>
                {shop.due !== null ? (
                  <span className="text-xs text-text-muted">
                    {t("field.oldDue")}: {formatAmount(shop.due)}
                  </span>
                ) : null}
              </span>
              <Button onClick={() => setShopId("")}>{t("common.edit")}</Button>
            </div>
          ) : (
            <input
              id={`${id}-shop`}
              type="search"
              placeholder={t("field.searchShop")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        {shop ? null : (
          <>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {shopMatches.slice(0, 50).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setShopId(s.id)}
                    className="flex min-h-(--touch-target) w-full items-center justify-between gap-2 rounded-md px-3 text-left hover:bg-surface-hover"
                  >
                    <span className="truncate">
                      {s.name}
                      {s.area ? <span className="text-xs text-text-muted"> · {s.area}</span> : null}
                    </span>
                    {s.due !== null && s.due !== "0" ? (
                      <span className="text-xs text-text-muted tabular-nums">
                        {formatAmount(s.due)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
              {shopMatches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-text-muted">{t("field.noShopMatch")}</li>
              ) : null}
            </ul>
            <Button onClick={() => setAddingShop(true)}>{t("field.addShop")}</Button>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        {rows.map((r) => {
          const p = r.product;
          const error = errors.fields[`line.${p.productId}`];
          const cartons = p.piecesPerCarton !== "1";
          return (
            <div
              key={p.productId}
              className={`rounded-lg border bg-surface p-3 ${r.over || error ? "border-error" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-medium">{p.productName}</span>
                <span className="text-right text-xs text-text-muted">
                  {t("field.remaining")}:{" "}
                  <CartonQty pieces={inHand(p)} piecesPerCarton={p.piecesPerCarton} />
                  <br />
                  {t("field.price")}: {p.unitPrice ? formatAmount(p.unitPrice) : t("field.noPrice")}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {cartons ? (
                  <label className="flex flex-col text-xs text-text-muted">
                    {t("common.cartons")}
                    <input
                      inputMode="numeric"
                      value={r.draft.cartons}
                      onChange={(event) => setDraft(p.productId, { cartons: event.target.value })}
                      className={`${inputClass} text-right`}
                    />
                  </label>
                ) : null}
                <label
                  className={`flex flex-col text-xs text-text-muted ${cartons ? "" : "col-span-2"}`}
                >
                  {t("common.pieces")}
                  <input
                    inputMode="numeric"
                    value={r.draft.loose}
                    onChange={(event) => setDraft(p.productId, { loose: event.target.value })}
                    className={`${inputClass} text-right`}
                  />
                </label>
                <label className="flex flex-col text-xs text-text-muted">
                  {t("field.exchanged")}
                  <input
                    inputMode="numeric"
                    value={r.draft.exchanged}
                    onChange={(event) => setDraft(p.productId, { exchanged: event.target.value })}
                    className={`${inputClass} text-right`}
                  />
                </label>
              </div>
              <div className="mt-1 flex justify-between text-xs">
                <span className="text-error">
                  {error ?? (r.over ? t("field.exceedsHand") : "")}
                </span>
                <span className="tabular-nums">
                  {t("field.value")}: {formatAmount(roundSettlement(r.value))}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t("field.salesValue")} value={totals.salesValue} />
          <Stat label={t("field.dueCreated")} value={totals.dueCreated} />
        </div>
        <Field id={`${id}-cash`} label={t("field.cashReceived")} error={errors.fields.cashReceived}>
          <input
            id={`${id}-cash`}
            inputMode="decimal"
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            className={`${inputClass} text-right`}
          />
        </Field>
        <Field
          id={`${id}-collected`}
          label={t("field.dueCollected")}
          error={errors.fields.dueCollected}
        >
          <input
            id={`${id}-collected`}
            inputMode="decimal"
            value={collected}
            onChange={(event) => setCollected(event.target.value)}
            className={`${inputClass} text-right`}
          />
        </Field>
        <Field id={`${id}-note`} label={`${t("field.note")} (${t("common.optional")})`}>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </Field>
        {errors.form ? (
          <p role="alert" className="text-sm text-error">
            {errors.form}
          </p>
        ) : null}
        <Button variant="primary" disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </section>

      {addingShop ? (
        <ShopDialog
          companyId={companyId}
          onCreated={(created) => {
            setShopId(created);
            setAddingShop(false);
          }}
          onClose={() => setAddingShop(false)}
        />
      ) : null}
    </div>
  );
}

function FieldDayView() {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  const day = useFieldDay(company.id, date);
  const remove = useDeleteFieldVisit(company.id);
  const [editing, setEditing] = useState<FieldVisit | "new" | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  if (day.isPending) return <ListSkeleton rows={4} detail />;
  if (day.isError) {
    const described = describeError(day.error, []);
    return (
      <StatePanel
        tone="error"
        title={described.form ?? t("error.INTERNAL")}
        action={<Button onClick={() => void day.refetch()}>{t("state.retry")}</Button>}
      />
    );
  }
  const data = day.data;

  if (editing) {
    return (
      <VisitEditor
        key={editing === "new" ? "new" : editing.id}
        companyId={company.id}
        day={data}
        visit={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
  }

  const canEnter = !data.locked && data.sheetStatus !== "none";
  async function onDelete(visit: FieldVisit) {
    if (!window.confirm(t("field.deleteConfirm"))) return;
    setDeleteError(undefined);
    try {
      await remove.mutateAsync({ visitId: visit.id, version: visit.version });
    } catch (error) {
      setDeleteError(describeError(error, []).form);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{t("field.title")}</h1>
          <StatusChip status={data.sheetStatus === "none" ? "none" : data.sheetStatus} />
        </div>
        <p className="text-sm text-text-muted">{data.staffName}</p>
        <DateBar date={date} onChange={setDate} id="field-date" />
      </div>

      {data.sheetStatus === "none" ? (
        <StatePanel
          tone="warning"
          title={t("field.noSamari.title")}
          hint={t("field.noSamari.hint")}
        />
      ) : null}
      {data.locked ? <StatePanel title={t("field.locked")} /> : null}

      <Totals day={data} />

      {canEnter ? (
        <Button variant="primary" onClick={() => setEditing("new")}>
          {t("field.newVisit")}
        </Button>
      ) : null}

      {deleteError ? (
        <p role="alert" className="text-sm text-error">
          {deleteError}
        </p>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("field.visits")}</h2>
        {data.visits.length === 0 ? (
          <p className="text-sm text-text-muted">{t("field.noVisits")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.visits.map((visit) => (
              <VisitCard
                key={visit.id}
                visit={visit}
                editable={canEnter && visit.status === "open"}
                onEdit={() => setEditing(visit)}
                onDelete={() => void onDelete(visit)}
              />
            ))}
          </ul>
        )}
      </section>

      {data.products.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold">{t("field.inHand")}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {data.products.map((p) => (
              <li key={p.productId} className="flex justify-between gap-2">
                <span className="truncate">{p.productName}</span>
                <span className="tabular-nums">
                  <CartonQty pieces={p.remaining} piecesPerCarton={p.piecesPerCarton} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** DSR phone panel (D40): shop-wise delivery, cash, old due and damage exchange per visit. */
export function FieldPage() {
  const { permissions } = useCurrentWorkspace();
  if (isFieldOnly(permissions)) return <FieldDayView />;
  return (
    <NavGate path={FIELD_PATH}>
      <div className="mx-auto max-w-xl">
        <FieldDayView />
      </div>
    </NavGate>
  );
}
