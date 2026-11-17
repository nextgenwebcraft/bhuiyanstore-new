import { describe, expect, it } from "vitest";
import {
  canCorrectDsrSheet,
  canEditDailyMoney,
  canPostDailyMoney,
  dsrHandoverAmountLocked,
  dsrSheetBodyLocked,
} from "./daily-kit";

const adminPerms = ["sale.create", "sale.post", "sale.reverse", "sale.handover_submit"] as const;
const managerPerms = ["sale.create", "sale.post", "sale.handover_submit"] as const;

describe("দৈনিক বিক্রয় হিসাব locks (D126 / D135)", () => {
  it("lets Super Admin correct and edit after হাতে জমা pending/approved", () => {
    expect(canCorrectDsrSheet(null, adminPerms)).toBe(true);
    expect(
      dsrSheetBodyLocked({
        loginRoleKind: null,
        permissions: adminPerms,
        posted: true,
        handoverActive: true,
      }),
    ).toBe(false);
    expect(
      dsrHandoverAmountLocked({
        loginRoleKind: null,
        canTypeHandover: false,
        bodyLocked: false,
        handoverActive: true,
      }),
    ).toBe(false);
    expect(canEditDailyMoney(null, true)).toBe(true);
    expect(canPostDailyMoney(null, true)).toBe(true);
  });

  it("locks Manager after post and after হাতে জমা (D126 / D114)", () => {
    expect(canCorrectDsrSheet("manager", managerPerms)).toBe(false);
    expect(
      dsrSheetBodyLocked({
        loginRoleKind: "manager",
        permissions: managerPerms,
        posted: true,
        handoverActive: false,
      }),
    ).toBe(true);
    expect(
      dsrSheetBodyLocked({
        loginRoleKind: "manager",
        permissions: managerPerms,
        posted: false,
        handoverActive: true,
      }),
    ).toBe(true);
    expect(
      dsrSheetBodyLocked({
        loginRoleKind: "manager",
        permissions: managerPerms,
        posted: false,
        handoverActive: false,
      }),
    ).toBe(false);
    expect(canEditDailyMoney("manager", true)).toBe(false);
    expect(canPostDailyMoney("manager", true)).toBe(false);
  });

  it("lets Manager type হাতে জমা on a posted sheet before submit", () => {
    expect(
      dsrHandoverAmountLocked({
        loginRoleKind: "manager",
        canTypeHandover: true,
        bodyLocked: true,
        handoverActive: false,
      }),
    ).toBe(false);
  });

  it("never lets DSR correct; locks DSR after post", () => {
    expect(canCorrectDsrSheet("dsr", adminPerms)).toBe(false);
    expect(
      dsrSheetBodyLocked({
        loginRoleKind: "dsr",
        permissions: ["sale.create"],
        posted: true,
        handoverActive: false,
      }),
    ).toBe(true);
    expect(canEditDailyMoney("dsr", false)).toBe(false);
  });
});
