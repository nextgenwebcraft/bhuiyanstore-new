import { describe, expect, it } from "vitest";
import { checkDueRemaining, checkIsCompleted } from "./company-check";

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
