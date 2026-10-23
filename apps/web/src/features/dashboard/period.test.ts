import { describe, expect, it } from "vitest";
import {
  parsePeriod,
  periodForMonth,
  periodForRange,
  periodMonth,
  periodParam,
  periodRange,
  pickedMonth,
  pickerYears,
  validYear,
} from "./period";

const today = "2026-10-11";

describe("dashboard period", () => {
  it("parses the URL value and falls back to today", () => {
    expect(parsePeriod(null, today)).toEqual({ kind: "today" });
    expect(parsePeriod("this-month", today)).toEqual({ kind: "this-month" });
    expect(parsePeriod("last-month", today)).toEqual({ kind: "last-month" });
    expect(parsePeriod("2026-03", today)).toEqual({ kind: "month", month: "2026-03" });
    expect(parsePeriod("2026-10", today)).toEqual({ kind: "this-month" });
    expect(parsePeriod("2026-09", today)).toEqual({ kind: "last-month" });
    expect(parsePeriod("2025", today)).toEqual({ kind: "year", year: "2025" });
    expect(parsePeriod("2026-10-02..2026-10-04", today)).toEqual({
      kind: "dates",
      from: "2026-10-02",
      to: "2026-10-04",
    });
    expect(parsePeriod("2026-10-11..2026-10-11", today)).toEqual({ kind: "today" });
    expect(parsePeriod("2026-10-01..2026-10-11", today)).toEqual({ kind: "this-month" });
    for (const bad of ["", "x", "2026-13", "2026-00", "20261", "2026-1"]) {
      expect(parsePeriod(bad, today)).toEqual({ kind: "today" });
    }
  });

  it("round-trips through the URL value", () => {
    for (const value of [
      "today",
      "this-month",
      "last-month",
      "2026-03",
      "2025",
      "2026-10-02..2026-10-04",
    ]) {
      expect(periodParam(parsePeriod(value, today))).toBe(value);
    }
  });

  it("keeps a single day and a range from the calendar", () => {
    expect(periodForRange("2026-10-04", "2026-10-04", today)).toEqual({
      kind: "dates",
      from: "2026-10-04",
      to: "2026-10-04",
    });
    expect(periodForRange("2026-10-08", "2026-10-02", today)).toEqual({
      kind: "dates",
      from: "2026-10-02",
      to: "2026-10-08",
    });
    expect(periodRange({ kind: "dates", from: "2026-10-02", to: "2026-12-01" }, today)).toEqual({
      from: "2026-10-02",
      to: today,
    });
  });

  it("gives today's range", () => {
    expect(periodRange({ kind: "today" }, today)).toEqual({ from: today, to: today });
  });

  it("stops the current month at today and ends past months on their last day", () => {
    expect(periodRange({ kind: "this-month" }, today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-11",
    });
    expect(periodRange({ kind: "last-month" }, today)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(periodRange({ kind: "month", month: "2026-02" }, today)).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(periodRange({ kind: "month", month: "2028-02" }, "2028-10-11").to).toBe("2028-02-29");
  });

  it("handles January for last month", () => {
    expect(periodRange({ kind: "last-month" }, "2027-01-05")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("gives a year from January 1, stopped at today for the current year", () => {
    expect(periodRange({ kind: "year", year: "2026" }, today)).toEqual({
      from: "2026-01-01",
      to: today,
    });
    expect(periodRange({ kind: "year", year: "2025" }, today)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("names the month a period lies in", () => {
    expect(periodMonth({ kind: "today" }, today)).toBe("2026-10");
    expect(periodMonth({ kind: "last-month" }, today)).toBe("2026-09");
    expect(periodMonth({ kind: "month", month: "2026-03" }, today)).toBe("2026-03");
    expect(periodMonth({ kind: "year", year: "2026" }, today)).toBeNull();
  });

  it("links a month to the period that shows it", () => {
    expect(periodForMonth("2026-10", today)).toEqual({ kind: "this-month" });
    expect(periodForMonth("2026-09", today)).toEqual({ kind: "last-month" });
    expect(periodForMonth("2026-04", today)).toEqual({ kind: "month", month: "2026-04" });
  });

  it("lists 5 future years, 15 years back, further when the cutoff is older, newest first (D60)", () => {
    const years = pickerYears("2024-05-01", today);
    expect(years[0]).toBe("2031");
    expect(years.at(-1)).toBe("2011");
    expect(years).toHaveLength(21);
    expect(pickerYears("2005-01-01", today).at(-1)).toBe("2005");
    expect(pickerYears(null, today)).toEqual(years);
  });

  it("accepts any typed four-digit year, future included", () => {
    expect(validYear("1999")).toBe("1999");
    expect(validYear("2026")).toBe("2026");
    expect(validYear("2040")).toBe("2040");
    for (const bad of ["3000", "199", "abcd", "1899", ""]) expect(validYear(bad)).toBeNull();
  });

  it("names the picked month of a period", () => {
    expect(pickedMonth({ kind: "today" }, today)).toBeNull();
    expect(pickedMonth({ kind: "year", year: "2025" }, today)).toBeNull();
    expect(pickedMonth({ kind: "last-month" }, today)).toBe("2026-09");
    expect(pickedMonth({ kind: "month", month: "2019-04" }, today)).toBe("2019-04");
  });
});
