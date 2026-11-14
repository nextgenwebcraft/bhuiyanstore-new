import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import type { DayInput, MonthInput, MonthOpening, OrderInput } from "./types";

/**
 * D57: an order carries a carton rate and free pieces; the bill is pieces × rate ÷ carton size and
 * the receipt's batch costs receiptValue ÷ received pieces. Every number is worked out by hand.
 */
const catalog = [{ id: "A", piecesPerCarton: "24" }];
const empty: MonthOpening = {
  products: { A: { stock: "0", dueFromCompany: "0", salePrice: "30" } },
};
const run = (days: DayInput[], opening: MonthOpening = empty) =>
  computeMonth({ products: catalog, opening, days } satisfies MonthInput);
const order = (pieces: string, cartonRate: string, freePieces = "0"): OrderInput => ({
  pieces,
  freePieces,
  cartonRate,
  piecesPerCarton: "24",
});
const batches = (out: ReturnType<typeof run>, day: number) =>
  out.days[day]?.products[0]?.batches.map((b) => [b.seq, b.costPrice, b.salePrice, b.quantity]);
const near = (value: string | undefined, expected: number) =>
  expect(Number(value)).toBeCloseTo(expected, 9);

describe("D57 order with carton rate and free goods", () => {
  it("owner example: 10 cartons at 480 + 1 free carton bills 4800 and costs 4800/264 a piece", () => {
    const out = run([
      { date: "2026-11-01", products: { A: { orders: [order("240", "480", "24")] } } },
      { date: "2026-11-02", products: { A: { received: "264" } } },
    ]);
    const d1 = out.days[0]?.products[0];
    // Bill 240 × 480 ÷ 24 = 4800; undelivered 264 pieces worth 4800.
    expect([d1?.orderValue, d1?.dueFromCompany, d1?.dueFromCompanyValue]).toEqual([
      "4800",
      "264",
      "4800",
    ]);
    expect(out.month.companyPayable).toMatchObject({
      orders: "4800",
      receipts: "0",
      closing: "4800",
    });
    const d2 = out.days[1]?.products[0];
    expect([
      d2?.receiptValue,
      d2?.receiptBill,
      d2?.dueFromCompany,
      d2?.dueFromCompanyValue,
    ]).toEqual(["4800", "0", "0", "0"]);
    const batch = d2?.batches[0];
    expect(batch?.quantity).toBe("264");
    near(batch?.costPrice, 4800 / 264); // 18.1818…
    near(d2?.stockValue, 4800); // 264 pieces hold the whole bill
    expect(out.companyEntries[0]).toMatchObject({
      kind: "order",
      amount: "4800",
      quantity: "240",
      freeQuantity: "24",
      cartonRate: "480",
    });
  });

  it("a free-only order makes a zero-cost batch", () => {
    const out = run([
      { date: "2026-11-01", products: { A: { orders: [order("0", "0", "24")] } } },
      { date: "2026-11-02", products: { A: { received: "24" } } },
    ]);
    expect(out.days[0]?.products[0]?.dueFromCompany).toBe("24");
    expect(batches(out, 1)).toEqual([[1, "0", "30", "24"]]);
    expect(out.month.companyPayable.orders).toBe("0");
  });

  it("a partial receipt keeps the pool average for the rest", () => {
    const out = run([
      { date: "2026-11-01", products: { A: { orders: [order("240", "480", "24")] } } },
      { date: "2026-11-02", products: { A: { received: "132" } } },
      { date: "2026-11-03", products: { A: { received: "132" } } },
    ]);
    const d2 = out.days[1]?.products[0];
    // Half of 264 pieces releases half of 4800; the rest keeps 132 pieces worth 2400.
    expect([d2?.receiptValue, d2?.dueFromCompany, d2?.dueFromCompanyValue]).toEqual([
      "2400",
      "132",
      "2400",
    ]);
    near(d2?.batches[0]?.costPrice, 2400 / 132);
    // The second half costs the same per piece, so it merges into the same batch.
    expect(out.days[2]?.products[0]?.batches).toHaveLength(1);
    expect(out.days[2]?.products[0]?.batches[0]?.quantity).toBe("264");
    expect(out.days[2]?.products[0]?.dueFromCompanyValue).toBe("0");
  });

  it("two orders at different rates are pooled", () => {
    const out = run([
      {
        date: "2026-11-01",
        products: { A: { orders: [order("24", "480"), order("24", "600")] } },
      },
      { date: "2026-11-02", products: { A: { received: "48" } } },
    ]);
    // Bills 480 + 600 = 1080 for 48 pieces: 22.5 each.
    expect(out.days[0]?.products[0]?.dueFromCompanyValue).toBe("1080");
    expect(batches(out, 1)).toEqual([[1, "22.5", "30", "48"]]);
    expect(out.companyEntries.filter((e) => e.kind === "order").map((e) => e.balance)).toEqual([
      "480",
      "1080",
    ]);
  });

  it("bills a receipt beyond the order at the current order price", () => {
    const out = run(
      [
        { date: "2026-11-01", products: { A: { orders: [order("24", "480")] } } },
        { date: "2026-11-02", products: { A: { received: "30" } } },
      ],
      { products: { A: { stock: "0", dueFromCompany: "0", orderPrice: "25", salePrice: "30" } } },
    );
    const d2 = out.days[1]?.products[0];
    // 24 covered release 480; 6 excess at 25 = 150; 630 ÷ 30 pieces = 21 each.
    expect([d2?.receiptBill, d2?.receiptValue]).toEqual(["150", "630"]);
    expect(batches(out, 1)).toEqual([[1, "21", "30", "30"]]);
    expect(out.month.companyPayable).toMatchObject({
      orders: "480",
      receipts: "150",
      closing: "630",
    });
  });

  it("receipts at the same cost and sale price merge; a different cost opens a batch", () => {
    const out = run([
      { date: "2026-11-01", products: { A: { orders: [order("24", "480")] } } },
      { date: "2026-11-02", products: { A: { received: "24", orders: [order("24", "480")] } } },
      { date: "2026-11-03", products: { A: { received: "24", orders: [order("24", "600")] } } },
      { date: "2026-11-04", products: { A: { received: "24" } } },
    ]);
    expect(batches(out, 1)).toEqual([[1, "20", "30", "24"]]);
    // Day 2 received 24 of the 48 due at 20 each (pool 960 for 48): same cost, still one batch.
    expect(out.days[1]?.products[0]?.batches).toHaveLength(1);
    // Day 3 receives against a pool of 24 @ 20 (day 2) + 24 @ 25 (day 3): 22.5 average, a new batch.
    expect(out.days[2]?.products[0]?.receiptValue).toBe("540");
    expect(batches(out, 2)).toEqual([
      [1, "20", "30", "24"],
      [2, "22.5", "30", "24"],
    ]);
  });
});
