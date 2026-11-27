import {
  monthSchema,
  monthlySummarySchema,
  salaryHistorySchema,
  type MonthlySummary,
  type SalaryHistory,
} from "@bsd/contracts";
import {
  MONEY_KIND_EFFECTS,
  cashPay,
  firstOfMonth,
  lastOfMonth,
  monthKhoroch,
  monthNetProfit,
  monthOf,
  recoveryTotal,
  roundSettlement,
  sumAmounts,
  todayBusinessDate,
  toDecimal,
  type MoneyKind,
  type StaffRoleRef,
} from "@bsd/domain";
import { requirePermission } from "./access";
import type { AppContext } from "./context";
import { dashboardOf, requireAll } from "./daily";
import { fromDbDate, toDbDate } from "./dates";
import { invalid } from "./errors";
import { staffCompanyIds } from "./master";
import { plain } from "./numeric";
import { unpostedSalaryCount } from "./payroll";

/**
 * History → মাসিক সারসংক্ষেপ (D148) and বেতন ইতিহাস (D149). Read models only: every figure comes
 * from posted entries through the dashboard, the month engine or the domain rules; nothing here
 * posts or stores a total.
 */

/** Kinds whose amount is khoroch on the profit side (D148): category expenses and salary accrual. */
const KHOROCH_KINDS = (Object.keys(MONEY_KIND_EFFECTS) as MoneyKind[]).filter((kind) => {
  const expense = MONEY_KIND_EFFECTS[kind].expense;
  return expense === "category" || expense === "salary";
});

function parseMonth(value: unknown): string {
  const parsed = monthSchema.safeParse(value);
  if (!parsed.success) throw invalid("month", "validation.month.invalid");
  return parsed.data;
}

function parseYear(value: unknown, today: string): string {
  return typeof value === "string" && /^\d{4}$/.test(value) ? value : today.slice(0, 4);
}

export async function getMonthlySummary(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
): Promise<MonthlySummary> {
  const access = await requirePermission(ctx, companyId, "report.profit_view");
  requireAll(access, ["inventory.cost_view", "finance.view"]);
  const today = todayBusinessDate();
  const month = parseMonth(monthInput);
  if (month > monthOf(today)) throw invalid("month", "validation.month.invalid");
  const from = firstOfMonth(month);
  const to = lastOfMonth(month) > today ? today : lastOfMonth(month);

  const { summary, orderTotal } = await dashboardOf(ctx, access, { from, to });
  const cutoff = summary.cutoffDate;
  const start = cutoff && cutoff > from ? cutoff : from;
  const entries =
    cutoff && to >= cutoff
      ? await ctx.db.moneyEntry.findMany({
          where: {
            companyId,
            status: "posted",
            date: { gte: toDbDate(start), lte: toDbDate(to) },
            kind: { in: KHOROCH_KINDS },
          },
          select: { kind: true, amount: true, staffId: true },
        })
      : [];

  const staffIds = [...new Set(entries.flatMap((e) => (e.staffId ? [e.staffId] : [])))];
  const [assignments, staffRows, tenantRoles, pending] = await Promise.all([
    ctx.db.staffAssignment.findMany({
      where: {
        staffId: { in: staffIds },
        companyId: { in: await staffCompanyIds(ctx.db, companyId) },
        from: { lte: toDbDate(to) },
      },
      orderBy: { from: "desc" },
      select: { staffId: true, role: { select: { id: true, name: true } } },
    }),
    ctx.db.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    }),
    ctx.db.staffRole.findMany({
      where: { tenantId: access.company.tenantId, active: true, kind: { not: "sr" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    access.permissions.includes("compensation.view")
      ? unpostedSalaryCount(ctx.db, companyId, month)
      : Promise.resolve(0),
  ]);
  const roleOf = new Map<string, StaffRoleRef>();
  for (const a of assignments) {
    if (!roleOf.has(a.staffId)) roleOf.set(a.staffId, { roleId: a.role.id, roleName: a.role.name });
  }
  const nameOf = new Map(staffRows.map((s) => [s.id, s.name]));

  const khoroch = monthKhoroch(
    entries.map((e) => ({
      kind: e.kind as MoneyKind,
      amount: plain(e.amount),
      ...(e.staffId ? { staffId: e.staffId } : {}),
    })),
    roleOf,
  );
  const found = new Map(khoroch.roles.map((r) => [r.roleId, r]));
  const empty = { salary: "0.00", expenses: "0.00", total: "0.00", staff: [] };
  const roles = [
    ...tenantRoles.map(
      (role) => found.get(role.id) ?? { roleId: role.id, roleName: role.name, ...empty },
    ),
    ...khoroch.roles.filter((r) => !tenantRoles.some((role) => role.id === r.roleId)),
  ].map((role) => ({
    ...role,
    staff: role.staff
      .map((s) => ({ ...s, staffName: nameOf.get(s.staffId) ?? "" }))
      .sort((a, b) => a.staffName.localeCompare(b.staffName, "bn")),
  }));
  const salesProfit = summary.salesProfit ?? "0.00";

  return monthlySummarySchema.parse({
    month,
    from,
    to,
    cutoffDate: cutoff,
    totalOrder: orderTotal,
    totalReceive: roundSettlement(summary.receivedValue ?? "0"),
    totalSales: summary.totalSales,
    commission: summary.commission,
    salesProfit: roundSettlement(salesProfit),
    operatingCost: khoroch.operating,
    roles,
    staffTotal: khoroch.staffTotal,
    netProfit: monthNetProfit(salesProfit, khoroch),
    dashboardNetProfit: roundSettlement(summary.netProfit ?? "0"),
    salaryPendingCount: pending,
  });
}

/**
 * D149: every posted salary line of the year (optionally one month): salary, absent fee, what was
 * recovered from advance / loan / shortage, ক্যাশ পাবে and the cash actually paid. The absent fee
 * is salary − the posted accrual, as payroll stores it (D67); it never touches a balance.
 */
export async function listSalaryHistory(
  ctx: AppContext,
  companyId: string,
  query: { year?: unknown; month?: unknown; staffId?: unknown },
): Promise<SalaryHistory> {
  await requirePermission(ctx, companyId, "compensation.view");
  const year = parseYear(query.year, todayBusinessDate());
  const month =
    typeof query.month === "string" && query.month.startsWith(`${year}-`)
      ? parseMonth(query.month)
      : null;
  const staffId = typeof query.staffId === "string" && query.staffId ? query.staffId : null;
  const runs = await ctx.db.payrollRun.findMany({
    where: {
      companyId,
      status: { not: "reversed" },
      month: { gte: `${year}-01`, lte: `${year}-12` },
    },
    include: {
      lines: {
        include: {
          staff: {
            select: {
              name: true,
              assignments: {
                orderBy: { from: "desc" },
                select: { companyId: true, role: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  const entries = await ctx.db.moneyEntry.findMany({
    where: {
      payrollRunId: { in: runs.map((r) => r.id) },
      status: "posted",
      kind: { in: ["salaryAccrual", "salaryRecovery", "salaryPaid"] },
    },
    select: { payrollRunId: true, staffId: true, kind: true, amount: true, date: true },
  });
  type Posting = {
    accrual: string[];
    paid: string[];
    postedDate: string | null;
    paidDate: string | null;
  };
  const postings = new Map<string, Posting>();
  for (const e of entries) {
    if (!e.payrollRunId || !e.staffId) continue;
    const key = `${e.payrollRunId}:${e.staffId}`;
    const row = postings.get(key) ?? { accrual: [], paid: [], postedDate: null, paidDate: null };
    const date = fromDbDate(e.date);
    if (e.kind === "salaryPaid") {
      row.paid.push(plain(e.amount));
      if (!row.paidDate || date > row.paidDate) row.paidDate = date;
    } else {
      if (e.kind === "salaryAccrual") row.accrual.push(plain(e.amount));
      if (!row.postedDate || date < row.postedDate) row.postedDate = date;
    }
    postings.set(key, row);
  }

  const rows = runs.flatMap((run) =>
    run.lines.flatMap((l) => {
      // Posted lines only: the snapshot of what the person owed is written when salary posts.
      if (!l.owedAdvance || !l.owedLoan || !l.owedShortage) return [];
      const posting = postings.get(`${run.id}:${l.staffId}`);
      const salary = plain(l.salary);
      const payable = roundSettlement(sumAmounts(["0", ...(posting?.accrual ?? [])]));
      const recovery = {
        advance: roundSettlement(plain(l.recoverAdvance)),
        loan: roundSettlement(plain(l.recoverLoan)),
        shortage: roundSettlement(plain(l.recoverShortage)),
      };
      const owed = {
        advance: roundSettlement(plain(l.owedAdvance)),
        loan: roundSettlement(plain(l.owedLoan)),
        shortage: roundSettlement(plain(l.owedShortage)),
      };
      const left = (bucket: keyof typeof owed) =>
        roundSettlement(toDecimal(owed[bucket]).sub(toDecimal(recovery[bucket])));
      const role =
        l.staff.assignments.find((a) => a.companyId === companyId) ?? l.staff.assignments[0];
      return [
        {
          runId: run.id,
          month: run.month,
          staffId: l.staffId,
          staffName: l.staff.name,
          roleName: role?.role.name ?? "",
          salary: roundSettlement(salary),
          absent: roundSettlement(toDecimal(salary).sub(toDecimal(payable))),
          payable,
          owed,
          recovery,
          remaining: { advance: left("advance"), loan: left("loan"), shortage: left("shortage") },
          recoveryTotal: roundSettlement(recoveryTotal(recovery)),
          cashPay: roundSettlement(cashPay(payable, recovery)),
          cashPaid: roundSettlement(sumAmounts(["0", ...(posting?.paid ?? [])])),
          postedDate: posting?.postedDate ?? fromDbDate(run.date),
          paidDate: posting?.paidDate ?? null,
        },
      ];
    }),
  );
  const staffOptions = [...new Map(rows.map((r) => [r.staffId, r.staffName]))]
    .map(([id, name]) => ({ staffId: id, staffName: name }))
    .sort((a, b) => a.staffName.localeCompare(b.staffName, "bn"));
  const shown = rows.filter(
    (r) => (!month || r.month === month) && (!staffId || r.staffId === staffId),
  );
  shown.sort((a, b) =>
    a.month === b.month ? a.staffName.localeCompare(b.staffName, "bn") : a.month < b.month ? 1 : -1,
  );
  const total = (pick: (r: (typeof rows)[number]) => string) =>
    roundSettlement(sumAmounts(["0", ...shown.map(pick)]));
  return salaryHistorySchema.parse({
    year,
    month,
    staffId,
    staffOptions,
    rows: shown,
    totals: {
      salary: total((r) => r.salary),
      absent: total((r) => r.absent),
      recovery: total((r) => r.recoveryTotal),
      cashPay: total((r) => r.cashPay),
      cashPaid: total((r) => r.cashPaid),
    },
  });
}
