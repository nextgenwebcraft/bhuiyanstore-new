import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { toDecimal } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { createCompany } from "./companies";
import { staffRoles } from "./configuration";
import type { AppContext } from "./context";
import {
  listMoneyEntries,
  postDsrDay,
  postStockEntries,
  reverseDsrDay,
  reverseStockEntry,
  saveDsrDay,
} from "./daily";
import { AppError } from "./errors";
import {
  createFieldShop,
  createStaffLogin,
  deleteFieldVisit,
  getDsrFieldDay,
  getFieldDay,
  saveFieldVisit,
} from "./field";
import { runLedger } from "./ledger";
import { getOpening, saveOpeningCutoff, saveOpeningSection } from "./opening";
import { getPayrollRun } from "./payroll";
import { createProduct } from "./products";
import { getSetupStatus } from "./setup";
import { createShop, getShopStatement } from "./shops";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let ctx: AppContext;
let company = "";
const id = { alpha: "", rohim: "", kamal: "", shop: "" };

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

async function closingOn(date: string) {
  const access = await loadCompanyAccess(ctx, company);
  return must(await runLedger(db, access, date)).output;
}

async function loginFor(staffId: string, email: string): Promise<AppContext> {
  await createStaffLogin(ctx, company, staffId, { email, password: "one-time-Password-1" });
  const staff = await db.staff.findUniqueOrThrow({ where: { id: staffId } });
  return contextFor(db, {
    userId: must(staff.userId),
    tenantId: admin.tenantId,
    isSuperAdmin: false,
    mustChangePassword: false,
  });
}

const same = (a: string | null | undefined, b: string) => toDecimal(must(a)).eq(toDecimal(b));

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
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  company = (
    await createCompany(ctx, { name: "Drinko", theme, modules: ["sales"], starterData: false })
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
  const dsr = must(roles.find((r) => r.kind === "dsr")).id;
  const person = async (name: string, monthlySalary: string | null) =>
    (
      await createStaff(ctx, company, {
        name,
        employer: "distributor",
        status: "active",
        assignment: { roleId: dsr, from: "2026-01-01", to: null, monthlySalary },
      })
    ).id;
  id.rohim = await person("Rohim", "15000");
  id.kamal = await person("Kamal", null);
  id.shop = (await createShop(ctx, company, { name: "Hasan Store" })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("setup checklist and opening (PLAN §5.2–5.4)", () => {
  it("computes each step on the server from the entered data", async () => {
    const before = await getSetupStatus(ctx, company);
    const step = (s: typeof before, stepId: string) => must(s.steps.find((x) => x.id === stepId));
    expect(step(before, "products").complete).toBe(true);
    expect(step(before, "staff").missing).toEqual([{ code: "setup.missing.salary", count: 1 }]);
    expect(step(before, "cutoff").complete).toBe(false);
    expect(step(before, "openingStock").complete).toBe(false);
    expect(step(before, "staffOpening").complete).toBe(false);
    expect(before.ready).toBe(false);
    expect(before.live).toBe(false);

    const empty = await getOpening(ctx, company);
    let view = await saveOpeningCutoff(ctx, company, {
      version: empty.version,
      cutoffDate: "2026-09-01",
    });
    // The opening is live at once: no approval or activation step (D43).
    expect((await getSetupStatus(ctx, company)).live).toBe(true);
    expect(step(await getSetupStatus(ctx, company), "cutoff").complete).toBe(true);

    view = await saveOpeningSection(ctx, company, {
      section: "stock",
      version: view.version,
      stock: [
        {
          productId: id.alpha,
          pieces: "100",
          unitCost: "10",
          salePrice: "12",
          orderPrice: "10",
          dueFromCompany: "0",
          note: "",
        },
      ],
    });
    const shopDue = (amount: string) => ({
      section: "shopDue" as const,
      version: view.version,
      balances: [
        {
          kind: "shop_due" as const,
          staffId: null,
          cashAccountId: null,
          shopId: id.shop,
          amount,
          note: "",
        },
      ],
    });
    view = await saveOpeningSection(ctx, company, shopDue("200"));
    const entered = await getSetupStatus(ctx, company);
    expect(step(entered, "shops").complete).toBe(true);
    expect(step(entered, "openingStock").complete).toBe(true);
    expect(step(entered, "shopDue").complete).toBe(true);
    expect(step(entered, "staffOpening").complete).toBe(false);
    expect(step(entered, "staffOpening").missing[0]?.code).toBe("setup.missing.blanks");

    view = await saveOpeningSection(ctx, company, shopDue("250"));
    expect(view.sections.find((x) => x.section === "shopDue")?.state).toBe("done");
    // Saving the shop section left the stock lines alone.
    expect(view.stock.find((l) => l.productId === id.alpha)?.pieces).toBe("100");
  });

  it("carries a shop's opening due into its statement (D38)", async () => {
    const statement = await getShopStatement(ctx, company, id.shop, {
      from: "2026-09-01",
      to: "2026-09-01",
    });
    expect(same(statement.opening, "250")).toBe(true);
    expect(same(statement.closing, "250")).toBe(true);
  });

  it("proposes the monthly salary from the staff assignment in payroll", async () => {
    const run = await getPayrollRun(ctx, company, "2026-09");
    const salary = (staffId: string) => must(run.lines.find((l) => l.staffId === staffId)).salary;
    expect(same(salary(id.rohim), "15000")).toBe(true);
    expect(same(salary(id.kamal), "0")).toBe(true);
  });
});

describe("free-goods incentive (D16)", () => {
  it("adds stock without a bill or payable; replays and reverses cleanly", async () => {
    const before = await closingOn("2026-09-03");
    const post = () =>
      postStockEntries(
        ctx,
        company,
        { date: "2026-09-03", lines: [{ kind: "incentive", productId: id.alpha, pieces: "10" }] },
        "incentive-1",
      );
    const [entry] = await post();
    const [replayed] = await post();
    expect(must(replayed).id).toBe(must(entry).id);

    const after = await closingOn("2026-09-03");
    const stock = (out: typeof before) => must(out.closing.products[id.alpha]?.stock);
    expect(
      toDecimal(stock(after))
        .sub(toDecimal(stock(before)))
        .toString(),
    ).toBe("10");
    expect(after.closing.companyPayable).toBe(before.closing.companyPayable);

    await reverseStockEntry(ctx, company, must(entry).id);
    const reversed = await closingOn("2026-09-03");
    expect(stock(reversed)).toBe(stock(before));
  });
});

describe("DSR field panel (D40)", () => {
  const date = "2026-09-02";
  let rohim: AppContext;
  let kamal: AppContext;
  let visitId = "";
  let sheetVersion = 0;

  it("links a login to the DSR; the field user sees only their own day", async () => {
    rohim = await loginFor(id.rohim, "rohim@example.test");
    kamal = await loginFor(id.kamal, "kamal@example.test");
    await expectField(
      createStaffLogin(ctx, company, id.rohim, {
        email: "rohim2@example.test",
        password: "one-time-Password-1",
      }),
      "email",
      "validation.field.duplicateLogin",
    );
    sheetVersion = (
      await saveDsrDay(ctx, company, {
        date,
        staffId: id.rohim,
        version: 0,
        lines: [{ productId: id.alpha, issued: "48", returned: "0", damaged: "0" }],
      })
    ).version;
    const own = await getFieldDay(rohim, company, date);
    expect(own.staffId).toBe(id.rohim);
    expect(own.sheetStatus).toBe("draft");
    expect(must(own.products[0]).issued).toBe("48");
    const other = await getFieldDay(kamal, company, date);
    expect(other.staffId).toBe(id.kamal);
    expect(other.products).toEqual([]);
    await expect(getDsrFieldDay(rohim, company, id.kamal, date)).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "FORBIDDEN",
    );
  });

  it("prices on the server and refuses pieces beyond the samari in hand", async () => {
    const visit = await saveFieldVisit(rohim, company, undefined, {
      date,
      shopId: id.shop,
      version: 0,
      cashReceived: "100",
      dueCollected: "50",
      lines: [{ productId: id.alpha, delivered: "20", exchanged: "2" }],
    });
    visitId = visit.id;
    expect(same(visit.salesValue, "240")).toBe(true);
    expect(same(visit.dueCreated, "140")).toBe(true);
    expect(same(must(visit.lines[0]).unitPrice, "12")).toBe(true);

    await expectField(
      saveFieldVisit(rohim, company, undefined, {
        date,
        shopId: id.shop,
        version: 0,
        cashReceived: "0",
        dueCollected: "0",
        lines: [{ productId: id.alpha, delivered: "27", exchanged: "0" }],
      }),
      "lines.0",
      "validation.field.exceedsSamari",
    );
    const day = await getFieldDay(rohim, company, date);
    expect(must(day.products[0]).remaining).toBe("26");
    expect(same(day.totals.cashInHand, "150")).toBe(true);

    await expectField(
      deleteFieldVisit(kamal, company, visitId, { version: visit.version }),
      "",
      "validation.field.visitNotFound",
    );
    const shop = await createFieldShop(rohim, company, { name: "New Corner" });
    expect(shop.addedByDsr).toBe(true);
  });

  it("posting the day writes per-shop dues and locks the visits; reversing undoes it", async () => {
    const draft = await saveDsrDay(ctx, company, {
      date,
      staffId: id.rohim,
      version: sheetVersion,
      lines: [{ productId: id.alpha, issued: "48", returned: "26", damaged: "2" }],
    });
    const posted = await postDsrDay(ctx, company, draft.id, { version: draft.version });
    const entries = await listMoneyEntries(ctx, company, { from: date, to: date, shopId: id.shop });
    const amount = (kind: string) =>
      entries.filter((e) => e.kind === kind && e.status === "posted").map((e) => e.amount);
    expect(amount("marketDueNew").map((a) => toDecimal(a).toString())).toEqual(["140"]);
    expect(amount("marketDueCollected").map((a) => toDecimal(a).toString())).toEqual(["50"]);

    const locked = await getFieldDay(rohim, company, date);
    expect(locked.locked).toBe(true);
    expect(must(locked.visits[0]).status).toBe("locked");
    await expectField(
      saveFieldVisit(rohim, company, undefined, {
        date,
        shopId: id.shop,
        version: 0,
        cashReceived: "0",
        dueCollected: "10",
        lines: [],
      }),
      "",
      "validation.field.dayPosted",
    );

    await reverseDsrDay(ctx, company, posted.id, { version: posted.version });
    const after = await listMoneyEntries(ctx, company, { from: date, to: date, shopId: id.shop });
    expect(after.filter((e) => e.status === "posted")).toEqual([]);
    expect(must((await getFieldDay(rohim, company, date)).visits[0]).status).toBe("open");
  });
});
