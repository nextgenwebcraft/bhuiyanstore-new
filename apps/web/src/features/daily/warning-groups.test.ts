import { describe, expect, it } from "vitest";
import { groupWarnings } from "./warning-groups";

describe("groupWarnings", () => {
  it("collapses daily repeats into one group per code", () => {
    const groups = groupWarnings([
      { code: "NEGATIVE_STOCK", date: "2026-10-02", productId: "p1" },
      { code: "NEGATIVE_STOCK", date: "2026-10-01", productId: "p1" },
      { code: "NEGATIVE_STOCK", date: "2026-10-02", productId: "p2" },
      { code: "NEGATIVE_BALANCE", date: "2026-10-03", staffId: "s1" },
      { code: "NEGATIVE_STOCK", date: "2026-10-04", productId: "p1" },
    ]);
    expect(groups).toEqual([
      {
        code: "NEGATIVE_STOCK",
        days: 3,
        firstDate: "2026-10-01",
        lastDate: "2026-10-04",
        productIds: ["p1", "p2"],
        staffIds: [],
      },
      {
        code: "NEGATIVE_BALANCE",
        days: 1,
        firstDate: "2026-10-03",
        lastDate: "2026-10-03",
        productIds: [],
        staffIds: ["s1"],
      },
    ]);
  });

  it("returns nothing for no warnings", () => {
    expect(groupWarnings([])).toEqual([]);
  });
});
