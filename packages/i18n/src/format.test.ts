import { describe, expect, it } from "vitest";
import { formatAmount, formatBusinessDate, formatRate } from "./format";

describe("formatBusinessDate", () => {
  it("shows the calendar date itself, whatever the viewer's timezone", () => {
    const text = formatBusinessDate("2026-10-02");
    expect(text).toContain("শুক্রবার");
    expect(text).toContain("অক্টোবর");
    expect(text).toContain("২০২৬");
  });
});

describe("formatRate", () => {
  it("trims trailing zeros to at least 2 places without rounding", () => {
    expect(formatRate("25.000000")).toBe("২৫.০০");
    expect(formatRate("18.500000")).toBe("১৮.৫০");
    expect(formatRate("21.645400")).toBe("২১.৬৪৫৪");
    expect(formatRate("33")).toBe("৩৩.০০");
  });
});

describe("formatAmount", () => {
  it("uses Bengali digits with South Asian grouping", () => {
    expect(formatAmount("1234567.50")).toBe("১২,৩৪,৫৬৭.৫০");
    expect(formatAmount("15100.00")).toBe("১৫,১০০.০০");
  });

  it("leaves short and integer values ungrouped", () => {
    expect(formatAmount("999")).toBe("৯৯৯");
    expect(formatAmount("0.00")).toBe("০.০০");
  });

  it("keeps the sign", () => {
    expect(formatAmount("-1909.00")).toBe("-১,৯০৯.০০");
  });
});
