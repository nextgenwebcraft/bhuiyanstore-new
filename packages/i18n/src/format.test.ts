import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatBusinessDate,
  formatCount,
  formatDateTime,
  formatMoney,
  formatRate,
} from "./format";

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

describe("formatCount", () => {
  it("uses Bengali digits for numbers and numeric strings", () => {
    expect(formatCount(12)).toBe("১২");
    expect(formatCount("345")).toBe("৩৪৫");
    expect(formatCount(0)).toBe("০");
  });
});

describe("formatMoney", () => {
  it("shows a dash for null and the amount otherwise", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("15100.00")).toBe("১৫,১০০.০০");
  });
});

describe("formatDateTime", () => {
  it("renders the Asia/Dhaka calendar day of an instant", () => {
    // 19:30 UTC on 1 Oct is 01:30 on 2 Oct in Dhaka.
    const text = formatDateTime(new Date("2026-10-01T19:30:00Z"));
    expect(text).toContain("২");
    expect(text).toContain("অক্টো");
    expect(formatDateTime("2026-10-01T19:30:00Z")).toBe(text);
  });
});
