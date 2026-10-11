import { describe, expect, it } from "vitest";
import {
  earlierMonths,
  parsePeriod,
  periodForMonth,
  periodMonth,
  periodParam,
  periodRange,
  periodYears,
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
    for (const bad of ["", "x", "2026-13", "2026-00", "2026-11", "2027", "20261", "2026-1"]) {
      expect(parsePeriod(bad, today)).toEqual({ kind: "today" });
    }
  });

  it("round-trips through the URL value", () => {
    for (const value of ["today", "this-month", "last-month", "2026-03", "2025"]) {
      expect(periodParam(parsePeriod(value, today))).toBe(value);
    }
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

  it("lists earlier months from the cutoff month to the month before last, newest first", () => {
    expect(earlierMonths("2026-06-15", today)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(earlierMonths("2026-09-01", today)).toEqual([]);
    expect(earlierMonths("2025-11-01", "2026-02-10")).toEqual(["2025-12", "2025-11"]);
  });

  it("falls back to January of this year without a cutoff", () => {
    expect(earlierMonths(null, today)).toEqual([
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
      "2026-04",
      "2026-03",
      "2026-02",
      "2026-01",
    ]);
  });

  it("lists years from the cutoff year to this year, newest first", () => {
    expect(periodYears("2024-05-01", today)).toEqual(["2026", "2025", "2024"]);
    expect(periodYears(null, today)).toEqual(["2026"]);
  });
});
