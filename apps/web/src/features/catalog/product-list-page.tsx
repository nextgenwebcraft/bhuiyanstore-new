"use client";

import type { Product } from "@bsd/contracts";
import { t, toBengaliDigits, formatCount, matchesSearch } from "@bsd/i18n";
import { useDeferredValue, useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { useDeleteProduct, useProducts } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { ProductForm, type ProductFormHandle } from "./product-form";
import { ProductHistoryDialog } from "./product-history-dialog";

const PATH = "masters/products";

function StatusText({ status }: { status: Product["status"] }) {
  return (
    <span className={status === "active" ? "text-success" : "text-text-muted"}>
      {t(`product.status.${status}`)}
    </span>
  );
}

function ProductResults({
  products,
  canEdit,
  onEdit,
  onHistory,
  onDelete,
}: {
  products: Product[];
  canEdit: boolean;
  onEdit: (product: Product) => void;
  onHistory: (product: Product) => void;
  onDelete: (product: Product) => Promise<unknown>;
}) {
  return (
    <>
      {/* Desktop: compact table */}
      <table className="hidden w-full border-collapse overflow-hidden rounded-lg bg-surface text-sm md:table">
        <thead className="bg-surface-muted text-left">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("product.sku")}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("product.name")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("product.piecesPerCarton")}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("product.status")}
            </th>
            <th scope="col" className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-t border-border">
              <td className="px-4 py-3 font-mono">{product.sku}</td>
              <td className="px-4 py-3">
                <div>{product.name}</div>
                {product.aliases.length > 0 ? (
                  <div className="text-text-muted">{product.aliases.join(", ")}</div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-right">{toBengaliDigits(product.piecesPerCarton)}</td>
              <td className="px-4 py-3">
                <StatusText status={product.status} />
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button onClick={() => onHistory(product)}>{t("product.history")}</Button>
                  {canEdit ? (
                    <Button onClick={() => onEdit(product)}>{t("product.edit")}</Button>
                  ) : null}
                  {canEdit ? (
                    <DeleteButton
                      name={product.name}
                      message={t("product.delete.confirm")}
                      onDelete={() => onDelete(product)}
                    />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards instead of a squeezed table (guide section 5.1.1) */}
      <ul className="flex flex-col gap-3 md:hidden">
        {products.map((product) => (
          <li key={product.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{product.name}</div>
                {product.aliases.length > 0 ? (
                  <div className="text-sm text-text-muted">{product.aliases.join(", ")}</div>
                ) : null}
              </div>
              <StatusText status={product.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-text-muted">{t("product.sku")}</dt>
              <dd className="font-mono">{product.sku}</dd>
              <dt className="text-text-muted">{t("product.piecesPerCarton")}</dt>
              <dd>{toBengaliDigits(product.piecesPerCarton)}</dd>
            </dl>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1" onClick={() => onHistory(product)}>
                {t("product.history")}
              </Button>
              {canEdit ? (
                <Button className="flex-1" onClick={() => onEdit(product)}>
                  {t("product.edit")}
                </Button>
              ) : null}
              {canEdit ? (
                <DeleteButton
                  className="flex-1"
                  name={product.name}
                  message={t("product.delete.confirm")}
                  onDelete={() => onDelete(product)}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function ProductList() {
  const { company, permissions } = useCurrentWorkspace();
  const products = useProducts(company.id);
  const deleteProduct = useDeleteProduct(company.id);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchId = useId();
  const formRef = useRef<ProductFormHandle>(null);
  const [historyOf, setHistoryOf] = useState<Product | null>(null);
  const canCreate = permissions.includes("product.create");
  const canEdit = permissions.includes("product.edit");

  let body: React.ReactNode;
  if (products.isPending) {
    body = <TableSkeleton rows={8} columns={6} />;
  } else if (products.isError) {
    body = (
      <StatePanel
        tone="error"
        title={t(`error.${errorCodeOf(products.error)}`)}
        action={<Button onClick={() => void products.refetch()}>{t("state.retry")}</Button>}
      />
    );
  } else if (products.data.length === 0) {
    body = <StatePanel title={t("product.empty")} />;
  } else {
    const filtered = products.data.filter((p) =>
      matchesSearch(deferredQuery, [p.sku, p.name, ...p.aliases]),
    );
    body = (
      <>
        <p className="mb-3 text-sm text-text-muted" aria-live="polite">
          {t("product.count")}: {formatCount(filtered.length)}
        </p>
        {filtered.length === 0 ? (
          <StatePanel title={t("state.noResults")} />
        ) : (
          <ProductResults
            products={filtered}
            canEdit={canEdit}
            onEdit={(product) => formRef.current?.openEdit(product)}
            onHistory={setHistoryOf}
            onDelete={(product) => deleteProduct.mutateAsync(product.id)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.masters.products")}
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => formRef.current?.openCreate()}>
              {t("product.new")}
            </Button>
          ) : null
        }
      />
      <ProductForm ref={formRef} companyId={company.id} />
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
          className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
        />
      </div>
      {body}
    </>
  );
}

export function ProductListPage() {
  return (
    <NavGate path={PATH}>
      <ProductList />
    </NavGate>
  );
}
