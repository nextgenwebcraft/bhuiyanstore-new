"use client";

import type { Product } from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { matchesSearch, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useDeferredValue, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useAddProductPack, useProducts, useUpdateProduct } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { ProductHistoryDialog } from "./product-history-dialog";

const PATH = "masters/cartons";

/**
 * D37: one place to set how many pieces each product's carton holds. A correction rewrites the
 * base size (only while the product has no dated size); a change from a date adds a dated size,
 * so earlier days keep the size they were entered with.
 */
function CartonRow({
  companyId,
  product,
  canEdit,
  onHistory,
}: {
  companyId: string;
  product: Product;
  canEdit: boolean;
  onHistory: (product: Product) => void;
}) {
  const id = useId();
  const update = useUpdateProduct(companyId);
  const addPack = useAddProductPack(companyId, product.id);
  const [size, setSize] = useState("");
  const [dated, setDated] = useState(false);
  const [from, setFrom] = useState(() => businessDateOf(new Date()));
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const pending = update.isPending || addPack.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const pieces = normalizeDigits(size.trim());
    if (!/^[1-9]\d*$/.test(pieces)) {
      setError(t("validation.positiveInteger.invalid"));
      return;
    }
    setError(undefined);
    setSaved(false);
    try {
      if (dated) {
        await addPack.mutateAsync({ piecesPerCarton: pieces, effectiveFrom: from });
      } else {
        await update.mutateAsync({
          productId: product.id,
          input: {
            sku: product.sku,
            name: product.name,
            aliases: product.aliases,
            baseUnit: "piece",
            piecesPerCarton: pieces,
            status: product.status,
          },
        });
      }
      setSize("");
      setSaved(true);
    } catch (failure) {
      const described = describeError(failure, ["piecesPerCarton"]);
      setError(described.fields.piecesPerCarton ?? described.form);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{product.name}</div>
          <div className="font-mono text-sm text-text-muted">{product.sku}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-text-muted">{t("carton.current")}</div>
          <div className="text-lg font-semibold">
            {toBengaliDigits(product.piecesPerCarton)} {t("common.pieces")}
          </div>
        </div>
      </div>
      {canEdit ? (
        <form onSubmit={submit} noValidate className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-32">
            <label htmlFor={`${id}-size`} className="mb-1 block text-sm font-medium">
              {t("carton.newSize")}
            </label>
            <input
              id={`${id}-size`}
              inputMode="numeric"
              value={size}
              onChange={(event) => setSize(event.target.value)}
              className={inputClass}
            />
          </div>
          <label className="flex min-h-(--touch-target) items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dated}
              onChange={(event) => setDated(event.target.checked)}
            />
            {t("carton.fromDate")}
          </label>
          {dated ? (
            <DatePicker
              id={`${id}-from`}
              value={from}
              label={t("product.history.effectiveFrom")}
              onChange={setFrom}
            />
          ) : null}
          <Button type="submit" variant="primary" disabled={pending || (dated && !from)}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
          <Button type="button" onClick={() => onHistory(product)}>
            {t("product.history")}
          </Button>
        </form>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-2 text-sm text-success" role="status">
          {t("carton.saved")}
        </p>
      ) : null}
    </li>
  );
}

function CartonSetup() {
  const { company, permissions } = useCurrentWorkspace();
  const products = useProducts(company.id);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const searchId = useId();
  const [historyOf, setHistoryOf] = useState<Product | null>(null);
  const canEdit = permissions.includes("product.edit");

  let body: React.ReactNode;
  if (products.isPending) body = <TableSkeleton rows={8} columns={3} />;
  else if (products.isError) {
    body = <QueryError error={products.error} onRetry={() => void products.refetch()} />;
  } else if (products.data.length === 0) {
    body = <StatePanel title={t("product.empty")} />;
  } else {
    const list = products.data
      .filter((p) => p.status === "active")
      .filter((p) => matchesSearch(deferred, [p.sku, p.name, ...p.aliases]));
    body = list.length ? (
      <ul className="grid gap-3 lg:grid-cols-2">
        {list.map((product) => (
          <CartonRow
            key={product.id}
            companyId={company.id}
            product={product}
            canEdit={canEdit}
            onHistory={setHistoryOf}
          />
        ))}
      </ul>
    ) : (
      <StatePanel title={t("state.noResults")} />
    );
  }

  return (
    <>
      <PageHeader title={t("nav.masters.cartons")} />
      <p className="mb-4 max-w-3xl text-sm text-text-muted">{t("carton.intro")}</p>
      <ProductHistoryDialog
        companyId={company.id}
        product={historyOf}
        canEdit={canEdit}
        onClose={() => setHistoryOf(null)}
      />
      <div className="mb-4 max-w-md">
        <label htmlFor={searchId} className="mb-1 block text-sm font-medium">
          {t("product.search")}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("product.searchHint")}
          autoComplete="off"
          className={inputClass}
        />
      </div>
      {body}
    </>
  );
}

export function CartonSetupPage() {
  return (
    <NavGate path={PATH}>
      <CartonSetup />
    </NavGate>
  );
}
