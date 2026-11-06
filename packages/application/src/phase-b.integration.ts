import { bootstrapSuperAdmin, createAuth, type Actor } from "@bsd/auth";
import type { CompanyCreateRequest, ProductCreateRequest } from "@bsd/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany, getWorkspace, listWorkspaces, updateCompany } from "./companies";
import { AppError } from "./errors";
import { changePassword } from "./me";
import { createProduct, listProducts, updateProduct } from "./products";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();
const PASSWORD = "one-time-Password-123";
const NEW_PASSWORD = "chosen-Password-456";

const companyInput = (name: string): CompanyCreateRequest => ({
  name,
  theme: { primary: "#0F766E", primaryForeground: "#FFFFFF" },
  modules: ["sales", "inventory"],
  blockNegativeStock: false,
  starterData: false,
});
const productInput = (sku: string, name = `Product ${sku}`): ProductCreateRequest => ({
  sku,
  name,
  aliases: [],
  baseUnit: "piece",
  piecesPerCarton: "24",
  status: "active",
});

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

let admin: Actor;

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "Admin@Example.test",
    adminName: "Admin",
    adminPassword: PASSWORD,
  });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
  };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("super-admin bootstrap and sign-in", () => {
  it("is idempotent and never resets the password", async () => {
    const before = await db.account.findFirstOrThrow({ where: { userId: admin.userId } });
    const again = await bootstrapSuperAdmin(db, {
      tenantName: "Other",
      adminEmail: "admin@example.test",
      adminName: "Other",
      adminPassword: "a-different-password-456",
    });
    expect(again).toEqual({ tenantId: admin.tenantId, adminId: admin.userId, created: false });
    const after = await db.account.findFirstOrThrow({ where: { userId: admin.userId } });
    expect(after.password).toBe(before.password);
    expect(await db.tenant.count()).toBe(1);
  });

  it("signs in with Better Auth; public sign-up and inactive users are refused", async () => {
    const auth = createAuth(db);
    const ok = await auth.api.signInEmail({
      body: { email: "admin@example.test", password: PASSWORD },
    });
    expect(ok.user.id).toBe(admin.userId);
    await expect(
      auth.api.signInEmail({
        body: { email: "admin@example.test", password: "wrong-password-000" },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.signUpEmail({
        body: { email: "new@example.test", password: PASSWORD, name: "New" },
      }),
    ).rejects.toThrow();
    await db.user.update({ where: { id: admin.userId }, data: { active: false } });
    await expect(
      auth.api.signInEmail({ body: { email: "admin@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
    await db.user.update({ where: { id: admin.userId }, data: { active: true } });
  });

  it("changes the password voluntarily and revokes the old one", async () => {
    const auth = createAuth(db);
    const signedIn = await auth.api.signInEmail({
      body: { email: "admin@example.test", password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const headers = new Headers({ cookie });
    const ctx = contextFor(db, admin);

    await expect(
      changePassword(ctx, auth, headers, {
        currentPassword: "not-the-password",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toSatisfy(
      (e) => e instanceof AppError && e.fieldErrors?.[0]?.path === "currentPassword",
    );
    await expectCode(
      changePassword(ctx, auth, headers, { currentPassword: PASSWORD, newPassword: "short" }),
      "VALIDATION_FAILED",
    );
    await changePassword(ctx, auth, headers, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(await db.auditEvent.count({ where: { action: "user.password_changed" } })).toBe(1);
    await expect(
      auth.api.signInEmail({ body: { email: "admin@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
    const again = await auth.api.signInEmail({
      body: { email: "admin@example.test", password: NEW_PASSWORD },
    });
    expect(again.user.id).toBe(admin.userId);
  });
});

describe("companies and products through the real database", () => {
  let companyA = "";
  let companyB = "";

  it("creates companies idempotently and rejects duplicate names", async () => {
    const ctx = contextFor(db, admin);
    const first = await createCompany(ctx, companyInput("Drinko"), "key-company-0001");
    const replay = await createCompany(ctx, companyInput("Drinko"), "key-company-0001");
    expect(replay.company.id).toBe(first.company.id);
    expect(await db.company.count()).toBe(1);
    await expectCode(
      createCompany(ctx, companyInput("Other"), "key-company-0001"),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      createCompany(ctx, companyInput("Drinko"), "key-company-0002"),
      "VALIDATION_FAILED",
    );
    companyA = first.company.id;
    companyB = (await createCompany(ctx, companyInput("PRAN"))).company.id;
    expect(first.company.modules).toEqual(["inventory", "sales"]);
    expect(first.permissions).toContain("product.create");
  });

  it("updates a company as a full replace and audits it", async () => {
    const ctx = contextFor(db, admin);
    const updated = await updateCompany(ctx, companyA, {
      ...companyInput("Drinko"),
      modules: ["sales"],
    });
    expect(updated.company.modules).toEqual(["sales"]);
    expect(await db.auditEvent.count({ where: { resourceId: companyA } })).toBe(2);
  });

  it("creates, lists and updates products with SKU uniqueness per company", async () => {
    const ctx = contextFor(db, admin);
    const p = await createProduct(
      ctx,
      companyA,
      productInput("D250", "Drinko 250ml"),
      "key-product-0001",
    );
    expect(p).toMatchObject({ companyId: companyA, sku: "D250", piecesPerCarton: "24" });
    await expectCode(createProduct(ctx, companyA, productInput("D250")), "VALIDATION_FAILED");
    await createProduct(ctx, companyB, productInput("D250"));
    const updated = await updateProduct(ctx, companyA, p.id, {
      ...productInput("D250", "Drinko 250 ml"),
      piecesPerCarton: "96",
    });
    expect(updated).toMatchObject({ name: "Drinko 250 ml", piecesPerCarton: "96" });
    expect((await listProducts(ctx, companyA)).map((x) => x.sku)).toEqual(["D250"]);
    await expectCode(updateProduct(ctx, companyB, p.id, productInput("D250")), "VALIDATION_FAILED");
    await expectCode(
      createProduct(ctx, companyA, { ...productInput("X1"), piecesPerCarton: "0" }),
      "VALIDATION_FAILED",
    );
  });

  it("returns one outcome for concurrent requests with the same key", async () => {
    const ctx = contextFor(db, admin);
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => createProduct(ctx, companyA, productInput("RACE"), "key-product-race")),
    );
    const ids = new Set(results.flatMap((r) => (r.status === "fulfilled" ? [r.value.id] : [])));
    expect(ids.size).toBe(1);
    expect(await db.product.count({ where: { companyId: companyA, sku: "RACE" } })).toBe(1);
  });

  it("isolates companies and tenants and enforces permissions", async () => {
    const viewer = await db.user.create({
      data: {
        id: "viewer-1",
        name: "Viewer",
        email: "viewer@example.test",
        tenantId: admin.tenantId,
      },
    });
    const role = await db.role.create({
      data: {
        tenantId: admin.tenantId,
        name: "Viewer",
        permissions: { create: [{ permission: "product.view" }, { permission: "company.view" }] },
      },
    });
    await db.membership.create({
      data: { userId: viewer.id, companyId: companyB, roles: { create: [{ roleId: role.id }] } },
    });
    const viewerCtx = contextFor(db, {
      userId: viewer.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
    });
    expect((await listWorkspaces(viewerCtx)).map((w) => w.company.id)).toEqual([companyB]);
    expect((await getWorkspace(viewerCtx, companyB)).permissions).toEqual([
      "company.view",
      "product.view",
    ]);
    expect(await listProducts(viewerCtx, companyB)).toHaveLength(1);
    await expectCode(listProducts(viewerCtx, companyA), "COMPANY_NOT_FOUND");
    await expectCode(listProducts(viewerCtx, "no-such-company"), "COMPANY_NOT_FOUND");
    await expectCode(createProduct(viewerCtx, companyB, productInput("V1")), "FORBIDDEN");
    await expectCode(createCompany(viewerCtx, companyInput("Mine")), "FORBIDDEN");

    const otherTenant = await db.tenant.create({ data: { name: "Other distributor" } });
    const outsider = contextFor(db, {
      userId: "outsider",
      tenantId: otherTenant.id,
      isSuperAdmin: true,
    });
    expect(await listWorkspaces(outsider)).toEqual([]);
    await expectCode(listProducts(outsider, companyA), "COMPANY_NOT_FOUND");
  });

  it("keeps the audit log append-only", async () => {
    const event = await db.auditEvent.findFirstOrThrow();
    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { action: "x" } }),
    ).rejects.toThrow();
    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });
});
