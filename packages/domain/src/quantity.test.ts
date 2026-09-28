import { describe, expect, it } from "vitest";
import { netIssuedQuantity, sumQuantities, toBaseQuantity, toCartonDisplay } from "./quantity";

describe("toBaseQuantity", () => {
  it("matches workbook Jan 2026!M45 (7 cartons × 24)", () => {
    expect(toBaseQuantity("7", "0", "24")).toBe("168");
  });

  it("matches workbook Jan 2026!M46 (4 cartons × 96 + 12)", () => {
    expect(toBaseQuantity("4", "12", "96")).toBe("396");
  });

  it("treats 2 cartons + 3 pieces as 51 pieces, not 2.3 cartons", () => {
    expect(toBaseQuantity("2", "3", "24")).toBe("51");
  });

  it("rejects a non-positive carton factor", () => {
    expect(() => toBaseQuantity("1", "0", "0")).toThrow(RangeError);
  });
});

describe("toCartonDisplay", () => {
  it("normalizes excess loose pieces without changing quantity", () => {
    expect(toCartonDisplay("51", "24")).toEqual({ cartons: "2", loosePieces: "3" });
  });
});

describe("sumQuantities", () => {
  it("adds decimal quantities across batches", () => {
    expect(sumQuantities(["120", "48.5", "0"])).toBe("168.5");
  });

  it("returns zero for an empty list", () => {
    expect(sumQuantities([])).toBe("0");
  });
});

describe("netIssuedQuantity", () => {
  it("subtracts Firot from Samari (regression for Apr 2026!J82 multiplication defect)", () => {
    expect(netIssuedQuantity("192", "120")).toBe("72");
  });

  it("rejects returns exceeding issue", () => {
    expect(() => netIssuedQuantity("10", "11")).toThrow(RangeError);
  });
});
