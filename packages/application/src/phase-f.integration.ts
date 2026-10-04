import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { reportIds } from "@bsd/contracts";
import { computeMonth, type DayInput, type MonthOpening } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { expenseCategories, staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { discardDsrDay, postDsrDay, postMoneyEntry, postStockEntries, saveDsrDay } from "./daily";
import { todayInDhaka } from "./dates";
import { AppError } from "./errors";
import { runLedger } from "./ledger";
import { closeMonth, exportReport, getMonthView, getReport, reopenMonth } from "./month";
import { activateOpening, approveOpening, getOpening, saveOpening } from "./opening";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let ctx: AppContext;
let company = "";
const id = { alpha: "", mamun: "", rohim: "", transport: "" };

function must<T>(value: T | null | undefined): T {
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

/** Facts per day: receipt pieces, one DSR sheet (issued, returned, বাকি) and an expense. */
const FACTS = [
  { date: "2026-08-30", received: "48", issued: "60", returned: "12", due: "100", expense: "40" },
  { date: "2026-08-31", received: "0", issued: "24", returned: "0", due: "0", expense: "0" },
  { date: "2026-09-01", received: "24", issued: "36", returned: "6", due: "30", expense: "20" },
  { date: "2026-09-02", received: "0", issued: "12", returned: "0", due: "0", expense: "10" },
] as const;

type Fact = (typeof FACTS)[number];

function engineDay(f: Fact): DayInput {
  return {
    date: f.date,
    products: f.received === "0" ? {} : { [id.alpha]: { received: f.received } },
    dsrLines: [
      {
        staffId: id.mamun,
        productId: id.alpha,
        issued: f.issued,
        returned: f.returned,
        damaged: "0",
        priceSplits: [],
      },
    ],
    money: [
      ...(f.due === "0"
        ? []
        : [{ kind: "marketDueNew" as const, amount: f.due, staffId: id.mamun }]),
      ...(f.expense === "0"
        ? []
        : [{ kind: "expense" as const, amount: f.expense, category: id.transport }]),
    ],
  };
}

function opening(): MonthOpening {
  return {
    products: {
      [id.alpha]: {
        stock: "200",
        dueFromCompany: "0",
        orderPrice: "9.5",
        costPrice: "9.5",
        salePrice: "11",
      },
    },
    marketDue: { [id.mamun]: "500" },
  };
}

const catalog = () => [{ id: id.alpha, piecesPerCarton: "24" }];

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
  company = (await createCompany(ctx, { name: "Drinko", theme, modules: ["sales"] })).company.id;
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
  const dsr = async (name: string) =>
    (
      await createStaff(ctx, company, {
        name,
        employer: "distributor",
        status: "active",
        assignment: {
          roleId: must(roles.find((r) => r.kind === "dsr")).id,
          from: "2026-01-01",
          to: null,
        },
      })
    ).id;
  id.mamun = await dsr("Mamun");
  id.rohim = await dsr("Rohim");
  id.transport = (await expenseCategories.create(ctx, { name: "Transport", active: true })).id;

  const empty = await getOpening(ctx, company);
  const saved = await saveOpening(ctx, company, {
    version: empty.version,
    cutoffDate: "2026-08-30",
    stock: [
      {
        productId: id.alpha,
        pieces: "200",
        unitCost: "9.5",
        salePrice: "11",
        orderPrice: "9.5",
        dueFromCompany: "0",
        note: "",
      },
    ],
    balances: [
      { kind: "market_due", staffId: id.mamun, cashAccountId: null, amount: "500", note: "" },
    ],
  });
  const approved = await approveOpening(ctx, company, { version: saved.version });
  await activateOpening(ctx, company, { version: approved.version });

  for (const f of FACTS) {
    if (f.received !== "0") {
      await postStockEntries(ctx, company, {
        date: f.date,
        lines: [{ kind: "receipt", productId: id.alpha, pieces: f.received }],
      });
    }
    const sheet = await saveDsrDay(ctx, company, {
      date: f.date,
      staffId: id.mamun,
      version: 0,
      marketDueNew: f.due,
      marketDueCollected: "0",
      lines: [{ productId: id.alpha, issued: f.issued, returned: f.returned, damaged: "0" }],
    });
    await postDsrDay(ctx, company, sheet.id, { version: sheet.version });
    if (f.expense !== "0") {
      await postMoneyEntry(ctx, company, {
        date: f.date,
        kind: "expense",
        amount: f.expense,
        expenseCategoryId: id.transport,
      });
    }
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Phase F: month view, reports and closing", () => {
  it("shows month figures equal to an independent engine run", async () => {
    const august = computeMonth({
      products: catalog(),
      opening: opening(),
      days: FACTS.filter((f) => f.date < "2026-09-01").map(engineDay),
    });
    const view = await getMonthView(ctx, company, "2026-08");
    expect(view.status).toBe("open");
    expect(view.from).toBe("2026-08-30");
    expect(view.to).toBe("2026-08-31");
    expect(view.totals.salesTotal).toBe(august.month.totals.salesTotal);
    expect(view.totals.profitTotal).toBe(august.month.totals.profitTotal);
    expect(view.products[0]?.closingStock).toBe(august.month.products[0]?.closingStock);
    expect(view.marketDue.closing).toBe(august.month.marketDue.closing);
    expect(view.days.map((d) => d.cashLeft)).toEqual(august.days.map((d) => d.money.cashLeft));
    expect(view.profit?.expensesByCategory).toEqual([
      { name: "Transport", amount: must(august.month.profit.expensesByCategory[id.transport]) },
    ]);
    expect(view.canClose).toBe(true);
    expect(view.closeBlockedBy).toBeNull();

    const current = await getMonthView(ctx, company, todayInDhaka().slice(0, 7));
    expect(current.closeBlockedBy).toBe("validation.month.notOver");
    expect((await getMonthView(ctx, company, "2026-07")).status).toBe("beforeOpening");
  });

  it("closes months in order, blocks backdating and reopens only the latest", async () => {
    await expectField(
      closeMonth(ctx, company, "2026-09"),
      "month",
      "validation.month.previousOpen",
    );

    const draft = await saveDsrDay(ctx, company, {
      date: "2026-08-31",
      staffId: id.rohim,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      lines: [],
    });
    await expectField(closeMonth(ctx, company, "2026-08"), "month", "validation.month.drafts");
    await discardDsrDay(ctx, company, draft.id, { version: draft.version });

    const access = await loadCompanyAccess(ctx, company);
    const augustRun = must(await runLedger(db, access, "2026-08-31"));
    expect(await closeMonth(ctx, company, "2026-08", "key-f-close-aug-01")).toEqual({
      month: "2026-08",
      status: "closed",
    });
    // Replay returns the same result instead of failing as already closed.
    expect((await closeMonth(ctx, company, "2026-08", "key-f-close-aug-01")).status).toBe("closed");
    await expectField(
      closeMonth(ctx, company, "2026-08"),
      "month",
      "validation.month.alreadyClosed",
    );
    const stored = must(
      await db.monthClose.findUnique({
        where: { companyId_month: { companyId: company, month: "2026-08" } },
      }),
    );
    expect(stored.closing).toEqual(augustRun.output.closing);

    const closed = await getMonthView(ctx, company, "2026-08");
    expect(closed.status).toBe("closed");
    expect(closed.closedByName).toBe("Admin");
    expect(closed.canReopen).toBe(true);
    expect(closed.totals.salesTotal).toBe(augustRun.output.month.totals.salesTotal);
    await expectField(
      postMoneyEntry(ctx, company, {
        date: "2026-08-31",
        kind: "expense",
        amount: "1",
        expenseCategoryId: id.transport,
      }),
      "date",
      "validation.daily.monthClosed",
    );

    const september = await getMonthView(ctx, company, "2026-09");
    expect(september.marketDue.opening).toBe(augustRun.output.month.marketDue.closing);
    await closeMonth(ctx, company, "2026-09");
    await expectField(
      reopenMonth(ctx, company, "2026-08"),
      "month",
      "validation.month.laterClosed",
    );
    expect((await getMonthView(ctx, company, "2026-08")).canReopen).toBe(false);
    await reopenMonth(ctx, company, "2026-09");
    await reopenMonth(ctx, company, "2026-08");
    await expectField(reopenMonth(ctx, company, "2026-08"), "month", "validation.month.notClosed");
    expect((await getMonthView(ctx, company, "2026-08")).status).toBe("open");

    const audit = await db.auditEvent.findMany({
      where: { companyId: company, action: { in: ["month.close", "month.reopen"] } },
    });
    expect(audit).toHaveLength(4);
  });

  it("reports a date range from one engine run opening at the day before", async () => {
    const first = computeMonth({
      products: catalog(),
      opening: opening(),
      days: [engineDay(FACTS[0])],
    });
    const range = computeMonth({
      products: catalog(),
      opening: first.closing,
      days: FACTS.slice(1).map(engineDay),
    });
    const sales = await getReport(ctx, company, "sales", { from: "2026-08-31", to: "2026-09-02" });
    expect(sales.from).toBe("2026-08-31");
    expect(sales.tables[0]?.totals?.salesTotal).toBe(range.month.totals.salesTotal);
    expect(sales.tables[1]?.rows.map((r) => r.cells.sales)).toEqual(
      range.days.map((d) => d.money.sales),
    );

    const due = await getReport(ctx, company, "market-due", {
      from: "2026-08-31",
      to: "2026-09-02",
    });
    expect(due.tables[0]?.totals).toEqual({
      staff: null,
      opening: range.month.marketDue.opening,
      added: range.month.marketDue.added,
      collected: range.month.marketDue.collected,
      closing: range.month.marketDue.closing,
    });

    // A range starting before the cutoff starts at the cutoff.
    const early = await getReport(ctx, company, "stock", { from: "2026-08-01", to: "2026-09-02" });
    expect(early.from).toBe("2026-08-30");

    await expectField(
      getReport(ctx, company, "sales", { from: "2026-09-02", to: "2026-09-01" }),
      "to",
      "validation.period.endBeforeStart",
    );
    await expectField(
      getReport(ctx, company, "nope", { from: "2026-09-01", to: "2026-09-02" }),
      "report",
      "validation.report.unknown",
    );

    const csv = await exportReport(
      ctx,
      company,
      "sales",
      { from: "2026-08-31", to: "2026-09-02" },
      "csv",
    );
    const text = new TextDecoder().decode(csv.data);
    expect(csv.fileName).toBe("sales_2026-08-31_2026-09-02.csv");
    expect(text).toContain("Alpha 250ml");
    // Every heading, column and line label must be a dictionary key, or the file shows raw keys.
    for (const id of reportIds) {
      const file = await exportReport(
        ctx,
        company,
        id,
        { from: "2026-08-30", to: "2026-09-02" },
        "csv",
      );
      expect(new TextDecoder().decode(file.data)).not.toMatch(/report\.(table|column|line)\./);
    }
    const xlsx = await exportReport(
      ctx,
      company,
      "sales",
      { from: "2026-08-31", to: "2026-09-02" },
      "xlsx",
    );
    expect(String.fromCharCode(...xlsx.data.slice(0, 2))).toBe("PK");
  });

  it("hides cost and profit, and refuses profit and closing without permission", async () => {
    const role = await createRole(ctx, { name: "Report viewer", permissions: ["report.view"] });
    const viewer = await createUser(ctx, {
      name: "Viewer",
      email: "viewer.f@example.test",
      password: "temporary-Password-1",
      memberships: [{ companyId: company, roleIds: [role.id] }],
    });
    const viewerCtx = contextFor(db, {
      userId: viewer.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
      mustChangePassword: false,
    });
    const view = await getMonthView(viewerCtx, company, "2026-08");
    expect(view.totals.profitTotal).toBeNull();
    expect(view.products.every((p) => p.costTotal === null && p.closingValue === null)).toBe(true);
    expect(view.profit).toBeNull();
    expect(view.staff).toEqual([]);
    expect(view.canClose).toBe(false);
    const stock = await getReport(viewerCtx, company, "stock", {
      from: "2026-08-30",
      to: "2026-09-02",
    });
    expect(stock.tables[0]?.columns.some((c) => c.key === "closingValue")).toBe(false);
    const forbidden = (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN";
    await expect(
      getReport(viewerCtx, company, "profit", { from: "2026-08-30", to: "2026-09-02" }),
    ).rejects.toSatisfy(forbidden);
    await expect(closeMonth(viewerCtx, company, "2026-08")).rejects.toSatisfy(forbidden);
    await expect(
      exportReport(viewerCtx, company, "stock", { from: "2026-08-30", to: "2026-09-02" }, "csv"),
    ).rejects.toSatisfy(forbidden);
  });
});
