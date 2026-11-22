import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { moneyEntryKinds, type MoneyEntryKind } from "@bsd/contracts";
import {
  MONEY_KIND_EFFECTS,
  computeMonth,
  toDecimal,
  type BatchReceiptInput,
  type DayInput,
  type MonthOpening,
  type MonthResult,
  type OrderInput,
  type ProductDayInput,
} from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { expenseCategories, staffRoles } from "./configuration";
import type { AppContext } from "./context";
import {
  getCompanyCapitalYear,
  getDashboardSummary,
  getDayView,
  listDsrDays,
  listMoneyEntries,
  postDsrDay,
  postMoneyEntry,
  postStockEntries,
  reverseDsrDay,
  reverseStockEntry,
  reverseMoneyEntry,
  saveDsrDay,
} from "./daily";
import { AppError } from "./errors";
import { runLedger } from "./ledger";
import { getReport } from "./month";
import { getOpening } from "./opening";
import { createProduct } from "./products";
import { createShop, getShopStatement, listShops } from "./shops";
import { createStaff } from "./staff";
import {
  contextFor,
  resetTestSchema,
  saveWholeOpening,
  testDatabase,
  type WholeOpening,
} from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let ctx: AppContext;
let company = "";
const id = {
  alpha: "",
  beta: "",
  mamun: "",
  rohim: "",
  karim: "",
  jamal: "",
  transport: "",
  shop: "",
};

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

type StockFact = {
  kind: "order" | "receipt" | "damage";
  product: string;
  pieces: string;
  /** D57: taka per carton of an order. */
  rate?: string;
  /** D68: an order's sale price per piece. */
  sale?: string;
  /** D68: the batch a receipt fills (its number) and that batch's prices per piece. */
  batch?: { seq: number; cost: string; sale: string };
};
type PriceFact = { product: string; kind: "order" | "cost" | "sale"; price: string };
type DsrFact = {
  staff: string;
  lines: { product: string; issued: string; returned: string; damaged: string }[];
  dueNew: string;
  dueCollected: string;
};
type MoneyFact = {
  kind: MoneyEntryKind;
  amount: string;
  staff?: string;
  category?: string;
  shop?: string;
};
type DayFacts = {
  date: string;
  stock?: StockFact[];
  prices?: PriceFact[];
  dsr?: DsrFact[];
  money?: MoneyFact[];
};

const ALPHA_ORDER = { seq: 2, cost: "9.5", sale: "11.5" };
const BETA_OPENING = { seq: 1, cost: "19", sale: "22.5" };

/** D68: the stored batch ids by product and batch number, the engine's batch keys. */
const batchIds = new Map<string, string>();
const batchKey = (product: string, seq: number) => must(batchIds.get(`${product}|${seq}`));
async function loadBatchIds() {
  for (const b of await db.productBatch.findMany({ where: { companyId: company } })) {
    batchIds.set(`${b.productId}|${b.seq}`, b.id);
  }
}

/** A month-crossing run covering every input type the engine reads (Excel's raw facts). */
function facts(): DayFacts[] {
  return [
    {
      date: "2026-08-30",
      stock: [
        // D57: 228 per carton of 24 = 9.5 a piece, the product's order price. D68: sold at 11.5,
        // the order is batch 2; beta's 10 pieces due at the opening arrive into its batch 1.
        { kind: "order", product: id.alpha, pieces: "72", rate: "228", sale: "11.5" },
        { kind: "receipt", product: id.alpha, pieces: "48", batch: ALPHA_ORDER },
        { kind: "receipt", product: id.beta, pieces: "10", batch: BETA_OPENING },
        { kind: "damage", product: id.beta, pieces: "1" },
      ],
      prices: [{ product: id.alpha, kind: "sale", price: "11.5" }],
      dsr: [
        {
          staff: id.mamun,
          lines: [
            { product: id.alpha, issued: "60", returned: "12", damaged: "0" },
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
        { kind: "expense", amount: "15", category: id.transport },
        { kind: "supplierDeposit", amount: "500" },
        { kind: "staffAdvance", amount: "100", staff: id.jamal },
        { kind: "marketDueCollected", amount: "25", staff: id.mamun, shop: id.shop },
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
      stock: [{ kind: "receipt", product: id.alpha, pieces: "24", batch: ALPHA_ORDER }],
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

// D53: a godown damage entry is the engine's `godownDamaged` input, not product-level `damaged`.
const ENGINE_FIELD = { order: "ordered", receipt: "received", damage: "godownDamaged" } as const;
const ENGINE_PRICE = { order: "orderPrice", cost: "costPrice", sale: "salePrice" } as const;
/** The same facts as engine input, written independently of the ledger. */
function toEngineDay(day: DayFacts): DayInput {
  const products: Record<string, Record<string, string>> = {};
  const orders: Record<string, OrderInput[]> = {};
  const receipts: Record<string, BatchReceiptInput[]> = {};
  for (const line of day.stock ?? []) {
    if (line.kind === "order" && line.rate !== undefined) {
      (orders[line.product] ??= []).push({
        pieces: line.pieces,
        freePieces: "0",
        cartonRate: line.rate,
        piecesPerCarton: line.product === id.alpha ? "24" : "12",
      });
      continue;
    }
    if (line.kind === "receipt" && line.batch) {
      (receipts[line.product] ??= []).push({
        key: batchKey(line.product, line.batch.seq),
        seq: line.batch.seq,
        quantity: line.pieces,
        costPrice: line.batch.cost,
        salePrice: line.batch.sale,
      });
      continue;
    }
    const row = (products[line.product] ??= {});
    const field = ENGINE_FIELD[line.kind];
    row[field] = String(Number(row[field] ?? 0) + Number(line.pieces));
  }
  for (const price of day.prices ?? []) {
    (products[price.product] ??= {})[ENGINE_PRICE[price.kind]] = price.price;
  }
  const withOrders = products as Record<string, ProductDayInput>;
  for (const [productId, list] of Object.entries(orders)) {
    withOrders[productId] = { ...(withOrders[productId] ?? {}), orders: list };
  }
  for (const [productId, list] of Object.entries(receipts)) {
    withOrders[productId] = { ...(withOrders[productId] ?? {}), batchReceipts: list };
  }
  return {
    date: day.date,
    products: withOrders,
    dsrLines: (day.dsr ?? []).flatMap((sheet) =>
      sheet.lines.map((l) => ({
        staffId: sheet.staff,
        productId: l.product,
        issued: l.issued,
        returned: l.returned,
        damaged: l.damaged,
        priceSplits: [],
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
        ...(m.shop ? { shopId: m.shop } : {}),
        ...(m.category ? { category: m.category } : {}),
      })),
    ],
  };
}

/** Enters one day through the application services, as the screens do. */
async function enterDay(day: DayFacts): Promise<void> {
  // D68: orders first, so the receipts can name the batches they opened.
  const orders = (day.stock ?? []).filter((l) => l.kind === "order");
  if (orders.length) {
    await postStockEntries(ctx, company, {
      date: day.date,
      lines: orders.map((l) => ({
        kind: l.kind,
        productId: l.product,
        pieces: l.pieces,
        ...(l.rate === undefined ? {} : { cartonRate: l.rate }),
        ...(l.sale === undefined ? {} : { salePrice: l.sale }),
      })),
      prices: [],
    });
    await loadBatchIds();
  }
  const rest = (day.stock ?? []).filter((l) => l.kind !== "order");
  if (rest.length || day.prices?.length) {
    await postStockEntries(ctx, company, {
      date: day.date,
      lines: rest.map((l) => ({
        kind: l.kind,
        productId: l.product,
        pieces: l.pieces,
        ...(l.batch === undefined
          ? {}
          : { batchId: batchKey(l.product, l.batch.seq), salePrice: l.batch.sale }),
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
        dsrStaffId: sheet.staff,
        issued: l.issued,
        returned: l.returned,
        damaged: l.damaged,
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
      shopId: m.shop ?? null,
      expenseCategoryId: m.category ?? null,
      srLoanType: m.kind === "srLoan" || m.kind === "srRepayment" ? "cash" : null,
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
        // D49: each opening stock line is batch 1, dated at the cutoff (hand-written, not derived);
        // D68: keyed by its stored batch.
        batches: [
          {
            key: batchKey(id.alpha, 1),
            seq: 1,
            startDate: "2026-08-30",
            costPrice: "9.5",
            salePrice: "11",
            quantity: "100",
          },
        ],
      },
      [id.beta]: {
        stock: "50",
        dueFromCompany: "10",
        orderPrice: "19",
        costPrice: "19",
        salePrice: "22.5",
        batches: [
          {
            key: batchKey(id.beta, 1),
            seq: 1,
            startDate: "2026-08-30",
            costPrice: "19",
            salePrice: "22.5",
            quantity: "50",
          },
        ],
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
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
  };
  ctx = contextFor(db, admin);
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  company = (
    await createCompany(ctx, { name: "Drinko", theme, modules: ["sales"], starterData: false })
  ).company.id;
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
        companyId: company,
        assignment: { roleId: role(kind), from: "2026-01-01", to: null },
      })
    ).id;
  id.mamun = await person("Mamun", "dsr", "distributor");
  id.rohim = await person("Rohim", "dsr", "distributor");
  id.karim = await person("Karim", "sr", "supplier");
  id.jamal = await person("Jamal", "general", "distributor");
  id.transport = (await expenseCategories.create(ctx, { name: "Transport", active: true })).id;
  id.shop = (await createShop(ctx, company, { name: "Hasan Store" })).id;

  const empty = await getOpening(ctx, company);
  const opening: WholeOpening = {
    version: empty.version,
    cutoffDate: "2026-08-30",
    stock: [
      {
        productId: id.alpha,
        pieces: "100",
        unitCost: "9.5",
        salePrice: "11",
        dueFromCompany: "0",
        note: "",
      },
      {
        productId: id.beta,
        pieces: "50",
        unitCost: "19",
        salePrice: "22.5",
        dueFromCompany: "10",
        note: "",
      },
    ],
    balances: [
      {
        kind: "market_due",
        staffId: id.mamun,
        cashAccountId: null,
        shopId: null,
        amount: "500",
        note: "",
      },
      {
        kind: "market_due",
        staffId: null,
        cashAccountId: null,
        shopId: null,
        amount: "75",
        note: "",
      },
      {
        kind: "shortage",
        staffId: id.rohim,
        cashAccountId: null,
        shopId: null,
        amount: "20",
        note: "",
      },
      {
        kind: "company_payable",
        staffId: null,
        cashAccountId: null,
        shopId: null,
        amount: "1000",
        note: "",
      },
    ],
  };
  await saveWholeOpening(ctx, company, opening);
  await loadBatchIds();
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
      postMoneyEntry(ctx, company, { date: "2026-08-29", kind: "supplierDeposit", amount: "1" }),
      "date",
      "validation.daily.beforeCutoff",
    );
    await expectField(
      postMoneyEntry(ctx, company, { date: "2099-01-01", kind: "supplierDeposit", amount: "1" }),
      "date",
      "validation.daily.future",
    );
    await expectField(
      saveDsrDay(ctx, company, {
        date: "2026-08-30",
        staffId: id.jamal,
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
        srLoanType: "cash",
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
  });

  it(
    "reproduces the engine's daily cash and closing from facts entered through the services",
    { timeout: 180_000 },
    async () => {
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
    },
  );

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
    });
    const hidden = await getDayView(viewerCtx, company, "2026-08-30");
    expect(hidden.canSeeCost).toBe(false);
    expect(hidden.products.every((p) => p.cost === null && p.stockValue === null)).toBe(true);
    const summary = await getDashboardSummary(viewerCtx, company, {
      from: "2026-08-30",
      to: "2026-08-30",
    });
    expect(summary.grossProfit).toBeUndefined();
    expect(summary.postedSummaryCount).toBe(2);
    expect(summary.byDsr.find((r) => r.dsrId === id.mamun)?.marketDueCreated).toBe("100.00");
    await expect(
      postMoneyEntry(viewerCtx, company, {
        date: "2026-08-30",
        kind: "supplierDeposit",
        amount: "1",
      }),
    ).rejects.toSatisfy((e) => e instanceof AppError && e.code === "FORBIDDEN");
    await expect(listMoneyEntries(viewerCtx, company, { from: "2026-08-30" })).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "FORBIDDEN",
    );
    // D146: History → সারাংশ needs cost visibility.
    await expect(getCompanyCapitalYear(viewerCtx, company, "2026")).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "FORBIDDEN",
    );
  });

  it("D146: History summary is the dashboard's month-end undelivered + stock + market due", async () => {
    const capital = await getCompanyCapitalYear(ctx, company, "2026");
    const august = must(capital.months.find((row) => row.month === "2026-08"));
    expect(august.to).toBe("2026-08-31");
    const summary = await getDashboardSummary(ctx, company, {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(august.undelivered).toBe(toDecimal(summary.undeliveredValue ?? "0").toFixed(2));
    expect(august.stock).toBe(toDecimal(summary.stockValue ?? "0").toFixed(2));
    expect(august.marketDue).toBe(toDecimal(summary.marketDueOutstanding).toFixed(2));
    expect(august.total).toBe(
      toDecimal(august.undelivered).add(august.stock).add(august.marketDue).toFixed(2),
    );
    expect(toDecimal(august.stock).gt(0)).toBe(true);
    // Newest month first; a month before the opening reads zero.
    expect((capital.months[0]?.month ?? "") >= "2026-08").toBe(true);
    expect(capital.months.find((row) => row.month === "2026-01")?.total).toBe("0.00");
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
    // D56: saving a posted sheet corrects it: the old one is reversed, the edit posted in its place.
    const sameLines = posted.lines.map(
      ({ productId, dsrStaffId, issued, returned, damaged, commission }) => ({
        productId,
        dsrStaffId,
        issued,
        returned,
        damaged,
        commission,
      }),
    );
    const edited = await saveDsrDay(ctx, company, {
      date: "2026-09-02",
      staffId: id.mamun,
      version: posted.version,
      lines: sameLines,
    });
    expect(edited.status).toBe("posted");
    expect(edited.id).not.toBe(posted.id);
    const afterEdit = await listDsrDays(ctx, company, "2026-09-02");
    expect(afterEdit.find((s) => s.id === posted.id)?.status).toBe("reversed");
    expect((await getDayView(ctx, company, "2026-09-02")).money).toEqual(before.money);
    await expectField(
      saveDsrDay(ctx, company, {
        date: "2026-09-02",
        staffId: id.mamun,
        version: posted.version,
        lines: sameLines,
      }),
      "version",
      "validation.daily.stale",
    );
    await expectField(
      postDsrDay(ctx, company, edited.id, { version: edited.version }),
      "version",
      "validation.daily.stale",
    );
    const reversed = await reverseDsrDay(ctx, company, edited.id, { version: edited.version });
    expect(reversed.status).toBe("reversed");
    const redo = await saveDsrDay(ctx, company, {
      date: "2026-09-02",
      staffId: id.mamun,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      lines: [
        { productId: id.alpha, dsrStaffId: id.mamun, issued: "48", returned: "6", damaged: "0" },
      ],
    });
    await postDsrDay(ctx, company, redo.id, { version: redo.version });
    expect((await getDayView(ctx, company, "2026-09-02")).money).toEqual(before.money);
  });

  it("D48: an order lowers the company balance at once and its reversal restores it", async () => {
    const date = "2026-09-02";
    const companyOf = async () => {
      const account = (await getDayView(ctx, company, date)).company;
      if (!account) throw new Error("expected the company account");
      return account;
    };
    const before = await companyOf();
    const [entry] = await postStockEntries(ctx, company, {
      date,
      // D57: 228 per carton of 24 = 9.5 a piece, so the bill is 10 × 9.5 as before.
      lines: [
        {
          kind: "order",
          productId: id.alpha,
          pieces: "10",
          cartonRate: "228",
          salePrice: "11.5",
        },
      ],
      prices: [],
    });
    const price = must(
      (await getDayView(ctx, company, date)).products.find((p) => p.productId === id.alpha)
        ?.orderPrice,
    );
    const bill = toDecimal(price ?? "0").mul(10);
    expect(bill.gt(0)).toBe(true);

    const after = await companyOf();
    expect(toDecimal(after.balance).toString()).toBe(
      toDecimal(before.balance).sub(bill).toString(),
    );
    expect(toDecimal(after.undeliveredValue).toString()).toBe(
      toDecimal(before.undeliveredValue).add(bill).toString(),
    );
    expect(toDecimal(after.undeliveredPieces).toString()).toBe(
      toDecimal(before.undeliveredPieces).add(10).toString(),
    );

    // The statement's closing row is the current balance; its undelivered value is the company-due total.
    const range = { from: "2026-08-01", to: date };
    const account = await getReport(ctx, company, "company-account", range);
    const statement = must(account.tables[1]).rows;
    const last = must(statement.at(-1)).cells;
    expect(toDecimal(last.companyBalance ?? "0").toString()).toBe(
      toDecimal(after.balance).toString(),
    );
    expect(toDecimal(last.undelivered ?? "0").toString()).toBe(
      toDecimal(after.undeliveredValue).toString(),
    );
    const due = await getReport(ctx, company, "company-due", range);
    const dueRows = must(due.tables[0]).rows;
    const dueTotal = dueRows.reduce(
      (total, r) => total.add(r.cells.dueFromCompanyValue ?? "0"),
      toDecimal("0"),
    );
    expect(dueTotal.toString()).toBe(toDecimal(after.undeliveredValue).toString());

    // All time is not blocked by the one-year limit.
    const allTime = await getReport(ctx, company, "company-account", {
      from: "2000-01-01",
      to: date,
    });
    expect(allTime.from).toBe(account.from);

    await reverseStockEntry(ctx, company, must(entry).id);
    expect(await companyOf()).toEqual(before);
  });

  it("D41: shop commission is stored per line and lowers sales and cash left", async () => {
    const date = "2026-09-03";
    const before = (await getDayView(ctx, company, date)).money;
    const sheet = (commission: string, issued = "10") => ({
      date,
      staffId: id.mamun,
      version: 0,
      lines: [
        {
          productId: id.alpha,
          dsrStaffId: id.mamun,
          issued,
          returned: "0",
          damaged: "0",
          commission,
        },
      ],
    });
    await expectField(
      saveDsrDay(ctx, company, sheet("5", "0")),
      "lines.0.commission",
      "validation.daily.commissionWithoutSale",
    );
    const draft = await saveDsrDay(ctx, company, sheet("12.5"));
    expect(draft.lines[0]?.commission).toBe("12.5");
    await postDsrDay(ctx, company, draft.id, { version: draft.version });

    const view = await getDayView(ctx, company, date);
    const alpha = must(view.products.find((p) => p.productId === id.alpha));
    expect(alpha.commission).toBe("12.5");
    expect(
      toDecimal(alpha.sold)
        .mul(must(alpha.salePrice ?? undefined))
        .sub("12.5")
        .eq(alpha.sales),
    ).toBe(true);
    expect(view.money.commission).toBe("12.5");
    expect(
      toDecimal(view.money.cashLeft)
        .sub(before.cashLeft)
        .eq(toDecimal(view.money.sales).sub(before.sales)),
    ).toBe(true);
    expect(view.persons.find((p) => p.staffId === id.mamun)?.commission).toBe("12.5");
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
      postMoneyEntry(ctx, company, { date: "2026-08-31", kind: "supplierDeposit", amount: "1" }),
      "date",
      "validation.daily.monthClosed",
    );
    // September now opens from the snapshot and is unchanged.
    const september = must((await runLedger(db, access, "2026-09-02")) ?? undefined);
    expect(september.output.month.marketDue.opening).toBe(run.output.month.marketDue.closing);
    await db.monthClose.deleteMany({ where: { companyId: company } });
  });
});

describe("D35: shop due", () => {
  const date = "2026-09-02";

  it("requires a shop and a DSR on market due, and only there", async () => {
    await expectField(
      postMoneyEntry(ctx, company, { date, kind: "marketDueNew", amount: "5", staffId: id.mamun }),
      "shopId",
      "validation.shop.required",
    );
    await expectField(
      postMoneyEntry(ctx, company, { date, kind: "marketDueNew", amount: "5", shopId: id.shop }),
      "staffId",
      "validation.daily.staffRequired",
    );
    await expectField(
      postMoneyEntry(ctx, company, {
        date,
        kind: "expense",
        amount: "5",
        expenseCategoryId: id.transport,
        shopId: id.shop,
      }),
      "shopId",
      "validation.shop.notForKind",
    );
    const closed = await createShop(ctx, company, { name: "Closed Store", status: "inactive" });
    await expectField(
      postMoneyEntry(ctx, company, {
        date,
        kind: "marketDueNew",
        amount: "5",
        staffId: id.mamun,
        shopId: closed.id,
      }),
      "shopId",
      "validation.shop.unknown",
    );
    await expectField(
      createShop(ctx, company, { name: "Hasan Store" }),
      "name",
      "validation.shop.duplicate",
    );
  });

  it("counts shop due in the day's cash and market due, with a running shop balance", async () => {
    const before = await getDayView(ctx, company, date);
    await postMoneyEntry(ctx, company, {
      date,
      kind: "marketDueNew",
      amount: "300",
      staffId: id.mamun,
      shopId: id.shop,
    });
    await postMoneyEntry(ctx, company, {
      date,
      kind: "marketDueCollected",
      amount: "100",
      staffId: id.rohim,
      shopId: id.shop,
    });
    const after = await getDayView(ctx, company, date);
    expect(Number(after.money.cashLeft)).toBe(Number(before.money.cashLeft) - 200);
    expect(Number(after.marketDueOutstanding)).toBe(Number(before.marketDueOutstanding) + 200);

    // The 25 collected on Aug 30 (no shop opening yet) leaves the shop at −25 before today.
    const statement = await getShopStatement(ctx, company, id.shop, { from: date, to: date });
    expect(statement.opening).toBe("-25");
    expect(Number(statement.added)).toBe(300);
    expect(Number(statement.collected)).toBe(100);
    expect(statement.closing).toBe("175");
    expect(statement.lines.map((l) => [l.kind, l.staffName, l.balance])).toEqual([
      ["marketDueNew", "Mamun", "275"],
      ["marketDueCollected", "Rohim", "175"],
    ]);
    const shop = must((await listShops(ctx, company)).find((s) => s.id === id.shop));
    expect(shop.due).toBe("175");
  });
});
