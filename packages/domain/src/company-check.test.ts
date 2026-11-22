import { describe, expect, it } from "vitest";
import { checkDueRemaining, checkIsCompleted, checkLedger } from "./company-check";

describe("checkDueRemaining", () => {
  it("sums charges minus payments", () => {
    expect(checkDueRemaining(["1000.00", "500.50"], ["200.00"])).toBe("1300.50");
  });

  it("floors at zero for display", () => {
    expect(checkDueRemaining(["100"], ["100", "1"])).toBe("0.00");
  });

  it("is zero with no rows", () => {
    expect(checkDueRemaining([], [])).toBe("0.00");
  });
});

describe("checkIsCompleted", () => {
  it("needs at least one charge and zero remaining", () => {
    expect(checkIsCompleted([], [])).toBe(false);
    expect(checkIsCompleted(["100"], [])).toBe(false);
    expect(checkIsCompleted(["100"], ["100"])).toBe(true);
    expect(checkIsCompleted(["100", "50"], ["150"])).toBe(true);
  });
});

describe("checkLedger (D145)", () => {
  it("orders by date then creation and keeps the running due", () => {
    const lines = checkLedger([
      { kind: "payment", date: "2026-11-10", order: 3, amount: "400.00" },
      { kind: "charge", date: "2026-11-02", order: 1, amount: "1000.00" },
      { kind: "charge", date: "2026-11-10", order: 2, amount: "250.50" },
      { kind: "payment", date: "2026-11-20", order: 4, amount: "850.50" },
    ]);
    expect(lines.map((line) => [line.date, line.kind, line.balance])).toEqual([
      ["2026-11-02", "charge", "1000.00"],
      ["2026-11-10", "charge", "1250.50"],
      ["2026-11-10", "payment", "850.50"],
      ["2026-11-20", "payment", "0.00"],
    ]);
  });

  it("is empty for an unused cheque", () => {
    expect(checkLedger([])).toEqual([]);
  });
});
