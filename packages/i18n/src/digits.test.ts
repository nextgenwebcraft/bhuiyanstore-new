import { describe, expect, it } from "vitest";
import { normalizeDigits, toBengaliDigits } from "./digits";

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
});
