import { describe, expect, it } from "vitest";
import {
  businessDateOf,
  clampDate,
  datesBetween,
  daysBetween,
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shiftBusinessDate,
  shiftMonth,
  todayBusinessDate,
} from "./dates";

describe("business dates", () => {
  it("uses the Dhaka calendar date, not UTC", () => {
    expect(businessDateOf(new Date("2026-10-01T19:30:00Z"))).toBe("2026-10-02");
    expect(todayBusinessDate(new Date("2026-10-01T19:30:00Z"))).toBe("2026-10-02");
  });

  it("shifts across month, year and leap-day boundaries", () => {
    expect(shiftBusinessDate("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftBusinessDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftBusinessDate("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("month helpers", () => {
  it("derives the month and its first day", () => {
    expect(monthOf("2026-10-11")).toBe("2026-10");
    expect(firstOfMonth("2026-10")).toBe("2026-10-01");
    expect(firstOfMonth("2026-10-11")).toBe("2026-10-01");
  });

  it("finds month ends including leap February", () => {
    expect(lastOfMonth("2026-09")).toBe("2026-09-30");
    expect(lastOfMonth("2026-10")).toBe("2026-10-31");
    expect(lastOfMonth("2027-02")).toBe("2027-02-28");
    expect(lastOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastOfMonth("2026-12")).toBe("2026-12-31");
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", -22)).toBe("2024-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});

describe("day ranges", () => {
  it("counts days between dates", () => {
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-02", "2026-10-01")).toBe(-1);
  });

  it("lists dates inclusively", () => {
    expect(datesBetween("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(datesBetween("2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
    expect(datesBetween("2026-10-02", "2026-10-01")).toEqual([]);
  });

  it("clamps a date to optional bounds", () => {
    expect(clampDate("2026-10-05", "2026-10-10", "2026-10-20")).toBe("2026-10-10");
    expect(clampDate("2026-10-25", "2026-10-10", "2026-10-20")).toBe("2026-10-20");
    expect(clampDate("2026-10-15", "2026-10-10", "2026-10-20")).toBe("2026-10-15");
    expect(clampDate("2026-10-15")).toBe("2026-10-15");
  });
});
