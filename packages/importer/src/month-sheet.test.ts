import { computeMonth } from "@bsd/domain";
import { describe, expect, it } from "vitest";
import { compareWithSaved } from "./compare";
import { readMonthSheet } from "./month-sheet";
import { syntheticWorkbook } from "./synthetic-workbook";

describe("readMonthSheet", () => {
  const read = readMonthSheet(syntheticWorkbook(), "Nov 2026");

  it("maps blocks, products and grids by headers, including a 20-column block", () => {
    expect(read.month).toBe("2026-11");
    expect(read.input.days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(read.products.map((p) => p.id)).toEqual(["p7", "p9"]);
    expect(read.persons).toEqual(["Mamun"]);
    expect(read.notes).toContain("daily blocks have mixed widths: 19, 20");
    expect(read.input.products).toEqual([
      { id: "p7", piecesPerCarton: "24" },
      { id: "p9", piecesPerCarton: "1" },
    ]);
  });

  it("reads only raw inputs: openings, typed prices, arithmetic and carry-forward", () => {
    expect(read.input.opening.products.p7).toEqual({
      stock: "100",
      dueFromCompany: "5",
      orderPrice: "10",
      costPrice: "9.5",
      salePrice: "11",
    });
    expect(read.input.opening.products.p9?.costPrice).toBe("19");
    const [day1, day2] = read.input.days;
    expect(day1?.products?.p7).toMatchObject({ received: "48" });
    expect(day2?.products?.p7).toEqual({ salePrice: "12" });
    expect(day2?.products?.p9).toBeUndefined();
    expect(day1?.dsrLines).toEqual([
      { staffId: "mamun", productId: "p7", issued: "60", returned: "12" },
    ]);
    expect(day2?.dsrLines).toEqual([{ staffId: "mamun", productId: "p9", issued: "12" }]);
  });

  it("maps money columns by type and pairs Sort/Over through the net formula", () => {
    expect(read.moneyColumns.map((c) => [c.header, c.kind, c.staffId ?? null])).toEqual([
      ["Credit", "marketDueCollected", null],
      ["SR Rohim Over", "staffRepayment", "sr rohim"],
      ["Due", "marketDueNew", null],
      ["SR Rohim Sort", "staffShortage", "sr rohim"],
      ["Operating Cost", "expense", null],
    ]);
    expect(read.input.opening.marketDue).toEqual({ "": "25" });
  });

  it("labels every person key the input uses, for the owner's mapping", () => {
    expect(read.people).toEqual([
      { key: "mamun", label: "Mamun" },
      { key: "sr rohim", label: "SR Rohim" },
    ]);
    expect(read.categories).toEqual([{ key: "operating", label: "Operating Cost" }]);
  });

  it("recalculates and matches every saved value", () => {
    const results = compareWithSaved(computeMonth(read.input), read.expectations);
    expect(results.flatMap((r) => r.unexplained)).toEqual([]);
    expect(Object.fromEntries(results.map((r) => [r.check, r.matched]))).toMatchObject({
      Samari: 1,
      "Sales amount": 2,
      "Stock pieces": 2,
      "Person net (issue − return)": 2,
      "Daily sales": 2,
      "Daily cash left (Total Amount)": 2,
      "Staff net (owes us − we owe)": 1,
      "Market due closing": 1,
    });
  });

  it("reads a month in progress up to a date, without month-level checks", () => {
    const partial = readMonthSheet(syntheticWorkbook(), "Nov 2026", { through: "2026-11-01" });
    expect(partial.input.days.map((d) => d.date)).toEqual(["2026-11-01"]);
    expect(partial.input.opening).toEqual(read.input.opening);
    expect(partial.expectations.every((e) => e.day === 1)).toBe(true);
    const results = compareWithSaved(computeMonth(partial.input), partial.expectations);
    expect(results.flatMap((r) => r.unexplained)).toEqual([]);
    const checks = results.map((r) => r.check);
    expect(checks).toContain("Daily cash left (Total Amount)");
    expect(checks).not.toContain("Staff net (owes us − we owe)");
    expect(checks).not.toContain("Market due closing");
  });

  it("rejects a through date outside the sheet's month", () => {
    for (const through of ["2026-12-01", "2026-11-31", "2026-11"]) {
      expect(() => readMonthSheet(syntheticWorkbook(), "Nov 2026", { through })).toThrow(
        RangeError,
      );
    }
  });
});
