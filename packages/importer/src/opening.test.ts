import { describe, expect, it } from "vitest";
import {
  buildOpeningTemplate,
  isOpeningTemplate,
  loadWorkbook,
  monthSheetNames,
  proposeOpening,
  readOpeningTemplate,
} from "./opening";
import { syntheticWorkbook } from "./synthetic-workbook";

describe("proposeOpening", () => {
  it("lists month sheets newest first", () => {
    expect(monthSheetNames(syntheticWorkbook())).toEqual(["Nov 2026", "Oct 2026"]);
  });

  it("proposes the month engine's closing, labelled by the sheet's names", () => {
    const proposal = proposeOpening(syntheticWorkbook(), "Nov 2026");
    expect(proposal.products.map((p) => p.label)).toEqual(["Alpha 250ml", "Beta 1lt"]);
    expect(proposal.products[0]).toMatchObject({ costPrice: "9.5", salePrice: "12" });
    expect(proposal.products[1]?.stock).toBe("-12");
    expect(
      proposal.notes.some((n) => n.includes("negative closing stock") && n.includes("Beta")),
    ).toBe(true);
    expect(proposal.marketDue).toEqual([{ label: "", amount: "75" }]);
    expect(proposal.staff.map((s) => s.label)).toEqual(["sr rohim"]);
  });
});

describe("opening template", () => {
  it("round-trips machine keys, blanks as unknown and typed values", async () => {
    const data = await buildOpeningTemplate({
      products: [
        {
          code: "W500",
          name: "Water",
          cartonSize: "24",
          pieces: "120",
          unitCost: "9.5",
          salePrice: null,
          orderPrice: null,
          dueFromCompany: "0",
          note: "",
        },
        {
          code: "CAKE",
          name: "Cake",
          cartonSize: "12",
          pieces: null,
          unitCost: null,
          salePrice: null,
          orderPrice: null,
          dueFromCompany: null,
          note: "",
        },
      ],
      balances: [{ kind: "market_due", person: "", cashAccount: "", amount: "2500.5", note: "" }],
    });
    const workbook = await loadWorkbook(data);
    expect(isOpeningTemplate(workbook)).toBe(true);
    const read = readOpeningTemplate(workbook);
    expect(read.products).toEqual([
      {
        row: 3,
        code: "W500",
        pieces: "120",
        unitCost: "9.5",
        salePrice: null,
        orderPrice: null,
        dueFromCompany: "0",
        note: "",
      },
      {
        row: 4,
        code: "CAKE",
        pieces: null,
        unitCost: null,
        salePrice: null,
        orderPrice: null,
        dueFromCompany: null,
        note: "",
      },
    ]);
    expect(read.balances).toEqual([
      { row: 3, kind: "market_due", person: "", cashAccount: "", amount: "2500.5", note: "" },
    ]);
  });

  it("does not mistake a month workbook for a template", () => {
    expect(isOpeningTemplate(syntheticWorkbook())).toBe(false);
  });
});
