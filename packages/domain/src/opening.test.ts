import { describe, expect, it } from "vitest";
import { computeMonth } from "./month/compute-month";
import { checkOpening, toMonthOpening, type OpeningCheckInput } from "./opening";

const line = (productId: string, overrides: Partial<OpeningCheckInput["stock"][number]> = {}) => ({
  productId,
  pieces: "100",
  unitCost: "23.48",
  salePrice: "25",
  dueFromCompany: "0",
  ...overrides,
});

const codes = (input: OpeningCheckInput) =>
  checkOpening(input).issues.map((i) => [i.code, i.severity, i.productId ?? i.kind]);

describe("checkOpening", () => {
  it("passes a complete opening and totals value at cost", () => {
    const result = checkOpening({
      cutoffDate: "2026-11-01",
      stock: [line("a"), line("b", { pieces: "0", unitCost: null, salePrice: null })],
      balances: [{ kind: "market_due", amount: "232016", staffId: null, cashAccountId: null }],
    });
    expect(result.issues).toEqual([]);
    expect(result.totals).toMatchObject({
      stockPieces: "100",
      stockValue: "2348.00",
      valuedRows: 2,
      excludedRows: 0,
      marketDue: "232016.00",
    });
  });

  it("only warns about a blank count and needs a cost for stock", () => {
    expect(
      codes({
        cutoffDate: null,
        stock: [line("a", { pieces: null }), line("b", { unitCost: null })],
        balances: [],
      }),
    ).toEqual([
      ["opening.issue.cutoffMissing", "error", undefined],
      ["opening.issue.stockUnknown", "warning", "a"],
      ["opening.issue.costMissing", "error", "b"],
    ]);
  });

  it("leaves error rows out of the value", () => {
    const result = checkOpening({
      cutoffDate: "2026-11-01",
      stock: [line("a", { pieces: "1.5" }), line("b")],
      balances: [],
    });
    expect(result.issues.map((i) => i.code)).toEqual(["opening.issue.stockInvalid"]);
    expect(result.totals).toMatchObject({ stockValue: "2348.00", valuedRows: 1, excludedRows: 1 });
  });

  it("counts a blank as 0 without excluding the row", () => {
    const result = checkOpening({
      cutoffDate: "2026-11-01",
      stock: [line("a", { pieces: null }), line("b")],
      balances: [],
    });
    expect(result.issues.map((i) => i.severity)).toEqual(["warning"]);
    expect(result.totals).toMatchObject({ stockValue: "2348.00", valuedRows: 1, excludedRows: 0 });
  });

  it("checks balance parties, SR-only kinds and duplicates", () => {
    expect(
      codes({
        cutoffDate: "2026-11-01",
        stock: [],
        balances: [
          { kind: "advance", amount: "10", staffId: null, cashAccountId: null },
          {
            kind: "sr_loan",
            amount: "10",
            staffId: "dsr1",
            cashAccountId: null,
            personRoleKind: "dsr",
          },
          {
            kind: "advance",
            amount: "5",
            staffId: "sr1",
            cashAccountId: null,
            personRoleKind: "sr",
          },
          { kind: "cash", amount: "5", staffId: null, cashAccountId: "c1" },
          { kind: "cash", amount: "6", staffId: null, cashAccountId: "c1" },
          {
            kind: "loan",
            amount: null,
            staffId: "dsr1",
            cashAccountId: null,
            personRoleKind: "dsr",
          },
        ],
      }),
    ).toEqual([
      ["opening.issue.personMissing", "error", "advance"],
      ["opening.issue.srOnly", "error", "sr_loan"],
      ["opening.issue.notForSr", "error", "advance"],
      ["opening.issue.duplicate", "error", "cash"],
      ["opening.issue.amountUnknown", "warning", "loan"],
    ]);
  });

  it("nets company payable against advance and splits what staff owe from what we owe", () => {
    const { totals } = checkOpening({
      cutoffDate: "2026-11-01",
      stock: [],
      balances: [
        { kind: "company_payable", amount: "1000", staffId: null, cashAccountId: null },
        { kind: "company_advance", amount: "1500", staffId: null, cashAccountId: null },
        { kind: "advance", amount: "300", staffId: "s1", cashAccountId: null },
        { kind: "credit", amount: "40", staffId: "s1", cashAccountId: null },
      ],
    });
    expect(totals).toMatchObject({
      companyPayable: "-500.00",
      staffOwesUs: "300.00",
      staffWeOwe: "40.00",
    });
  });
});

describe("toMonthOpening", () => {
  it("starts the month engine from exactly the entered values", () => {
    const opening = toMonthOpening({
      cutoffDate: "2026-11-01",
      stock: [line("a", { dueFromCompany: "8" })],
      balances: [
        { kind: "market_due", amount: "500", staffId: null, cashAccountId: null },
        { kind: "market_due", amount: "200", staffId: "d1", cashAccountId: null },
        { kind: "advance", amount: "300", staffId: "d1", cashAccountId: null },
        { kind: "company_payable", amount: "1000", staffId: null, cashAccountId: null },
      ],
    });
    const out = computeMonth({
      products: [{ id: "a", piecesPerCarton: "24" }],
      opening,
      days: [{ date: "2026-11-01" }],
    });
    expect(out.closing.products.a).toMatchObject({
      stock: "100",
      dueFromCompany: "8",
      costPrice: "23.48",
      salePrice: "25",
    });
    expect(out.month.marketDue.closing).toBe("700");
    expect(out.closing.staff.d1?.advance).toBe("300");
    expect(out.closing.companyPayable).toBe("1000");
  });

  it("makes each stock line one opening batch at its cost and sale price (D49)", () => {
    const opening = toMonthOpening({
      cutoffDate: "2026-11-01",
      stock: [line("a"), line("b", { pieces: "0" })],
      balances: [],
    });
    expect(opening.products.a?.batches).toEqual([
      { seq: 1, startDate: "2026-11-01", costPrice: "23.48", salePrice: "25", quantity: "100" },
    ]);
    expect(opening.products.b?.batches).toBeUndefined(); // no pieces, no batch
    const out = computeMonth({
      products: [
        { id: "a", piecesPerCarton: "24" },
        { id: "b", piecesPerCarton: "24" },
      ],
      opening,
      days: [{ date: "2026-11-01" }],
    });
    expect(out.days[0]?.products[0]?.batches).toEqual([
      {
        key: "auto:1",
        seq: 1,
        startDate: "2026-11-01",
        costPrice: "23.48",
        salePrice: "25",
        quantity: "100",
        value: "2348",
      },
    ]);
  });

  it("opens each shop's due and counts it in the market due total (D38)", () => {
    const opening = toMonthOpening({
      cutoffDate: "2026-11-01",
      stock: [],
      balances: [
        { kind: "market_due", amount: "100", staffId: null, cashAccountId: null },
        { kind: "shop_due", amount: "250", staffId: null, cashAccountId: null, shopId: "s1" },
      ],
    });
    const out = computeMonth({
      products: [],
      opening,
      days: [
        {
          date: "2026-11-01",
          money: [{ kind: "marketDueCollected", amount: "50", staffId: "d1", shopId: "s1" }],
        },
      ],
    });
    expect(out.closing.shopDue).toEqual({ s1: "200" });
    expect(out.month.marketDue.closing).toBe("300");
  });

  it("needs a shop for a shop due", () => {
    expect(
      codes({
        cutoffDate: "2026-11-01",
        stock: [],
        balances: [{ kind: "shop_due", amount: "1", staffId: null, cashAccountId: null }],
      }),
    ).toEqual([["opening.issue.shopMissing", "error", "shop_due"]]);
  });
});
