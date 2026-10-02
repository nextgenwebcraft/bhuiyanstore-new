import type { Batch } from "@bsd/contracts";
import { describe, expect, it } from "vitest";
import { summarizeStockByProduct } from "./stock-summary";

function batch(
  overrides: Partial<Batch> & Pick<Batch, "id" | "productId" | "availableQuantity">,
): Batch {
  return {
    companyId: "drinko",
    lotId: undefined,
    receivedDate: "2026-01-01",
    location: "godown",
    origin: "opening",
    unitCost: "10.000000",
    receivedQuantity: overrides.availableQuantity,
    reservedQuantity: "0",
    quarantineQuantity: "0",
    ...overrides,
  };
}

describe("summarizeStockByProduct", () => {
  it("sums available quantity across a product's batches and counts them", () => {
    const batches = [
      batch({ id: "a", productId: "p1", availableQuantity: "100" }),
      batch({ id: "b", productId: "p1", availableQuantity: "50" }),
      batch({ id: "c", productId: "p2", availableQuantity: "20" }),
    ];
    const summary = summarizeStockByProduct(batches);
    expect(summary).toEqual(
      expect.arrayContaining([
        { productId: "p1", availableQuantity: "150", batchCount: 2 },
        { productId: "p2", availableQuantity: "20", batchCount: 1 },
      ]),
    );
  });

  it("excludes reserved and quarantine quantities from the total", () => {
    const batches = [
      batch({
        id: "a",
        productId: "p1",
        availableQuantity: "60",
        reservedQuantity: "10",
        quarantineQuantity: "30",
        receivedQuantity: "100",
      }),
    ];
    expect(summarizeStockByProduct(batches)).toEqual([
      { productId: "p1", availableQuantity: "60", batchCount: 1 },
    ]);
  });

  it("returns an empty list for no batches", () => {
    expect(summarizeStockByProduct([])).toEqual([]);
  });
});
