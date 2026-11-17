import { describe, expect, it } from "vitest";
import { dashboardSummarySchema } from "./reporting";

const base = {
  from: "2026-11-17",
  to: "2026-11-17",
  cutoffDate: null,
  netSales: "0.00",
  salesCash: "0.00",
  oldDuesCollected: "0.00",
  cashCollected: "0.00",
  marketDueCreated: "0.00",
  marketDueOpening: "0.00",
  marketDueOutstanding: "0.00",
  issuedValue: "0.00",
  returnValue: "0.00",
  commission: "0.00",
  damageSaleValue: "0.00",
  damageTotal: "120.00",
  totalSales: "0.00",
  postedSummaryCount: 0,
  postedReceiptCount: 0,
  byDsr: [],
  damageLots: [],
};

describe("dashboardSummarySchema (D133)", () => {
  it("requires damageTotal alongside damageSaleValue", () => {
    expect(dashboardSummarySchema.parse(base).damageTotal).toBe("120.00");
    const { damageTotal: _drop, ...without } = base;
    expect(dashboardSummarySchema.safeParse(without).success).toBe(false);
  });
});
