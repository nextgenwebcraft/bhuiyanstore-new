import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { toDecimal } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "./companies";
import { expenseCategories, staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { listMoneyEntries, postDsrDay, postMoneyEntry, reverseDsrDay, saveDsrDay } from "./daily";
import { listHandoverShorts } from "./handover-short";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/**
 * Money entered on a daily sheet (shop due, DSR short, operating cost) belongs to that SR's sheet.
 * Two SRs sold on one date through the same DSR; the other SR's sheet must not be charged again.
 * Numbers are worked out by hand in the comments.
 */

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
const DAY = "2026-09-01";

let admin: Actor;
let ctx: AppContext;
let company = "";
const id = { alpha: "", dsr: "", srA: "", srB: "", rent: "" };

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

const money = (kind: string, amount: string, extra: Record<string, unknown>) =>
  postMoneyEntry(ctx, company, { date: DAY, kind, amount, ...extra } as never);

async function sheet(staffId: string, issued: string, returned: string, handedOver: string) {
  const draft = await saveDsrDay(ctx, company, {
    date: DAY,
    staffId,
    version: 0,
    marketDueNew: "0",
    marketDueCollected: "0",
    cashHandedOver: handedOver,
    lines: [{ productId: id.alpha, dsrStaffId: id.dsr, issued, returned, damaged: "0" }],
  });
  return postDsrDay(ctx, company, draft.id, { version: draft.version });
}

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  admin = { userId: boot.adminId, tenantId: boot.tenantId, isSuperAdmin: true };
  ctx = contextFor(db, admin);
  company = (
    await createCompany(ctx, { name: "Drinko S", theme, modules: ["sales"], starterData: false })
  ).company.id;
  id.alpha = (
    await createProduct(ctx, company, {
      sku: "A250",
      name: "Alpha 250ml",
      aliases: [],
      baseUnit: "piece",
      piecesPerCarton: "24",
      status: "active",
    })
  ).id;
  const roles = await staffRoles.list(ctx);
  const role = (kind: string) => must(roles.find((r) => r.kind === kind)).id;
  const person = async (name: string, kind: string, employer: "distributor" | "supplier") =>
    (
      await createStaff(ctx, company, {
        name,
        employer,
        status: "active",
        companyId: company,
        assignment: { roleId: role(kind), from: "2026-01-01", to: null },
      })
    ).id;
  id.dsr = await person("Sojib", "dsr", "distributor");
  id.srA = await person("Hasan", "sr", "supplier");
  id.srB = await person("Rayhan", "sr", "supplier");
  id.rent = (await expenseCategories.create(ctx, { name: "Rent", active: true })).id;
  await saveWholeOpening(ctx, company, {
    cutoffDate: DAY,
    stock: [
      {
        productId: id.alpha,
        pieces: "200",
        unitCost: "10",
        salePrice: "12",
        dueFromCompany: "0",
        note: "",
      },
    ],
    balances: [],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sheet-owned money", () => {
  it("a due, a short and a cost entered on one sheet are charged to that sheet only", async () => {
    // Rayhan's sheet: Sojib's due 50, short 6 and operating cost 10 are entered on it.
    await money("marketDueNew", "50", {
      staffId: id.dsr,
      sheetStaffId: id.srB,
      newShop: { name: "Shop 1" },
    });
    await money("staffShortage", "6", { staffId: id.dsr, sheetStaffId: id.srB });
    await money("expense", "10", { expenseCategoryId: id.rent, sheetStaffId: id.srB });
    // Hasan's sheet has its own cost of 4 only.
    await money("expense", "4", { expenseCategoryId: id.rent, sheetStaffId: id.srA });

    const ofA = await listMoneyEntries(ctx, company, { from: DAY, sheetStaffId: id.srA });
    const ofB = await listMoneyEntries(ctx, company, { from: DAY, sheetStaffId: id.srB });
    expect(ofA.map((e) => e.kind)).toEqual(["expense"]);
    expect(ofB.map((e) => e.kind).sort()).toEqual(["expense", "marketDueNew", "staffShortage"]);

    // Hasan: 24 - 4 = 20 pieces x 12 = 240 sales, expected 240 - 4 cost = 236; handed over 230,
    // so 6 short. Rayhan: 12 - 2 = 10 x 12 = 120, expected 120 - 50 due - 6 short - 10 cost = 54;
    // handed over 54, so no short. Counting the date's entries on every sheet would make
    // Hasan's expected 240 - 50 - 6 - 14 = 170 (an excess, so no short).
    await sheet(id.srA, "24", "4", "230");
    await sheet(id.srB, "12", "2", "54");
    // The handover check prices a line by its stored sale price; set it as the batch would.
    await db.dsrLine.updateMany({ data: { salePrice: "12" } });
    const shorts = await listHandoverShorts(db, company, DAY, DAY);
    expect(shorts).toHaveLength(1);
    expect(shorts[0]).toMatchObject({ staffId: id.srA });
    expect(toDecimal(must(shorts[0]).amount).eq(6)).toBe(true);
  });

  it("reversing one sheet reverses only the money entered on it", async () => {
    const posted = await listMoneyEntries(ctx, company, { from: DAY });
    const sheets = await db.dsrDay.findMany({ where: { companyId: company } });
    const rayhan = must(sheets.find((s) => s.staffId === id.srB));
    await reverseDsrDay(ctx, company, rayhan.id, { version: rayhan.version });
    const after = await listMoneyEntries(ctx, company, { from: DAY });
    const live = (rows: typeof after) => rows.filter((e) => e.status === "posted");
    expect(live(posted)).toHaveLength(4);
    expect(live(after).map((e) => e.sheetStaffId)).toEqual([id.srA]);
    expect(live(after)[0]).toMatchObject({ kind: "expense", amount: "4" });
  });
});
