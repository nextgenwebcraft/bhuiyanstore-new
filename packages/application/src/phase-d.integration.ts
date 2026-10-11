import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import {
  openingBalanceKinds,
  openingSectionKinds,
  type Opening,
  type OpeningBalanceLine,
} from "@bsd/contracts";
import { OPENING_KIND_EFFECTS } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { cashAccounts, staffRoles } from "./configuration";
import { AppError } from "./errors";
import { postStockEntries } from "./daily";
import { getOpening, saveOpeningCutoff, saveOpeningSection } from "./opening";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let drinko = "";
let snacks = "";
let bakery = "";
let bakeryProduct = "";
let alpha = "";
let beta = "";
let rohim = "";
let cashBox = "";

async function expectField(promise: Promise<unknown>, path: string, code?: string) {
  await expect(promise).rejects.toSatisfy(
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.[0]?.path === path &&
      (code === undefined || e.fieldErrors?.[0]?.code === code),
  );
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

const stockLines = (view: Opening) =>
  view.stock.map((l) => ({
    productId: l.productId,
    pieces: l.pieces,
    unitCost: l.unitCost,
    salePrice: l.salePrice,
    orderPrice: l.orderPrice,
    dueFromCompany: l.dueFromCompany,
    note: l.note,
  }));

const withPieces = (view: Opening, productId: string, pieces: string | null) =>
  stockLines(view).map((l) => (l.productId === productId ? { ...l, pieces } : l));

const line = (
  kind: OpeningBalanceLine["kind"],
  amount: string | null,
  party: Partial<Pick<OpeningBalanceLine, "staffId" | "cashAccountId" | "shopId">> = {},
): OpeningBalanceLine => ({
  kind,
  staffId: null,
  cashAccountId: null,
  shopId: null,
  amount,
  note: "",
  ...party,
});

type Ctx = ReturnType<typeof contextFor>;

const saveBalances = (
  ctx: Ctx,
  company: string,
  view: Opening,
  section: keyof typeof openingSectionKinds,
  balances: OpeningBalanceLine[],
) => saveOpeningSection(ctx, company, { section, version: view.version, balances });

const saveStock = (
  ctx: Ctx,
  company: string,
  view: Opening,
  stock: ReturnType<typeof stockLines>,
) => saveOpeningSection(ctx, company, { section: "stock", version: view.version, stock });

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
  bakery = (await createCompany(ctx, { name: "Bakery", theme, modules: ["sales"] })).company.id;
  bakeryProduct = (
    await createProduct(ctx, bakery, {
      sku: "R1",
      name: "Rusk",
      aliases: [],
      baseUnit: "piece",
      piecesPerCarton: "10",
      status: "active",
    })
  ).id;
  const product = (sku: string, name: string, piecesPerCarton: string) =>
    createProduct(ctx, drinko, {
      sku,
      name,
      aliases: [],
      baseUnit: "piece",
      piecesPerCarton,
      status: "active",
    });
  alpha = (await product("A250", "Alpha 250ml", "24")).id;
  beta = (await product("B1L", "Beta 1lt", "1")).id;
  const roles = await staffRoles.list(ctx);
  const role = (kind: string) => must(roles.find((r) => r.kind === kind)).id;
  rohim = (
    await createStaff(ctx, drinko, {
      name: "Rohim",
      employer: "distributor",
      status: "active",
      assignment: { roleId: role("dsr"), from: "2026-01-01", to: null },
    })
  ).id;
  cashBox = (await cashAccounts.create(ctx, { name: "Cash box", kind: "cash", active: true })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Phase D: opening balances (save = live, D43)", () => {
  it("keeps the contract's balance kinds and the domain's effects in step", () => {
    expect(Object.keys(OPENING_KIND_EFFECTS).sort()).toEqual([...openingBalanceKinds].sort());
    // Every kind belongs to exactly one section.
    expect(Object.values(openingSectionKinds).flat().sort()).toEqual(
      [...openingBalanceKinds].sort(),
    );
  });

  it("starts empty and not locked, with every active product listed as pending", async () => {
    const view = await getOpening(contextFor(db, admin), drinko);
    expect(view).toMatchObject({
      version: 0,
      cutoffDate: null,
      locked: false,
      cutoffEditable: true,
    });
    expect(view.stock.map((l) => [l.sku, l.pieces])).toEqual([
      ["A250", null],
      ["B1L", null],
    ]);
    expect(view.sections.find((x) => x.section === "stock")).toMatchObject({
      entered: 0,
      total: 2,
      state: "pending",
    });
  });

  it("is live once the cutoff is saved and refuses a stale version", async () => {
    const ctx = contextFor(db, admin);
    const before = await getOpening(ctx, drinko);
    const dated = await saveOpeningCutoff(
      ctx,
      drinko,
      { version: before.version, cutoffDate: "2026-11-30" },
      "key-d-cutoff-0001",
    );
    expect(dated).toMatchObject({ version: 1, cutoffDate: "2026-11-30" });
    const replay = await saveOpeningCutoff(
      ctx,
      drinko,
      { version: before.version, cutoffDate: "2026-11-30" },
      "key-d-cutoff-0001",
    );
    expect(replay.version).toBe(1);
    await expectField(
      saveOpeningCutoff(ctx, drinko, { version: before.version, cutoffDate: "2026-11-29" }),
      "version",
      "validation.opening.stale",
    );
    expect(
      await db.auditEvent.count({ where: { companyId: drinko, action: "opening.cutoff" } }),
    ).toBe(1);
  });

  it("saves a section on its own and leaves the other sections alone", async () => {
    const ctx = contextFor(db, admin);
    let view = await getOpening(ctx, drinko);
    view = await saveBalances(ctx, drinko, view, "staff", [
      line("advance", "200", { staffId: rohim }),
    ]);
    view = await saveBalances(ctx, drinko, view, "marketDue", [line("market_due", "75")]);
    expect(view.totals).toMatchObject({ staffOwesUs: "200.00", marketDue: "75.00" });
    // Saving another section (here: empty) keeps the staff and market lines.
    view = await saveBalances(ctx, drinko, view, "shopDue", []);
    expect(view.balances.map((b) => b.kind).sort()).toEqual(["advance", "market_due"]);
    view = await saveBalances(ctx, drinko, view, "cash", [
      line("cash", "1000", { cashAccountId: cashBox }),
    ]);
    expect(view.totals.cash).toBe("1000.00");
    expect(view.balances).toHaveLength(3);
    // Replacing the staff section does not touch cash or market due.
    view = await saveBalances(ctx, drinko, view, "staff", []);
    expect(view.balances.map((b) => b.kind).sort()).toEqual(["cash", "market_due"]);
    expect(view.sections.find((x) => x.section === "cash")).toMatchObject({
      entered: 1,
      state: "done",
    });
  });

  it("accepts blanks, which count as 0 and show the section as pending", async () => {
    const ctx = contextFor(db, admin);
    const before = await getOpening(ctx, drinko);
    const view = await saveStock(
      ctx,
      drinko,
      before,
      stockLines(before).map((l) =>
        l.productId === alpha ? { ...l, pieces: "50", unitCost: "9.5", salePrice: "12" } : l,
      ),
    );
    expect(must(view.stock.find((l) => l.productId === beta)).pieces).toBeNull();
    expect(view.sections.find((x) => x.section === "stock")).toMatchObject({
      entered: 1,
      total: 2,
      state: "pending",
    });
    expect(view.totals.stockValue).toBe("475.00");
  });

  it("refuses real mistakes in the section only", async () => {
    const ctx = contextFor(db, admin);
    const view = await getOpening(ctx, drinko);
    // Negative stock.
    await expectField(
      saveStock(ctx, drinko, view, withPieces(view, alpha, "-5")),
      "stock.0.pieces",
      "validation.opening.pieces",
    );
    // Pieces without a unit cost.
    await expectField(
      saveStock(
        ctx,
        drinko,
        view,
        stockLines(view).map((l) =>
          l.productId === beta ? { ...l, pieces: "5", unitCost: null } : l,
        ),
      ),
      "stock.1.pieces",
      "opening.issue.costMissing",
    );
    await expectField(
      saveBalances(ctx, drinko, view, "staff", [line("shortage", "1")]),
      "balances.0.kind",
      "validation.opening.personRequired",
    );
    await expectField(
      saveBalances(ctx, drinko, view, "staff", [
        line("advance", "1", { staffId: rohim }),
        line("advance", "2", { staffId: rohim }),
      ]),
      "balances.1.kind",
      "validation.opening.duplicate",
    );
    // A kind from another section does not fit this one.
    await expectField(
      saveOpeningSection(ctx, drinko, {
        section: "cash",
        version: view.version,
        balances: [line("advance", "1", { staffId: rohim })],
      }),
      "balances.0.kind",
      "validation.opening.wrongSection",
    );
    // Nothing was written by the refused saves.
    expect((await getOpening(ctx, drinko)).version).toBe(view.version);
  });

  it("needs the opening.prepare permission", async () => {
    const ctx = contextFor(db, admin);
    const role = await createRole(ctx, { name: "Viewer", permissions: ["company.view"] });
    const viewer = await createUser(ctx, {
      name: "Viewer",
      email: "viewer.d@example.test",
      password: "temporary-Password-1",
      memberships: [{ companyId: drinko, roleIds: [role.id] }],
    });
    const viewerCtx = contextFor(db, {
      userId: viewer.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
      mustChangePassword: false,
    });
    const view = await getOpening(ctx, drinko);
    await expect(
      saveOpeningCutoff(viewerCtx, drinko, { version: view.version, cutoffDate: "2026-11-30" }),
    ).rejects.toSatisfy((e) => e instanceof AppError && e.code === "FORBIDDEN");
  });

  it("writes opening prices at save time and replaces them on every save", async () => {
    const ctx = contextFor(db, admin);
    const prices = async (productId: string, effectiveFrom: string) =>
      (
        await db.priceChange.findMany({
          where: { productId, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`) },
          orderBy: { kind: "asc" },
        })
      ).map((p) => [p.kind, p.price.toFixed(), p.source]);
    expect(await prices(alpha, "2026-11-30")).toEqual([
      ["cost", "9.5", "opening"],
      ["sale", "12", "opening"],
    ]);
    let view = await getOpening(ctx, drinko);
    view = await saveStock(
      ctx,
      drinko,
      view,
      stockLines(view).map((l) => (l.productId === alpha ? { ...l, salePrice: "13" } : l)),
    );
    expect(await prices(alpha, "2026-11-30")).toEqual([
      ["cost", "9.5", "opening"],
      ["sale", "13", "opening"],
    ]);
    // Moving the cutoff moves the prices with it.
    await saveOpeningCutoff(ctx, drinko, {
      version: view.version,
      cutoffDate: "2026-12-01",
    });
    expect(await prices(alpha, "2026-11-30")).toEqual([]);
    expect(await prices(alpha, "2026-12-01")).toEqual([
      ["cost", "9.5", "opening"],
      ["sale", "13", "opening"],
    ]);
  });

  it("opens a cash account in one company only, checked when the cash section is saved", async () => {
    const ctx = contextFor(db, admin);
    let view = await getOpening(ctx, snacks);
    view = await saveOpeningCutoff(ctx, snacks, {
      version: view.version,
      cutoffDate: "2026-11-30",
    });
    await expectField(
      saveBalances(ctx, snacks, view, "cash", [line("cash", "500", { cashAccountId: cashBox })]),
      "balances",
      "validation.opening.cashElsewhere",
    );
    expect((await getOpening(ctx, snacks)).balances).toEqual([]);
  });

  it("fixes the cutoff once a daily record exists and locks after a month close", async () => {
    const ctx = contextFor(db, admin);
    let view = await getOpening(ctx, bakery);
    view = await saveOpeningCutoff(ctx, bakery, {
      version: view.version,
      cutoffDate: "2026-09-01",
    });
    view = await saveStock(ctx, bakery, view, [
      {
        productId: bakeryProduct,
        pieces: "10",
        unitCost: "5",
        salePrice: "6",
        orderPrice: "5",
        dueFromCompany: "0",
        note: "",
      },
    ]);
    expect(view.cutoffEditable).toBe(true);
    await postStockEntries(ctx, bakery, {
      date: "2026-09-02",
      lines: [{ kind: "receipt", productId: bakeryProduct, pieces: "1" }],
    });
    view = await getOpening(ctx, bakery);
    expect(view.cutoffEditable).toBe(false);
    await expectField(
      saveOpeningCutoff(ctx, bakery, { version: view.version, cutoffDate: "2026-09-02" }),
      "cutoffDate",
      "validation.opening.cutoffInUse",
    );
    // Sections still save while no month is closed.
    view = await saveBalances(ctx, bakery, view, "company", [line("company_payable", "100")]);

    const closed = await db.monthClose.create({
      data: {
        tenantId: admin.tenantId,
        companyId: bakery,
        month: "2026-09",
        closing: {},
        closedById: admin.userId,
      },
    });
    view = await getOpening(ctx, bakery);
    expect(view).toMatchObject({ locked: true, cutoffEditable: false });
    await expectField(
      saveBalances(ctx, bakery, view, "company", []),
      "",
      "validation.opening.locked",
    );
    await expectField(
      saveOpeningCutoff(ctx, bakery, { version: view.version, cutoffDate: "2026-09-01" }),
      "",
      "validation.opening.locked",
    );
    // Reopening every month unlocks it again.
    await db.monthClose.delete({ where: { id: closed.id } });
    view = await getOpening(ctx, bakery);
    expect(view.locked).toBe(false);
    await saveBalances(ctx, bakery, view, "company", []);
  });
});
