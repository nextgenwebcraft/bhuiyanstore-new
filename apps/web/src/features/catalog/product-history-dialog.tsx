"use client";

import { priceKinds, type PriceKind, type Product } from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { formatRate, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import { useAddProductPack, useProductHistory, useSetProductPrice } from "@/data/queries";

const noErrors: DescribedError = { fields: {} };

function FormMessage({ message }: { message?: string | undefined }) {
  return message ? (
    <p className="text-sm text-error" role="alert">
      {message}
    </p>
  ) : null;
}

function PackForm({ companyId, productId }: { companyId: string; productId: string }) {
  const id = useId();
  const addPack = useAddProductPack(companyId, productId);
  const [pieces, setPieces] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => businessDateOf(new Date()));
  const [errors, setErrors] = useState(noErrors);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const piecesPerCarton = normalizeDigits(pieces.trim());
    if (!/^[1-9]\d*$/.test(piecesPerCarton)) {
      setErrors({ fields: { piecesPerCarton: t("validation.positiveInteger.invalid") } });
      return;
    }
    setErrors(noErrors);
    try {
      await addPack.mutateAsync({ piecesPerCarton, effectiveFrom });
      setPieces("");
    } catch (error) {
      setErrors(describeError(error, ["piecesPerCarton", "effectiveFrom"]));
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md bg-surface-muted p-3"
      noValidate
    >
      <h4 className="font-medium">{t("product.history.addPack")}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${id}-pieces`}
          label={t("product.piecesPerCarton")}
          error={errors.fields.piecesPerCarton}
        >
          <input
            id={`${id}-pieces`}
            inputMode="numeric"
            value={pieces}
            onChange={(event) => setPieces(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${id}-from`}
          label={t("product.history.effectiveFrom")}
          error={errors.fields.effectiveFrom}
        >
          <DatePicker
            id={`${id}-from`}
            value={effectiveFrom}
            label={t("product.history.effectiveFrom")}
            onChange={setEffectiveFrom}
            className="w-full"
          />
        </Field>
      </div>
      <FormMessage message={errors.form} />
      <Button type="submit" variant="primary" disabled={addPack.isPending || !effectiveFrom}>
        {addPack.isPending ? t("common.saving") : t("common.add")}
      </Button>
    </form>
  );
}

function PriceForm({ companyId, productId }: { companyId: string; productId: string }) {
  const id = useId();
  const setPrice = useSetProductPrice(companyId, productId);
  const [kind, setKind] = useState<PriceKind>("sale");
  const [price, setPriceText] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => businessDateOf(new Date()));
  const [errors, setErrors] = useState(noErrors);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeDigits(price.trim());
    if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
      setErrors({ fields: { price: t("validation.unitPrice.invalid") } });
      return;
    }
    setErrors(noErrors);
    try {
      await setPrice.mutateAsync({ kind, price: normalized, effectiveFrom });
      setPriceText("");
    } catch (error) {
      setErrors(describeError(error, ["kind", "price", "effectiveFrom"]));
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md bg-surface-muted p-3"
      noValidate
    >
      <h4 className="font-medium">{t("product.history.setPrice")}</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${id}-kind`} label={t("price.kind")} error={errors.fields.kind}>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as PriceKind)}
            className={inputClass}
          >
            {priceKinds.map((k) => (
              <option key={k} value={k}>
                {t(`price.kind.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-price`} label={t("price.unitPrice")} error={errors.fields.price}>
          <input
            id={`${id}-price`}
            inputMode="decimal"
            value={price}
            onChange={(event) => setPriceText(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${id}-from`}
          label={t("product.history.effectiveFrom")}
          error={errors.fields.effectiveFrom}
        >
          <DatePicker
            id={`${id}-from`}
            value={effectiveFrom}
            label={t("product.history.effectiveFrom")}
            onChange={setEffectiveFrom}
            className="w-full"
          />
        </Field>
      </div>
      <FormMessage message={errors.form} />
      <Button type="submit" variant="primary" disabled={setPrice.isPending || !effectiveFrom}>
        {setPrice.isPending ? t("common.saving") : t("common.save")}
      </Button>
    </form>
  );
}

function History({
  companyId,
  product,
  canEdit,
}: {
  companyId: string;
  product: Product;
  canEdit: boolean;
}) {
  const history = useProductHistory(companyId, product.id);
  if (history.isPending) return <TableSkeleton rows={3} columns={4} title />;
  if (history.isError) {
    return <QueryError error={history.error} onRetry={() => void history.refetch()} />;
  }
  const { packs, prices } = history.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">{t("product.history.packs")}</h3>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-muted text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                {t("product.history.effectiveFrom")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("product.piecesPerCarton")}
              </th>
            </tr>
          </thead>
          <tbody>
            {packs.map((pack) => (
              <tr key={pack.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {pack.effectiveFrom
                    ? toBengaliDigits(pack.effectiveFrom)
                    : t("product.history.base")}
                </td>
                <td className="px-3 py-2 text-right">{toBengaliDigits(pack.piecesPerCarton)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit ? <PackForm companyId={companyId} productId={product.id} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">{t("product.history.prices")}</h3>
        {prices.length === 0 ? (
          <p className="text-sm text-text-muted">{t("product.history.noPrices")}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-muted text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t("price.kind")}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t("product.history.effectiveFrom")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("price.unitPrice")}
                </th>
              </tr>
            </thead>
            <tbody>
              {prices.map((change) => (
                <tr key={change.id} className="border-t border-border">
                  <td className="px-3 py-2">{t(`price.kind.${change.kind}`)}</td>
                  <td className="px-3 py-2">{toBengaliDigits(change.effectiveFrom)}</td>
                  <td className="px-3 py-2 text-right">{formatRate(change.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? <PriceForm companyId={companyId} productId={product.id} /> : null}
      </section>

      {canEdit ? (
        <p className="text-sm text-text-muted">{t("product.history.sameDateReplaces")}</p>
      ) : null}
    </div>
  );
}

/** Carton sizes and per-piece prices by effective date (PLAN §2.2, Excel's carry-forward). */
export function ProductHistoryDialog({
  companyId,
  product,
  canEdit,
  onClose,
}: {
  companyId: string;
  product: Product | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (product && !dialog.open) dialog.showModal();
    if (!product && dialog.open) dialog.close();
  }, [product]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={t("product.history.title")}
      className="m-auto w-full max-w-2xl rounded-lg border border-border bg-surface p-0 text-text backdrop:bg-black/40"
    >
      {product ? (
        <div className="flex flex-col gap-4 p-4">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("product.history.title")}</h2>
              <p className="text-text-muted">
                {product.name} <span className="font-mono">({product.sku})</span>
              </p>
            </div>
            <Button variant="secondary" onClick={onClose}>
              {t("product.history.close")}
            </Button>
          </header>
          <History companyId={companyId} product={product} canEdit={canEdit} />
        </div>
      ) : null}
    </dialog>
  );
}
