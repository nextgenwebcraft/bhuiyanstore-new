import { describe, expect, it } from "vitest";
import type { StaffRecord } from "@bsd/contracts";
import { dsrsOn } from "./dsr-days-page";

function dsr(
  id: string,
  assignments: { from: string; to: string | null }[],
): StaffRecord {
  return {
    id,
    name: id,
    employer: "distributor",
    phone: "",
    status: "active",
    loginEmail: null,
    loginRoleKind: null,
    loginActive: null,
    loginCompanyIds: [],
    companyId: "co-1",
    assignments: assignments.map((a) => ({
      id: `${id}-${a.from}`,
      roleId: "role-dsr",
      roleName: "DSR",
      roleKind: "dsr" as const,
      companyId: "co-1",
      from: a.from,
      to: a.to,
      monthlySalary: "0",
    })),
  };
}

describe("dsrsOn date filter", () => {
  const early = dsr("early", [{ from: "2026-01-01", to: "2026-06-30" }]);
  const open = dsr("open", [{ from: "2026-07-01", to: null }]);
  const future = dsr("future", [{ from: "2026-12-01", to: null }]);
  const all = [early, open, future];

  it("without a date keeps every DSR assignment", () => {
    expect(dsrsOn(all).map((s) => s.id)).toEqual(["early", "open", "future"]);
  });

  it("on a mid-year day excludes ended and not-yet-started DSRs", () => {
    expect(dsrsOn(all, "2026-08-15").map((s) => s.id)).toEqual(["open"]);
  });

  it("includes a DSR on their first and last assignment day", () => {
    expect(dsrsOn([early], "2026-01-01").map((s) => s.id)).toEqual(["early"]);
    expect(dsrsOn([early], "2026-06-30").map((s) => s.id)).toEqual(["early"]);
    expect(dsrsOn([early], "2026-07-01")).toEqual([]);
  });
});
