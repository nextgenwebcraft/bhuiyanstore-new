import { describe, expect, it } from "vitest";
import { salesProfit } from "@bsd/domain";

/**
 * Mirrors `profitLinesOfDraft` behaviour: a validation failure on save must not be required
 * for the on-screen summary strip (regression: summary stayed ০ while the table had সামারি).
 */
describe("dsr sheet summary strip", () => {
  it("sums draft lines even when a separate save check would refuse the sheet", () => {
    const parts = salesProfit([
      {
        issued: "264",
        returned: "52",
        damaged: "0",
        commission: "0",
        salePrice: "19.444",
        costPrice: "15",
      },
      {
        issued: "30",
        returned: "6",
        damaged: "0",
        commission: "0",
        salePrice: "60.82",
        costPrice: "50",
      },
    ]);
    expect(parts.issued).toBe("294");
    expect(Number(parts.issuedValue)).toBeGreaterThan(0);
    expect(Number(parts.netSales)).toBeGreaterThan(0);
  });
});
