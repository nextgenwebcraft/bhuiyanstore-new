"use client";

import type { GoodsReceipt, GoodsReceiptKind, Product, Supplier } from "@bsd/contracts";
import {
  businessDateOf,
  roundSettlement,
  sumAmounts,
  toBaseQuantity,
  toDecimal,
} from "@bsd/domain";
import { formatAmount, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { usePostGoodsReceipt } from "@/data/queries";
import { useRequestKey } from "@/data/use-request-key";
import { useRegisterDraftGuard } from "@/features/shell/draft-guard";
import { useOnlineStatus } from "@/features/shell/use-online-status";

type Line = {
  uid: string;
  productId: string;
  cartons: string;
  loosePieces: string;
  unitCost: string;
  lotId: string;
  expiryDate: string;
};

type LineErrors = Partial<Record<"productId" | "quantity" | "unitCost" | "expiryDate", string>>;

const WHOLE = /^(0|[1-9]\d*)$/;
const DECIMAL = /^\d+(\.\d+)?$/;

const emptyLine = (): Line => ({
  uid: crypto.randomUUID(),
  productId: "",
  cartons: "",
  loosePieces: "",
  unitCost: "",
  lotId: "",
  expiryDate: "",
});

/** Live base quantity for display; the service recomputes it from its own product factor. */
function previewQuantity(line: Line, product: Product | undefined): string | null {
  const cartons = normalizeDigits(line.cartons.trim() || "0");
  const pieces = normalizeDigits(line.loosePieces.trim() || "0");
  if (!product || !WHOLE.test(cartons) || !WHOLE.test(pieces)) return null;
  return toBaseQuantity(cartons, pieces, product.piecesPerCarton);
}

function previewValue(quantity: string | null, unitCost: string): string | null {
  const cost = normalizeDigits(unitCost.trim());
  if (quantity === null || !DECIMAL.test(cost)) return null;
  return roundSettlement(toDecimal(quantity).mul(toDecimal(cost)));
}

/**
 * Goods receipt entry (guide 5.3 purchase workspace, 9.3, 9.3a). One form for paid purchases and
 * free supplier-incentive stock: the receipt kind decides the accounting policy, not a second
 * inventory writer (D16).
 */
export function ReceiptForm({
  companyId,
  products,
  suppliers,
  allowedKinds,
  onClose,
  onPosted,
}: {
  companyId: string;
  products: Product[];
  suppliers: Supplier[];
  allowedKinds: GoodsReceiptKind[];
  onClose: () => void;
  onPosted: (receipt: GoodsReceipt) => void;
}) {
  const fieldId = useId();
  const online = useOnlineStatus();
  const post = usePostGoodsReceipt(companyId);
  const [requestKey] = useRequestKey();
  const activeProducts = useMemo(() => products.filter((p) => p.status === "active"), [products]);

  const [kind, setKind] = useState<GoodsReceiptKind>(allowedKinds[0] ?? "purchase");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [receivedDate, setReceivedDate] = useState(() => businessDateOf(new Date()));
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const productById = new Map(activeProducts.map((p) => [p.id, p]));
  const lineValues = lines.map((line) =>
    previewValue(previewQuantity(line, productById.get(line.productId)), line.unitCost),
  );
  const total = sumAmounts(lineValues.map((v) => v ?? "0"));

  function updateLine(uid: string, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  async function submit(): Promise<boolean> {
    const errors: Record<string, LineErrors> = {};
    for (const line of lines) {
      const e: LineErrors = {};
      const quantity = previewQuantity(line, productById.get(line.productId));
      const cost = normalizeDigits(line.unitCost.trim());
      if (!line.productId) e.productId = t("validation.required");
      if (quantity === null) e.quantity = t("validation.wholeNumber");
      else if (toDecimal(quantity).lte(0)) e.quantity = t("validation.quantityPositive");
      if (!DECIMAL.test(cost)) e.unitCost = t("validation.decimal");
      else if (toDecimal(cost).lte(0)) e.unitCost = t("validation.amountPositive");
      if (line.expiryDate && line.expiryDate < receivedDate) {
        e.expiryDate = t("validation.expiryBeforeReceipt");
      }
      if (Object.keys(e).length > 0) errors[line.uid] = e;
    }
    setLineErrors(errors);
    if (!supplierId || !receivedDate) {
      setFormError(t("validation.required"));
      return false;
    }
    if (Object.keys(errors).length > 0) return false;

    setFormError(null);
    try {
      const receipt = await post.mutateAsync({
        requestKey,
        kind,
        supplierId,
        receivedDate,
        reference: reference.trim(),
        lines: lines.map((line) => ({
          productId: line.productId,
          cartons: normalizeDigits(line.cartons.trim() || "0"),
          loosePieces: normalizeDigits(line.loosePieces.trim() || "0"),
          unitCost: normalizeDigits(line.unitCost.trim()),
          ...(line.lotId.trim() ? { lotId: line.lotId.trim() } : {}),
          ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
        })),
      });
      onPosted(receipt);
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
      aria-label={t("receipt.formTitle")}
      className="mb-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-lg font-semibold">{t("receipt.formTitle")}</h2>
      {formError ? (
        <StatePanel tone="error" title={formError} hint={t("common.retrySafe")} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          id={`${fieldId}-kind`}
          label={t("receipt.kind")}
          hint={t(`receipt.kindHint.${kind}`)}
        >
          <select
            id={`${fieldId}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as GoodsReceiptKind)}
            className={inputClass}
          >
            {allowedKinds.map((k) => (
              <option key={k} value={k}>
                {t(`receipt.kind.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${fieldId}-supplier`} label={t("receipt.supplier")}>
          <select
            id={`${fieldId}-supplier`}
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className={inputClass}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${fieldId}-date`} label={t("common.date")}>
          <input
            id={`${fieldId}-date`}
            type="date"
            value={receivedDate}
            onChange={(event) => setReceivedDate(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={`${fieldId}-ref`} label={`${t("common.reference")} (${t("common.optional")})`}>
          <input
            id={`${fieldId}-ref`}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <ol className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const product = productById.get(line.productId);
          const quantity = previewQuantity(line, product);
          const value = lineValues[index];
          const e = lineErrors[line.uid] ?? {};
          const id = `${fieldId}-${line.uid}`;
          return (
            <li
              key={line.uid}
              className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 md:grid-cols-6"
            >
              <Field
                id={`${id}-product`}
                label={t("inventory.column.product")}
                error={e.productId}
                className="col-span-2"
              >
                <select
                  id={`${id}-product`}
                  value={line.productId}
                  onChange={(event) => updateLine(line.uid, { productId: event.target.value })}
                  className={inputClass}
                >
                  <option value="">{t("common.select")}</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id={`${id}-cartons`}
                label={
                  product
                    ? `${t("common.cartons")} (×${toBengaliDigits(product.piecesPerCarton)})`
                    : t("common.cartons")
                }
                error={e.quantity}
              >
                <input
                  id={`${id}-cartons`}
                  inputMode="numeric"
                  value={line.cartons}
                  onChange={(event) => updateLine(line.uid, { cartons: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field id={`${id}-pieces`} label={t("common.pieces")}>
                <input
                  id={`${id}-pieces`}
                  inputMode="numeric"
                  value={line.loosePieces}
                  onChange={(event) => updateLine(line.uid, { loosePieces: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field id={`${id}-cost`} label={t("receipt.unitCost")} error={e.unitCost}>
                <input
                  id={`${id}-cost`}
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(event) => updateLine(line.uid, { unitCost: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field
                id={`${id}-lot`}
                label={`${t("inventory.column.lot")} (${t("common.optional")})`}
              >
                <input
                  id={`${id}-lot`}
                  value={line.lotId}
                  onChange={(event) => updateLine(line.uid, { lotId: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field
                id={`${id}-expiry`}
                label={`${t("inventory.column.expiry")} (${t("common.optional")})`}
                error={e.expiryDate}
              >
                <input
                  id={`${id}-expiry`}
                  type="date"
                  value={line.expiryDate}
                  onChange={(event) => updateLine(line.uid, { expiryDate: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <div className="col-span-2 flex flex-wrap items-end justify-between gap-2 md:col-span-5">
                <p className="text-sm text-text-muted" aria-live="polite">
                  {t("receipt.baseQuantity")}: {quantity ? toBengaliDigits(quantity) : "—"} ·{" "}
                  {t("receipt.lineValue")}: {value ? formatAmount(value) : "—"}
                </p>
                {lines.length > 1 ? (
                  <Button
                    onClick={() => setLines((current) => current.filter((l) => l.uid !== line.uid))}
                  >
                    {t("common.removeLine")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div>
        <Button onClick={() => setLines((current) => [...current, emptyLine()])}>
          {t("common.addLine")}
        </Button>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface pt-3">
        <p className="font-semibold tabular-nums">
          {t("receipt.totalValue")}: {formatAmount(total)}
        </p>
        <div className="flex gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={post.isPending || !online}>
            {post.isPending ? t("common.posting") : t("common.post")}
          </Button>
        </div>
      </div>
    </form>
  );
}
