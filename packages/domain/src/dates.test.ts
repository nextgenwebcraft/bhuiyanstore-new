import { describe, expect, it } from "vitest";
import { businessDateOf, shiftBusinessDate } from "./dates";

describe("business dates", () => {
  it("uses the Dhaka calendar date, not UTC", () => {
    expect(businessDateOf(new Date("2026-10-01T19:30:00Z"))).toBe("2026-10-02");
  });

  it("shifts across month, year and leap-day boundaries", () => {
    expect(shiftBusinessDate("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftBusinessDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftBusinessDate("2028-02-28", 1)).toBe("2028-02-29");
  });
});
