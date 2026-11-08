import { describe, expect, it } from "vitest";
import {
  batchDueParts,
  orderBatchCostPrice,
  orderJoinsLatestBatch,
  pieceFromCarton,
} from "./batch-lots";

describe("orderBatchCostPrice (D68)", () => {
  const ppc = "24";

  it("is cartonRate ÷ ppc when there are no free pieces", () => {
    expect(
      orderBatchCostPrice({ paid: "72", free: "0", cartonRate: "420", piecesPerCarton: ppc }),
    ).toBe(pieceFromCarton("420", ppc));
  });

  it("is bill ÷ (paid + free) when free pieces lower the effective cost", () => {
    // 3 cartons @ 420 = bill 1260; +10 free → 1260 / 82
    expect(
      orderBatchCostPrice({ paid: "72", free: "10", cartonRate: "420", piecesPerCarton: ppc }),
    ).toBe("15.365854");
  });

  it("returns null for a free-only order", () => {
    expect(
      orderBatchCostPrice({ paid: "0", free: "12", cartonRate: "420", piecesPerCarton: ppc }),
    ).toBeNull();
  });
});

describe("orderJoinsLatestBatch (D68)", () => {
  const ppc = "24";
  const latest = {
    costPrice: pieceFromCarton("420", ppc),
    salePrice: pieceFromCarton("500", ppc),
  };

  it("joins when paid-only prices match the latest batch", () => {
    expect(
      orderJoinsLatestBatch(latest, {
        paid: "72",
        free: "0",
        cartonRate: "420",
        piecesPerCarton: ppc,
        salePrice: latest.salePrice,
      }),
    ).toBe(true);
  });

  it("opens a new batch when free goods change the effective cost", () => {
    expect(
      orderJoinsLatestBatch(latest, {
        paid: "72",
        free: "10",
        cartonRate: "420",
        piecesPerCarton: ppc,
        salePrice: latest.salePrice,
      }),
    ).toBe(false);
  });

  it("opens a new batch when only the carton rate differs", () => {
    expect(
      orderJoinsLatestBatch(latest, {
        paid: "72",
        cartonRate: "480",
        piecesPerCarton: ppc,
        salePrice: latest.salePrice,
      }),
    ).toBe(false);
  });

  it("opens a new batch when only the sale price differs", () => {
    expect(
      orderJoinsLatestBatch(latest, {
        paid: "72",
        cartonRate: "420",
        piecesPerCarton: ppc,
        salePrice: pieceFromCarton("520", ppc),
      }),
    ).toBe(false);
  });

  it("joins another free order with the same effective cost and sale", () => {
    const withFree = {
      costPrice: must(orderBatchCostPrice({ paid: "72", free: "10", cartonRate: "420", piecesPerCarton: ppc })),
      salePrice: latest.salePrice,
    };
    expect(
      orderJoinsLatestBatch(withFree, {
        paid: "72",
        free: "10",
        cartonRate: "420",
        piecesPerCarton: ppc,
        salePrice: latest.salePrice,
      }),
    ).toBe(true);
  });
});

function must(value: string | null): string {
  if (value === null) throw new Error("expected cost");
  return value;
}

describe("batchDueParts (D118)", () => {
  it("splits paid and free due from orders", () => {
    const due = batchDueParts([
      { batchId: "b1", orderedPaid: "72", orderedFree: "10" },
    ]);
    expect(due.get("b1")).toEqual({
      undelivered: "82",
      undeliveredPaid: "72",
      undeliveredFree: "10",
    });
  });

  it("subtracts explicit paid and free receipts separately", () => {
    const due = batchDueParts([
      { batchId: "b1", orderedPaid: "72", orderedFree: "10" },
      { batchId: "b1", receivedPaid: "24", receivedFree: "10" },
    ]);
    expect(due.get("b1")).toEqual({
      undelivered: "48",
      undeliveredPaid: "48",
      undeliveredFree: "0",
    });
  });

  it("allocates legacy combined receipts paid-first then free", () => {
    const due = batchDueParts([
      { batchId: "b1", orderedPaid: "72", orderedFree: "10" },
      { batchId: "b1", receivedCombined: "75" },
    ]);
    expect(due.get("b1")).toEqual({
      undelivered: "7",
      undeliveredPaid: "0",
      undeliveredFree: "7",
    });
  });
});
