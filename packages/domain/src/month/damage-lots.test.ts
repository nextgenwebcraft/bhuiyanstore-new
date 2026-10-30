import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import type { MonthInput } from "./types";

const run = (days: MonthInput["days"]) =>
  computeMonth({
    products: [{ id: "A", piecesPerCarton: "12" }],
    opening: {
      products: {
        A: { stock: "100", dueFromCompany: "0", costPrice: "8", salePrice: "10" },
      },
    },
    days,
  });

describe("damage lots by rate (D109)", () => {
  it("stores sheet damage at the entered rate, defaulting to the line's sale price", () => {
    const out = run([
      {
        date: "2026-11-01",
        dsrLines: [
          { staffId: "d1", productId: "A", issued: "10", damaged: "2", damageRate: "7.5" },
          { staffId: "d2", productId: "A", issued: "4", damaged: "1" },
        ],
      },
    ]);
    expect(out.days[0]?.products[0]?.damageLots).toEqual([
      { rate: "7.500000", pieces: "2" },
      { rate: "10.000000", pieces: "1" },
    ]);
    // The sheet's own sales still value damaged pieces at the sale price, not the custom rate.
    expect(out.days[0]?.products[0]).toMatchObject({ damaged: "3", sales: "110" });
  });

  it("merges the same rate and lets a deposit take only that rate", () => {
    const out = run([
      {
        date: "2026-11-01",
        dsrLines: [
          { staffId: "d1", productId: "A", issued: "6", damaged: "2", damageRate: "10" },
          { staffId: "d2", productId: "A", issued: "6", damaged: "3", damageRate: "10.00" },
          { staffId: "d2", productId: "A", issued: "4", damaged: "1", damageRate: "9" },
        ],
      },
      {
        date: "2026-11-02",
        products: {
          A: { companyRefunds: [{ quantity: "4", unitCost: "10" }] },
        },
      },
    ]);
    expect(out.days[1]?.products[0]?.damageLots).toEqual([
      { rate: "9.000000", pieces: "1" },
      { rate: "10.000000", pieces: "1" },
    ]);
    expect(out.closing.products.A?.damageLots).toEqual([
      { rate: "9.000000", pieces: "1" },
      { rate: "10.000000", pieces: "1" },
    ]);
  });
});
