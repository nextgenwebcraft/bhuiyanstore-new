import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { reportIds } from "@bsd/contracts";
import type { Database, Prisma } from "@bsd/database";
import {
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shiftBusinessDate,
  shiftMonth,
  todayBusinessDate,
} from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { getStaffAccounts, getStaffStatement } from "./accounts";
import { createCompany } from "./companies";
import { expenseCategories, staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { getDashboardSummary, getDayView } from "./daily";
import { toDbDate } from "./dates";
import { closeMonth, getMonthView, getReport } from "./month";
import { getOpening } from "./opening";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

/**
 * SQL baseline for the Redis decision (T19): times the heaviest reads against the real database
 * with a workbook-sized company (guide §15.5 budgets). Run with `pnpm benchmark:sql`; it wipes
 * the test schema like the integration tests. `BENCH_SCALE=3` triples products and DSRs.
 */

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const SCALE = Math.max(1, Number(process.env.BENCH_SCALE ?? "1"));
const RUNS = Math.max(3, Number(process.env.BENCH_RUNS ?? "7"));
const PRODUCTS = 110 * SCALE;
const DSRS = 6 * SCALE;
const LINES_PER_SHEET = 60;
const OPEN_MONTHS = 3;

const { db, schema } = testDatabase();

// ------------------------------------------------------------------ query timing

let intervals: [number, number][] = [];
/** One line per query of the last measured run when tracing (`BENCH_TRACE=1`). */
let trace: string[] = [];
const timed = db.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        let size = "";
        try {
          const result = await query(args);
          if (Array.isArray(result)) size = ` → ${result.length} rows`;
          return result;
        } finally {
          const end = performance.now();
          intervals.push([start, end]);
          trace.push(`${model}.${operation} ${Math.round(end - start)} ms${size}`);
        }
      },
    },
  },
}) as unknown as Database;

/** Merged query intervals: waves = sequential round trips, busy = wall time spent waiting on SQL. */
function dbProfile(spans: [number, number][]) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let waves = 0;
  let busy = 0;
  let end = -Infinity;
  let start = 0;
  for (const [s, e] of sorted) {
    if (s > end) {
      if (waves > 0) busy += end - start;
      waves += 1;
      start = s;
      end = e;
    } else {
      end = Math.max(end, e);
    }
  }
  if (waves > 0) busy += end - start;
  return { queries: spans.length, waves, busy };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

type Row = {
  scenario: string;
  operation: string;
  p50: number;
  max: number;
  queries: number;
  waves: number;
  sqlWait: number;
  nonSql: number;
  nearDb: number;
};

const rows: Row[] = [];
const traces: string[] = [];
let rtt = 0;

async function measure(scenario: string, operation: string, run: () => Promise<unknown>) {
  await run();
  const walls: number[] = [];
  const profiles: ReturnType<typeof dbProfile>[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    intervals = [];
    trace = [];
    const start = performance.now();
    await run();
    walls.push(performance.now() - start);
    profiles.push(dbProfile(intervals));
  }
  if (process.env.BENCH_TRACE) traces.push(`${scenario} / ${operation}\n  ${trace.join("\n  ")}`);
  const p50 = median(walls);
  const sqlWait = median(profiles.map((p) => p.busy));
  const waves = median(profiles.map((p) => p.waves));
  rows.push({
    scenario,
    operation,
    p50,
    max: Math.max(...walls),
    queries: median(profiles.map((p) => p.queries)),
    waves,
    sqlWait,
    nonSql: p50 - sqlWait,
    // Same work with the app beside the database (≈1 ms per round trip instead of `rtt`).
    nearDb: Math.max(0, p50 - waves * Math.max(0, rtt - 1)),
  });
}

// ------------------------------------------------------------------ deterministic data

let seed = 42;
const random = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

function monthsBefore(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - count, 1)).toISOString().slice(0, 7);
}

async function insertChunks<T>(rowsToInsert: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rowsToInsert.length; i += 2000) await insert(rowsToInsert.slice(i, i + 2000));
}

let admin: Actor;
let ctx: AppContext;
let timedCtx: AppContext;
let company = "";
let dsrIds: string[] = [];
const today = todayBusinessDate();
const cutoff = lastOfMonth(monthsBefore(monthOf(today), OPEN_MONTHS + 1));
const counts = { days: 0, dsrLines: 0, stock: 0, money: 0, prices: 0 };

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Benchmark Distributor",
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
  timedCtx = contextFor(timed, admin);
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  company = (
    await createCompany(ctx, { name: "Drinko", theme, modules: ["sales"], starterData: false })
  ).company.id;
  const tenantId = boot.tenantId;

  const productIds = Array.from({ length: PRODUCTS }, (_, i) => `bench-p-${i}`);
  await db.product.createMany({
    data: productIds.map((id, i) => ({
      id,
      tenantId,
      companyId: company,
      sku: `P${String(i).padStart(4, "0")}`,
      name: `Product ${i}`,
      aliases: [],
    })),
  });
  await db.productPack.createMany({
    data: productIds.map((productId, i) => ({ productId, piecesPerCarton: i % 3 ? 24 : 12 })),
  });

  const roles = await staffRoles.list(ctx);
  const dsrRole = roles.find((r) => r.kind === "dsr");
  if (!dsrRole) throw new Error("no DSR role");
  dsrIds = [];
  for (let i = 0; i < DSRS; i += 1) {
    const staff = await createStaff(ctx, company, {
      name: `DSR ${i}`,
      employer: "distributor",
      status: "active",
      assignment: { roleId: dsrRole.id, from: "2026-01-01", to: null },
    });
    dsrIds.push(staff.id);
  }
  const categoryIds: string[] = [];
  for (const name of ["Transport", "Labour", "Rent", "Utilities", "Misc"]) {
    categoryIds.push((await expenseCategories.create(ctx, { name, active: true })).id);
  }

  const empty = await getOpening(ctx, company);
  await saveWholeOpening(ctx, company, {
    version: empty.version,
    cutoffDate: cutoff,
    stock: productIds.map((productId) => ({
      productId,
      pieces: "5000",
      unitCost: "9.5",
      salePrice: "11",
      orderPrice: "9.5",
      dueFromCompany: "0",
      note: "",
    })),
    balances: dsrIds.map((staffId) => ({
      kind: "market_due" as const,
      staffId,
      cashAccountId: null,
      amount: "2500",
      note: "",
    })),
  });

  const dates: string[] = [];
  for (let d = shiftBusinessDate(cutoff, 1); d <= today; d = shiftBusinessDate(d, 1)) dates.push(d);
  counts.days = dates.length;

  const stock: Prisma.StockEntryCreateManyInput[] = [];
  const money: Prisma.MoneyEntryCreateManyInput[] = [];
  const prices: Prisma.PriceChangeCreateManyInput[] = [];
  const days: Prisma.DsrDayCreateManyInput[] = [];
  const lines: Prisma.DsrLineCreateManyInput[] = [];
  const splits: Prisma.DsrPriceSplitCreateManyInput[] = [];
  const base = { tenantId, companyId: company, createdById: admin.userId };

  dates.forEach((date, dayIndex) => {
    const when = toDbDate(date);
    if (dayIndex % 2 === 0) {
      for (let i = 0; i < 30; i += 1) {
        const productId = pick(productIds);
        stock.push({ ...base, date: when, kind: "order", productId, pieces: "240" });
        stock.push({ ...base, date: when, kind: "receipt", productId, pieces: "240" });
      }
    }
    if (dayIndex % 7 === 3) {
      for (const productId of productIds.slice(dayIndex % 10, (dayIndex % 10) + 10)) {
        prices.push({ productId, kind: "sale", price: "11.5", effectiveFrom: when });
      }
    }
    for (const staffId of dsrIds) {
      const dayId = `bench-d-${dayIndex}-${staffId}`;
      days.push({
        ...base,
        id: dayId,
        staffId,
        date: when,
        status: "posted",
        version: 2,
        marketDueNew: String(Math.floor(random() * 3000)),
        marketDueCollected: String(Math.floor(random() * 2500)),
        postedById: admin.userId,
        postedAt: new Date(),
      });
      const start = Math.floor(random() * (PRODUCTS - LINES_PER_SHEET));
      for (const productId of productIds.slice(start, start + LINES_PER_SHEET)) {
        const lineId = `bench-l-${lines.length}`;
        const issued = 12 + Math.floor(random() * 48);
        const returned = Math.floor(random() * 6);
        lines.push({
          id: lineId,
          dsrDayId: dayId,
          dsrStaffId: staffId,
          productId,
          piecesPerCarton: 24,
          issued: String(issued),
          returned: String(returned),
          damaged: "0",
        });
        if (random() < 0.1) splits.push({ lineId, quantity: "6", unitPrice: "10.5" });
      }
    }
    for (let i = 0; i < 4; i += 1) {
      money.push({
        ...base,
        date: when,
        kind: "expense",
        amount: String(100 + Math.floor(random() * 900)),
        expenseCategoryId: pick(categoryIds),
      });
    }
    for (let i = 0; i < 2; i += 1) {
      money.push({
        ...base,
        date: when,
        kind: "staffAdvance",
        amount: "500",
        staffId: pick(dsrIds),
      });
    }
    money.push({ ...base, date: when, kind: "supplierDeposit", amount: "50000" });
  });

  await insertChunks(prices, (data) => db.priceChange.createMany({ data, skipDuplicates: true }));
  await insertChunks(stock, (data) => db.stockEntry.createMany({ data }));
  await insertChunks(days, (data) => db.dsrDay.createMany({ data }));
  await insertChunks(lines, (data) => db.dsrLine.createMany({ data }));
  await insertChunks(splits, (data) => db.dsrPriceSplit.createMany({ data }));
  await insertChunks(money, (data) => db.moneyEntry.createMany({ data }));
  Object.assign(counts, {
    dsrLines: lines.length,
    stock: stock.length,
    money: money.length,
    prices: prices.length,
  });

  const pings: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now();
    await db.$queryRaw`SELECT 1`;
    pings.push(performance.now() - start);
  }
  rtt = median(pings);
}, 1_800_000);

afterAll(async () => {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const report = [
    "",
    `SQL baseline ${new Date().toISOString()} — scale ${SCALE}: ${PRODUCTS} products, ${DSRS} DSRs, ` +
      `${counts.days} days since cutoff ${cutoff}; rows: ${counts.dsrLines} DSR lines, ` +
      `${counts.stock} stock entries, ${counts.money} money entries, ${counts.prices} price changes. ` +
      `Round trip (SELECT 1) p50 ${rtt.toFixed(1)} ms; ${RUNS} runs after one warm-up.`,
    "",
    "| Scenario | Operation | p50 ms | max ms | queries | round trips | SQL wait ms | non-SQL ms | ≈ beside DB ms |",
    "| --- | --- | --: | --: | --: | --: | --: | --: | --: |",
    ...rows.map(
      (r) =>
        `| ${r.scenario} | ${r.operation} | ${fmt(r.p50)} | ${fmt(r.max)} | ${r.queries} | ${r.waves} | ` +
        `${fmt(r.sqlWait)} | ${fmt(r.nonSql)} | ${fmt(r.nearDb)} |`,
    ),
    "",
    ...traces,
  ].join("\n");
  // Vitest hides console output of passing tests, so the report goes to a file as well.
  const out = process.env.BENCH_OUT ?? join(tmpdir(), "bsd-sql-baseline.md");
  writeFileSync(out, report);
  console.log(`${report}\nWritten to ${out}`);
  await db.$disconnect();
});

async function measureReads(scenario: string) {
  const month = monthOf(today);
  const previous = monthsBefore(month, 1);
  const ninetyDays = { from: shiftBusinessDate(today, -89), to: today };
  const thisMonth = { from: firstOfMonth(month), to: today };
  const report = reportIds[0];
  await measure(scenario, "company access check", () => loadCompanyAccess(timedCtx, company));
  await measure(scenario, "day view (today)", () => getDayView(timedCtx, company, today));
  await measure(scenario, "dashboard (today)", () =>
    getDashboardSummary(timedCtx, company, { from: today, to: today }),
  );
  await measure(scenario, "month view (this month)", () => getMonthView(timedCtx, company, month));
  await measure(scenario, "month view (last month)", () =>
    getMonthView(timedCtx, company, previous),
  );
  await measure(scenario, `report ${report} (month to date)`, () =>
    getReport(timedCtx, company, report, thisMonth),
  );
  await measure(scenario, `report ${report} (90 days)`, () =>
    getReport(timedCtx, company, report, ninetyDays),
  );
  await measure(scenario, "staff accounts (today)", () =>
    getStaffAccounts(timedCtx, company, { kind: "distributor" }),
  );
  await measure(scenario, "staff statement (90 days)", () =>
    getStaffStatement(timedCtx, company, dsrIds[0] ?? "", ninetyDays),
  );
}

describe("SQL baseline", () => {
  it(`measures reads with ${OPEN_MONTHS} past months still open`, async () => {
    await measureReads("past months open");
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);

  it("measures reads once past months are closed", async () => {
    for (let m = monthOf(cutoff); m < monthOf(today); m = shiftMonth(m, 1)) {
      await closeMonth(ctx, company, m);
    }
    await measureReads("past months closed");
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);
});
