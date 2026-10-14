import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import type { MonthInput } from "./types";

describe("damage collected by a DSR (D47)", () => {
  const base = (day: MonthInput["days"][number]) =>
    computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: { A: { stock: "100", dueFromCompany: "0", costPrice: "9", salePrice: "11" } },
      },
      days: [day],
    });

  it("never lowers stock beyond the delivered pieces", () => {
    const out = base({
      date: "2026-11-01",
      dsrLines: [{ staffId: "d1", productId: "A", issued: "10", damaged: "3" }],
    });
    // Delivered 10 leave the godown; the 3 damaged ones do not subtract again.
    expect(out.days[0]?.products[0]).toMatchObject({ delivered: "10", damaged: "3", sold: "7" });
    expect(out.days[0]?.products[0]?.stock).toBe("90");
  });

  it("charges the cost of the damaged pieces and lowers sales by their price", () => {
    const out = base({
      date: "2026-11-01",
      dsrLines: [{ staffId: "d1", productId: "A", issued: "10", damaged: "3" }],
    });
    // Sales 7 x 11 = 77; cost 10 x 9 = 90 (not 7 x 9); profit 77 - 90 = -13.
    expect(out.days[0]?.products[0]).toMatchObject({
      sales: "77",
      cost: "90",
      grossProfit: "-13",
      damageValue: "27",
    });
    expect(out.days[0]?.persons[0]).toMatchObject({ amount: "110", soldValue: "77", sold: "7" });
  });

  it("charges the cost of a good piece handed out of the godown for a buyer's damaged one", () => {
    const out = base({ date: "2026-11-01", products: { A: { replacedFromStock: "4" } } });
    // Leaves stock (96), cost 4 x 9 = 36 hits gross profit, no sale.
    expect(out.days[0]?.products[0]).toMatchObject({
      stock: "96",
      sales: "0",
      cost: "36",
      grossProfit: "-36",
      damageValue: "36",
    });
  });

  it("adds damage refunds and replacement goods to net profit, not to gross profit", () => {
    const out = base({
      date: "2026-11-01",
      products: {
        A: {
          companyRefunds: [{ quantity: "5", unitCost: "9.5" }],
          replacements: [{ quantity: "3", unitCost: "8" }],
        },
      },
    });
    expect(out.month.profit.gross).toBe("0");
    expect(out.days[0]?.products[0]).toMatchObject({ grossProfit: "0", damageRecovery: "71.5" });
    expect(out.month.profit.damageRecovery).toBe("71.5"); // 47.5 refund + 24 replacement
    expect(out.month.profit.net).toBe("71.5");
    expect(out.month.profit.netWithoutIncentive).toBe("71.5");
    expect(out.month.totals.damageRecovery).toBe("71.5");
    // The refund still lowers what we owe; the replacements are memos on the company account.
    expect(out.month.companyPayable.closing).toBe("-47.5");
    expect(out.companyEntries.find((e) => e.kind === "replacement")).toMatchObject({
      amount: "24",
      quantity: "3",
      balance: "-47.5",
    });
  });
});

describe("company order billed at once (D48)", () => {
  const run = (
    opening: { due?: string; dueValue?: string; payable?: string },
    days: MonthInput["days"],
  ) =>
    computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: {
          A: {
            stock: "0",
            dueFromCompany: opening.due ?? "0",
            ...(opening.dueValue === undefined ? {} : { dueFromCompanyValue: opening.dueValue }),
            orderPrice: "1000",
            costPrice: "900",
          },
        },
        companyPayable: opening.payable ?? "0",
      },
      days,
    });

  it("deducts an order from the deposit at once: 60,000 deposited, 40,000 ordered, 20,000 left", () => {
    const out = run({ payable: "-60000" }, [
      { date: "2026-11-01", products: { A: { ordered: "40" } } },
    ]);
    expect(out.month.companyPayable).toMatchObject({
      opening: "-60000",
      orders: "40000",
      receipts: "0",
      closing: "-20000", // balance with the company = 20,000
      undeliveredOpening: "0",
      undeliveredClosing: "40000",
    });
    expect(out.closing.companyPayable).toBe("-20000");
    expect(out.companyEntries).toEqual([
      {
        date: "2026-11-01",
        kind: "order",
        amount: "40000",
        productId: "A",
        quantity: "40",
        balance: "-20000",
        undelivered: "40000",
      },
    ]);
    expect(out.closing.products.A).toMatchObject({
      dueFromCompany: "40",
      dueFromCompanyValue: "40000",
    });
  });

  it("moves no money when ordered goods are received", () => {
    const out = run({ payable: "-60000" }, [
      { date: "2026-11-01", products: { A: { ordered: "40" } } },
      { date: "2026-11-02", products: { A: { received: "40" } } },
    ]);
    expect(out.days[1]?.products[0]).toMatchObject({
      stock: "40",
      dueFromCompany: "0",
      dueFromCompanyValue: "0",
      receiptBill: "0",
      receiptValue: "40000",
    });
    expect(out.month.companyPayable.closing).toBe("-20000");
    expect(out.month.companyPayable.undeliveredClosing).toBe("0");
    expect(out.companyEntries[1]).toMatchObject({
      kind: "receipt",
      amount: "0",
      quantity: "40",
      balance: "-20000",
      undelivered: "0",
    });
  });

  it("bills only the excess when more is received than was ordered", () => {
    const out = run({ due: "10", dueValue: "10000", payable: "0" }, [
      { date: "2026-11-01", products: { A: { ordered: "5", received: "20" } } },
    ]);
    // Ordered 5 (5,000) is billed; of the 20 received 15 are covered (10 opening + 5 today).
    expect(out.month.companyPayable).toMatchObject({ orders: "5000", receipts: "5000" });
    expect(out.month.companyPayable.closing).toBe("10000");
    expect(out.days[0]?.products[0]).toMatchObject({
      dueFromCompany: "0",
      dueFromCompanyValue: "0",
      receiptBill: "5000",
      receiptValue: "20000", // 15,000 released + 5,000 excess
    });
  });

  it("values the undelivered goods proportionally and is exactly 0 when the due clears", () => {
    const out = run({ due: "3", dueValue: "100", payable: "100" }, [
      { date: "2026-11-01", products: { A: { received: "1" } } },
      { date: "2026-11-02", products: { A: { received: "1" } } },
      { date: "2026-11-03", products: { A: { received: "1" } } },
    ]);
    const values = out.days.map((d) => d.products[0]?.dueFromCompanyValue ?? "");
    expect(values[0]?.startsWith("66.666666666666")).toBe(true); // 100 - 100 x 1/3
    expect(values[1]?.startsWith("33.333333333333")).toBe(true); // half of the rest
    expect(values[2]).toBe("0");
    expect(out.closing.products.A?.dueFromCompanyValue).toBe("0");
    expect(out.month.companyPayable.closing).toBe("100");
  });

  it("defaults the opening undelivered value to due x opening order price", () => {
    const out = run({ due: "7" }, []);
    expect(out.month.companyPayable.undeliveredOpening).toBe("7000");
    expect(out.closing.products.A?.dueFromCompanyValue).toBe("7000");
  });

  it("keeps the order/receipt identity and the payable identity over several days", () => {
    const out = run({ due: "10", dueValue: "9000", payable: "-5000" }, [
      {
        date: "2026-11-01",
        products: { A: { ordered: "20", received: "4" } },
        money: [{ kind: "supplierDeposit", amount: "3000" }],
      },
      {
        date: "2026-11-02",
        products: { A: { orderPrice: "1100", ordered: "10", received: "40" } },
        money: [{ kind: "companyIncentive", amount: "250" }],
      },
      {
        date: "2026-11-03",
        products: { A: { received: "3", companyRefunds: [{ quantity: "2", unitCost: "800" }] } },
      },
    ]);
    const c = out.month.companyPayable;
    const receivedValue = out.days.reduce(
      (total, d) => total + Number(d.products[0]?.receiptValue ?? 0),
      0,
    );
    // Sum of orders + excess bills = goods received at bill + closing undelivered - opening undelivered.
    expect(Number(c.orders) + Number(c.receipts)).toBeCloseTo(
      receivedValue + Number(c.undeliveredClosing) - Number(c.undeliveredOpening),
      6,
    );
    // closing payable = opening + orders + excess bills - deposits - incentives - damage refunds.
    expect(Number(c.closing)).toBeCloseTo(
      Number(c.opening) +
        Number(c.orders) +
        Number(c.receipts) -
        Number(c.deposits) -
        Number(c.incentives) -
        Number(c.damageRefunds),
      6,
    );
    expect(c.undeliveredClosing).toBe(out.closing.products.A?.dueFromCompanyValue);
    expect(out.companyEntries.at(-1)?.balance).toBe(c.closing);
    expect(out.companyEntries.at(-1)?.undelivered).toBe(c.undeliveredClosing);
  });
});
