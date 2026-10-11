import { describe, expect, it } from "vitest";
import type { Opening } from "@bsd/contracts";
import { blankStock, draftOf, sectionRequestOf } from "./opening-draft";

const view = {
  version: 1,
  stock: [
    {
      productId: "p1",
      piecesPerCarton: "12",
      pieces: null,
      unitCost: null,
      salePrice: null,
      orderPrice: null,
      dueFromCompany: "5",
      note: "",
    },
  ],
  balances: [],
} as unknown as Opening;

describe("goods due entry (D46)", () => {
  it("is one field: loaded as stored, blank sent as null", () => {
    const draft = draftOf(view);
    expect(draft.stock["p1"]?.dueFromCompany).toBe("5");
    const request = sectionRequestOf(view, draft, "stock");
    expect(request.section === "stock" && request.stock[0]?.dueFromCompany).toBe("5");
    const blank = { ...draft, stock: { p1: { ...blankStock } } };
    const blanked = sectionRequestOf(view, blank, "stock");
    expect(blanked.section === "stock" && blanked.stock[0]?.dueFromCompany).toBeNull();
  });
});
