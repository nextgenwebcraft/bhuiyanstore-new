import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import type { DayInput, MonthInput, MonthOpening } from "./types";

/**
 * D49 FIFO batches. Every expected number is worked out by hand from the rules in PLAN §2.3:
 * a receipt at a changed cost or sale price starts a new batch; older batches sell first at their
 * own prices; zero-cost batches hold free goods and company replacements.
 */

// D57: a receipt batch costs its billed value per piece (order price here), so cases that receive
// goods at a cost set the order price equal to that cost; the expected numbers stay as worked out.
const catalog = [{ id: "A", piecesPerCarton: "12" }];
const run = (opening: MonthOpening, days: DayInput[]) =>
  computeMonth({ products: catalog, opening, days } satisfies MonthInput);
const batch = (
  seq: number,
  startDate: string,
  costPrice: string,
  salePrice: string,
  q: string,
) => ({
  seq,
  startDate,
  costPrice,
  salePrice,
  quantity: q,
});
const view = (out: ReturnType<typeof run>, day: number) => {
  const p = out.days[day]?.products[0];
  if (!p) throw new Error("no product day");
  return p;
};
const shown = (p: ReturnType<typeof view>) =>
  p.batches.map((b) => [b.seq, b.startDate, b.costPrice, b.salePrice, b.quantity]);

describe("batches: receipt rules", () => {
  // Opening 100 pieces at cost 10 / sale 15 (one batch). Day 1 receives 50 at 11/16 (new batch),
  // day 2 receives 40 at 12/18 (new batch), day 3 sells across all of them, day 4 receives 20 at
  // the unchanged 12/18 (merges).
  const out = run(
    {
      products: {
        A: {
          stock: "100",
          dueFromCompany: "0",
          orderPrice: "10",
          costPrice: "10",
          salePrice: "15",
        },
      },
    },
    [
      {
        date: "2026-11-01",
        products: { A: { received: "50", orderPrice: "11", costPrice: "11", salePrice: "16" } },
        dsrLines: [{ staffId: "d1", productId: "A", issued: "30" }],
      },
      {
        date: "2026-11-02",
        products: { A: { received: "40", orderPrice: "12", costPrice: "12", salePrice: "18" } },
        dsrLines: [{ staffId: "d1", productId: "A", issued: "10" }],
      },
      { date: "2026-11-03", dsrLines: [{ staffId: "d1", productId: "A", issued: "120" }] },
      { date: "2026-11-04", products: { A: { received: "20" } } },
    ],
  );

  it("opens a new batch only when the receipt's price differs, older batches keep theirs", () => {
    const d1 = view(out, 0);
    expect(shown(d1)).toEqual([
      [1, "opening", "10", "15", "70"],
      [2, "2026-11-01", "11", "16", "50"],
    ]);
    // 30 sold from batch 1: 30 × 15 = 450, cost 30 × 10 = 300; stock 70 + 50; value 700 + 550.
    expect([d1.sales, d1.cost, d1.stock, d1.stockValue]).toEqual(["450", "300", "120", "1250"]);
    // Current product prices = the newest batch.
    expect([d1.costPrice, d1.salePrice]).toEqual(["11", "16"]);
    expect(shown(view(out, 1))).toEqual([
      [1, "opening", "10", "15", "60"],
      [2, "2026-11-01", "11", "16", "50"],
      [3, "2026-11-02", "12", "18", "40"],
    ]);
    expect(view(out, 1).stockValue).toBe("1630"); // 600 + 550 + 480
  });

  it("allocates a DSR line FIFO across three batches and prices sales and cost per batch", () => {
    const d3 = view(out, 2);
    // 120 pieces = 60 @ 15 + 50 @ 16 + 10 @ 18.
    expect(out.days[2]?.persons[0]?.allocations).toEqual([
      { seq: 1, quantity: "60", costPrice: "10", salePrice: "15" },
      { seq: 2, quantity: "50", costPrice: "11", salePrice: "16" },
      { seq: 3, quantity: "10", costPrice: "12", salePrice: "18" },
    ]);
    expect(d3.sales).toBe("1880"); // 900 + 800 + 180
    expect(d3.cost).toBe("1270"); // 600 + 550 + 120
    expect(d3.grossProfit).toBe("610");
    expect(out.days[2]?.persons[0]).toMatchObject({
      amount: "1880",
      sold: "120",
      soldValue: "1880",
    });
    // Emptied older batches disappear; stock is the sum of what is left.
    expect(shown(d3)).toEqual([[3, "2026-11-02", "12", "18", "30"]]);
    expect([d3.stock, d3.stockValue]).toEqual(["30", "360"]);
  });

  it("merges a receipt at the same prices into the newest batch", () => {
    expect(shown(view(out, 3))).toEqual([[3, "2026-11-02", "12", "18", "50"]]);
  });

  it("starts a new batch when only the sale price (or only the cost) differs", () => {
    const sale = run(
      {
        products: {
          A: {
            stock: "10",
            dueFromCompany: "0",
            orderPrice: "10",
            costPrice: "10",
            salePrice: "15",
          },
        },
      },
      [{ date: "2026-11-01", products: { A: { received: "5", salePrice: "16" } } }],
    );
    expect(shown(view(sale, 0))).toEqual([
      [1, "opening", "10", "15", "10"],
      [2, "2026-11-01", "10", "16", "5"],
    ]);
    const cost = run(
      {
        products: {
          A: {
            stock: "10",
            dueFromCompany: "0",
            orderPrice: "10",
            costPrice: "10",
            salePrice: "15",
          },
        },
      },
      [{ date: "2026-11-01", products: { A: { received: "5", orderPrice: "9", costPrice: "9" } } }],
    );
    expect(shown(view(cost, 0))).toEqual([
      [1, "opening", "10", "15", "10"],
      [2, "2026-11-01", "9", "15", "5"],
    ]);
  });
});

describe("batches: price change without a receipt", () => {
  it("re-prices the newest batch only", () => {
    const out = run(
      {
        products: {
          A: {
            stock: "70",
            dueFromCompany: "0",
            batches: [
              batch(1, "2026-10-01", "10", "15", "40"),
              batch(2, "2026-10-20", "11", "16", "30"),
            ],
          },
        },
      },
      [
        {
          date: "2026-11-01",
          products: { A: { costPrice: "12", salePrice: "17" } },
          dsrLines: [{ staffId: "d1", productId: "A", issued: "50" }],
        },
      ],
    );
    // The opening prices come from the newest batch (11 / 16) until the day changes them.
    expect(shown(view(out, 0))).toEqual([[2, "2026-10-20", "12", "17", "20"]]);
    // 40 @ 15 (batch 1 keeps 10/15) + 10 @ 17 = 770; cost 400 + 10 × 12 = 520.
    expect(out.days[0]?.persons[0]?.allocations).toEqual([
      { seq: 1, quantity: "40", costPrice: "10", salePrice: "15" },
      { seq: 2, quantity: "10", costPrice: "12", salePrice: "17" },
    ]);
    expect([view(out, 0).sales, view(out, 0).cost]).toEqual(["770", "520"]);
  });
});

describe("batches: damaged pieces and price splits", () => {
  const out = run(
    {
      products: {
        A: {
          stock: "50",
          dueFromCompany: "0",
          batches: [
            batch(1, "2026-10-01", "10", "15", "20"),
            batch(2, "2026-10-20", "11", "16", "30"),
          ],
        },
      },
    },
    [
      {
        date: "2026-11-01",
        dsrLines: [
          {
            staffId: "d1",
            productId: "A",
            issued: "30",
            damaged: "5",
            priceSplits: [{ quantity: "22", unitPrice: "14" }],
          },
        ],
      },
    ],
  );

  it("takes the damaged pieces from the end of the allocation and sells the first ones", () => {
    const person = out.days[0]?.persons[0];
    // 30 allocated = 20 @ batch 1 + 10 @ batch 2; sold = first 25, damaged = last 5 (batch 2).
    expect(person?.allocations).toEqual([
      { seq: 1, quantity: "20", costPrice: "10", salePrice: "15" },
      { seq: 2, quantity: "10", costPrice: "11", salePrice: "16" },
    ]);
    // Split: first 22 sold pieces at 14 replace 20 @ 15 (−20) and 2 @ 16 (−4) = −24.
    // soldValue = 20 × 15 + 5 × 16 − 24 = 356; amount (all 30) = 300 + 160 − 24 = 436.
    expect(person).toMatchObject({ sold: "25", soldValue: "356", amount: "436" });
    const p = view(out, 0);
    expect(p.sales).toBe("356");
    // D47: cost of all 30 delivered pieces = 20 × 10 + 10 × 11 = 310 (damaged ones included).
    expect(p.cost).toBe("310");
    expect(p.grossProfit).toBe("46");
    // Damage value = batch cost of the 5 damaged pieces (all from batch 2) = 55.
    expect(p.damageValue).toBe("55");
    expect(shown(p)).toEqual([[2, "2026-10-20", "11", "16", "20"]]);
  });

  it("D47 pin: the damaged count does not lower saleable stock by itself", () => {
    const plain = run(
      {
        products: {
          A: {
            stock: "50",
            dueFromCompany: "0",
            orderPrice: "10",
            costPrice: "10",
            salePrice: "15",
          },
        },
      },
      [
        {
          date: "2026-11-01",
          dsrLines: [{ staffId: "d1", productId: "A", issued: "10", damaged: "3" }],
        },
      ],
    );
    const p = view(plain, 0);
    expect([p.delivered, p.sold, p.stock]).toEqual(["10", "7", "40"]);
    expect([p.sales, p.cost]).toEqual(["105", "100"]);
  });

  it("values product-level damaged (importer) at the newest sale price and current cost", () => {
    const product = run(
      {
        products: {
          A: {
            stock: "20",
            dueFromCompany: "0",
            batches: [
              batch(1, "2026-10-01", "10", "15", "10"),
              batch(2, "2026-10-20", "11", "16", "10"),
            ],
          },
        },
      },
      [{ date: "2026-11-01", products: { A: { damaged: "3" } } }],
    );
    const p = view(product, 0);
    expect([p.sales, p.cost, p.damageValue, p.stock]).toEqual(["-48", "0", "33", "20"]);
  });
});

describe("batches: deficit and returns", () => {
  const opening: MonthOpening = {
    products: {
      A: { stock: "10", dueFromCompany: "0", orderPrice: "10", costPrice: "10", salePrice: "15" },
    },
  };

  it("makes the newest batch negative when stock runs out, and the next receipt fills it first", () => {
    const out = run(opening, [
      { date: "2026-11-01", dsrLines: [{ staffId: "d1", productId: "A", issued: "25" }] },
      // 40 received at new prices: 15 fill the deficit (batch 1 stays priced 10/15), 25 are batch 2.
      {
        date: "2026-11-02",
        products: { A: { received: "40", orderPrice: "11", costPrice: "11", salePrice: "16" } },
      },
      // 40 more at the unchanged prices: nothing to fill, merges into batch 2.
      { date: "2026-11-03", products: { A: { received: "40" } } },
    ]);
    const d1 = view(out, 0);
    expect(shown(d1)).toEqual([[1, "opening", "10", "15", "-15"]]);
    expect([d1.stock, d1.sales, d1.cost, d1.stockValue]).toEqual(["-15", "375", "250", "-150"]);
    expect(out.warnings.filter((w) => w.date === "2026-11-01").map((w) => w.code)).toEqual([
      "NEGATIVE_STOCK",
    ]);
    expect(out.days[0]?.persons[0]?.allocations).toEqual([
      { seq: 1, quantity: "25", costPrice: "10", salePrice: "15" },
    ]);
    expect(shown(view(out, 1))).toEqual([[2, "2026-11-02", "11", "16", "25"]]);
    expect(view(out, 1).stockValue).toBe("275");
    expect(shown(view(out, 2))).toEqual([[2, "2026-11-02", "11", "16", "65"]]);
    expect(
      out.warnings.filter((w) => w.code === "NEGATIVE_STOCK" && w.date > "2026-11-01"),
    ).toEqual([]);
  });

  it("fills a deficit with a same-price receipt and keeps the batch", () => {
    const out = run(opening, [
      { date: "2026-11-01", dsrLines: [{ staffId: "d1", productId: "A", issued: "25" }] },
      { date: "2026-11-02", products: { A: { received: "40" } } },
    ]);
    expect(shown(view(out, 1))).toEqual([[1, "opening", "10", "15", "25"]]);
  });

  it("returns a negative net to the oldest batch at that batch's prices", () => {
    const out = run(
      {
        products: {
          A: {
            stock: "25",
            dueFromCompany: "0",
            batches: [
              batch(1, "2026-10-01", "10", "15", "5"),
              batch(2, "2026-10-20", "11", "16", "20"),
            ],
          },
        },
      },
      [{ date: "2026-11-01", dsrLines: [{ staffId: "d1", productId: "A", returned: "4" }] }],
    );
    expect(out.days[0]?.persons[0]?.allocations).toEqual([
      { seq: 1, quantity: "-4", costPrice: "10", salePrice: "15" },
    ]);
    expect(out.days[0]?.persons[0]).toMatchObject({ amount: "-60", soldValue: "-60" });
    const p = view(out, 0);
    expect([p.sales, p.cost, p.stock]).toEqual(["-60", "-40", "29"]);
    expect(shown(p)[0]).toEqual([1, "2026-10-01", "10", "15", "9"]);
  });
});

describe("batches: zero-cost goods and godown outflows", () => {
  const opening: MonthOpening = {
    products: {
      A: { stock: "10", dueFromCompany: "0", orderPrice: "10", costPrice: "10", salePrice: "15" },
    },
  };

  it("puts free goods in a zero-cost batch at the current sale price; selling them is all profit", () => {
    const out = run(opening, [
      { date: "2026-11-01", products: { A: { incentiveReceived: "20" } } },
      { date: "2026-11-02", dsrLines: [{ staffId: "d1", productId: "A", issued: "25" }] },
      // More free goods merge into the (now) newest zero-cost batch, same sale price.
      { date: "2026-11-03", products: { A: { incentiveReceived: "5" } } },
      // A normal receipt after free goods is a new batch (the newest batch costs 0).
      { date: "2026-11-04", products: { A: { received: "10" } } },
    ]);
    const d1 = view(out, 0);
    expect(shown(d1)).toEqual([
      [1, "opening", "10", "15", "10"],
      [2, "2026-11-01", "0", "15", "20"],
    ]);
    expect([d1.stock, d1.stockValue]).toEqual(["30", "100"]);
    // The product's current prices stay the real ones for display.
    expect([d1.costPrice, d1.salePrice]).toEqual(["10", "15"]);
    const d2 = view(out, 1);
    // 10 @ cost 10 + 15 free: sales 25 × 15 = 375, cost 100, profit 275.
    expect([d2.sales, d2.cost, d2.grossProfit]).toEqual(["375", "100", "275"]);
    expect(shown(d2)).toEqual([[2, "2026-11-01", "0", "15", "5"]]);
    expect(shown(view(out, 2))).toEqual([[2, "2026-11-01", "0", "15", "10"]]);
    expect(shown(view(out, 3))).toEqual([
      [2, "2026-11-01", "0", "15", "10"],
      [3, "2026-11-04", "10", "15", "10"],
    ]);
  });

  it("puts company replacement pieces in a zero-cost batch (the damage memo keeps unit cost)", () => {
    const out = run(opening, [
      { date: "2026-11-01", products: { A: { replacements: [{ quantity: "6", unitCost: "9" }] } } },
    ]);
    const p = view(out, 0);
    expect(shown(p)).toEqual([
      [1, "opening", "10", "15", "10"],
      [2, "2026-11-01", "0", "15", "6"],
    ]);
    expect([p.stock, p.stockValue, p.damageRecovery]).toEqual(["16", "100", "54"]);
  });

  it("takes replacedFromStock, then godownDamaged, oldest batch first at batch cost", () => {
    const out = run(
      {
        products: {
          A: {
            stock: "30",
            dueFromCompany: "0",
            batches: [
              batch(1, "2026-10-01", "10", "15", "10"),
              batch(2, "2026-10-20", "12", "16", "20"),
            ],
          },
        },
      },
      [
        {
          date: "2026-11-01",
          products: { A: { replacedFromStock: "4", godownDamaged: "8" } },
        },
      ],
    );
    const p = view(out, 0);
    // replaced 4 @ 10 = 40 (batch 1 → 6 left); godown 8 = 6 @ 10 + 2 @ 12 = 84.
    expect(shown(p)).toEqual([[2, "2026-10-20", "12", "16", "18"]]);
    expect([p.cost, p.sales, p.grossProfit, p.damageValue]).toEqual(["124", "0", "-124", "124"]);
    expect([p.stock, p.stockValue, p.damagedStock]).toEqual(["18", "216", "12"]);
  });
});

describe("batches: carry between months and fallback", () => {
  const days: DayInput[] = [
    {
      date: "2026-11-01",
      products: { A: { received: "50", orderPrice: "11", costPrice: "11", salePrice: "16" } },
      dsrLines: [{ staffId: "d1", productId: "A", issued: "30" }],
    },
    {
      date: "2026-11-02",
      products: { A: { received: "40", orderPrice: "12", costPrice: "12", salePrice: "18" } },
      dsrLines: [{ staffId: "d1", productId: "A", issued: "10" }],
    },
    {
      date: "2026-12-01",
      products: { A: { received: "5", orderPrice: "13", costPrice: "13", salePrice: "19" } },
      dsrLines: [{ staffId: "d1", productId: "A", issued: "100" }],
    },
  ];
  const opening: MonthOpening = {
    products: {
      A: { stock: "100", dueFromCompany: "0", orderPrice: "10", costPrice: "10", salePrice: "15" },
    },
  };

  it("carries the batches with their seq into the next opening and continues the numbering", () => {
    const november = run(opening, days.slice(0, 2));
    expect(november.closing.products.A?.batches).toEqual([
      batch(1, "opening", "10", "15", "60"),
      batch(2, "2026-11-01", "11", "16", "50"),
      batch(3, "2026-11-02", "12", "18", "40"),
    ]);
    expect(november.month.products[0]?.closingBatches.map((b) => b.seq)).toEqual([1, 2, 3]);
    const december = run(november.closing, days.slice(2));
    const whole = run(opening, days);
    expect(december.days[0]).toEqual(whole.days[2]);
    expect(december.closing).toEqual(whole.closing);
    // The 5 received are the new 13/19 batch (seq 4, not 1); 100 sold = 60 of batch 1 + 40 of batch 2.
    const left = [
      batch(2, "2026-11-01", "11", "16", "10"),
      batch(3, "2026-11-02", "12", "18", "40"),
      batch(4, "2026-12-01", "13", "19", "5"),
    ];
    expect(shown(view(december, 0))).toEqual(left.map((b) => Object.values(b)));
    expect(whole.closing.products.A?.batches).toEqual(left);
  });

  it("derives one batch from the stock when the opening has none (also for old snapshots)", () => {
    const fallback = run(opening, [{ date: "2026-11-01" }]);
    expect(shown(view(fallback, 0))).toEqual([[1, "opening", "10", "15", "100"]]);
    // A month-close snapshot stored before batches is the same opening as a plain stock line.
    const snapshot = run(
      { products: { A: { stock: "7", dueFromCompany: "0", costPrice: "9.5", salePrice: "12" } } },
      [{ date: "2026-11-01" }],
    );
    expect(shown(view(snapshot, 0))).toEqual([[1, "opening", "9.5", "12", "7"]]);
    const none = run(
      { products: { A: { stock: "0", dueFromCompany: "0", costPrice: "9", salePrice: "12" } } },
      [{ date: "2026-11-01" }],
    );
    expect(view(none, 0).batches).toEqual([]);
    expect(none.closing.products.A?.batches).toEqual([]);
  });

  it("lets opening batches replace the stock figure; stock is always the sum of batches", () => {
    const out = run(
      {
        products: {
          A: {
            stock: "999",
            dueFromCompany: "0",
            batches: [
              batch(1, "2026-10-01", "10", "15", "4"),
              batch(2, "2026-10-20", "11", "16", "6"),
            ],
          },
        },
      },
      [{ date: "2026-11-01" }],
    );
    const p = view(out, 0);
    expect([p.stock, p.stockValue]).toEqual(["10", "106"]);
    expect(out.month.products[0]).toMatchObject({
      closingStock: "10",
      closingValue: "106",
      closingAtSale: "156",
    });
    expect(out.month.totals.closingValue).toBe("106");
  });
});
