import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { toDecimal } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { cashAccounts, expenseCategories, staffRoles } from "./configuration";
import { createCompany } from "./companies";
import type { AppContext } from "./context";
import {
  getDayView,
  listMoneyEntries,
  postDsrDay,
  postMoneyEntry,
  postStockEntries,
  reverseDsrDay,
  saveDsrDay,
} from "./daily";
import { createDamageCase, postDamageEvent } from "./damage";
import { AppError } from "./errors";
import { runLedger } from "./ledger";
import { closeMonth, getMonthView, getReport, reopenMonth } from "./month";
import { getOpening } from "./opening";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/**
 * Audit fixes (D52 cash book, made cash only by D72; D53 godown damage and damaged stock, D62 DSR
 * handover check, D55 SR owed, D47 amendment). Every expected number is worked out by hand in the
 * comments; nothing is derived from the code under test.
 */

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };

let admin: Actor;
let ctx: AppContext;
let company = "";
const id = {
  alpha: "",
  mamun: "",
  karim: "",
  jamal: "",
  rent: "",
  cashA: "", // created first, but has no opening line
  cashB: "", // has the opening cash line: the company's cash account
  bank: "", // an account from before D72, with an opening line and old entries
};

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

const money = (kind: string, amount: string, extra: Record<string, unknown> = {}, date = DAY1) =>
  postMoneyEntry(ctx, company, { date, kind, amount, ...extra } as never);

const DAY1 = "2026-09-01"; // opening cutoff and first posting day

async function sheet(date: string, handedOver: string | null, issued = "24", returned = "4") {
  const draft = await saveDsrDay(ctx, company, {
    date,
    staffId: id.mamun,
    version: 0,
    marketDueNew: "0",
    marketDueCollected: "0",
    cashHandedOver: handedOver,
    lines: [{ productId: id.alpha, dsrStaffId: id.mamun, issued, returned, damaged: "0" }],
  });
  return draft;
}

async function product(date: string, productId = id.alpha) {
  return must(
    (await getDayView(ctx, company, date)).products.find((p) => p.productId === productId),
  );
}

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
  };
  ctx = contextFor(db, admin);
  company = (
    await createCompany(ctx, { name: "Drinko J", theme, modules: ["sales"], starterData: false })
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
  id.mamun = await person("Mamun", "dsr", "distributor");
  id.karim = await person("Karim", "sr", "supplier");
  id.jamal = await person("Jamal", "general", "distributor");
  id.rent = (await expenseCategories.create(ctx, { name: "Rent", active: true })).id;

  // Account order matters for the cash account rule: cashA is the tenant's first cash account,
  // cashB is the one the opening has a cash line for.
  const account = async (name: string, kind: "cash" | "bank") =>
    (await cashAccounts.create(ctx, { name, kind, active: true })).id;
  id.cashA = await account("Cash A", "cash");
  id.cashB = await account("Cash B", "cash");
  id.bank = await account("Bank", "bank");

  await saveWholeOpening(ctx, company, {
    cutoffDate: DAY1,
    stock: [
      {
        productId: id.alpha,
        pieces: "100",
        unitCost: "10",
        salePrice: "12",
        dueFromCompany: "0",
        note: "",
      },
    ],
    balances: [
      {
        kind: "cash",
        staffId: null,
        cashAccountId: id.cashB,
        shopId: null,
        amount: "5000",
        note: "",
      },
      {
        kind: "cash",
        staffId: null,
        cashAccountId: id.bank,
        shopId: null,
        amount: "20000",
        note: "",
      },
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("D72: all money is cash", () => {
  it("shows every opening cash line as one line on the cash account", async () => {
    // Cash A is the tenant's first cash account, but Cash B holds the opening cash; the old bank
    // line's 20000 counts as cash too.
    const view = await getOpening(ctx, company);
    expect(view.cashAccountId).toBe(id.cashB);
    expect(view.balances.filter((b) => b.kind === "cash")).toEqual([
      {
        kind: "cash",
        staffId: null,
        cashAccountId: id.cashB,
        shopId: null,
        amount: "25000.00",
        note: "",
      },
    ]);
    expect(toDecimal(view.totals.cash).eq(25000)).toBe(true);
  });

  it("posts money with no account and refuses a transfer", async () => {
    const expense = await money("expense", "40", { expenseCategoryId: id.rent });
    expect(expense).not.toHaveProperty("cashAccountId");
    // An account named by an old client is dropped, never stored.
    const named = await money("expense", "25", {
      expenseCategoryId: id.rent,
      cashAccountId: id.bank,
    });
    const row = await db.moneyEntry.findUniqueOrThrow({ where: { id: named.id } });
    expect(row.cashAccountId).toBeNull();
    await money("supplierDeposit", "1000");
    await expectField(
      money("cashTransfer", "10", { cashAccountId: id.cashB, toCashAccountId: id.bank }),
      "kind",
      "validation.daily.kindRetired",
    );
  });

  it("counts an old bank entry as cash and leaves an old transfer out", async () => {
    const old = {
      tenantId: admin.tenantId,
      companyId: company,
      date: new Date(`${DAY1}T00:00:00Z`),
      createdById: admin.userId,
    };
    await db.moneyEntry.createMany({
      data: [
        {
          ...old,
          kind: "expense",
          amount: "30",
          expenseCategoryId: id.rent,
          cashAccountId: id.bank,
        },
        {
          ...old,
          kind: "cashTransfer",
          amount: "500",
          cashAccountId: id.cashB,
          toCashAccountId: id.bank,
        },
      ],
    });
    const view = await getDayView(ctx, company, DAY1);
    expect(view.money).toMatchObject({ cashIn: "0", cashOut: "95", banked: "1000" }); // 40 + 25 + 30
  });
});

describe("D62: the DSR cash handover is checked, never posted", () => {
  const entriesOf = async (date: string) =>
    (await listMoneyEntries(ctx, company, { from: date })).filter((e) => e.dsrDayId !== null);

  it("a short handover posts no staff entry and leaves the DSR's account alone", async () => {
    // Mamun sold 24 - 4 = 20 pieces x 12 = 240 and handed over 230 (10 short).
    const draft = await sheet(DAY1, "230");
    const posted = await postDsrDay(ctx, company, draft.id, { version: draft.version });
    expect(posted.cashHandedOver).toBe("230");
    expect(await entriesOf(DAY1)).toEqual([]);
    const view = await getDayView(ctx, company, DAY1);
    expect(toDecimal(view.money.sales).eq(240)).toBe(true);
    const access = await loadCompanyAccess(ctx, company);
    const run = must(await runLedger(db, access, DAY1));
    expect(run.output.closing.staff[id.mamun]?.shortage ?? "0").toBe("0");

    // Reversed and posted again: still nothing posted for the difference.
    await reverseDsrDay(ctx, company, posted.id, { version: posted.version });
    const again = await sheet(DAY1, "230");
    await postDsrDay(ctx, company, again.id, { version: again.version });
    expect(await entriesOf(DAY1)).toEqual([]);
  });

  it("an over, exact or missing handover posts nothing either", async () => {
    for (const [date, handed] of [
      ["2026-09-02", "250"],
      ["2026-09-03", "240"],
      ["2026-09-04", null],
    ] as const) {
      const draft = await sheet(date, handed);
      await postDsrDay(ctx, company, draft.id, { version: draft.version });
      expect(await entriesOf(date)).toEqual([]);
    }
    const access = await loadCompanyAccess(ctx, company);
    expect(
      must(await runLedger(db, access, "2026-09-02")).output.closing.staff[id.mamun]?.credit ?? "0",
    ).toBe("0");
  });
});

describe("D72: the cash book report", () => {
  it("is one cash book: opening + movements = closing, by hand", async () => {
    // Day 1 only. Opening 5000 (Cash B) + 20000 (old bank line) = 25000. In: 240 sales cash (D62:
    // the handover difference is not posted). Out: the 1000 deposit plus the three expenses
    // (40 + 25 + 30 = 95). The D62 reverse above leaves them: they were entered on no SR sheet, and
    // reversing a sheet only reverses the money entered on it. The old transfer is left out.
    // Closing 25000 + 240 - 1095 = 24145.
    const report = await getReport(ctx, company, "cash-book", { from: DAY1, to: DAY1 });
    const [summary, statement] = report.tables;
    expect(summary?.rows).toHaveLength(1);
    expect(summary?.rows[0]?.cells).toMatchObject({
      opening: "25000.00",
      cashIn: "240.00",
      cashOut: "1095.00",
      closing: "24145.00",
    });
    expect(toDecimal(must(statement?.rows.at(-1)?.cells.cashBalance)).eq(24145)).toBe(true);
    expect(statement?.rows.some((r) => r.cells.line === "money.kind.cashTransfer")).toBe(false);
    expect(statement?.rows.some((r) => r.cells.line === "report.line.cash.sales")).toBe(true);
  });

  it("is not narrowed by the one-year limit", async () => {
    const all = await getReport(ctx, company, "cash-book", {
      from: "2000-01-01",
      to: "2026-09-04",
    });
    expect(all.from).toBe(DAY1);
  });
});

describe("D53: godown damage and damaged-goods stock", () => {
  it("a godown damage entry lowers stock and charges cost with no sales", async () => {
    // Day 1: 20 pieces went out on Mamun's sheet; 100 - 20 = 80 before the damage.
    const before = await product(DAY1);
    expect(before).toMatchObject({ stock: "80", sales: "240", cost: "200", damagedStock: "0" });
    await postStockEntries(ctx, company, {
      date: DAY1,
      lines: [{ kind: "damage", productId: id.alpha, pieces: "3" }],
      prices: [],
    });
    // 3 more pieces gone at cost 10: stock 77, cost 230, gross profit 240 - 230 = 10, no extra sales.
    expect(await product(DAY1)).toMatchObject({
      stock: "77",
      sales: "240",
      cost: "230",
      grossProfit: "10",
      damageValue: "30",
      godownDamaged: "3",
      damagedStock: "3",
      damageAtCompany: "0",
    });
  });

  it("follows damaged pieces to the company and back; recovery money is not profit", async () => {
    const date = "2026-09-05";
    const view = await getDayView(ctx, company, date);
    const base = must(view.products[0]);
    const created = await createDamageCase(ctx, company, {
      date,
      origin: "buyerExchange",
      lines: [{ productId: id.alpha, quantity: "4" }],
    });
    const line = must(created.lines[0]);
    const event = (kind: string, quantity: string, extra: Record<string, unknown> = {}) =>
      postDamageEvent(ctx, company, created.id, {
        date,
        lineId: line.id,
        kind,
        quantity,
        ...extra,
      } as never);

    // The buyer's 4 damaged pieces taken in, 4 good ones handed out of the godown.
    await event("buyerReplacement", "4", { fromStock: true });
    expect(await product(date)).toMatchObject({
      stock: String(Number(base.stock) - 4),
      damagedStock: String(Number(base.damagedStock) + 4),
    });
    // Dispatched to the company: out of damaged stock, waiting there.
    await event("companyDispatch", "4");
    let row = await product(date);
    expect(row).toMatchObject({ damagedStock: base.damagedStock, damageAtCompany: "4" });
    // The company rejects 1 (back in the godown), then the case writes it off.
    await event("companyReject", "1");
    row = await product(date);
    expect(row).toMatchObject({
      damagedStock: String(Number(base.damagedStock) + 1),
      damageAtCompany: "3",
    });
    await event("writeOff", "1");
    expect(await product(date)).toMatchObject({ damagedStock: base.damagedStock });
    // The other 3 are accepted and refunded in money: the company's side clears, the balance moves,
    // profit does not (D47 amendment).
    await event("companyRefund", "3", { unitCost: "10", autoAccept: true });
    expect(await product(date)).toMatchObject({ damageAtCompany: "0" });
    const month = await getMonthView(ctx, company, "2026-09");
    expect(month.companyPayable.damageRefunds).toBe("30");
    expect(month.profit).not.toHaveProperty("damageRecovery");
    expect(month.totals.damageRecovery).toBe("30"); // memo only
  });

  it("refuses a stock replacement on a case that belongs to a DSR day", async () => {
    const sheetDay = await db.dsrDay.findFirstOrThrow({
      where: { companyId: company, date: new Date("2026-09-03T00:00:00Z") },
    });
    const date = "2026-09-05";
    const created = await createDamageCase(ctx, company, {
      date,
      origin: "buyerExchange",
      lines: [{ productId: id.alpha, quantity: "2" }],
    });
    await db.damageCase.update({ where: { id: created.id }, data: { dsrDayId: sheetDay.id } });
    await expectField(
      postDamageEvent(ctx, company, created.id, {
        date,
        lineId: must(created.lines[0]).id,
        kind: "buyerReplacement",
        quantity: "2",
        fromStock: true,
      }),
      "fromStock",
      "validation.damage.fromStockDsrDay",
    );
    // Giving it from the DSR's samari (already on the sheet) is still allowed.
    await postDamageEvent(ctx, company, created.id, {
      date,
      lineId: must(created.lines[0]).id,
      kind: "buyerReplacement",
      quantity: "2",
      fromStock: false,
    });
  });
});

describe("D55: SR owed is an accrued incentive", () => {
  it("srOwed is an expense with no cash; srPayment is cash with no expense", async () => {
    const date = "2026-09-06";
    const before = await getMonthView(ctx, company, "2026-09");
    await money("srOwed", "70", { staffId: id.karim }, date);
    await money("srPayment", "20", { staffId: id.karim }, date);
    const after = await getMonthView(ctx, company, "2026-09");
    const delta = (a: string | undefined, b: string | undefined) =>
      toDecimal(a ?? "0")
        .sub(b ?? "0")
        .toString();
    expect(delta(after.profit?.srIncentive, before.profit?.srIncentive)).toBe("70"); // accrual only
    expect(delta(after.profit?.net, before.profit?.net)).toBe("-70");
    expect(after.staff.find((s) => s.staffId === id.karim)?.closing.owedToSr).toBe("50");
    // The 20 paid left the default cash account; the accrual did not.
    const day = await getDayView(ctx, company, date);
    expect(day.money).toMatchObject({ cashOut: "20", srIncentive: "70" });
  });
});

describe("D72: month close stores one cash balance", () => {
  it("closes with the cash balance, equal to the report, and warns for old snapshots", async () => {
    const range = { from: DAY1, to: "2026-09-30" };
    const report = await getReport(ctx, company, "cash-book", range);
    await closeMonth(ctx, company, "2026-09");
    const close = must(
      await db.monthClose.findUnique({
        where: { companyId_month: { companyId: company, month: "2026-09" } },
      }),
    );
    const stored = (close.closing as { cashAccounts?: Record<string, string> }).cashAccounts;
    expect(Object.keys(stored ?? {})).toEqual([id.cashB]);
    const reported = must(report.tables[0]?.rows[0]?.cells.closing);
    expect(toDecimal(must(stored?.[id.cashB])).eq(reported)).toBe(true);

    // October opens from the snapshot: balances carry over exactly.
    const access = await loadCompanyAccess(ctx, company);
    const october = must(await runLedger(db, access, "2026-10-02"));
    expect(october.output.closing.cashAccounts).toEqual(stored);
    expect(october.output.warnings.some((w) => w.code === "CASH_SNAPSHOT_MISSING")).toBe(false);

    // A snapshot stored before the cash book has no balances: start at 0 and warn once.
    await reopenMonth(ctx, company, "2026-09");
    const old: Record<string, unknown> = { ...(close.closing as Record<string, unknown>) };
    delete old.cashAccounts;
    await db.monthClose.create({
      data: {
        tenantId: admin.tenantId,
        companyId: company,
        month: "2026-09",
        closing: old as never,
        closedById: admin.userId,
      },
    });
    const legacy = must(await runLedger(db, access, "2026-10-02"));
    expect(legacy.output.warnings.filter((w) => w.code === "CASH_SNAPSHOT_MISSING")).toEqual([
      { code: "CASH_SNAPSHOT_MISSING", date: "2026-10-01" },
    ]);
    expect(legacy.output.closing.cashAccounts).toEqual({});
    await db.monthClose.deleteMany({ where: { companyId: company } });
  });
});
