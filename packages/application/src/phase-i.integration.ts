import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { todayBusinessDate } from "@bsd/domain";
import type { PermissionId } from "@bsd/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import type { AppContext } from "./context";
import { postMoneyEntry, postStockEntries } from "./daily";
import { fromDbDate } from "./dates";
import { AppError } from "./errors";
import { getOpening, saveOpeningCutoff, saveOpeningSection } from "./opening";
import { createProduct, deleteProduct } from "./products";
import { deleteShop, listShops } from "./shops";
import { deleteStaff, listStaffRecords } from "./staff";
import {
  STANDARD_CASH_ACCOUNTS,
  STANDARD_EXPENSE_CATEGORIES,
  STARTER_CASH,
  STARTER_COMPANY_ADVANCE,
  STARTER_NOTE,
  STARTER_PEOPLE,
  STARTER_PRODUCTS,
  STARTER_SHOPS,
  starterCashAccountName,
} from "./starter-dataset";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
const DAY = "2026-09-01"; // opening cutoff
const POST_DAY = todayBusinessDate(); // the creation day: starter assignments and go-live

let admin: Actor;
let ctx: AppContext;
let starter = ""; // company created with the starter dataset
let plain = ""; // company created without it
let dsrId = "";
let userCount = 0;

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

async function expectField(promise: Promise<unknown>, path: string, code: string) {
  await expect(promise).rejects.toSatisfy(
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.[0]?.path === path &&
      e.fieldErrors?.[0]?.code === code,
  );
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

async function userWith(company: string, permissions: PermissionId[]): Promise<AppContext> {
  userCount += 1;
  const role = await createRole(ctx, { name: `Phase I role ${userCount}`, permissions });
  const user = await createUser(ctx, {
    name: `User ${userCount}`,
    email: `i.user${userCount}@example.test`,
    password: "temporary-Password-1",
    memberships: [{ companyId: company, roleIds: [role.id] }],
  });
  return contextFor(db, {
    userId: user.id,
    tenantId: admin.tenantId,
    isSuperAdmin: false,
    mustChangePassword: false,
  });
}

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  await db.user.update({ where: { id: boot.adminId }, data: { mustChangePassword: false } });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
    mustChangePassword: false,
  };
  ctx = contextFor(db, admin);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("D51 starter dataset", () => {
  it("creates the dataset in the company transaction and nothing when switched off", async () => {
    const created = await createCompany(
      ctx,
      { name: "Starter", theme, modules: ["sales"], starterData: true },
      "key-starter-0001",
    );
    starter = created.company.id;
    const without = await createCompany(ctx, {
      name: "Plain",
      theme,
      modules: ["sales"],
      starterData: false,
    });
    plain = without.company.id;

    expect(await db.product.count({ where: { companyId: starter } })).toBe(STARTER_PRODUCTS.length);
    expect(
      await db.product.count({ where: { companyId: starter, name: { startsWith: "নমুনা" } } }),
    ).toBe(STARTER_PRODUCTS.length);
    expect(await db.shop.count({ where: { companyId: starter } })).toBe(STARTER_SHOPS.length);
    expect(await db.staffAssignment.count({ where: { companyId: starter } })).toBe(
      STARTER_PEOPLE.length,
    );
    // The seeded opening wrote its prices at the go-live date; they replaced the sample prices.
    expect(await db.priceChange.count({ where: { product: { companyId: starter } } })).toBe(
      STARTER_PRODUCTS.length * 3,
    );
    expect(
      await db.priceChange.count({
        where: { product: { companyId: starter }, source: { not: "opening" } },
      }),
    ).toBe(0);
    expect(await db.expenseCategory.count({ where: { tenantId: admin.tenantId } })).toBe(
      STANDARD_EXPENSE_CATEGORIES.length,
    );
    // The standard accounts plus the company's own cash account for its opening cash.
    expect(await db.cashAccount.count({ where: { tenantId: admin.tenantId } })).toBe(
      STANDARD_CASH_ACCOUNTS.length + 1,
    );

    // D59: every opening section is filled and live from the creation day.
    const opening = await getOpening(ctx, starter);
    expect(opening.cutoffDate).toBe(POST_DAY);
    expect(opening.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(opening.sections.map((s) => [s.section, s.state])).toEqual([
      ["stock", "done"],
      ["marketDue", "done"],
      ["shopDue", "done"],
      ["staff", "done"],
      ["company", "done"],
      ["cash", "done"],
    ]);
    expect(opening.stock.every((l) => l.pieces !== null && l.note === STARTER_NOTE)).toBe(true);
    expect(opening.totals.companyPayable).toBe(`-${STARTER_COMPANY_ADVANCE}.00`);
    expect(opening.totals.cash).toBe(`${STARTER_CASH}.00`);
    const cashLine = must(opening.balances.find((b) => b.kind === "cash"));
    const cashAccount = must(
      await db.cashAccount.findUnique({ where: { id: must(cashLine.cashAccountId) } }),
    );
    expect(cashAccount.name).toBe(starterCashAccountName("Starter"));
    // No daily records: everything stays editable and deletable.
    expect(opening.cutoffEditable).toBe(true);
    expect(await db.stockEntry.count({ where: { companyId: starter } })).toBe(0);
    expect(await db.moneyEntry.count({ where: { companyId: starter } })).toBe(0);

    expect(await db.product.count({ where: { companyId: plain } })).toBe(0);
    expect(await db.shop.count({ where: { companyId: plain } })).toBe(0);
    expect(await db.staffAssignment.count({ where: { companyId: plain } })).toBe(0);
    expect(await db.openingSession.count({ where: { companyId: plain } })).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "company.starter_data" } })).toBe(1);

    // Same key replays the stored response without a second dataset.
    const replay = await createCompany(
      ctx,
      { name: "Starter", theme, modules: ["sales"], starterData: true },
      "key-starter-0001",
    );
    expect(replay.company.id).toBe(starter);
    expect(await db.product.count({ where: { companyId: starter } })).toBe(STARTER_PRODUCTS.length);
  });

  it("creates tenant lists only when missing by name", async () => {
    await createCompany(ctx, { name: "Second", theme, modules: ["sales"] });
    expect(await db.expenseCategory.count({ where: { tenantId: admin.tenantId } })).toBe(
      STANDARD_EXPENSE_CATEGORIES.length,
    );
    expect(await db.staffRole.count({ where: { tenantId: admin.tenantId, name: "ডিএসআর" } })).toBe(
      1,
    );
    // The second company got its own copy of the sample masters (default is starterData true).
    const second = must(await db.company.findFirst({ where: { name: "Second" } }));
    expect(await db.product.count({ where: { companyId: second.id } })).toBe(
      STARTER_PRODUCTS.length,
    );
    // Its opening cash is in its own account, never in the first company's.
    const cash = (await getOpening(ctx, second.id)).balances.find((b) => b.kind === "cash");
    const account = must(
      await db.cashAccount.findUnique({ where: { id: must(cash?.cashAccountId) } }),
    );
    expect(account.name).toBe(starterCashAccountName("Second"));
  });

  it("rolls the whole company back when the dataset cannot be created", async () => {
    await db.staffRole.updateMany({ where: { kind: "dsr" }, data: { active: false } });
    const companies = await db.company.count();
    const products = await db.product.count();
    await expect(
      createCompany(ctx, { name: "Broken", theme, modules: ["sales"] }),
    ).rejects.toThrow();
    expect(await db.company.count()).toBe(companies);
    expect(await db.product.count()).toBe(products);
    await db.staffRole.updateMany({ where: { kind: "dsr" }, data: { active: true } });
  });

  it("lets the owner move the go-live date and change the seeded opening prices", async () => {
    const product = must(
      await db.product.findFirst({ where: { companyId: starter, sku: "NMN-001" } }),
    );
    let view = await saveOpeningCutoff(ctx, starter, {
      version: (await getOpening(ctx, starter)).version,
      cutoffDate: DAY,
    });
    const moved = await db.priceChange.findMany({ where: { product: { companyId: starter } } });
    expect(moved).toHaveLength(STARTER_PRODUCTS.length * 3);
    expect(moved.every((r) => r.source === "opening" && fromDbDate(r.effectiveFrom) === DAY)).toBe(
      true,
    );
    view = await saveOpeningSection(ctx, starter, {
      section: "stock",
      version: view.version,
      stock: view.stock.map((l) => ({
        productId: l.productId,
        pieces: l.pieces,
        unitCost: l.productId === product.id ? "19" : l.unitCost,
        salePrice: l.salePrice,
        dueFromCompany: l.dueFromCompany,
        note: l.note,
      })),
    });
    const cost = must(
      await db.priceChange.findFirst({ where: { productId: product.id, kind: "cost" } }),
    );
    expect(cost.price.toString()).toBe("19");
    expect(view.sections.every((s) => s.state === "done")).toBe(true);
  });
});

describe("D50 new shop from a due entry", () => {
  const roles = {} as { sale: AppContext; collect: AppContext; none: AppContext };

  beforeAll(async () => {
    const dsr = must(
      await db.staff.findFirst({
        where: { name: "নমুনা ডিএসআর ১", assignments: { some: { companyId: starter } } },
      }),
    );
    dsrId = dsr.id;
    roles.sale = await userWith(starter, ["company.view", "sale.post"]);
    roles.collect = await userWith(starter, ["company.view", "collection.post"]);
    roles.none = await userWith(starter, ["company.view", "shop.manage"]);
  });

  const post = (
    c: AppContext,
    kind: "marketDueNew" | "marketDueCollected",
    name: string,
    key?: string,
  ) =>
    postMoneyEntry(
      c,
      starter,
      { date: POST_DAY, kind, amount: "100", staffId: dsrId, newShop: { name } },
      key,
    );

  it("creates the shop and posts the entry once, idempotently", async () => {
    const before = await db.shop.count({ where: { companyId: starter } });
    const first = await post(roles.sale, "marketDueNew", "  দোকান আলফা  ", "key-newshop-0001");
    const replay = await post(roles.sale, "marketDueNew", "  দোকান আলফা  ", "key-newshop-0001");
    expect(replay.id).toBe(first.id);
    expect(first.shopName).toBe("দোকান আলফা");
    expect(await db.shop.count({ where: { companyId: starter } })).toBe(before + 1);
    expect(await db.moneyEntry.count({ where: { companyId: starter, shopId: first.shopId } })).toBe(
      1,
    );
    const shop = must(
      await db.shop.findFirst({ where: { companyId: starter, name: "দোকান আলফা" } }),
    );
    expect(shop.status).toBe("active");
    expect(
      await db.auditEvent.count({ where: { action: "shop.create", resourceId: shop.id } }),
    ).toBe(1);
    expect((await listShops(ctx, starter)).map((s) => s.name)).toContain("দোকান আলফা");
  });

  it("reuses a shop whose exact name exists", async () => {
    const count = await db.shop.count({ where: { companyId: starter } });
    const entry = await post(roles.collect, "marketDueCollected", "দোকান আলফা");
    expect(entry.shopName).toBe("দোকান আলফা");
    expect(await db.shop.count({ where: { companyId: starter } })).toBe(count);
  });

  it("is allowed by the posting permission of the kind alone", async () => {
    await expectCode(post(roles.sale, "marketDueCollected", "দোকান বিটা"), "FORBIDDEN");
    await expectCode(post(roles.collect, "marketDueNew", "দোকান বিটা"), "FORBIDDEN");
    expect(await db.shop.count({ where: { companyId: starter, name: "দোকান বিটা" } })).toBe(0);
    // shop.manage alone cannot post either; the kind's own permission decides.
    await expectCode(post(roles.none, "marketDueNew", "দোকান বিটা"), "FORBIDDEN");
  });

  it("refuses shopId with newShop and a newShop for other kinds", async () => {
    const shop = must(await db.shop.findFirst({ where: { companyId: starter } }));
    await expectField(
      postMoneyEntry(roles.sale, starter, {
        date: POST_DAY,
        kind: "marketDueNew",
        amount: "5",
        staffId: dsrId,
        shopId: shop.id,
        newShop: { name: "X" },
      }),
      "newShop",
      "validation.shop.newShopExclusive",
    );
    await expectField(
      postMoneyEntry(ctx, starter, {
        date: POST_DAY,
        kind: "supplierDeposit",
        amount: "5",
        newShop: { name: "X" },
      }),
      "newShop",
      "validation.shop.notForKind",
    );
  });

  it("does not silently reuse an inactive shop of the same name", async () => {
    await db.shop.updateMany({
      where: { companyId: starter, name: "দোকান আলফা" },
      data: { status: "inactive" },
    });
    const count = await db.moneyEntry.count({ where: { companyId: starter } });
    await expectField(
      post(roles.sale, "marketDueNew", "দোকান আলফা"),
      "newShop",
      "validation.shop.inactiveName",
    );
    expect(await db.moneyEntry.count({ where: { companyId: starter } })).toBe(count);
  });
});

describe("D51 delete only what was never used", () => {
  it("deletes an unused product with its prices, packs and opening line, and audits it", async () => {
    const product = must(
      await db.product.findFirst({ where: { companyId: starter, sku: "NMN-008" } }),
    );
    expect(await db.openingStockLine.count({ where: { productId: product.id } })).toBe(1);
    await deleteProduct(ctx, starter, product.id);
    expect(await db.product.count({ where: { id: product.id } })).toBe(0);
    expect(await db.priceChange.count({ where: { productId: product.id } })).toBe(0);
    expect(await db.productPack.count({ where: { productId: product.id } })).toBe(0);
    expect(await db.openingStockLine.count({ where: { productId: product.id } })).toBe(0);
    expect(
      await db.auditEvent.count({ where: { action: "product.delete", resourceId: product.id } }),
    ).toBe(1);
    await expectField(deleteProduct(ctx, starter, product.id), "id", "validation.product.unknown");
  });

  it("refuses a used product", async () => {
    const used = must(
      await db.product.findFirst({ where: { companyId: starter, sku: "NMN-001" } }),
    );
    await postStockEntries(ctx, starter, {
      date: POST_DAY,
      lines: [{ kind: "incentive", productId: used.id, pieces: "1" }],
      prices: [],
    });
    await expectField(deleteProduct(ctx, starter, used.id), "id", "validation.product.inUse");
    expect(await db.openingStockLine.count({ where: { productId: used.id } })).toBe(1);
    expect(await db.product.count({ where: { id: used.id } })).toBe(1);
    const fresh = await createProduct(ctx, plain, {
      sku: "P1",
      name: "Fresh",
      aliases: [],
      baseUnit: "piece",
      piecesPerCarton: "12",
      status: "active",
    });
    await deleteProduct(ctx, plain, fresh.id);
  });

  it("deletes an unused shop and refuses one with entries", async () => {
    const unused = must(
      await db.shop.findFirst({ where: { companyId: starter, name: "নমুনা দোকান ৪" } }),
    );
    expect(await db.openingBalanceLine.count({ where: { shopId: unused.id } })).toBe(1);
    await deleteShop(ctx, starter, unused.id);
    expect(await db.shop.count({ where: { id: unused.id } })).toBe(0);
    expect(await db.openingBalanceLine.count({ where: { shopId: unused.id } })).toBe(0);
    const used = must(
      await db.shop.findFirst({ where: { companyId: starter, name: "দোকান আলফা" } }),
    );
    await expectField(deleteShop(ctx, starter, used.id), "id", "validation.shop.inUse");
    expect(await db.shop.count({ where: { id: used.id } })).toBe(1);
  });

  it("deletes an unused person with the assignment and refuses one with entries", async () => {
    const records = await listStaffRecords(ctx, starter);
    const manager = must(records.find((r) => r.name === "নমুনা ম্যানেজার"));
    expect(await db.openingBalanceLine.count({ where: { staffId: manager.id } })).toBe(1);
    await deleteStaff(ctx, starter, manager.id);
    expect(await db.staff.count({ where: { id: manager.id } })).toBe(0);
    expect(await db.staffAssignment.count({ where: { staffId: manager.id } })).toBe(0);
    expect(await db.openingBalanceLine.count({ where: { staffId: manager.id } })).toBe(0);
    // The DSR has money entries from the D50 tests.
    await expectField(deleteStaff(ctx, starter, dsrId), "id", "validation.staff.inUse");
    expect(await db.staff.count({ where: { id: dsrId } })).toBe(1);
  });

  it("needs the manage permissions", async () => {
    const viewer = await userWith(starter, ["company.view", "product.view"]);
    const product = must(
      await db.product.findFirst({ where: { companyId: starter, sku: "NMN-007" } }),
    );
    await expectCode(deleteProduct(viewer, starter, product.id), "FORBIDDEN");
    const shop = must(
      await db.shop.findFirst({ where: { companyId: starter, name: "নমুনা দোকান ৩" } }),
    );
    await expectCode(deleteShop(viewer, starter, shop.id), "FORBIDDEN");
    await expectCode(deleteStaff(viewer, starter, dsrId), "FORBIDDEN");
  });

  it("keeps opening lines as use once the opening is locked (D43)", async () => {
    const product = must(
      await db.product.findFirst({ where: { companyId: starter, sku: "NMN-007" } }),
    );
    const shop = must(
      await db.shop.findFirst({ where: { companyId: starter, name: "নমুনা দোকান ৩" } }),
    );
    const close = await db.monthClose.create({
      data: {
        tenantId: admin.tenantId,
        companyId: starter,
        month: "2026-08",
        closing: {},
        closedById: admin.userId,
      },
    });
    await expectField(deleteProduct(ctx, starter, product.id), "id", "validation.product.inUse");
    await expectField(deleteShop(ctx, starter, shop.id), "id", "validation.shop.inUse");
    expect(await db.openingStockLine.count({ where: { productId: product.id } })).toBe(1);
    await db.monthClose.delete({ where: { id: close.id } });
  });
});

describe("migration 20261014010000_standard_expense_categories", () => {
  it("adds the four categories to every tenant, only when missing, and is repeatable", async () => {
    const other = await db.tenant.create({ data: { name: "Other distributor" } });
    await db.expenseCategory.deleteMany({
      where: {
        tenantId: { in: [admin.tenantId, other.id] },
        name: { in: ["বিদ্যুৎ বিল", "লোড আনলোড"] },
      },
    });
    // A deactivated category of the same name stays as it is.
    await db.expenseCategory.create({
      data: { tenantId: other.id, name: "গ্যারেজ ভাড়া", active: false },
    });
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          "../../database/prisma/migrations/20261014010000_standard_expense_categories/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    await db.$executeRawUnsafe(sql);
    await db.$executeRawUnsafe(sql);
    for (const tenantId of [admin.tenantId, other.id]) {
      const names = (await db.expenseCategory.findMany({ where: { tenantId } })).map((c) => c.name);
      for (const name of ["লোড আনলোড", "বিদ্যুৎ বিল", "গ্যারেজ ভাড়া", "গোডাউন ভাড়া"]) {
        expect(names.filter((n) => n === name)).toHaveLength(1);
      }
    }
    const kept = must(
      await db.expenseCategory.findFirst({ where: { tenantId: other.id, name: "গ্যারেজ ভাড়া" } }),
    );
    expect(kept.active).toBe(false);
  });
});
