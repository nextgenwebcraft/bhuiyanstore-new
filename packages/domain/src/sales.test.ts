import { describe, expect, it } from "vitest";
import { allocateByPriority } from "./allocation";
import { allocateOldestFirst, allocationCost, priceSplitAmount, saleTotals } from "./sales";

describe("sale arithmetic", () => {
  it("reproduces the guide 9.6 multi-batch sale: revenue 1,800, COGS 1,240, profit 560", () => {
    const { allocations } = allocateByPriority(
      [
        { id: "A", receivedDate: "2026-01-01", availableQuantity: "100", unitCost: "10" },
        { id: "B", receivedDate: "2026-02-01", availableQuantity: "100", unitCost: "12" },
      ],
      "120",
    );
    const revenue = priceSplitAmount({ quantity: "120", unitPrice: "15" });
    const cogs = allocationCost(allocations);
    const totals = saleTotals([revenue], [cogs], "1800");
    expect(totals).toEqual({
      netSales: "1800.00",
      cogs: "1240.00",
      grossProfit: "560.00",
      cashCollected: "1800.00",
      marketDue: "0.00",
    });
  });

  it("keeps different actual prices for the same product as separate amounts (10@15 + 10@16)", () => {
    const amounts = [
      priceSplitAmount({ quantity: "10", unitPrice: "15" }),
      priceSplitAmount({ quantity: "10", unitPrice: "16" }),
    ];
    expect(amounts).toEqual(["150.00", "160.00"]);
    expect(saleTotals(amounts, ["0"], "0").netSales).toBe("310.00");
  });

  it("splits unpaid sales into market due so collection + due == net sales", () => {
    const totals = saleTotals(["1000.00"], ["800.00"], "650");
    expect(totals.marketDue).toBe("350.00");
    expect(totals.grossProfit).toBe("200.00");
  });

  it("rejects collecting more than was sold", () => {
    expect(() => saleTotals(["100.00"], ["0"], "100.01")).toThrow(RangeError);
  });

  it("keeps 6-place unit costs exact before rounding COGS", () => {
    expect(allocationCost([{ quantity: "3", unitCost: "21.6454" }])).toBe("64.94");
  });
});

describe("allocateOldestFirst", () => {
  const items = [
    { id: "due-2", businessDate: "2026-02-01", remainingAmount: "300" },
    { id: "due-1", businessDate: "2026-01-01", remainingAmount: "200" },
  ];

  it("settles the oldest due first and partially settles the next", () => {
    expect(allocateOldestFirst(items, "350")).toEqual([
      { dueItemId: "due-1", amount: "200.00" },
      { dueItemId: "due-2", amount: "150.00" },
    ]);
  });

  it("rejects an amount larger than the total open due", () => {
    expect(() => allocateOldestFirst(items, "500.01")).toThrow(RangeError);
  });

  it("rejects a zero amount", () => {
    expect(() => allocateOldestFirst(items, "0")).toThrow(RangeError);
  });
});
