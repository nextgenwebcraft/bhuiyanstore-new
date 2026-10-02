import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { moneyEntryKinds, type MoneyEntryKind, type OpeningSaveRequest } from "@bsd/contracts";
import {
  MONEY_KIND_EFFECTS,
  computeMonth,
  type DayInput,
  type MonthOpening,
  type MonthResult,
  type ProductDayInput,
} from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { expenseCategories, staffRoles } from "./configuration";
import type { AppContext } from "./context";
import {
  getDashboardSummary,
  getDayView,
  listDsrDays,
  listMoneyEntries,
  postDsrDay,
  postMoneyEntry,
  postStockEntries,
  reverseDsrDay,
  reverseMoneyEntry,
  saveDsrDay,
} from "./daily";
import { AppError } from "./errors";
import { runLedger } from "./ledger";
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
const id = { alpha: "", beta: "", mamun: "", rohim: "", karim: "", jamal: "", transport: "" };

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
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

// ---------------------------------------------------------------- the raw facts

type StockFact = { kind: "order" | "receipt" | "damage"; product: string; pieces: string };
type PriceFact = { product: string; kind: "order" | "cost" | "sale"; price: string };
type DsrFact = {
  staff: string;
  lines: { product: string; issued: string; returned: string; damaged: string; split?: string }[];
  dueNew: string;
  dueCollected: string;
};
type MoneyFact = { kind: MoneyEntryKind; amount: string; staff?: string; category?: string };
type DayFacts = {
  date: string;
  stock?: StockFact[];
  prices?: PriceFact[];
  dsr?: DsrFact[];
  money?: MoneyFact[];
};

/** A month-crossing run covering every input type the engine reads (Excel's raw facts). */
function facts(): DayFacts[] {
  return [
    {
      date: "2026-08-30",
      stock: [
        { kind: "order", product: id.alpha, pieces: "48" },
        { kind: "receipt", product: id.alpha, pieces: "48" },
        { kind: "receipt", product: id.beta, pieces: "10" },
        { kind: "damage", product: id.beta, pieces: "1" },
      ],
      prices: [{ product: id.alpha, kind: "sale", price: "11.5" }],
      dsr: [
        {
          staff: id.mamun,
          lines: [
            { product: id.alpha, issued: "60", returned: "12", damaged: "0", split: "6@10" },
            { product: id.beta, issued: "12", returned: "0", damaged: "1" },
          ],
          dueNew: "100",
          dueCollected: "50",
        },
        {
          staff: id.rohim,
          lines: [{ product: id.alpha, issued: "24", returned: "0", damaged: "0" }],
          dueNew: "0",
          dueCollected: "0",
        },
      ],
      money: [
        { kind: "expense", amount: "40", category: id.transport },
        { kind: "staffShortage", amount: "30", staff: id.rohim },
        { kind: "srLoan", amount: "200", staff: id.karim },
        { kind: "srIncentive", amount: "15" },
        { kind: "supplierDeposit", amount: "500" },
        { kind: "staffAdvance", amount: "100", staff: id.jamal },
        { kind: "marketDueCollected", amount: "25" },
      ],
    },
    {
      date: "2026-08-31",
      prices: [{ product: id.beta, kind: "sale", price: "23" }],
      dsr: [
        {
          staff: id.mamun,
          lines: [{ product: id.alpha, issued: "24", returned: "0", damaged: "0" }],
          dueNew: "0",
          dueCollected: "0",
        },
      ],
      money: [
        { kind: "salaryAccrual", amount: "8000", staff: id.jamal },
        { kind: "staffRepayment", amount: "10", staff: id.rohim },
        { kind: "srRepayment", amount: "50", staff: id.karim },
      ],
    },
    {
      date: "2026-09-01",
      stock: [{ kind: "receipt", product: id.alpha, pieces: "24" }],
      dsr: [
        {
          staff: id.rohim,
          lines: [{ product: id.beta, issued: "12", returned: "2", damaged: "0" }],
          dueNew: "30",
          dueCollected: "0",
        },
      ],
      money: [{ kind: "expense", amount: "20", category: id.transport }],
    },
    {
      date: "2026-09-02",
      dsr: [
        {
          staff: id.mamun,
          lines: [{ product: id.alpha, issued: "48", returned: "6", damaged: "0" }],
          dueNew: "0",
          dueCollected: "0",
        },
      ],
      money: [
        { kind: "salaryPaid", amount: "5000", staff: id.jamal },
        { kind: "srOwed", amount: "70", staff: id.karim },
        { kind: "srPayment", amount: "20", staff: id.karim },
      ],
    },
  ];
}

const ENGINE_FIELD = { order: "ordered", receipt: "received", damage: "damaged" } as const;
const ENGINE_PRICE = { order: "orderPrice", cost: "costPrice", sale: "salePrice" } as const;
const splitOf = (split: string) => {
  const [quantity, unitPrice] = split.split("@") as [string, string];
  return { quantity, unitPrice };
};

/** The same facts as engine input, written independently of the ledger. */
function toEngineDay(day: DayFacts): DayInput {
  const products: Record<string, Record<string, string>> = {};
  for (const line of day.stock ?? []) {
    const row = (products[line.product] ??= {});
    const field = ENGINE_FIELD[line.kind];
    row[field] = String(Number(row[field] ?? 0) + Number(line.pieces));
  }
  for (const price of day.prices ?? []) {
    (products[price.product] ??= {})[ENGINE_PRICE[price.kind]] = price.price;
  }
  return {
    date: day.date,
    products: products as Record<string, ProductDayInput>,
    dsrLines: (day.dsr ?? []).flatMap((sheet) =>
      sheet.lines.map((l) => ({
        staffId: sheet.staff,
        productId: l.product,
        issued: l.issued,
        returned: l.returned,
        damaged: l.damaged,
        priceSplits: l.split ? [splitOf(l.split)] : [],
      })),
    ),
    money: [
      ...(day.dsr ?? []).flatMap((sheet) => [
        ...(sheet.dueNew !== "0"
          ? [{ kind: "marketDueNew" as const, amount: sheet.dueNew, staffId: sheet.staff }]
          : []),
        ...(sheet.dueCollected !== "0"
          ? [
              {
                kind: "marketDueCollected" as const,
                amount: sheet.dueCollected,
                staffId: sheet.staff,
              },
            ]
          : []),
      ]),
      ...(day.money ?? []).map((m) => ({
        kind: m.kind,
        amount: m.amount,
        ...(m.staff ? { staffId: m.staff } : {}),
        ...(m.category ? { category: m.category } : {}),
      })),
    ],
  };
}

/** Enters one day through the application services, as the screens do. */
async function enterDay(day: DayFacts): Promise<void> {
  if (day.stock?.length || day.prices?.length) {
    await postStockEntries(ctx, company, {
      date: day.date,
      lines: (day.stock ?? []).map((l) => ({
        kind: l.kind,
        productId: l.product,
        pieces: l.pieces,
      })),
      prices: (day.prices ?? []).map((p) => ({
        productId: p.product,
        kind: p.kind,
        price: p.price,
      })),
    });
  }
  for (const sheet of day.dsr ?? []) {
    const draft = await saveDsrDay(ctx, company, {
      date: day.date,
      staffId: sheet.staff,
      version: 0,
      marketDueNew: sheet.dueNew,
      marketDueCollected: sheet.dueCollected,
      lines: sheet.lines.map((l) => ({
        productId: l.product,
        issued: l.issued,
        returned: l.returned,
        damaged: l.damaged,
        splits: l.split ? [splitOf(l.split)] : [],
      })),
    });
    await postDsrDay(ctx, company, draft.id, { version: draft.version });
  }
  for (const m of day.money ?? []) {
    await postMoneyEntry(ctx, company, {
      date: day.date,
      kind: m.kind,
      amount: m.amount,
      staffId: m.staff ?? null,
      expenseCategoryId: m.category ?? null,
    });
  }
}

/** Per-party rows follow the opening's key order, which carries no meaning. */
function sorted(month: MonthResult): MonthResult {
  const byId = <T extends { staffId: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.staffId.localeCompare(b.staffId));
  return {
    ...month,
    marketDue: { ...month.marketDue, byDsr: byId(month.marketDue.byDsr) },
    staff: byId(month.staff),
    persons: byId(month.persons),
  };
}

function expectedOpening(): MonthOpening {
  return {
    products: {
      [id.alpha]: {
        stock: "100",
        dueFromCompany: "0",
        orderPrice: "9.5",
        costPrice: "9.5",
        salePrice: "11",
      },
      [id.beta]: {
        stock: "50",
        dueFromCompany: "10",
        orderPrice: "19",
        costPrice: "19",
        salePrice: "22.5",
      },
    },
    marketDue: { [id.mamun]: "500", "": "75" },
    staff: { [id.rohim]: { shortage: "20" } },
    companyPayable: "1000",
  };
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
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  company = (await createCompany(ctx, { name: "Drinko", theme, modules: ["sales"] })).company.id;
  const product = async (sku: string, name: string, piecesPerCarton: string) =>
    (
      await createProduct(ctx, company, {
        sku,
        name,
        aliases: [],
        baseUnit: "piece",
        piecesPerCarton,
        status: "active",
      })
    ).id;
  id.alpha = await product("A250", "Alpha 250ml", "24");
  id.beta = await product("B1L", "Beta 1lt", "12");
  const roles = await staffRoles.list(ctx);
  const role = (kind: string) => must(roles.find((r) => r.kind === kind)).id;
  const person = async (name: string, kind: string, employer: "distributor" | "supplier") =>
    (
      await createStaff(ctx, company, {
        name,
        employer,
        status: "active",
        assignment: { roleId: role(kind), from: "2026-01-01", to: null },
      })
    ).id;
  id.mamun = await person("Mamun", "dsr", "distributor");
  id.rohim = await person("Rohim", "dsr", "distributor");
  id.karim = await person("Karim", "sr", "supplier");
  id.jamal = await person("Jamal", "general", "distributor");
  id.transport = (await expenseCategories.create(ctx, { name: "Transport", active: true })).id;

  const empty = await getOpening(ctx, company);
  const opening: OpeningSaveRequest = {
    version: empty.version,
    cutoffDate: "2026-08-30",
    stock: [
      {
        productId: id.alpha,
        pieces: "100",
        unitCost: "9.5",
        salePrice: "11",
        orderPrice: "9.5",
        dueFromCompany: "0",
        note: "",
      },
      {
        productId: id.beta,
        pieces: "50",
        unitCost: "19",
        salePrice: "22.5",
        orderPrice: "19",
        dueFromCompany: "10",
        note: "",
      },
    ],
    balances: [
      { kind: "market_due", staffId: id.mamun, cashAccountId: null, amount: "500", note: "" },
      { kind: "market_due", staffId: null, cashAccountId: null, amount: "75", note: "" },
      { kind: "shortage", staffId: id.rohim, cashAccountId: null, amount: "20", note: "" },
      { kind: "company_payable", staffId: null, cashAccountId: null, amount: "1000", note: "" },
    ],
  };
  const saved = await saveOpening(ctx, company, opening);
  const approved = await approveOpening(ctx, company, { version: saved.version });
  await activateOpening(ctx, company, { version: approved.version });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Phase E: daily entry", () => {
  it("keeps the contract's money kinds and the engine's kinds in step", () => {
    expect([...moneyEntryKinds].sort()).toEqual(Object.keys(MONEY_KIND_EFFECTS).sort());
  });

  it("refuses postings before the cutoff, in the future, or for the wrong person", async () => {
    await expectField(
      postMoneyEntry(ctx, company, { date: "2026-08-29", kind: "srIncentive", amount: "1" }),
      "date",
      "validation.daily.beforeCutoff",
    );
    await expectField(
      postMoneyEntry(ctx, company, { date: "2099-01-01", kind: "srIncentive", amount: "1" }),
      "date",
      "validation.daily.future",
    );
    await expectField(
      saveDsrDay(ctx, company, {
        date: "2026-08-30",
        staffId: id.karim,
        version: 0,
        marketDueNew: "0",
        marketDueCollected: "0",
        lines: [],
      }),
      "staffId",
      "validation.daily.dsrOnly",
    );
    await expectField(
      postMoneyEntry(ctx, company, {
        date: "2026-08-30",
        kind: "srLoan",
        amount: "5",
        staffId: id.rohim,
      }),
      "staffId",
      "validation.daily.srOnly",
    );
    await expectField(
      postMoneyEntry(ctx, company, { date: "2026-08-30", kind: "expense", amount: "5" }),
      "expenseCategoryId",
      "validation.daily.categoryRequired",
    );
    await expectField(
      postMoneyEntry(ctx, company, { date: "2026-08-30", kind: "staffAdvance", amount: "5" }),
      "staffId",
      "validation.daily.staffRequired",
    );
    await expectField(
      saveDsrDay(ctx, company, {
        date: "2026-08-30",
        staffId: id.mamun,
        version: 0,
        marketDueNew: "0",
        marketDueCollected: "0",
        lines: [
          {
            productId: id.alpha,
            issued: "10",
            returned: "5",
            damaged: "0",
            splits: [{ quantity: "6", unitPrice: "10" }],
          },
        ],
      }),
      "lines.0.splits",
      "validation.daily.splitExceedsSold",
    );
  });

  it("reproduces the engine's daily cash and closing from facts entered through the services", async () => {
    const all = facts();
    for (const day of all) await enterDay(day);

    const catalog = [
      { id: id.alpha, piecesPerCarton: "24" },
      { id: id.beta, piecesPerCarton: "12" },
    ];
    const august = computeMonth({
      products: catalog,
      opening: expectedOpening(),
      days: all.filter((d) => d.date < "2026-09-01").map(toEngineDay),
    });
    const september = computeMonth({
      products: catalog,
      opening: august.closing,
      days: all.filter((d) => d.date >= "2026-09-01").map(toEngineDay),
    });

    const access = await loadCompanyAccess(ctx, company);
    const augustRun = must((await runLedger(db, access, "2026-08-31")) ?? undefined);
    expect(augustRun.output.closing).toEqual(august.closing);
    expect(sorted(augustRun.output.month)).toEqual(sorted(august.month));
    const septemberRun = must((await runLedger(db, access, "2026-09-02")) ?? undefined);
    expect(septemberRun.from).toBe("2026-09-01");
    expect(septemberRun.output.closing).toEqual(september.closing);
    expect(sorted(septemberRun.output.month)).toEqual(sorted(september.month));

    for (const expected of [...august.days, ...september.days]) {
      const view = await getDayView(ctx, company, expected.date);
      expect(view.money).toEqual(expected.money);
    }
    // Sanity: the run is not trivially empty.
    expect(Number(august.days[0]?.money.sales)).toBeGreaterThan(0);
    expect(september.closing.marketDue[id.rohim]).toBe("30");
  });

  it("shows the day with names and hides cost without the permission", async () => {
    const view = await getDayView(ctx, company, "2026-08-30");
    expect(view.cutoffDate).toBe("2026-08-30");
    expect(view.products.map((p) => p.sku)).toEqual(["A250", "B1L"]);
    expect(view.persons.find((p) => p.staffId === id.mamun)?.staffName).toBe("Mamun");
    expect(view.canSeeCost).toBe(true);

    const role = await createRole(ctx, { name: "Day viewer", permissions: ["company.view"] });
    const viewer = await createUser(ctx, {
      name: "Viewer",
      email: "viewer.e@example.test",
      password: "temporary-Password-1",
      memberships: [{ companyId: company, roleIds: [role.id] }],
    });
    const viewerCtx = contextFor(db, {
      userId: viewer.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
      mustChangePassword: false,
    });
    const hidden = await getDayView(viewerCtx, company, "2026-08-30");
    expect(hidden.canSeeCost).toBe(false);
    expect(hidden.products.every((p) => p.cost === null && p.stockValue === null)).toBe(true);
    const summary = await getDashboardSummary(viewerCtx, company, "2026-08-30");
    expect(summary.grossProfit).toBeUndefined();
    expect(summary.postedSummaryCount).toBe(2);
    expect(summary.byDsr.find((r) => r.dsrId === id.mamun)?.marketDueCreated).toBe("100.00");
    await expect(
      postMoneyEntry(viewerCtx, company, { date: "2026-08-30", kind: "srIncentive", amount: "1" }),
    ).rejects.toSatisfy((e) => e instanceof AppError && e.code === "FORBIDDEN");
    await expect(listMoneyEntries(viewerCtx, company, { from: "2026-08-30" })).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "FORBIDDEN",
    );
  });

  it("corrects by reversal, replays idempotent posts and protects posted sheets", async () => {
    const before = await getDayView(ctx, company, "2026-09-02");
    const entry = await postMoneyEntry(
      ctx,
      company,
      { date: "2026-09-02", kind: "expense", amount: "99", expenseCategoryId: id.transport },
      "key-e-money-0001",
    );
    const replay = await postMoneyEntry(
      ctx,
      company,
      { date: "2026-09-02", kind: "expense", amount: "99", expenseCategoryId: id.transport },
      "key-e-money-0001",
    );
    expect(replay.id).toBe(entry.id);
    expect((await getDayView(ctx, company, "2026-09-02")).money.expenses).not.toBe(
      before.money.expenses,
    );
    await reverseMoneyEntry(ctx, company, entry.id);
    expect((await getDayView(ctx, company, "2026-09-02")).money).toEqual(before.money);
    await expectField(
      reverseMoneyEntry(ctx, company, entry.id),
      "",
      "validation.daily.alreadyReversed",
    );

    const [sheet] = (await listDsrDays(ctx, company, "2026-09-02")).filter(
      (s) => s.staffId === id.mamun,
    );
    const posted = must(sheet);
    expect(posted.status).toBe("posted");
    await expectField(
      saveDsrDay(ctx, company, {
        date: "2026-09-02",
        staffId: id.mamun,
        version: posted.version,
        marketDueNew: "0",
        marketDueCollected: "0",
        lines: [],
      }),
      "",
      "validation.daily.posted",
    );
    await expectField(
      postDsrDay(ctx, company, posted.id, { version: posted.version }),
      "version",
      "validation.daily.stale",
    );
    const reversed = await reverseDsrDay(ctx, company, posted.id, { version: posted.version });
    expect(reversed.status).toBe("reversed");
    const redo = await saveDsrDay(ctx, company, {
      date: "2026-09-02",
      staffId: id.mamun,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      lines: [{ productId: id.alpha, issued: "48", returned: "6", damaged: "0", splits: [] }],
    });
    await postDsrDay(ctx, company, redo.id, { version: redo.version });
    expect((await getDayView(ctx, company, "2026-09-02")).money).toEqual(before.money);
  });

  it("refuses postings in a closed month", async () => {
    const access = await loadCompanyAccess(ctx, company);
    const run = must((await runLedger(db, access, "2026-08-31")) ?? undefined);
    await db.monthClose.create({
      data: {
        tenantId: admin.tenantId,
        companyId: company,
        month: "2026-08",
        closing: run.output.closing,
        closedById: admin.userId,
      },
    });
    await expectField(
      postMoneyEntry(ctx, company, { date: "2026-08-31", kind: "srIncentive", amount: "1" }),
      "date",
      "validation.daily.monthClosed",
    );
    // September now opens from the snapshot and is unchanged.
    const september = must((await runLedger(db, access, "2026-09-02")) ?? undefined);
    expect(september.output.month.marketDue.opening).toBe(run.output.month.marketDue.closing);
    await db.monthClose.deleteMany({ where: { companyId: company } });
  });
});
