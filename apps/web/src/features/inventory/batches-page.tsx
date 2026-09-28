"use client";

import { sortByAllocationPriority } from "@bsd/domain";
import { t } from "@bsd/i18n";
import { Button } from "@/components/button";
import { ListSkeleton } from "@/components/skeleton";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { useBatches, useProducts } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { BatchTable } from "./batch-table";

const PATH = "inventory/batches";

function BatchRegister() {
  const { company, permissions } = useCurrentWorkspace();
  const products = useProducts(company.id);
  const batches = useBatches(company.id);
  const showCost = permissions.includes("inventory.cost_view");

  let body: React.ReactNode;
  if (products.isPending || batches.isPending) {
    body = <ListSkeleton />;
  } else if (batches.isError) {
    body = (
      <StatePanel
        tone="error"
        title={t(`error.${errorCodeOf(batches.error)}`)}
        action={<Button onClick={() => void batches.refetch()}>{t("state.retry")}</Button>}
      />
    );
  } else if (products.isError) {
    body = (
      <StatePanel
        tone="error"
        title={t(`error.${errorCodeOf(products.error)}`)}
        action={<Button onClick={() => void products.refetch()}>{t("state.retry")}</Button>}
      />
    );
  } else {
    const productNameById = new Map(products.data.map((p) => [p.id, p.name]));
    const sorted = sortByAllocationPriority(batches.data);
    body = (
      <BatchTable
        batches={sorted}
        showCost={showCost}
        productNameFor={(productId) => productNameById.get(productId) ?? productId}
      />
    );
  }

  return (
    <>
      <PageHeader title={t("nav.inventory.batches")} />
      {body}
    </>
  );
}

export function BatchesPage() {
  return (
    <NavGate path={PATH}>
      <BatchRegister />
    </NavGate>
  );
}
