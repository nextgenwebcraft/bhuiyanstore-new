"use client";

import { t, toBengaliDigits } from "@bsd/i18n";
import { toCartonDisplay } from "@bsd/domain";
import { useRef } from "react";
import { Button } from "@/components/button";
import { ListSkeleton } from "@/components/skeleton";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { useBatches, useProducts } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { BatchDrawer, type BatchDrawerHandle } from "./batch-drawer";
import { summarizeStockByProduct } from "./stock-summary";

const PATH = "inventory/stock";

function GodownStock() {
  const { company, permissions } = useCurrentWorkspace();
  const products = useProducts(company.id);
  const batches = useBatches(company.id);
  const drawerRef = useRef<BatchDrawerHandle>(null);
  const showCost = permissions.includes("inventory.cost_view");

  let body: React.ReactNode;
  if (products.isPending || batches.isPending) {
    body = <ListSkeleton />;
  } else if (products.isError) {
    body = (
      <StatePanel
        tone="error"
        title={t(`error.${errorCodeOf(products.error)}`)}
        action={<Button onClick={() => void products.refetch()}>{t("state.retry")}</Button>}
      />
    );
  } else if (batches.isError) {
    body = (
      <StatePanel
        tone="error"
        title={t(`error.${errorCodeOf(batches.error)}`)}
        action={<Button onClick={() => void batches.refetch()}>{t("state.retry")}</Button>}
      />
    );
  } else {
    const activeProducts = products.data.filter((p) => p.status === "active");
    const summaries = summarizeStockByProduct(batches.data);
    const summaryByProduct = new Map(summaries.map((s) => [s.productId, s]));

    body =
      activeProducts.length === 0 ? (
        <StatePanel title={t("inventory.stock.empty")} />
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-surface text-sm">
          <thead className="bg-surface-muted text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("inventory.column.product")}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                {t("inventory.column.available")}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                {t("inventory.column.batchCount")}
              </th>
              <th scope="col" className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {activeProducts.map((product) => {
              const summary = summaryByProduct.get(product.id);
              const available = summary?.availableQuantity ?? "0";
              const { cartons, loosePieces } = toCartonDisplay(available, product.piecesPerCarton);
              return (
                <tr key={product.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div>{product.name}</div>
                    <div className="text-text-muted">{product.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {toBengaliDigits(cartons)}×{toBengaliDigits(product.piecesPerCarton)} +{" "}
                    {toBengaliDigits(loosePieces)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {toBengaliDigits(String(summary?.batchCount ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      onClick={() => drawerRef.current?.open(product.id, product.name)}
                      disabled={!summary}
                    >
                      {t("inventory.viewBatches")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
  }

  return (
    <>
      <PageHeader title={t("nav.inventory.stock")} />
      <BatchDrawer ref={drawerRef} batches={batches.data ?? []} showCost={showCost} />
      {body}
    </>
  );
}

export function GodownStockPage() {
  return (
    <NavGate path={PATH}>
      <GodownStock />
    </NavGate>
  );
}
