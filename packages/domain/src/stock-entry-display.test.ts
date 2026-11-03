import { describe, expect, it } from "vitest";
import { stockEntryAmount, stockEntryCartonParts, sumCartons } from "./stock-entry-display";

describe("stockEntryAmount", () => {
  it("bills an order as pieces × carton rate ÷ carton size", () => {
    expect(
      stockEntryAmount({
        kind: "order",
        pieces: "48",
        cartonRate: "1200",
        piecesPerCarton: "24",
        costPrice: null,
        unitPrice: null,
      }),
    ).toBe("2400.00");
  });

  it("values a receipt at cost × pieces", () => {
    expect(
      stockEntryAmount({
        kind: "receipt",
        pieces: "10",
        cartonRate: null,
        piecesPerCarton: "24",
        costPrice: "5.5",
        unitPrice: null,
      }),
    ).toBe("55.00");
  });

  it("treats incentive as zero value", () => {
    expect(
      stockEntryAmount({
        kind: "incentive",
        pieces: "24",
        cartonRate: null,
        piecesPerCarton: "24",
        costPrice: "5",
        unitPrice: null,
      }),
    ).toBe("0");
  });
});

describe("stockEntryCartonParts", () => {
  it("keeps cartons and loose pieces separate", () => {
    expect(stockEntryCartonParts("50", "24")).toEqual({ cartons: "2", loosePieces: "2" });
    expect(sumCartons(["2", "1"])).toBe("3");
  });

  it("treats all quantity as loose when carton size is unknown", () => {
    expect(stockEntryCartonParts("50", null)).toEqual({ cartons: "0", loosePieces: "50" });
  });
});
