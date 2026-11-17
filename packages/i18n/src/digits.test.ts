import { describe, expect, it } from "vitest";
import {
  normalizeDigits,
  normalizeMoneyInput,
  parseAmountInput,
  toBengaliDigits,
} from "./digits";

describe("digit normalization", () => {
  it("converts Bengali digits to Latin", () => {
    expect(normalizeDigits("১২৩.৪৫")).toBe("123.45");
  });

  it("leaves Latin digits and mixed text intact", () => {
    expect(normalizeDigits("DR-250 ৪")).toBe("DR-250 4");
  });

  it("round-trips through Bengali display digits", () => {
    expect(normalizeDigits(toBengaliDigits("9876543210"))).toBe("9876543210");
  });

  it("normalizes money separators and parses trailing dots", () => {
    expect(normalizeMoneyInput("১,০৪,৬৩০।৯৬")).toBe("104630.96");
    expect(parseAmountInput("104630")).toBe("104630");
    expect(parseAmountInput("104630.")).toBe("104630");
    expect(parseAmountInput("104630.96")).toBe("104630.96");
    expect(parseAmountInput("104630.9")).toBe("104630.9");
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("12.345")).toBeNull();
  });

  it("accepts Bengali digits and refuses junk for day-end হাতে জমা", () => {
    expect(parseAmountInput("১০৪৬৩০.৯৬")).toBe("104630.96");
    expect(parseAmountInput("১০৪৬৩০।")).toBe("104630");
    expect(parseAmountInput("104630.96.")).toBeNull();
    expect(parseAmountInput("10.4.6")).toBeNull();
    expect(parseAmountInput("-1")).toBeNull();
    expect(parseAmountInput("  42.00  ")).toBe("42.00");
  });
});
