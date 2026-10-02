"use client";

import type { GoodsReceipt, GoodsReceiptKind } from "@bsd/contracts";
import { formatAmount, formatRate, t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { useGoodsReceipts, useProducts, useSuppliers } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { ReceiptForm } from "./receipt-form";

const PATH = "purchases/receipts";

function ReceiptCard({ receipt }: { receipt: GoodsReceipt }) {
  return (
    <li className="rounded-lg border border-border bg-surface">
      <details>
        <summary className="flex min-h-(--touch-target) cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
          <span className="font-medium">
            {receipt.number} · {toBengaliDigits(receipt.receivedDate)}
          </span>
          <span className="text-sm text-text-muted">{t(`receipt.kind.${receipt.kind}`)}</span>
          <span className="font-semibold tabular-nums">{formatAmount(receipt.totalValue)}</span>
        </summary>
        <div className="border-t border-border p-4 text-sm">
          <p className="mb-3 text-text-muted">
            {receipt.supplierName}
            {receipt.reference ? ` · ${t("common.reference")}: ${receipt.reference}` : ""}
          </p>
          <table className="w-full border-collapse">
            <thead className="text-left text-text-muted">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  {t("inventory.column.product")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t("inventory.column.lot")}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t("common.quantity")}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t("receipt.unitCost")}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t("receipt.lineValue")}
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => (
                <tr key={line.batchId} className="border-t border-border">
                  <td className="py-1">{line.productName}</td>
                  <td className="py-1 font-mono">{line.lotId ?? "—"}</td>
                  <td className="py-1 text-right">{toBengaliDigits(line.quantity)}</td>
                  <td className="py-1 text-right">{formatRate(line.unitCost)}</td>
                  <td className="py-1 text-right">{formatAmount(line.lineValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </li>
  );
}

function Receipts() {
  const { company, permissions } = useCurrentWorkspace();
  const receipts = useGoodsReceipts(company.id);
  const products = useProducts(company.id);
  const suppliers = useSuppliers(company.id);
  const [formOpen, setFormOpen] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);

  const allowedKinds: GoodsReceiptKind[] = [];
  if (permissions.includes("purchase.post")) allowedKinds.push("purchase");
  if (permissions.includes("supplier_incentive.receive")) allowedKinds.push("supplier_incentive");

  let body: React.ReactNode;
  if (receipts.isPending) {
    body = <ListSkeleton />;
  } else if (receipts.isError) {
    body = <QueryError error={receipts.error} onRetry={() => void receipts.refetch()} />;
  } else if (receipts.data.length === 0) {
    body = <StatePanel title={t("receipt.empty")} />;
  } else {
    const newestFirst = [...receipts.data].sort((a, b) => b.postingSequence - a.postingSequence);
    body = (
      <ul className="flex flex-col gap-3">
        {newestFirst.map((r) => (
          <ReceiptCard key={r.id} receipt={r} />
        ))}
      </ul>
    );
  }

  const canOpenForm = allowedKinds.length > 0 && products.isSuccess && suppliers.isSuccess;

  return (
    <>
      <PageHeader
        title={t("nav.purchases.receipts")}
        actions={
          allowedKinds.length > 0 && !formOpen ? (
            <Button
              variant="primary"
              disabled={!canOpenForm}
              onClick={() => {
                setLastPosted(null);
                setFormOpen(true);
              }}
            >
              {t("receipt.new")}
            </Button>
          ) : null
        }
      />
      {lastPosted ? (
        <div className="mb-4">
          <StatePanel title={`${t("common.posted")}: ${lastPosted}`} />
        </div>
      ) : null}
      {formOpen && products.isSuccess && suppliers.isSuccess ? (
        <ReceiptForm
          companyId={company.id}
          products={products.data}
          suppliers={suppliers.data}
          allowedKinds={allowedKinds}
          onClose={() => setFormOpen(false)}
          onPosted={(receipt) => {
            setFormOpen(false);
            setLastPosted(receipt.number);
          }}
        />
      ) : null}
      {body}
    </>
  );
}

export function ReceiptsPage() {
  return (
    <NavGate path={PATH}>
      <Receipts />
    </NavGate>
  );
}
