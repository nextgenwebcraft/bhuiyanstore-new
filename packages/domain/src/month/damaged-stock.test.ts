import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import { damageEventError, damageLineProgress } from "./damage-case";
import type { MonthInput } from "./types";

/** D53 godown damage and damaged-goods stock: hand-worked figures. */
const run = (
  days: MonthInput["days"],
  opening: Partial<MonthInput["opening"]["products"]["A"]> = {},
) =>
  computeMonth({
    products: [{ id: "A", piecesPerCarton: "24" }],
    opening: {
      products: {
        A: { stock: "100", dueFromCompany: "0", costPrice: "9", salePrice: "11", ...opening },
      },
    },
    days,
  });

describe("pieces found damaged in the godown (D53)", () => {
  const out = run([{ date: "2026-11-01", products: { A: { godownDamaged: "4" } } }]);

  it("lowers saleable stock, charges the cost and shows the damage value, with no sales", () => {
    expect(out.days[0]?.products[0]).toMatchObject({
      godownDamaged: "4",
      stock: "96",
      sales: "0",
      sold: "0",
      cost: "36", // 4 x 9
      grossProfit: "-36",
      damageValue: "36",
      damagedStock: "4",
      damageAtCompany: "0",
    });
    expect(out.month.profit.gross).toBe("-36");
    expect(out.month.products[0]).toMatchObject({ godownDamaged: "4", damagedStock: "4" });
    expect(out.closing.products.A).toMatchObject({ stock: "96", damagedStock: "4" });
  });

  it("is not product-level damaged (that stays the importer's Excel N)", () => {
    const importer = run([{ date: "2026-11-01", products: { A: { damaged: "4" } } }]);
    expect(importer.days[0]?.products[0]).toMatchObject({
      damaged: "4",
      godownDamaged: "0",
      damagedStock: "0", // the importer path never creates damaged goods stock
    });
  });
});

describe("damaged goods stock and damage at the company (D53)", () => {
  it("counts DSR sheet damage and the buyer's pieces taken in at the godown", () => {
    const out = run([
      {
        date: "2026-11-01",
        dsrLines: [{ staffId: "d1", productId: "A", issued: "10", damaged: "3" }],
        products: { A: { replacedFromStock: "2" } },
      },
    ]);
    // 3 from the sheet + 2 the buyer handed back when given good pieces from the godown.
    expect(out.days[0]?.products[0]).toMatchObject({ damagedStock: "5", stock: "88" });
  });

  it("moves pieces to the company on dispatch and back on a reject", () => {
    const out = run(
      [
        { date: "2026-11-01", products: { A: { companyDispatched: "6" } } },
        { date: "2026-11-02", products: { A: { companyRejected: "2" } } },
      ],
      { damagedStock: "10" },
    );
    expect(out.days[0]?.products[0]).toMatchObject({ damagedStock: "4", damageAtCompany: "6" });
    expect(out.days[1]?.products[0]).toMatchObject({ damagedStock: "6", damageAtCompany: "4" });
    // No money or profit effect from dispatch/reject: the loss was charged when it happened.
    expect(out.month.profit.gross).toBe("0");
    expect(out.month.companyPayable.closing).toBe("0");
  });

  it("clears the company's side by replacement goods and by money refunds", () => {
    const out = run(
      [
        {
          date: "2026-11-01",
          products: {
            A: {
              replacements: [{ quantity: "3", unitCost: "8" }],
              companyRefunds: [{ quantity: "2", unitCost: "9" }],
            },
          },
        },
      ],
      { damageAtCompany: "10" },
    );
    expect(out.days[0]?.products[0]).toMatchObject({
      damageAtCompany: "5", // 10 - 3 - 2
      stock: "103", // replacements are saleable stock
      grossProfit: "0",
    });
    expect(out.month.profit.net).toBe("0"); // D47 amendment: recovery is not profit
    expect(out.month.companyPayable.closing).toBe("-18"); // only the refund lowers the payable
  });

  it("removes written-off pieces from damaged stock with no money effect", () => {
    const out = run([{ date: "2026-11-01", products: { A: { writtenOff: "3" } } }], {
      damagedStock: "5",
    });
    expect(out.days[0]?.products[0]).toMatchObject({ damagedStock: "2", stock: "100" });
    expect(out.month.profit.net).toBe("0");
  });

  it("opens damaged stock at 0 and carries it through the closing", () => {
    const first = run([{ date: "2026-11-01", products: { A: { godownDamaged: "1" } } }]);
    const second = computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: first.closing,
      days: [{ date: "2026-11-02", products: { A: { companyDispatched: "1" } } }],
    });
    expect(second.closing.products.A).toMatchObject({ damagedStock: "0", damageAtCompany: "1" });
  });
});

describe("floor stock damage deposit (D131)", () => {
  it("takes saleable pieces from a named batch and raises the damage balance", () => {
    const out = computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: {
          A: {
            stock: "20",
            dueFromCompany: "0",
            costPrice: "10",
            salePrice: "15",
            batches: [
              {
                key: "b1",
                seq: 1,
                startDate: "opening",
                costPrice: "10",
                salePrice: "15",
                quantity: "20",
              },
            ],
          },
        },
      },
      days: [
        {
          date: "2026-11-01",
          products: {
            A: {
              batchDamageDeposits: [
                { key: "b1", seq: 1, quantity: "4", unitCost: "10", ref: "fd1" },
              ],
            },
          },
        },
      ],
    });
    expect(out.days[0]?.products[0]).toMatchObject({
      stock: "16",
      sales: "0",
      cost: "0",
      grossProfit: "0",
      damageRecovery: "40",
    });
    expect(out.month.companyPayable).toMatchObject({
      closing: "-40",
      damageBalance: "40",
      damageRefunds: "40",
    });
    expect(out.companyEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "damageRefund", amount: "40", ref: "fd1", productId: "A" }),
      ]),
    );
  });
});

describe("damage case custody (D53)", () => {
  const events = (...e: [string, string][]) =>
    e.map(([kind, quantity]) => ({ kind: kind as never, quantity }));

  it("a company reject restores the pieces to still-here", () => {
    const p = damageLineProgress(
      "ownedStock",
      "10",
      events(["companyDispatch", "10"], ["companyReject", "4"]),
    );
    expect(p.stillHere).toBe("4"); // 10 received - 10 sent + 4 rejected
    expect(p.awaitingAcceptance).toBe("6");
    expect(damageEventError("ownedStock", p, "companyDispatch", "4")).toBeNull();
    expect(damageEventError("ownedStock", p, "writeOff", "4")).toBeNull();
    expect(damageEventError("ownedStock", p, "writeOff", "5")).toBe("overWriteOff");
  });

  it("a rejected line can be written off", () => {
    const p = damageLineProgress(
      "ownedStock",
      "10",
      events(["companyDispatch", "10"], ["companyReject", "10"], ["writeOff", "10"]),
    );
    expect(p.stillHere).toBe("0");
  });
});
