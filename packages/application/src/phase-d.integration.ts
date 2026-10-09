import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { openingBalanceKinds, type Opening, type OpeningSaveRequest } from "@bsd/contracts";
import { OPENING_KIND_EFFECTS } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { cashAccounts, staffRoles } from "./configuration";
import { AppError } from "./errors";
import { activateOpening, approveOpening, getOpening, saveOpening } from "./opening";
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
    expect(view).toMatchObject({ status: "draft", version: 0, cutoffDate: null });
    expect(view.stock.map((l) => [l.sku, l.pieces])).toEqual([
      ["A250", null],
      ["B1L", null],
    ]);
    const codes = view.issues.filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes).toContain("opening.issue.cutoffMissing");
    expect(codes).toContain("opening.issue.stockUnknown");
  });

  it("saves entered values and refuses stale versions and missing parties", async () => {
    const ctx = contextFor(db, admin);
    const before = await getOpening(ctx, drinko);
    const stock = toSave(before).stock.map((l) =>
      l.productId === alpha
        ? { ...l, pieces: "50", unitCost: "9.5", salePrice: "12" }
        : { ...l, pieces: "0" },
    );
    const saved = await saveOpening(
      ctx,
      drinko,
      toSave(before, {
        cutoffDate: "2026-11-30",
        stock,
        balances: [
          { kind: "market_due", staffId: null, cashAccountId: null, amount: "75", note: "" },
          { kind: "advance", staffId: rohim, cashAccountId: null, amount: "200", note: "" },
          { kind: "cash", staffId: null, cashAccountId: cashBox, amount: "1000", note: "" },
        ],
      }),
      "key-d-save-0001",
    );
    expect(saved.version).toBe(1);
    expect(saved.totals).toMatchObject({
      stockValue: "475.00",
      marketDue: "75.00",
      staffOwesUs: "200.00",
      cash: "1000.00",
    });
    expect(must(saved.stock.find((l) => l.productId === beta)).pieces).toBe("0");

    await expectField(
      saveOpening(ctx, drinko, toSave(before)),
      "version",
      "validation.opening.stale",
    );
    await expectField(
      saveOpening(
        ctx,
        drinko,
        toSave(saved, {
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

  it("opens a cash account in one company only", async () => {
    const ctx = contextFor(db, admin);
    const draft = await getOpening(ctx, snacks);
    const dated = await saveOpening(
      ctx,
      snacks,
      toSave(draft, {
        cutoffDate: "2026-11-30",
        balances: [
          { kind: "cash", staffId: null, cashAccountId: cashBox, amount: "500", note: "" },
        ],
      }),
    );
    const approved = await approveOpening(ctx, snacks, { version: dated.version });
    await expectField(
      activateOpening(ctx, snacks, { version: approved.version }),
      "balances",
      "validation.opening.cashElsewhere",
    );
    expect((await getOpening(ctx, snacks)).status).toBe("approved");
  });
});
