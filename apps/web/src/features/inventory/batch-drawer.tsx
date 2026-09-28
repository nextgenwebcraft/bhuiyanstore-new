"use client";

import type { Batch } from "@bsd/contracts";
import { sortByAllocationPriority } from "@bsd/domain";
import { t } from "@bsd/i18n";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/button";
import { BatchTable } from "./batch-table";

export type BatchDrawerHandle = {
  open: (productId: string, productName: string) => void;
};

/**
 * Named reusable widget from guide section 21.6 (BatchAllocationDrawer): one product's batches,
 * FEFO/FIFO ordered (D05). Display-only for now; no allocation action exists yet.
 */
export const BatchDrawer = forwardRef<BatchDrawerHandle, { batches: Batch[]; showCost: boolean }>(
  function BatchDrawer({ batches, showCost }, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [productId, setProductId] = useState<string | null>(null);
    const [productName, setProductName] = useState("");

    useImperativeHandle(ref, () => ({
      open(nextProductId, nextProductName) {
        setProductId(nextProductId);
        setProductName(nextProductName);
        dialogRef.current?.showModal();
      },
    }));

    const productBatches = sortByAllocationPriority(
      batches.filter((b) => b.productId === productId),
    );

    return (
      <dialog
        ref={dialogRef}
        aria-label={`${t("nav.inventory.batches")} — ${productName}`}
        className="m-auto w-full max-w-2xl rounded-lg border border-border bg-surface p-0 text-text backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">{productName}</h2>
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
              {t("nav.close")}
            </Button>
          </div>
          <BatchTable batches={productBatches} showCost={showCost} />
        </div>
      </dialog>
    );
  },
);
