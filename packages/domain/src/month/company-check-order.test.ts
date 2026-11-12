import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";

describe("D129 cheque-funded orders", () => {
  it("does not raise companyPayable for paidByCheck orders", () => {
    const out = computeMonth({
      products: [{ id: "p1", piecesPerCarton: "12" }],
      opening: {
        products: {
          p1: {
            stock: "0",
            dueFromCompany: "0",
            orderPrice: "10",
            costPrice: "8",
            salePrice: "12",
          },
        },
        companyPayable: "0",
      },
      days: [
        {
          date: "2026-03-01",
          products: {
            p1: {
              orders: [
                {
                  pieces: "24",
                  cartonRate: "120",
                  piecesPerCarton: "12",
                  paidByCheck: true,
                },
              ],
            },
          },
        },
      ],
    });
    expect(out.closing.companyPayable).toBe("0");
    expect(out.month.companyPayable.closing).toBe("0");
    expect(out.month.companyPayable.orders).toBe("240");
    // Undelivered goods still tracked.
    expect(out.closing.products.p1?.dueFromCompany).toBe("24");
  });

  it("still raises companyPayable for cash orders", () => {
    const out = computeMonth({
      products: [{ id: "p1", piecesPerCarton: "12" }],
      opening: {
        products: {
          p1: {
            stock: "0",
            dueFromCompany: "0",
            orderPrice: "10",
            costPrice: "8",
            salePrice: "12",
          },
        },
        companyPayable: "0",
      },
      days: [
        {
          date: "2026-03-01",
          products: {
            p1: {
              orders: [{ pieces: "24", cartonRate: "120", piecesPerCarton: "12" }],
            },
          },
        },
      ],
    });
    expect(out.closing.companyPayable).toBe("240");
  });

  it("companyCheckPayment lowers cash book but not companyPayable", () => {
    const out = computeMonth({
      products: [{ id: "p1", piecesPerCarton: "12" }],
      opening: {
        products: { p1: { stock: "0", dueFromCompany: "0" } },
        companyPayable: "500",
        cashAccounts: { cash: "1000" },
      },
      days: [
        {
          date: "2026-03-01",
          money: [{ kind: "companyCheckPayment", amount: "200", account: "cash" }],
        },
      ],
    });
    expect(out.closing.companyPayable).toBe("500");
    expect(out.closing.cashAccounts?.cash).toBe("800");
  });
});
