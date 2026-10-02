import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { openingBalanceKinds, type Opening, type OpeningSaveRequest } from "@bsd/contracts";
import { OPENING_KIND_EFFECTS } from "@bsd/domain";
import { loadWorkbook, proposeOpening } from "@bsd/importer";
import { syntheticWorkbook } from "@bsd/importer/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { cashAccounts, staffRoles } from "./configuration";
import { AppError } from "./errors";
import {
  activateOpening,
  approveOpening,
  getOpening,
  importOpeningWorkbook,
  inspectOpeningWorkbook,
  openingTemplate,
  saveOpening,
} from "./opening";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let drinko = "";
let snacks = "";
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

async function bytes(workbook: { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }) {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** The editable part of a view, as the screen sends it back. */
function toSave(view: Opening, change: Partial<OpeningSaveRequest> = {}): OpeningSaveRequest {
  return {
    version: view.version,
    cutoffDate: view.cutoffDate,
    stock: view.stock.map((l) => ({
      productId: l.productId,
      pieces: l.pieces,
      unitCost: l.unitCost,
      salePrice: l.salePrice,
      orderPrice: l.orderPrice,
      dueFromCompany: l.dueFromCompany,
      note: l.note,
    })),
    balances: view.balances.map((b) => ({
      kind: b.kind,
      staffId: b.staffId,
      cashAccountId: b.cashAccountId,
      amount: b.amount,
      note: b.note,
    })),
    ...change,
  };
}

function withPieces(view: Opening, productId: string, pieces: string | null) {
  return toSave(view).stock.map((l) => (l.productId === productId ? { ...l, pieces } : l));
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
  await createStaff(ctx, drinko, {
    name: "Mamun",
    employer: "distributor",
    status: "active",
    assignment: { roleId: role("dsr"), from: "2026-01-01", to: null },
  });
  // The workbook's "SR Rohim" columns belong to a distributor DSR, as in the real book.
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

describe("Phase D: opening balances", () => {
  it("keeps the contract's balance kinds and the domain's effects in step", () => {
    expect(Object.keys(OPENING_KIND_EFFECTS).sort()).toEqual([...openingBalanceKinds].sort());
  });

  it("starts as an empty draft where every active product is unknown, never zero", async () => {
    const view = await getOpening(contextFor(db, admin), drinko);
    expect(view).toMatchObject({ status: "draft", version: 0, cutoffDate: null, source: null });
    expect(view.stock.map((l) => [l.sku, l.pieces])).toEqual([
      ["A250", null],
      ["B1L", null],
    ]);
    const codes = view.issues.filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes).toContain("opening.issue.cutoffMissing");
    expect(codes).toContain("opening.issue.stockUnknown");
  });

  it("imports a month sheet's closing as a proposal and keeps the Excel values as evidence", async () => {
    const ctx = contextFor(db, admin);
    const data = await bytes(syntheticWorkbook());
    expect(await inspectOpeningWorkbook(ctx, drinko, data)).toEqual({
      sheets: ["Nov 2026", "Oct 2026"],
      template: false,
    });
    await expectField(
      importOpeningWorkbook(ctx, drinko, {
        data,
        fileName: "book.xlsx",
        sheet: "Mar 2020",
        version: 0,
      }),
      "sheet",
    );
    await expectField(
      importOpeningWorkbook(ctx, drinko, {
        data: new Uint8Array([1, 2, 3]),
        fileName: "book.xlsx",
        sheet: "Nov 2026",
        version: 0,
      }),
      "file",
      "validation.opening.fileUnreadable",
    );

    const proposal = proposeOpening(syntheticWorkbook(), "Nov 2026");
    const view = await importOpeningWorkbook(
      ctx,
      drinko,
      { data, fileName: "book.xlsx", sheet: "Nov 2026", version: 0 },
      "key-d-import-01",
    );
    expect(view.version).toBe(1);
    expect(view.source).toMatchObject({ fileName: "book.xlsx", sheet: "Nov 2026" });
    expect(view.source?.fileHash).toMatch(/^[0-9a-f]{64}$/);
    const a = must(view.stock.find((l) => l.productId === alpha));
    const b = must(view.stock.find((l) => l.productId === beta));
    const pa = must(proposal.products.find((p) => p.label === "Alpha 250ml"));
    expect(a).toMatchObject({ pieces: pa.stock, unitCost: "9.5", salePrice: "12" });
    expect(a.source).toMatchObject({ label: "Alpha 250ml", pieces: pa.stock });
    // A negative closing is evidence of missing receipts: kept as source, entered value blank.
    expect(b.pieces).toBeNull();
    expect(b.source?.pieces).toBe("-12");
    expect(view.balances.find((x) => x.kind === "market_due" && !x.staffId)).toMatchObject({
      amount: "75.00",
      sourceAmount: "75",
    });
    const rohimLines = view.balances.filter((x) => x.staffId === rohim);
    expect(rohimLines.length).toBeGreaterThan(0);
    expect(rohimLines.every((x) => x.sourceAmount !== null)).toBe(true);
    expect(view.source?.unmatchedProducts).toEqual([]);
  });

  it("keeps the owner's edits on re-import and refuses stale versions", async () => {
    const ctx = contextFor(db, admin);
    const before = await getOpening(ctx, drinko);
    const stock = withPieces(before, beta, "0").map((l) =>
      l.productId === alpha ? { ...l, pieces: "50" } : l,
    );
    const saved = await saveOpening(
      ctx,
      drinko,
      toSave(before, {
        cutoffDate: "2026-11-30",
        stock,
        balances: [
          ...toSave(before).balances,
          { kind: "cash", staffId: null, cashAccountId: cashBox, amount: "1000", note: "" },
        ],
      }),
      "key-d-save-0001",
    );
    expect(saved.version).toBe(2);
    expect(saved.totals.cash).toBe("1000.00");

    const again = await importOpeningWorkbook(ctx, drinko, {
      data: await bytes(syntheticWorkbook()),
      fileName: "book.xlsx",
      sheet: "Nov 2026",
      version: 2,
    });
    expect(again.version).toBe(3);
    expect(again.stock.find((l) => l.productId === alpha)?.pieces).toBe("50");
    expect(again.stock.find((l) => l.productId === beta)?.pieces).toBe("0");
    expect(again.balances.find((x) => x.kind === "cash")?.amount).toBe("1000.00");

    await expectField(
      saveOpening(ctx, drinko, toSave(saved)),
      "version",
      "validation.opening.stale",
    );
    await expectField(
      saveOpening(
        ctx,
        drinko,
        toSave(again, {
          balances: [
            { kind: "shortage", staffId: null, cashAccountId: null, amount: "1", note: "" },
          ],
        }),
      ),
      "balances.0.kind",
      "validation.opening.personRequired",
    );
  });

  it("approves only without errors and returns to draft on any change", async () => {
    const ctx = contextFor(db, admin);
    const current = await getOpening(ctx, drinko);
    const broken = await saveOpening(
      ctx,
      drinko,
      toSave(current, { stock: withPieces(current, alpha, null) }),
    );
    await expectField(
      approveOpening(ctx, drinko, { version: broken.version }),
      "",
      "validation.opening.hasErrors",
    );
    const fixed = await saveOpening(
      ctx,
      drinko,
      toSave(broken, { stock: withPieces(broken, alpha, "50") }),
    );
    expect(fixed.issues.filter((i) => i.severity === "error")).toEqual([]);

    const role = await createRole(ctx, { name: "Opening clerk", permissions: ["opening.prepare"] });
    const clerk = await createUser(ctx, {
      name: "Clerk",
      email: "clerk.d@example.test",
      password: "temporary-Password-1",
      memberships: [{ companyId: drinko, roleIds: [role.id] }],
    });
    const clerkCtx = contextFor(db, {
      userId: clerk.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
      mustChangePassword: false,
    });
    expect((await getOpening(clerkCtx, drinko)).version).toBe(fixed.version);
    await expect(approveOpening(clerkCtx, drinko, { version: fixed.version })).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "FORBIDDEN",
    );

    const approved = await approveOpening(ctx, drinko, { version: fixed.version });
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
    const edited = await saveOpening(ctx, drinko, toSave(approved));
    expect(edited).toMatchObject({ status: "draft", approvedAt: null });
    await approveOpening(ctx, drinko, { version: edited.version });
  });

  it("activates once, sets catalog prices at the cutoff and locks the snapshot", async () => {
    const ctx = contextFor(db, admin);
    const approved = await getOpening(ctx, drinko);
    expect(approved.status).toBe("approved");
    const active = await activateOpening(
      ctx,
      drinko,
      { version: approved.version },
      "key-d-activate-01",
    );
    expect(active.status).toBe("active");
    const replay = await activateOpening(
      ctx,
      drinko,
      { version: approved.version },
      "key-d-activate-01",
    );
    expect(replay.activatedAt).toBe(active.activatedAt);
    await expectField(
      activateOpening(ctx, drinko, { version: approved.version }),
      "",
      "validation.opening.locked",
    );
    await expectField(saveOpening(ctx, drinko, toSave(active)), "", "validation.opening.locked");

    const prices = await db.priceChange.findMany({
      where: { productId: alpha, effectiveFrom: new Date("2026-11-30T00:00:00Z") },
      orderBy: { kind: "asc" },
    });
    expect(prices.map((p) => [p.kind, p.price.toFixed()])).toEqual(
      expect.arrayContaining([
        ["cost", "9.5"],
        ["sale", "12"],
      ]),
    );
    expect(
      await db.auditEvent.count({ where: { companyId: drinko, action: "opening.activate" } }),
    ).toBe(1);
  });

  it("round-trips the standard template and opens a cash account in one company only", async () => {
    const ctx = contextFor(db, admin);
    const template = await openingTemplate(ctx, snacks);
    expect(template.fileName).toBe("opening-Snacks.xlsx");
    expect(await inspectOpeningWorkbook(ctx, snacks, template.data)).toEqual({
      sheets: [],
      template: true,
    });
    const workbook = await loadWorkbook(template.data);
    const sheet = must(workbook.getWorksheet("Balances"));
    let cashRow = 0;
    sheet.eachRow((row, r) => {
      if (row.getCell(1).value === "cash" && row.getCell(4).value === "Cash box") cashRow = r;
    });
    expect(cashRow).toBeGreaterThan(2);
    sheet.getCell(cashRow, 5).value = 500;

    const imported = await importOpeningWorkbook(ctx, snacks, {
      data: await bytes(workbook),
      fileName: "opening-Snacks.xlsx",
      sheet: null,
      version: 0,
    });
    expect(imported.source?.sheet).toBe("template");
    expect(imported.balances.find((b) => b.kind === "cash")).toMatchObject({
      cashAccountId: cashBox,
      amount: "500.00",
    });
    const dated = await saveOpening(ctx, snacks, toSave(imported, { cutoffDate: "2026-11-30" }));
    const approved = await approveOpening(ctx, snacks, { version: dated.version });
    await expectField(
      activateOpening(ctx, snacks, { version: approved.version }),
      "balances",
      "validation.opening.cashElsewhere",
    );
    expect((await getOpening(ctx, snacks)).status).toBe("approved");
  });
});
