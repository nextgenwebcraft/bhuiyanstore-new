"use client";

import type { Batch, DailySalesSummary, Product, StaffMember } from "@bsd/contracts";
import {
  allocateByPriority,
  businessDateOf,
  priceSplitAmount,
  roundSettlement,
  sumAmounts,
  sumQuantities,
  toCartonDisplay,
  toDecimal,
} from "@bsd/domain";
import { formatAmount, formatRate, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { usePostDailySalesSummary } from "@/data/queries";
import { useRequestKey } from "@/data/use-request-key";
import { useRegisterDraftGuard } from "@/features/shell/draft-guard";
import { useOnlineStatus } from "@/features/shell/use-online-status";

type Split = { uid: string; quantity: string; unitPrice: string };
type Line = { uid: string; productId: string; splits: Split[] };

const POSITIVE_INT = /^[1-9]\d*$/;
const DECIMAL = /^\d+(\.\d+)?$/;

const emptySplit = (): Split => ({ uid: crypto.randomUUID(), quantity: "", unitPrice: "" });
const emptyLine = (): Line => ({ uid: crypto.randomUUID(), productId: "", splits: [emptySplit()] });

function parsedSplit(split: Split) {
  const quantity = normalizeDigits(split.quantity.trim());
  const unitPrice = normalizeDigits(split.unitPrice.trim());
  return {
    quantity,
    unitPrice,
    valid: POSITIVE_INT.test(quantity) && DECIMAL.test(unitPrice) && toDecimal(unitPrice).gt(0),
  };
}

/**
 * DSR daily product summary (D03, guide 5.3, 9.5): one brand/DSR/date, product lines with
 * actual-price splits. The batch allocation shown here is an estimate from the same pure
 * function the service uses (guide 21.2 R06); posting recalculates with authoritative stock.
 */
export function SummaryForm({
  companyId,
  products,
  batches,
  dsrs,
  showCost,
  onClose,
  onPosted,
}: {
  companyId: string;
  products: Product[];
  batches: Batch[];
  dsrs: StaffMember[];
  showCost: boolean;
  onClose: () => void;
  onPosted: (summary: DailySalesSummary) => void;
}) {
  const fieldId = useId();
  const online = useOnlineStatus();
  const post = usePostDailySalesSummary(companyId);
  const [requestKey] = useRequestKey();
  const activeProducts = useMemo(() => products.filter((p) => p.status === "active"), [products]);
  const productById = new Map(activeProducts.map((p) => [p.id, p]));

  const [businessDate, setBusinessDate] = useState(() => businessDateOf(new Date()));
  const [dsrId, setDsrId] = useState(dsrs[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
  const [cashCollected, setCashCollected] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const productCounts = new Map<string, number>();
  for (const line of lines) {
    if (line.productId) {
      productCounts.set(line.productId, (productCounts.get(line.productId) ?? 0) + 1);
    }
  }

  const linePreviews = lines.map((line) => {
    const splits = line.splits.map(parsedSplit);
    const allValid = splits.every((s) => s.valid);
    const quantity = allValid ? sumQuantities(splits.map((s) => s.quantity)) : null;
    const amount = allValid ? sumAmounts(splits.map((s) => priceSplitAmount(s))) : null;
    const layers = batches.filter((b) => b.productId === line.productId);
    const eligibleAvailable = sumQuantities(
      layers
        .filter((b) => !(b.expiryDate && b.expiryDate < businessDate))
        .map((b) => b.availableQuantity),
    );
    const allocation =
      quantity !== null ? allocateByPriority(layers, quantity, businessDate) : null;
    let error: string | undefined;
    if (!line.productId) error = t("validation.required");
    else if ((productCounts.get(line.productId) ?? 0) > 1) error = t("validation.duplicateProduct");
    else if (!allValid || !allocation) error = t("validation.quantityPositive");
    else if (!toDecimal(allocation.shortfall).isZero()) error = t("validation.exceedsAvailable");
    return { splits, quantity, amount, allocation, eligibleAvailable, error };
  });

  const netSales = sumAmounts(linePreviews.map((p) => p.amount ?? "0"));
  const cash = normalizeDigits(cashCollected.trim() || "0");
  const cashValid = DECIMAL.test(cash);
  const cashError = !cashValid
    ? t("validation.decimal")
    : toDecimal(cash).gt(toDecimal(netSales))
      ? t("validation.cashExceedsSales")
      : undefined;
  const marketDue = cashValid
    ? roundSettlement(clampToZero(toDecimal(netSales).sub(toDecimal(cash)).toString()))
    : null;

  function updateLine(uid: string, update: (line: Line) => Line) {
    setLines((current) => current.map((l) => (l.uid === uid ? update(l) : l)));
  }

  async function submit(): Promise<boolean> {
    setShowErrors(true);
    if (!dsrId || !businessDate || cashError || linePreviews.some((p) => p.error)) return false;
    setFormError(null);
    try {
      const summary = await post.mutateAsync({
        requestKey,
        businessDate,
        dsrId,
        cashCollected: cash,
        lines: lines.map((line, index) => ({
          productId: line.productId,
          priceSplits: (linePreviews[index]?.splits ?? []).map((s) => ({
            quantity: s.quantity,
            unitPrice: s.unitPrice,
          })),
        })),
      });
      onPosted(summary);
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
      aria-label={t("summary.formTitle")}
      className="mb-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-lg font-semibold">{t("summary.formTitle")}</h2>
      {formError ? (
        <StatePanel tone="error" title={formError} hint={t("common.retrySafe")} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${fieldId}-date`} label={t("summary.businessDate")}>
          <input
            id={`${fieldId}-date`}
            type="date"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={`${fieldId}-dsr`} label={t("summary.dsr")}>
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
      </div>

      <ol className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const preview = linePreviews[index];
          const product = productById.get(line.productId);
          const id = `${fieldId}-${line.uid}`;
          const cartons =
            preview?.quantity && product
              ? toCartonDisplay(preview.quantity, product.piecesPerCarton)
              : null;
          return (
            <li key={line.uid} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field
                  id={`${id}-product`}
                  label={t("inventory.column.product")}
                  error={showErrors ? preview?.error : undefined}
                  className="md:col-span-2"
                >
                  <select
                    id={`${id}-product`}
                    value={line.productId}
                    onChange={(event) =>
                      updateLine(line.uid, (l) => ({ ...l, productId: event.target.value }))
                    }
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
                <p className="self-end text-sm text-text-muted">
                  {t("summary.available")}:{" "}
                  {line.productId ? toBengaliDigits(preview?.eligibleAvailable ?? "0") : "—"}
                </p>
              </div>

              {line.splits.map((split) => (
                <div key={split.uid} className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field id={`${id}-${split.uid}-qty`} label={t("summary.soldQuantity")}>
                    <input
                      id={`${id}-${split.uid}-qty`}
                      inputMode="numeric"
                      value={split.quantity}
                      onChange={(event) =>
                        updateLine(line.uid, (l) => ({
                          ...l,
                          splits: l.splits.map((s) =>
                            s.uid === split.uid ? { ...s, quantity: event.target.value } : s,
                          ),
                        }))
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field id={`${id}-${split.uid}-price`} label={t("summary.unitPrice")}>
                    <input
                      id={`${id}-${split.uid}-price`}
                      inputMode="decimal"
                      value={split.unitPrice}
                      onChange={(event) =>
                        updateLine(line.uid, (l) => ({
                          ...l,
                          splits: l.splits.map((s) =>
                            s.uid === split.uid ? { ...s, unitPrice: event.target.value } : s,
                          ),
                        }))
                      }
                      className={inputClass}
                    />
                  </Field>
                  <p className="self-end text-sm tabular-nums">
                    {parsedSplit(split).valid
                      ? formatAmount(priceSplitAmount(parsedSplit(split)))
                      : "—"}
                  </p>
                  {line.splits.length > 1 ? (
                    <Button
                      className="self-end"
                      onClick={() =>
                        updateLine(line.uid, (l) => ({
                          ...l,
                          splits: l.splits.filter((s) => s.uid !== split.uid),
                        }))
                      }
                    >
                      {t("summary.removePrice")}
                    </Button>
                  ) : null}
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  onClick={() =>
                    updateLine(line.uid, (l) => ({ ...l, splits: [...l.splits, emptySplit()] }))
                  }
                >
                  {t("summary.addPrice")}
                </Button>
                {lines.length > 1 ? (
                  <Button
                    onClick={() => setLines((current) => current.filter((l) => l.uid !== line.uid))}
                  >
                    {t("common.removeLine")}
                  </Button>
                ) : null}
              </div>

              {preview?.quantity &&
              preview.allocation &&
              preview.allocation.allocations.length > 0 ? (
                <div className="text-sm text-text-muted">
                  <p>
                    {t("common.quantity")}: {toBengaliDigits(preview.quantity)}
                    {cartons
                      ? ` (${toBengaliDigits(cartons.cartons)} ${t("common.cartons")} + ${toBengaliDigits(cartons.loosePieces)} ${t("common.pieces")})`
                      : ""}
                  </p>
                  <p>
                    {t("summary.allocation")}:{" "}
                    {preview.allocation.allocations
                      .map((a) => {
                        const lot = batches.find((b) => b.id === a.batchId)?.lotId ?? "—";
                        const cost = showCost ? ` @ ${formatRate(a.unitCost)}` : "";
                        return `${lot} × ${toBengaliDigits(a.quantity)}${cost}`;
                      })
                      .join(" · ")}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-1">
        <div>
          <Button onClick={() => setLines((current) => [...current, emptyLine()])}>
            {t("common.addLine")}
          </Button>
        </div>
        <p className="text-sm text-text-muted">{t("summary.allocationHint")}</p>
      </div>

      <Field
        id={`${fieldId}-cash`}
        label={t("summary.cashCollected")}
        error={showErrors ? cashError : undefined}
        className="max-w-xs"
      >
        <input
          id={`${fieldId}-cash`}
          inputMode="decimal"
          value={cashCollected}
          onChange={(event) => setCashCollected(event.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border bg-surface py-3">
        <div
          className="flex flex-wrap gap-x-6 gap-y-1 font-semibold tabular-nums"
          aria-live="polite"
        >
          <span>
            {t("summary.netSales")}: {formatAmount(netSales)}
          </span>
          <span>
            {t("sales.marketDue")}: {marketDue ? formatAmount(marketDue) : "—"}
          </span>
        </div>
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

/** Display-only clamp: a negative difference is already reported as a cash field error. */
function clampToZero(value: string): string {
  return toDecimal(value).isNegative() ? "0" : value;
}
