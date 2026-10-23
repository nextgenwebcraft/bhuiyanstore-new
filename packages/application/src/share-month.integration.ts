import { bootstrapSuperAdmin } from "@bsd/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "./companies";
import { AppError } from "./errors";
import { ensureMasterCompany } from "./master";
import {
  createShareholder,
  getShareMonth,
  getShareYear,
  saveShareHolding,
  saveSharePolicy,
  updateShareholder,
} from "./shares";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin = contextFor(db, {
  userId: "pending",
  tenantId: "pending",
  isSuperAdmin: true,
  mustChangePassword: false,
});
let masterId = "";
let drinkoId = "";

function fieldError(error: unknown, path: string, code: string) {
  return (
    error instanceof AppError &&
    error.code === "VALIDATION_FAILED" &&
    error.fieldErrors?.some((field) => field.path === path && field.code === code) === true
  );
}

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "shares@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  await db.user.update({ where: { id: boot.adminId }, data: { mustChangePassword: false } });
  admin = contextFor(db, {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
    mustChangePassword: false,
  });
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  drinkoId = (
    await createCompany(admin, {
      name: "Drinko",
      theme,
      modules: ["sales"],
      starterData: false,
    })
  ).company.id;
  masterId = await ensureMasterCompany(db, boot.tenantId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("D76 master monthly account", () => {
  it("keeps earlier months when units change, and reads an empty month as zero", async () => {
    const karim = await createShareholder(admin, masterId, { name: "Karim" }, "share-karim");
    const rahim = await createShareholder(admin, masterId, { name: "Rahim" }, "share-rahim");
    await saveShareHolding(
      admin,
      masterId,
      karim.id,
      { fromMonth: "2026-01", units: "27.88858" },
      "share-karim-jan",
    );
    await saveShareHolding(
      admin,
      masterId,
      karim.id,
      { fromMonth: "2026-03", units: "10" },
      "share-karim-mar",
    );
    await saveSharePolicy(admin, masterId, drinkoId, { danBasis: "profit" }, "share-drinko-basis");

    const february = await getShareMonth(admin, masterId, "2026-02");
    const march = await getShareMonth(admin, masterId, "2026-03");
    const karimFeb = february.shareholders.find((row) => row.shareholderId === karim.id);
    const karimMar = march.shareholders.find((row) => row.shareholderId === karim.id);

    expect(february.companies.map((row) => row.companyName)).toEqual(["Drinko"]);
    expect(february.companies[0]).toMatchObject({
      profit: "0.00",
      khoroch: "0.00",
      dan: "0.00",
      total: "0.00",
      danBasis: "profit",
    });
    expect(february.totals).toMatchObject({
      distributable: "0.00",
      dan: "0.00",
      unallocated: "0.00",
    });
    expect(karimFeb).toMatchObject({ units: "27.88858", income: "0.00", yearIncome: "0.00" });
    expect(karimMar).toMatchObject({ units: "10", income: "0.00", yearIncome: "0.00" });
    expect(march.shareholders.some((row) => row.shareholderId === rahim.id)).toBe(true);
  });

  it("hides a deactivated shareholder who never held units", async () => {
    const idle = await createShareholder(admin, masterId, { name: "Idle" }, "share-idle");
    await updateShareholder(
      admin,
      masterId,
      idle.id,
      { name: "Idle", active: false },
      "share-idle-off",
    );
    const march = await getShareMonth(admin, masterId, "2026-03");
    expect(march.shareholders.some((row) => row.shareholderId === idle.id)).toBe(false);
  });

  it("refuses a duplicate name, the master company as a দান target, and a non-admin", async () => {
    await expect(
      createShareholder(admin, masterId, { name: "Karim" }, "share-karim-again"),
    ).rejects.toSatisfy((error) => fieldError(error, "name", "validation.share.duplicateName"));
    await expect(
      saveSharePolicy(admin, masterId, masterId, { danBasis: "net" }, "share-master-basis"),
    ).rejects.toSatisfy((error) => fieldError(error, "companyId", "validation.share.notCompany"));
    await expect(getShareMonth(admin, drinkoId, "2026-03")).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === "COMPANY_NOT_FOUND",
    );
    const member = contextFor(db, { ...admin.actor, isSuperAdmin: false });
    await expect(getShareMonth(member, masterId, "2026-03")).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });

  it("lays the year out as one row per month with each company's total", async () => {
    const year = await getShareYear(admin, masterId, "2026");
    const karim = year.shareholders.find((person) => person.name === "Karim");
    const units = (index: number) =>
      year.months[index]?.shareholders.find((row) => row.shareholderId === karim?.shareholderId)
        ?.units;
    expect(year.months.map((month) => month.month)).toEqual(
      Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`),
    );
    expect(year.companies.map((company) => company.companyName)).toEqual(["Drinko"]);
    expect(units(0)).toBe("27.88858");
    expect(units(1)).toBe("27.88858");
    expect(units(2)).toBe("10");
    expect(units(11)).toBe("10");
    expect(year.months.every((month) => month.totals.distributable === "0.00")).toBe(true);
    expect(year.shareholders.some((person) => person.name === "Idle")).toBe(false);
    await expect(getShareYear(admin, masterId, "2026-1")).rejects.toSatisfy((error) =>
      fieldError(error, "year", "validation.share.year"),
    );
  });
});
