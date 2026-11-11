import { bootstrapSuperAdmin } from "@bsd/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "./companies";
import {
  applyPreviousDueReduction,
  createPreviousDue,
  createShareholder,
  deletePreviousDue,
  getCompanyHishabYear,
  getMasterHishabYear,
  listPreviousDues,
  listShareholders,
  saveInvestments,
  updatePreviousDue,
  updateShareholder,
} from "./company-hishab";
import { AppError } from "./errors";
import { ensureMasterCompany } from "./master";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin = contextFor(db, {
  userId: "pending",
  tenantId: "pending",
  isSuperAdmin: true,
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
  admin = contextFor(db, {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
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

describe("company hishab (shareholder invest, replacing D76/D77 units)", () => {
  it("keeps earlier months when invest changes, and reads an empty month as zero", async () => {
    const karim = await createShareholder(admin, masterId, { name: "Karim" }, "share-karim");
    await createShareholder(admin, masterId, { name: "Rahim" }, "share-rahim");
    await saveInvestments(
      admin,
      masterId,
      karim.id,
      { entries: [{ targetCompanyId: drinkoId, fromMonth: "2026-01", amount: "500000" }] },
      "share-karim-jan",
    );
    await saveInvestments(
      admin,
      masterId,
      karim.id,
      { entries: [{ targetCompanyId: drinkoId, fromMonth: "2026-03", amount: "200000" }] },
      "share-karim-mar",
    );

    const year = await getCompanyHishabYear(admin, masterId, drinkoId, "2026", karim.id);
    expect(year.months[0]).toMatchObject({
      profit: "0.00",
      khoroch: "0.00",
      dan: "0.00",
      totalProfit: "0.00",
      invest: "500000.00",
      shareholderProfit: "0.00",
      profitPerLakh: "0.00",
    });
    expect(year.months[1]?.invest).toBe("500000.00");
    expect(year.months[2]?.invest).toBe("200000.00");
    expect(year.months[11]?.invest).toBe("200000.00");
    expect(year.shareholders.some((person) => person.name === "Rahim")).toBe(true);

    // Karim is the only investor here, so his profitPerLakh must match the all-shareholders
    // view (the company-wide rate), not a figure scaled to his own invest alone.
    const all = await getCompanyHishabYear(admin, masterId, drinkoId, "2026");
    expect(year.months[0]?.profitPerLakh).toBe(all.months[0]?.profitPerLakh);
  });

  it("hides a deactivated shareholder who never invested", async () => {
    const idle = await createShareholder(admin, masterId, { name: "Idle" }, "share-idle");
    await updateShareholder(
      admin,
      masterId,
      idle.id,
      { name: "Idle", active: false },
      "share-idle-off",
    );
    const year = await getCompanyHishabYear(admin, masterId, drinkoId, "2026");
    expect(year.shareholders.some((person) => person.name === "Idle")).toBe(false);
  });

  it("lists every shareholder's invest per company for a month", async () => {
    const list = await listShareholders(admin, masterId, "2026-03");
    expect(list.companies.map((company) => company.companyName)).toEqual(["Drinko"]);
    const karim = list.shareholders.find((person) => person.name === "Karim");
    expect(karim?.investments).toEqual([{ companyId: drinkoId, amount: "200000.00" }]);
    expect(list.shareholders.some((person) => person.name === "Rahim")).toBe(true);
  });

  it("refuses a duplicate name, an unknown target company, and a non-admin", async () => {
    await expect(
      createShareholder(admin, masterId, { name: "Karim" }, "share-karim-again"),
    ).rejects.toSatisfy((error) => fieldError(error, "name", "validation.share.duplicateName"));
    const karim = (await listShareholders(admin, masterId)).shareholders.find(
      (person) => person.name === "Karim",
    );
    await expect(
      saveInvestments(
        admin,
        masterId,
        karim?.shareholderId ?? "",
        { entries: [{ targetCompanyId: masterId, fromMonth: "2026-04", amount: "1000" }] },
        "share-master-target",
      ),
    ).rejects.toSatisfy((error) => fieldError(error, "companyId", "validation.share.notCompany"));
    await expect(getCompanyHishabYear(admin, drinkoId, drinkoId, "2026")).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === "COMPANY_NOT_FOUND",
    );
    const member = contextFor(db, { ...admin.actor, isSuperAdmin: false });
    await expect(getCompanyHishabYear(member, masterId, drinkoId, "2026")).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });

  it("saves a batch atomically: one bad entry rolls back every entry in the same save", async () => {
    const rahim = (await listShareholders(admin, masterId)).shareholders.find(
      (person) => person.name === "Rahim",
    );
    await expect(
      saveInvestments(
        admin,
        masterId,
        rahim?.shareholderId ?? "",
        {
          entries: [
            { targetCompanyId: drinkoId, fromMonth: "2026-05", amount: "900000" },
            { targetCompanyId: masterId, fromMonth: "2026-05", amount: "1000" },
          ],
        },
        "share-rahim-batch",
      ),
    ).rejects.toSatisfy((error) => fieldError(error, "companyId", "validation.share.notCompany"));
    const list = await listShareholders(admin, masterId, "2026-05");
    const after = list.shareholders.find((person) => person.name === "Rahim");
    expect(after?.investments).toEqual([{ companyId: drinkoId, amount: "0.00" }]);
  });

  it("lays the master panel out as one row per month with every company's total profit", async () => {
    const year = await getMasterHishabYear(admin, masterId, "2026");
    expect(year.months.map((month) => month.month)).toEqual(
      Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`),
    );
    expect(year.companies.map((company) => company.companyName)).toEqual(["Drinko"]);
    expect(year.openPreviousDueTotal).toBe("0.00");
    expect(year.months.every((month) => month.previousDueTotal === "0.00")).toBe(true);
    expect(year.months.every((month) => month.totalProfit === "0.00")).toBe(true);
    expect(year.months.every((month) => month.distributableProfit === "0.00")).toBe(true);
    expect(year.months.every((month) => month.totalDan === "0.00")).toBe(true);
    expect(year.months[2]?.invest).toBe("200000.00");
    await expect(getMasterHishabYear(admin, masterId, "2026-1")).rejects.toSatisfy((error) =>
      fieldError(error, "year", "validation.share.year"),
    );

    const karim = year.shareholders.find((person) => person.name === "Karim");
    const forKarim = await getMasterHishabYear(admin, masterId, "2026", karim?.shareholderId);
    expect(forKarim.months[2]?.shareholderProfit).toBe("0.00");
    expect(forKarim.months[2]?.profitPerLakh).toBe(year.months[2]?.profitPerLakh);
  });

  it("CRUDs Previous Due and exposes the open total on the master year (D128)", async () => {
    const created = await createPreviousDue(
      admin,
      masterId,
      { reason: "Old loan", amount: "1500.00" },
      "previous-due-1",
    );
    expect(created).toMatchObject({ reason: "Old loan", amount: "1500.00" });
    const listed = await listPreviousDues(admin, masterId);
    expect(listed.openTotal).toBe("1500.00");
    expect(listed.items.some((row) => row.id === created.id)).toBe(true);

    const yearOpen = await getMasterHishabYear(admin, masterId, "2026");
    expect(yearOpen.openPreviousDueTotal).toBe("1500.00");
    // Until a reduction is applied, months keep full totalProfit as distributable.
    expect(yearOpen.months.every((month) => month.previousDueTotal === "0.00")).toBe(true);

    await applyPreviousDueReduction(
      admin,
      masterId,
      { previousDueId: created.id, month: "2026-03", amount: "500.00" },
      "previous-due-reduce-mar",
    );
    const afterReduce = await listPreviousDues(admin, masterId);
    expect(afterReduce.openTotal).toBe("1000.00");
    const yearReduced = await getMasterHishabYear(admin, masterId, "2026");
    expect(yearReduced.openPreviousDueTotal).toBe("1000.00");
    expect(yearReduced.months[2]?.previousDueTotal).toBe("500.00");

    await updatePreviousDue(
      admin,
      masterId,
      created.id,
      { reason: "Old loan settled", amount: "0" },
      "previous-due-settle",
    );
    const settled = await listPreviousDues(admin, masterId);
    expect(settled.openTotal).toBe("0.00");
    expect((await getMasterHishabYear(admin, masterId, "2026")).openPreviousDueTotal).toBe("0.00");

    await deletePreviousDue(admin, masterId, created.id);
    expect((await listPreviousDues(admin, masterId)).items).toEqual([]);
  });
});
