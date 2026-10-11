import { todayBusinessDate } from "@bsd/domain";
import { bootstrapSuperAdmin, createAuth, type Actor } from "@bsd/auth";
import type { ProductCreateRequest, StaffCreateRequest } from "@bsd/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { createRole, createUser, listUsers, resetUserPassword, updateUser } from "./administration";
import { createCompany } from "./companies";
import { cashAccounts, expenseCategories, staffRoles } from "./configuration";
import { AppError } from "./errors";
import {
  addProductPack,
  createProduct,
  getProductHistory,
  listProducts,
  setProductPrice,
  updateProduct,
} from "./products";
import {
  addStaffAssignment,
  createStaff,
  listStaffMembers,
  listStaffRecords,
  updateStaff,
  updateStaffAssignment,
} from "./staff";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let drinko = "";
let snacks = "";

const product = (sku: string, pieces: string): ProductCreateRequest => ({
  sku,
  name: `Product ${sku}`,
  aliases: [],
  baseUnit: "piece",
  piecesPerCarton: pieces,
  status: "active",
});

async function expectField(promise: Promise<unknown>, path: string) {
  await expect(promise).rejects.toSatisfy(
    (e) =>
      e instanceof AppError && e.code === "VALIDATION_FAILED" && e.fieldErrors?.[0]?.path === path,
  );
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

function shiftDays(businessDate: string, days: number): string {
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const ctx = contextFor(db, admin);
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  drinko = (await createCompany(ctx, { name: "Drinko", theme, modules: ["sales"] })).company.id;
  snacks = (await createCompany(ctx, { name: "Snacks", theme, modules: ["sales"] })).company.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("T62: a second company with different products needs no code change", () => {
  it("keeps products, carton sizes and prices per company", async () => {
    const ctx = contextFor(db, admin);
    const water = await createProduct(ctx, drinko, product("W500", "24"), "key-c-water-01");
    const cake = await createProduct(ctx, snacks, product("CAKE", "576"));
    await createProduct(ctx, snacks, product("W500", "12"));
    await setProductPrice(ctx, drinko, water.id, {
      kind: "sale",
      price: "13.5",
      effectiveFrom: "2026-08-01",
    });
    await setProductPrice(ctx, snacks, cake.id, {
      kind: "sale",
      price: "2.083333",
      effectiveFrom: "2026-08-01",
    });

    expect((await listProducts(ctx, drinko)).map((p) => [p.sku, p.piecesPerCarton])).toEqual([
      ["W500", "24"],
    ]);
    expect((await listProducts(ctx, snacks)).map((p) => [p.sku, p.piecesPerCarton])).toEqual([
      ["CAKE", "576"],
      ["W500", "12"],
    ]);
    expect((await getProductHistory(ctx, snacks, cake.id)).prices).toEqual([
      expect.objectContaining({ kind: "sale", price: "2.083333", effectiveFrom: "2026-08-01" }),
    ]);
    await expectField(getProductHistory(ctx, snacks, water.id), "id");
  });
});

describe("product packs and price history", () => {
  it("versions carton sizes by date and never rewrites them through the product form", async () => {
    const ctx = contextFor(db, admin);
    const p = await createProduct(ctx, drinko, product("ORANGE", "24"));
    // Before any dated pack the size is a correction of the base pack.
    expect((await updateProduct(ctx, drinko, p.id, product("ORANGE", "170"))).piecesPerCarton).toBe(
      "170",
    );

    const today = todayBusinessDate();
    await addProductPack(ctx, drinko, p.id, {
      piecesPerCarton: "96",
      effectiveFrom: shiftDays(today, 30),
    });
    expect((await listProducts(ctx, drinko)).find((x) => x.id === p.id)?.piecesPerCarton).toBe(
      "170",
    );
    await addProductPack(ctx, drinko, p.id, {
      piecesPerCarton: "48",
      effectiveFrom: shiftDays(today, -1),
    });
    expect((await listProducts(ctx, drinko)).find((x) => x.id === p.id)?.piecesPerCarton).toBe(
      "48",
    );
    // Same date replaces.
    await addProductPack(ctx, drinko, p.id, {
      piecesPerCarton: "60",
      effectiveFrom: shiftDays(today, -1),
    });

    const history = await getProductHistory(ctx, drinko, p.id);
    expect(history.packs.map((k) => [k.piecesPerCarton, k.effectiveFrom])).toEqual([
      ["170", null],
      ["60", shiftDays(today, -1)],
      ["96", shiftDays(today, 30)],
    ]);
    await expectField(updateProduct(ctx, drinko, p.id, product("ORANGE", "24")), "piecesPerCarton");
    expect(
      (await updateProduct(ctx, drinko, p.id, { ...product("ORANGE", "60"), name: "Orange" })).name,
    ).toBe("Orange");
  });

  it("stores per-piece prices by kind and date, replacing the same date", async () => {
    const ctx = contextFor(db, admin);
    const p = await createProduct(ctx, drinko, product("COLA", "24"));
    await setProductPrice(ctx, drinko, p.id, {
      kind: "cost",
      price: "10.25",
      effectiveFrom: "2026-08-01",
    });
    await setProductPrice(ctx, drinko, p.id, {
      kind: "cost",
      price: "10.5",
      effectiveFrom: "2026-08-01",
    });
    await setProductPrice(ctx, drinko, p.id, {
      kind: "cost",
      price: "11",
      effectiveFrom: "2026-08-15",
    });
    await setProductPrice(ctx, drinko, p.id, {
      kind: "order",
      price: "0",
      effectiveFrom: "2026-08-01",
    });
    const { prices } = await getProductHistory(ctx, drinko, p.id);
    expect(prices.map((x) => [x.kind, x.price, x.effectiveFrom])).toEqual([
      ["cost", "10.5", "2026-08-01"],
      ["cost", "11", "2026-08-15"],
      ["order", "0", "2026-08-01"],
    ]);
    await expectField(
      setProductPrice(ctx, drinko, p.id, {
        kind: "sale",
        price: "1.1234567",
        effectiveFrom: "2026-08-01",
      }),
      "price",
    );
    await expectField(
      setProductPrice(ctx, drinko, p.id, {
        kind: "sale",
        price: "-1",
        effectiveFrom: "2026-08-01",
      }),
      "price",
    );
    expect(
      await db.auditEvent.count({ where: { resourceId: p.id, action: "product.price_set" } }),
    ).toBe(4);
  });
});

describe("staff, roles and assignments", () => {
  it("seeds starter roles and blocks changing the kind of a role in use", async () => {
    const roles = await staffRoles.list(contextFor(db, admin));
    expect(roles.map((r) => r.kind).sort()).toEqual(["dsr", "general", "general", "general", "sr"]);
  });

  it("assigns one person to several companies without overlapping periods", async () => {
    const ctx = contextFor(db, admin);
    const roles = await staffRoles.list(ctx);
    const dsr = must(roles.find((r) => r.kind === "dsr"));
    const sr = must(roles.find((r) => r.kind === "sr"));
    const helper = must(roles.find((r) => r.kind === "general"));
    const today = todayBusinessDate();
    const mamun: StaffCreateRequest = {
      name: "Mamun",
      employer: "distributor",
      status: "active",
      assignment: { roleId: dsr.id, from: "2026-01-01", to: null, monthlySalary: null },
    };

    await expectField(createStaff(ctx, drinko, { ...mamun, employer: "supplier" }), "employer");
    await expectField(
      createStaff(ctx, drinko, {
        ...mamun,
        assignment: { roleId: sr.id, from: "2026-01-01", to: null },
      }),
      "employer",
    );
    const person = await createStaff(ctx, drinko, mamun, "key-c-staff-01");
    expect(person.assignments).toHaveLength(1);

    const both = await addStaffAssignment(ctx, snacks, person.id, {
      roleId: dsr.id,
      from: "2026-03-01",
      to: null,
    });
    expect(both.assignments.map((a) => a.companyId).sort()).toEqual([drinko, snacks].sort());
    await expectField(
      addStaffAssignment(ctx, drinko, person.id, {
        roleId: helper.id,
        from: "2026-06-01",
        to: null,
      }),
      "from",
    );
    await expectField(
      addStaffAssignment(ctx, drinko, person.id, {
        roleId: helper.id,
        from: "2026-06-01",
        to: "2026-05-01",
      }),
      "to",
    );
    await expectField(
      updateStaff(ctx, drinko, person.id, {
        name: "Mamun",
        employer: "supplier",
        status: "active",
      }),
      "employer",
    );

    const members = await listStaffMembers(ctx, drinko);
    expect(members).toEqual([
      {
        id: person.id,
        name: "Mamun",
        kind: "dsr",
        companyIds: expect.arrayContaining([drinko, snacks]),
      },
    ]);

    // Ending the Snacks assignment yesterday removes the person from today's Snacks entry list.
    const snacksAssignment = must(both.assignments.find((a) => a.companyId === snacks));
    await updateStaffAssignment(ctx, snacks, person.id, snacksAssignment.id, {
      roleId: dsr.id,
      from: "2026-03-01",
      to: shiftDays(today, -1),
    });
    expect(await listStaffMembers(ctx, snacks)).toEqual([]);
    expect((await listStaffMembers(ctx, drinko))[0]?.companyIds).toEqual([drinko]);

    await expectField(
      staffRoles.update(ctx, dsr.id, { name: dsr.name, kind: "general", active: true }),
      "kind",
    );
  });

  it("hides assignments in companies the viewer cannot access", async () => {
    const ctx = contextFor(db, admin);
    const dsr = must((await staffRoles.list(ctx)).find((r) => r.kind === "dsr"));
    const person = await createStaff(ctx, drinko, {
      name: "Raju",
      employer: "distributor",
      status: "active",
      assignment: { roleId: dsr.id, from: "2026-01-01", to: null },
    });
    await addStaffAssignment(ctx, snacks, person.id, {
      roleId: dsr.id,
      from: "2026-01-01",
      to: null,
    });

    const role = await createRole(ctx, { name: "Drinko viewer", permissions: ["company.view"] });
    const viewer = await createUser(ctx, {
      name: "Viewer",
      email: "viewer.c@example.test",
      password: "temporary-Password-1",
      memberships: [{ companyId: drinko, roleIds: [role.id] }],
    });
    const viewerCtx = contextFor(db, {
      userId: viewer.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
      mustChangePassword: false,
    });
    const raju = (await listStaffRecords(viewerCtx, drinko)).find((s) => s.id === person.id);
    expect(raju?.assignments.map((a) => a.companyId)).toEqual([drinko]);
    await expectCode(listStaffRecords(viewerCtx, snacks), "COMPANY_NOT_FOUND");
    await expectCode(
      createStaff(viewerCtx, drinko, {
        name: "Nope",
        employer: "distributor",
        status: "active",
        assignment: { roleId: dsr.id, from: "2026-01-01", to: null },
      }),
      "FORBIDDEN",
    );
  });
});

describe("configuration lists", () => {
  it("lets the super-admin manage lists that every tenant user can read", async () => {
    const ctx = contextFor(db, admin);
    const rent = await expenseCategories.create(
      ctx,
      { name: "গুদাম ভাড়া", active: true },
      "key-c-expense-1",
    );
    await expectField(expenseCategories.create(ctx, { name: "গুদাম ভাড়া", active: true }), "name");
    expect(
      await expenseCategories.update(ctx, rent.id, { name: "গুদাম ভাড়া", active: false }),
    ).toMatchObject({
      active: false,
    });
    const cash = await cashAccounts.create(ctx, { name: "Cash box", kind: "cash", active: true });
    expect(cash.kind).toBe("cash");

    const outsider = contextFor(db, { ...admin, userId: "member", isSuperAdmin: false });
    expect((await cashAccounts.list(outsider)).map((a) => a.name)).toEqual(["Cash box"]);
    await expectCode(
      cashAccounts.create(outsider, { name: "Bank", kind: "bank", active: true }),
      "FORBIDDEN",
    );
  });
});

describe("users and roles", () => {
  it("creates users with one-time passwords and enforces their roles", async () => {
    const ctx = contextFor(db, admin);
    const role = await createRole(ctx, {
      name: "Clerk",
      permissions: ["product.view", "company.view", "product.view"],
    });
    expect(role.permissions).toEqual(["company.view", "product.view"]);
    const clerk = await createUser(
      ctx,
      {
        name: "Clerk",
        email: "Clerk@Example.test",
        password: "temporary-Password-2",
        memberships: [{ companyId: snacks, roleIds: [role.id] }],
      },
      "key-c-user-0001",
    );
    expect(clerk).toMatchObject({
      email: "clerk@example.test",
      mustChangePassword: true,
      active: true,
    });
    await expectField(
      createUser(ctx, {
        name: "Again",
        email: "clerk@example.test",
        password: "temporary-Password-3",
        memberships: [],
      }),
      "email",
    );
    const clerkActor = {
      userId: clerk.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
      mustChangePassword: true,
    };
    expect((await loadCompanyAccess(contextFor(db, clerkActor), snacks)).permissions).toEqual([
      "company.view",
      "product.view",
    ]);
    await expectCode(loadCompanyAccess(contextFor(db, clerkActor), drinko), "COMPANY_NOT_FOUND");
    await expectCode(listUsers(contextFor(db, clerkActor)), "FORBIDDEN");

    const auth = createAuth(db);
    await auth.api.signInEmail({
      body: { email: "clerk@example.test", password: "temporary-Password-2" },
    });
    expect(await db.session.count({ where: { userId: clerk.id } })).toBe(1);

    await updateUser(ctx, clerk.id, {
      name: "Clerk",
      active: false,
      memberships: clerk.memberships,
    });
    expect(await db.session.count({ where: { userId: clerk.id } })).toBe(0);
    await expect(
      auth.api.signInEmail({
        body: { email: "clerk@example.test", password: "temporary-Password-2" },
      }),
    ).rejects.toThrow();

    await updateUser(ctx, clerk.id, { name: "Clerk", active: true, memberships: [] });
    await resetUserPassword(ctx, clerk.id, { password: "another-Password-44" });
    await auth.api.signInEmail({
      body: { email: "clerk@example.test", password: "another-Password-44" },
    });
    expect((await listUsers(ctx)).find((u) => u.id === clerk.id)?.memberships).toEqual([]);

    await expectField(
      updateUser(ctx, admin.userId, { name: "Admin", active: false, memberships: [] }),
      "active",
    );
    await expectField(
      resetUserPassword(ctx, admin.userId, { password: "another-Password-44" }),
      "id",
    );
    const audit = await db.auditEvent.findMany({ where: { resourceId: clerk.id } });
    expect(JSON.stringify(audit)).not.toContain("temporary-Password-2");
    expect(JSON.stringify(audit)).not.toContain("another-Password-44");
  });
});
