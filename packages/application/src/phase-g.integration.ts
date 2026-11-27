import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import type { OpeningBalanceKind, PayrollRun, PermissionId } from "@bsd/contracts";
import { toDecimal } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { exportStaffStatement, getStaffAccounts, getStaffStatement } from "./accounts";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { staffRoles } from "./configuration";
import type { AppContext } from "./context";
import {
  getDayView,
  listMoneyEntries,
  postMoneyEntry,
  reverseMoneyEntry,
  saveDsrDay,
} from "./daily";
import {
  cancelDamageCase,
  createDamageCase,
  getDamageCase,
  listDamageCases,
  postDamageEvent,
  reverseDamageEvent,
} from "./damage";
import { AppError } from "./errors";
import { runLedger } from "./ledger";
import { getMonthView } from "./month";
import { getOpening } from "./opening";
import { getPayrollRun, payrollCommand, savePayrollRun } from "./payroll";
import { getMonthlySummary, listSalaryHistory } from "./history-reports";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let ctx: AppContext;
let company = "";
const id = {
  alpha: "",
  selim: "",
  habib: "",
  rohim: "",
  kamal: "",
  jamal: "",
  karim: "",
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

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === "FORBIDDEN");
}

let userCount = 0;
async function userWith(permissions: PermissionId[]): Promise<AppContext> {
  userCount += 1;
  const role = await createRole(ctx, { name: `Phase G role ${userCount}`, permissions });
  const user = await createUser(ctx, {
    name: `User ${userCount}`,
    email: `g.user${userCount}@example.test`,
    password: "temporary-Password-1",
    memberships: [{ companyId: company, roleIds: [role.id] }],
  });
  return contextFor(db, {
    userId: user.id,
    tenantId: admin.tenantId,
    isSuperAdmin: false,
  });
}

async function closingOn(date: string) {
  const access = await loadCompanyAccess(ctx, company);
  return must(await runLedger(db, access, date)).output;
}

function lineOf(run: PayrollRun, staffId: string) {
  return must(run.lines.find((l) => l.staffId === staffId));
}

const money = (date: string, kind: string, amount: string, staffId: string, extra = {}) =>
  postMoneyEntry(ctx, company, { date, kind, amount, staffId, ...extra });

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
  id.selim = await person("Selim", "general", "distributor");
  id.habib = await person("Habib", "general", "distributor");
  id.rohim = await person("Rohim", "dsr", "distributor");
  id.kamal = await person("Kamal", "dsr", "distributor");
  id.jamal = await person("Jamal", "general", "distributor");
  id.karim = await person("Karim", "sr", "supplier");

  const empty = await getOpening(ctx, company);
  const balance = (kind: OpeningBalanceKind, staffId: string, amount: string) => ({
    kind,
    staffId,
    cashAccountId: null,
    amount,
    note: "",
  });
  await saveWholeOpening(ctx, company, {
    version: empty.version,
    cutoffDate: "2026-09-01",
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
      balance("advance", id.selim, "2000"),
      balance("loan", id.selim, "1000"),
      balance("shortage", id.selim, "500"),
      balance("advance", id.habib, "4000"),
      balance("shortage", id.rohim, "1500"),
      balance("shortage", id.kamal, "1500"),
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Phase G: staff and SR accounts", () => {
  it("T55: someone who is neither an SR nor a DSR is refused on a day sheet", async () => {
    await expectField(
      saveDsrDay(ctx, company, {
        date: "2026-09-02",
        staffId: id.selim,
        version: 0,
        marketDueNew: "0",
        marketDueCollected: "0",
        lines: [],
      }),
      "staffId",
      "validation.daily.dsrOnly",
    );
  });

  it("T58: same-day advance, repayment, shortage and excess stay separate on the statement", async () => {
    await money("2026-09-02", "staffAdvance", "500", id.jamal);
    await money("2026-09-02", "staffRepayment", "200", id.jamal);
    await money("2026-09-02", "staffShortage", "100", id.jamal);
    await money("2026-09-02", "staffExcess", "50", id.jamal);

    expect((await getDayView(ctx, company, "2026-09-02")).money.cashLeft).toBe("-350");
    const statement = await getStaffStatement(ctx, company, id.jamal, {
      from: "2026-09-01",
      to: "2026-09-02",
    });
    expect(statement.kind).toBe("distributor");
    expect(statement.lines.map((l) => l.kind)).toEqual([
      "staffAdvance",
      "staffRepayment",
      "staffShortage",
      "staffExcess",
    ]);
    expect(statement.lines.every((l) => l.entryId !== null)).toBe(true);
    expect(statement.lines[1]).toMatchObject({
      change: { advance: "-200" },
      balances: { advance: "300" },
    });
    expect(statement.closing).toMatchObject({ advance: "300", shortage: "100", credit: "50" });
    expect(statement.owesUs).toBe("400");
    expect(statement.weOwe).toBe("50");

    const accounts = await getStaffAccounts(ctx, company, { date: "2026-09-02" });
    const row = must(accounts.rows.find((r) => r.staffId === id.jamal));
    expect(row).toMatchObject({ owesUs: "400", weOwe: "50" });
    expect(accounts.rows.some((r) => r.staffId === id.karim)).toBe(false);
  });

  it("T25: SR loan and repayment move cash and the SR receivable only", async () => {
    await expectField(
      money("2026-09-03", "srLoan", "1", id.karim),
      "srLoanType",
      "validation.money.srLoanTypeRequired",
    );
    await money("2026-09-03", "srLoan", "700", id.karim, { srLoanType: "cash" });
    await money("2026-09-03", "srLoan", "300", id.karim, { srLoanType: "commission" });
    await money("2026-09-03", "srRepayment", "400", id.karim, { srLoanType: "commission" });
    expect((await getDayView(ctx, company, "2026-09-03")).money).toMatchObject({
      cashIn: "400",
      cashOut: "1000",
      sales: "0",
    });
    const sr = await getStaffAccounts(ctx, company, { kind: "sr", date: "2026-09-03" });
    expect(sr.rows.map((r) => r.staffId)).toEqual([id.karim]);
    expect(sr.rows[0]?.balances).toMatchObject({ srLoan: "600", salaryPayable: "0" });
    const statement = await getStaffStatement(ctx, company, id.karim, {
      from: "2026-09-01",
      to: "2026-09-03",
    });
    expect(statement.kind).toBe("sr");
    expect(statement.closing.srLoan).toBe("600");
    expect(statement.lines.map((l) => [l.kind, l.srLoanType])).toEqual([
      ["srLoan", "cash"],
      ["srLoan", "commission"],
      ["srRepayment", "commission"],
    ]);
    const profit = (await closingOn("2026-09-03")).month.profit;
    expect(profit).toMatchObject({ salaries: "0", expenses: "0" });
  });

  it("checks explicit allocations and offsets against the balances on the date", async () => {
    await expectField(
      money("2026-09-04", "staffRepayment", "10", id.jamal, {
        allocation: { advance: "0", loan: "10", shortage: "0" },
      }),
      "allocation.loan",
      "validation.money.allocationExceeds",
    );
    await expectField(
      money("2026-09-04", "staffRepayment", "10", id.jamal, {
        allocation: { advance: "5", loan: "0", shortage: "0" },
      }),
      "allocation",
      "validation.money.allocationSum",
    );
    await expectField(
      postMoneyEntry(ctx, company, {
        date: "2026-09-04",
        kind: "supplierDeposit",
        amount: "5",
        allocation: { advance: "5", loan: "0", shortage: "0" },
      }),
      "allocation",
      "validation.money.noAllocationForKind",
    );
    await expectField(
      money("2026-09-04", "staffOffset", "100", id.jamal),
      "amount",
      "validation.money.offsetExceeds",
    );
    const offset = await money("2026-09-04", "staffOffset", "50", id.jamal, {
      allocation: { advance: "0", loan: "0", shortage: "50" },
    });
    expect(offset.allocation).toEqual({ advance: "0", loan: "0", shortage: "50" });

    await money("2026-09-04", "srOwed", "300", id.karim);
    await expectField(
      money("2026-09-04", "srOffset", "400", id.karim),
      "amount",
      "validation.money.offsetExceeds",
    );
    await money("2026-09-04", "srOffset", "300", id.karim);

    const closing = (await closingOn("2026-09-04")).closing.staff;
    expect(closing[id.jamal]).toMatchObject({ advance: "300", shortage: "50", credit: "0" });
    expect(closing[id.karim]).toMatchObject({ srLoan: "300", owedToSr: "0" });
    expect((await getDayView(ctx, company, "2026-09-04")).money.cashLeft).toBe("0");
  });

  it("exports the statement and enforces account permissions", async () => {
    const file = await exportStaffStatement(
      ctx,
      company,
      id.jamal,
      { from: "2026-09-01", to: "2026-09-04" },
      "csv",
    );
    const csv = new TextDecoder().decode(file.data);
    expect(csv).toContain("কর্মীকে অগ্রিম");
    expect(csv).not.toMatch(/report\.(table|column|line)\.|money\.kind\./);

    const srViewer = await userWith(["company.view", "sr_loan.view"]);
    expect((await getStaffAccounts(srViewer, company, { kind: "sr" })).rows).toHaveLength(1);
    await expectForbidden(getStaffAccounts(srViewer, company, { kind: "distributor" }));
    await expectForbidden(
      getStaffStatement(srViewer, company, id.jamal, { from: "2026-09-01", to: "2026-09-04" }),
    );
    await expectForbidden(
      exportStaffStatement(srViewer, company, id.karim, { from: "2026-09-01" }, "csv"),
    );
  });
});

describe("Phase G: payroll runs", () => {
  const lines = (overrides: Record<string, unknown> = {}) => [
    {
      staffId: id.selim,
      salary: "10500",
      recovery: null,
      reason: "",
      ...(overrides[id.selim] ?? {}),
    },
    { staffId: id.habib, salary: "3250", recovery: null, reason: "" },
    { staffId: id.rohim, salary: "12000", recovery: null, reason: "" },
    {
      staffId: id.kamal,
      salary: "1000",
      recovery: null,
      reason: "",
      ...(overrides[id.kamal] ?? {}),
    },
  ];
  let run: PayrollRun;

  it("proposes recovery advance → loan → shortage for every eligible employee", async () => {
    const proposal = await getPayrollRun(ctx, company, "2026-09");
    expect(proposal.status).toBe("none");
    const people = proposal.lines.map((l) => l.staffId);
    expect(people).toEqual(
      expect.arrayContaining([id.selim, id.habib, id.rohim, id.kamal, id.jamal]),
    );
    expect(people).not.toContain(id.karim);

    await expectField(
      savePayrollRun(ctx, company, "2026-09", { version: 0, date: "2026-10-01", lines: lines() }),
      "date",
      "validation.payroll.dateOutsideMonth",
    );
    await expectField(
      savePayrollRun(ctx, company, "2026-09", {
        version: 0,
        date: "2026-09-30",
        lines: [...lines(), { staffId: id.karim, salary: "1", recovery: null, reason: "" }],
      }),
      "lines.4.staffId",
      "validation.payroll.notEligible",
    );
    await expectField(
      savePayrollRun(ctx, company, "2026-09", {
        version: 0,
        date: "2026-09-30",
        lines: lines({ [id.kamal]: { recovery: { advance: "0", loan: "0", shortage: "1200" } } }),
      }),
      "lines.3.reason",
      "validation.payroll.reasonRequired",
    );
    await expectField(
      savePayrollRun(ctx, company, "2026-09", {
        version: 0,
        date: "2026-09-30",
        lines: lines({
          [id.kamal]: { recovery: { advance: "0", loan: "0", shortage: "1200" }, reason: "all" },
        }),
      }),
      "lines.3.recovery",
      "validation.payroll.exceedsSalary",
    );

    run = await savePayrollRun(ctx, company, "2026-09", {
      version: 0,
      date: "2026-09-30",
      lines: lines(),
    });
    expect(run.status).toBe("draft");
    // T56: manager 10,500 with advance 2,000, loan 1,000, shortage 500 → Cash Pabe 7,000.
    expect(lineOf(run, id.selim)).toMatchObject({
      recovery: { advance: "2000", loan: "1000", shortage: "500" },
      cashPay: "7000",
    });
    // T57: helper 3,250 with advance 4,000 → recovers 3,250, pays 0.
    expect(lineOf(run, id.habib)).toMatchObject({ recoveryTotal: "3250", cashPay: "0" });
    // T26: DSR 12,000 with due 1,500 → pays 10,500.
    expect(lineOf(run, id.rohim)).toMatchObject({ recoveryTotal: "1500", cashPay: "10500" });
    // T27: due above pay is capped at the salary.
    expect(lineOf(run, id.kamal)).toMatchObject({ recoveryTotal: "1000", cashPay: "0" });
  });

  it("keeps overrides with a reason, re-proposes the rest from live balances", async () => {
    const overridden = await savePayrollRun(ctx, company, "2026-09", {
      version: run.version,
      date: "2026-09-30",
      lines: lines({
        [id.selim]: {
          recovery: { advance: "2000", loan: "0", shortage: "0" },
          reason: "loan later",
        },
      }),
    });
    expect(lineOf(overridden, id.selim)).toMatchObject({ cashPay: "8500", reason: "loan later" });
    await expectField(
      savePayrollRun(ctx, company, "2026-09", {
        version: run.version,
        date: "2026-09-30",
        lines: lines(),
      }),
      "version",
      "validation.daily.stale",
    );
    run = await savePayrollRun(ctx, company, "2026-09", {
      version: overridden.version,
      date: "2026-09-30",
      lines: lines(),
    });
    expect(lineOf(run, id.selim).cashPay).toBe("7000");

    const advance = await money("2026-09-15", "staffAdvance", "100", id.selim);
    const live = await getPayrollRun(ctx, company, "2026-09");
    expect(lineOf(live, id.selim)).toMatchObject({
      owed: { advance: "2100" },
      recoveryTotal: "3600",
      cashPay: "6900",
    });
    await reverseMoneyEntry(ctx, company, advance.id);
  });

  it("needs the payroll permissions for each step", async () => {
    const viewer = await userWith(["company.view", "compensation.view"]);
    expect((await getPayrollRun(viewer, company, "2026-09")).status).toBe("draft");
    await expectForbidden(
      savePayrollRun(viewer, company, "2026-09", {
        version: run.version,
        date: "2026-09-30",
        lines: lines(),
      }),
    );
    const manager = await userWith(["company.view", "compensation.view", "compensation.manage"]);
    await expectForbidden(
      payrollCommand(manager, company, "2026-09", "approve", { version: run.version }),
    );
  });

  it("approves and pays: Cash Pabe leaves cash, recovery clears the buckets", async () => {
    await expectField(
      payrollCommand(ctx, company, "2026-09", "pay", {
        version: run.version,
        payDate: "2026-09-30",
      }),
      "",
      "validation.payroll.notApproved",
    );
    run = await payrollCommand(ctx, company, "2026-09", "approve", { version: run.version });
    expect(run.status).toBe("approved");

    const entries = await listMoneyEntries(ctx, company, { from: "2026-09-30" });
    const accrual = must(entries.find((e) => e.kind === "salaryAccrual" && e.staffId === id.selim));
    expect(accrual.payrollRunId).toBe(run.id);
    await expectField(
      reverseMoneyEntry(ctx, company, accrual.id),
      "",
      "validation.money.payrollOwned",
    );

    await expectField(
      payrollCommand(ctx, company, "2026-09", "pay", {
        version: run.version,
        payDate: "2026-09-29",
      }),
      "payDate",
      "validation.payroll.payBeforeRun",
    );
    run = await payrollCommand(ctx, company, "2026-09", "pay", {
      version: run.version,
      payDate: "2026-09-30",
    });
    expect(run.status).toBe("paid");
    expect(run.totals).toMatchObject({ salary: "26750.00", cashPay: "17500.00" });

    const out = await closingOn("2026-09-30");
    expect(out.closing.staff[id.selim]).toMatchObject({
      advance: "0",
      loan: "0",
      shortage: "0",
      salaryPayable: "0",
    });
    expect(out.closing.staff[id.habib]).toMatchObject({ advance: "750", salaryPayable: "0" });
    expect(out.closing.staff[id.rohim]).toMatchObject({ shortage: "0", salaryPayable: "0" });
    expect(out.closing.staff[id.kamal]).toMatchObject({ shortage: "500", salaryPayable: "0" });
    expect(out.month.profit.salaries).toBe("26750");
    expect((await getDayView(ctx, company, "2026-09-30")).money.cashOut).toBe("17500");

    const statement = await getStaffStatement(ctx, company, id.selim, {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(statement.lines.filter((l) => l.payrollRunId === run.id).map((l) => l.kind)).toEqual([
      "salaryAccrual",
      "salaryRecovery",
      "salaryPaid",
    ]);
  });

  it("reverses the whole run and allows a fresh one", async () => {
    await expectField(
      savePayrollRun(ctx, company, "2026-09", {
        version: run.version,
        date: "2026-09-30",
        lines: lines(),
      }),
      "",
      "validation.payroll.notDraft",
    );
    const after = await payrollCommand(ctx, company, "2026-09", "reverse", {
      version: run.version,
    });
    expect(after.status).toBe("none");
    const out = await closingOn("2026-09-30");
    expect(out.closing.staff[id.selim]).toMatchObject({
      advance: "2000",
      loan: "1000",
      shortage: "500",
    });
    expect(out.month.profit.salaries).toBe("0");
    const draft = await savePayrollRun(ctx, company, "2026-09", {
      version: 0,
      date: "2026-09-30",
      lines: lines(),
    });
    const discarded = await payrollCommand(ctx, company, "2026-09", "discard", {
      version: draft.version,
    });
    expect(discarded.status).toBe("none");
  });

  it("D75: Pay Now pays one person after the absent fee and keeps them through the draft", async () => {
    const absent = await money("2026-09-10", "staffAbsent", "500", id.selim);
    const proposal = await savePayrollRun(ctx, company, "2026-09", {
      version: 0,
      date: "2026-09-30",
      lines: lines(),
    });
    // Salary stays the gross 10,500; the absent fee only lowers what is paid.
    expect(lineOf(proposal, id.selim)).toMatchObject({
      salary: "10500",
      absent: "500.00",
      recoveryTotal: "3500",
      cashPay: "6500",
      paid: false,
    });
    expect((await closingOn("2026-09-30")).closing.staff[id.selim]).toMatchObject({
      advance: "2000",
    });

    await expectField(
      payrollCommand(ctx, company, "2026-09", "payStaff", {
        version: 0,
        payDate: "2026-09-30",
        staffId: id.selim,
      }),
      "version",
      "validation.daily.stale",
    );
    let paid = await payrollCommand(ctx, company, "2026-09", "payStaff", {
      version: proposal.version,
      payDate: "2026-09-30",
      staffId: id.selim,
    });
    expect(paid.status).toBe("draft");
    expect(lineOf(paid, id.selim)).toMatchObject({
      absent: "500.00",
      cashPay: "6500",
      paid: true,
    });
    expect(lineOf(paid, id.rohim).paid).toBe(false);
    expect((await closingOn("2026-09-30")).closing.staff[id.selim]).toMatchObject({
      advance: "0",
      loan: "0",
      shortage: "0",
      salaryPayable: "0",
    });
    expect((await getDayView(ctx, company, "2026-09-30")).money.cashOut).toBe("6500");

    // D149: বেতন ইতিহাস shows the paid line; the absent fee lowers only the payable.
    const history = await listSalaryHistory(ctx, company, { year: "2026", month: "2026-09" });
    const selimRow = must(history.rows.find((r) => r.staffId === id.selim));
    expect(selimRow).toMatchObject({
      salary: "10500.00",
      absent: "500.00",
      payable: "10000.00",
      recoveryTotal: "3500.00",
      cashPay: "6500.00",
      cashPaid: "6500.00",
      paidDate: "2026-09-30",
      remaining: { advance: "0.00", loan: "0.00", shortage: "0.00" },
    });
    expect(history.rows.some((r) => r.staffId === id.rohim)).toBe(false);
    expect(history.totals.cashPaid).toBe("6500.00");
    expect(
      (await listSalaryHistory(ctx, company, { year: "2026", staffId: id.rohim })).rows,
    ).toEqual([]);

    // D148: মাসিক সারসংক্ষেপ books the posted salary (salary − absent) under the person's role.
    const summary = await getMonthlySummary(ctx, company, "2026-09");
    const selimKhoroch = must(
      summary.roles.flatMap((r) => r.staff).find((x) => x.staffId === id.selim),
    );
    expect(selimKhoroch.salary).toBe("10000.00");
    expect(summary.salaryPendingCount).toBeGreaterThan(0);
    expect(summary.netProfit).toBe(
      toDecimal(summary.salesProfit).sub(summary.operatingCost).sub(summary.staffTotal).toFixed(2),
    );

    await expectField(
      payrollCommand(ctx, company, "2026-09", "payStaff", {
        version: paid.version,
        payDate: "2026-09-30",
        staffId: id.selim,
      }),
      "staffId",
      "validation.payroll.alreadyPaid",
    );
    paid = await savePayrollRun(ctx, company, "2026-09", {
      version: paid.version,
      date: "2026-09-30",
      lines: lines({ [id.selim]: { salary: "1" } }),
    });
    expect(lineOf(paid, id.selim)).toMatchObject({ salary: "10500", paid: true });
    await expectField(
      payrollCommand(ctx, company, "2026-09", "discard", { version: paid.version }),
      "",
      "validation.payroll.hasPaid",
    );

    const reversed = await payrollCommand(ctx, company, "2026-09", "reverse", {
      version: paid.version,
    });
    expect(reversed.status).toBe("none");
    expect((await closingOn("2026-09-30")).closing.staff[id.selim]).toMatchObject({
      advance: "2000",
      salaryPayable: "0",
    });
    await reverseMoneyEntry(ctx, company, absent.id);
  });
});

describe("Phase G: damage replacement legs (D17)", () => {
  let caseId = "";
  let lineId = "";

  it("moves stock for buyer replacement from stock and company replacement, nothing else", async () => {
    const created = await createDamageCase(ctx, company, {
      caseNumber: "D-1",
      date: "2026-09-05",
      origin: "buyerExchange",
      staffId: id.rohim,
      note: "",
      lines: [{ productId: id.alpha, quantity: "3" }],
    });
    caseId = created.id;
    lineId = must(created.lines[0]).id;
    await expectField(
      createDamageCase(ctx, company, {
        caseNumber: "D-1",
        date: "2026-09-05",
        origin: "buyerExchange",
        staffId: null,
        note: "",
        lines: [{ productId: id.alpha, quantity: "1" }],
      }),
      "caseNumber",
      "validation.damage.duplicateCase",
    );

    const event = (date: string, kind: string, quantity: string, extra = {}) =>
      postDamageEvent(ctx, company, caseId, {
        date,
        lineId,
        kind,
        quantity,
        fromStock: false,
        unitCost: null,
        reference: "",
        note: "",
        ...extra,
      });

    await event("2026-09-05", "buyerReplacement", "2", { fromStock: true });
    await expectField(
      event("2026-09-05", "buyerReplacement", "2"),
      "quantity",
      "validation.damage.overReplacement",
    );
    expect((await closingOn("2026-09-05")).closing.products[id.alpha]?.stock).toBe("98");

    await expectField(
      event("2026-09-06", "companyDispatch", "3", { fromStock: true }),
      "fromStock",
      "validation.damage.fromStockBuyerOnly",
    );
    await event("2026-09-06", "companyDispatch", "3");
    await expectField(
      event("2026-09-06", "companyDispatch", "1"),
      "quantity",
      "validation.damage.overDispatch",
    );
    await event("2026-09-07", "companyAccept", "2");
    await event("2026-09-07", "companyReject", "1");
    await expectField(
      event("2026-09-08", "companyReplacement", "2"),
      "unitCost",
      "validation.damage.unitCostRequired",
    );
    const replaced = await event("2026-09-08", "companyReplacement", "2", { unitCost: "10" });
    expect(must(replaced.lines[0]).progress).toMatchObject({
      buyerPending: "1",
      awaitingAcceptance: "0",
      rejected: "1",
      companyReplaced: "2",
      companyRefunded: "0",
      companyPending: "0",
    });

    const out = await closingOn("2026-09-08");
    expect(out.closing.products[id.alpha]?.stock).toBe("100");
    expect(out.closing.companyPayable).toBe("0");
    expect(out.month.totals.replacementValue).toBe("20");
    const month = await getMonthView(ctx, company, "2026-09");
    expect(month.totals.replacementValue).toBe("20");
    expect(month.products[0]).toMatchObject({
      replacedFromStock: "2",
      replacementReceived: "2",
      receiptTotal: "0",
      salesTotal: "0",
    });
  });

  it("reverses the latest dependent leg first and cancels only empty cases", async () => {
    const current = await getDamageCase(ctx, company, caseId);
    const accept = must(current.events.find((e) => e.kind === "companyAccept"));
    const replacement = must(current.events.find((e) => e.kind === "companyReplacement"));
    await expectField(
      reverseDamageEvent(ctx, company, accept.id),
      "",
      "validation.damage.reverseLaterFirst",
    );
    await reverseDamageEvent(ctx, company, replacement.id);
    expect((await closingOn("2026-09-08")).closing.products[id.alpha]?.stock).toBe("98");
    await reverseDamageEvent(ctx, company, accept.id);
    await expectField(
      reverseDamageEvent(ctx, company, accept.id),
      "",
      "validation.daily.alreadyReversed",
    );

    await expectField(cancelDamageCase(ctx, company, caseId), "", "validation.damage.hasEvents");
    const spare = await createDamageCase(ctx, company, {
      caseNumber: "D-2",
      date: "2026-09-05",
      origin: "ownedStock",
      staffId: null,
      note: "",
      lines: [{ productId: id.alpha, quantity: "1" }],
    });
    const cancelled = await cancelDamageCase(ctx, company, spare.id);
    expect(cancelled.status).toBe("cancelled");
    await expectField(
      postDamageEvent(ctx, company, spare.id, {
        date: "2026-09-06",
        lineId: must(spare.lines[0]).id,
        kind: "writeOff",
        quantity: "1",
        fromStock: false,
        unitCost: null,
        reference: "",
        note: "",
      }),
      "",
      "validation.damage.cancelled",
    );
    expect(
      (await listDamageCases(ctx, company, { status: "open" })).map((c) => c.caseNumber),
    ).toEqual(["D-1"]);
  });

  it("hides replacement cost and refuses legs without the permission", async () => {
    await postDamageEvent(ctx, company, caseId, {
      date: "2026-09-09",
      lineId,
      kind: "companyAccept",
      quantity: "2",
      fromStock: false,
      unitCost: null,
      reference: "",
      note: "",
    });
    await postDamageEvent(ctx, company, caseId, {
      date: "2026-09-09",
      lineId,
      kind: "companyReplacement",
      quantity: "2",
      fromStock: false,
      unitCost: "10",
      reference: "",
      note: "",
    });
    const reporter = await userWith(["company.view", "damage.report"]);
    const seen = await getDamageCase(reporter, company, caseId);
    expect(seen.events.every((e) => e.unitCost === null)).toBe(true);
    await expectForbidden(
      postDamageEvent(reporter, company, caseId, {
        date: "2026-09-09",
        lineId,
        kind: "writeOff",
        quantity: "1",
        fromStock: false,
        unitCost: null,
        reference: "",
        note: "",
      }),
    );
    const outsider = await userWith(["company.view"]);
    await expectForbidden(listDamageCases(outsider, company, {}));
  });

  it("never credits accepted pieces twice: refund plus replacement stays within acceptance", async () => {
    const owned = await createDamageCase(ctx, company, {
      caseNumber: "D-3",
      date: "2026-09-10",
      origin: "ownedStock",
      staffId: null,
      note: "",
      sentToCompany: true,
      lines: [{ productId: id.alpha, quantity: "2" }],
    });
    const leg = (kind: string, quantity: string, extra = {}, key?: string) =>
      postDamageEvent(
        ctx,
        company,
        owned.id,
        {
          date: "2026-09-11",
          lineId: must(owned.lines[0]).id,
          kind,
          quantity,
          fromStock: false,
          unitCost: null,
          reference: "",
          note: "",
          ...extra,
        },
        key,
      );
    await leg("companyAccept", "2");
    const refunded = await leg("companyRefund", "2", { unitCost: "10" }, "refund-1");
    const replay = await leg("companyRefund", "2", { unitCost: "10" }, "refund-1");
    expect(replay.events.length).toBe(refunded.events.length);
    await expectField(
      leg("companyRefund", "2", { unitCost: "10" }, "refund-2"),
      "quantity",
      "validation.damage.overCompanyReplacement",
    );
    await expectField(
      leg("companyReplacement", "1", { unitCost: "10" }),
      "quantity",
      "validation.damage.overCompanyReplacement",
    );
    const final = await getDamageCase(ctx, company, owned.id);
    expect(must(final.lines[0]).progress).toMatchObject({
      accepted: "2",
      companyRefunded: "2",
      companyReplaced: "0",
      companyPending: "0",
    });
    expect(final.status).toBe("settled");
  });
});
