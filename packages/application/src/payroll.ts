import {
  monthSchema,
  payrollActions,
  payrollRunSchema,
  payrollSaveRequestSchema,
  payrollTransitionRequestSchema,
  type PayrollAction,
  type PayrollRun,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  cashPay,
  checkRecovery,
  proposeRecovery,
  recoveryTotal,
  roundSettlement,
  salaryAfterAbsence,
  sumAmounts,
  toDecimal,
  type Recovery,
  todayBusinessDate,
  firstOfMonth,
  lastOfMonth,
} from "@bsd/domain";
import { requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { postingGuard, requireAll } from "./daily";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { liveOpening } from "./ledger";
import { staffCompanyIds } from "./master";
import { plain } from "./numeric";
import { staffRun } from "./staff-ledger";

/**
 * Payroll runs (D11, D24, D25, guide §11.6, §11.9): one run per company and month for every
 * distributor employee (never SRs, D18). Approval posts salary accrual and recovery as money
 * entries; paying posts Cash Pabe. The month engine then owns every balance.
 */

type Db = AppContext["db"] | Tx;
type Owed = Recovery;

const ZERO_OWED: Owed = { advance: "0", loan: "0", shortage: "0" };

const runInclude = {
  lines: {
    include: {
      staff: {
        select: {
          name: true,
          assignments: { include: { role: { select: { name: true } } } },
        },
      },
    },
    orderBy: { staff: { name: "asc" } },
  },
} as const;
type RunRow = Prisma.PayrollRunGetPayload<{ include: typeof runInclude }>;

function parseMonth(value: unknown): string {
  const parsed = monthSchema.safeParse(value);
  if (!parsed.success) throw invalid("month", "validation.month.invalid");
  return parsed.data;
}

function defaultDate(month: string): string {
  const today = todayBusinessDate();
  const last = lastOfMonth(month);
  return last < today ? last : today < firstOfMonth(month) ? firstOfMonth(month) : today;
}

/** What each person owes at the end of `date` (the tenant-wide staff run's closing, D65). */
async function owedOn(db: Db, access: CompanyAccess, date: string): Promise<Map<string, Owed>> {
  const run = await staffRun(db, access.company.tenantId, date);
  const owed = new Map<string, Owed>();
  for (const [staffId, b] of Object.entries(run?.output.closing.staff ?? {})) {
    owed.set(staffId, { advance: b.advance, loan: b.loan, shortage: b.shortage });
  }
  return owed;
}

/**
 * Distributor employees (not SR) assigned to the company or globally (master, D65) on some day of
 * the month, whose home company is this one (D93: salary is paid company-wise, not by assignment),
 * with the latest assignment's monthly salary as the payroll default (salary master).
 * D67: each company pays salaries from its own sales.
 */
async function eligibleStaff(db: Db, companyId: string, month: string) {
  const from = toDbDate(firstOfMonth(month));
  const to = toDbDate(lastOfMonth(month));
  const assignments = await db.staffAssignment.findMany({
    where: {
      companyId: { in: await staffCompanyIds(db, companyId) },
      from: { lte: to },
      OR: [{ to: null }, { to: { gte: from } }],
      role: { kind: { not: "sr" } },
      staff: { employer: "distributor", companyId },
    },
    include: { staff: { select: { id: true, name: true } }, role: { select: { name: true } } },
    orderBy: { from: "desc" },
  });
  const people = new Map<
    string,
    { id: string; name: string; roleName: string; monthlySalary: string | null }
  >();
  for (const a of assignments) {
    if (!people.has(a.staff.id)) {
      people.set(a.staff.id, {
        id: a.staff.id,
        name: a.staff.name,
        roleName: a.role.name,
        monthlySalary: a.monthlySalary === null ? null : plain(a.monthlySalary),
      });
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** D67: Σ absent fees per person entered in the company for the month. */
async function absentFees(db: Db, companyId: string, month: string) {
  const rows = await db.moneyEntry.findMany({
    where: {
      companyId,
      kind: "staffAbsent",
      status: "posted",
      date: { gte: toDbDate(firstOfMonth(month)), lte: toDbDate(lastOfMonth(month)) },
    },
    select: { staffId: true, amount: true },
  });
  const byStaff = new Map<string, string[]>();
  for (const r of rows) {
    if (r.staffId) byStaff.set(r.staffId, [...(byStaff.get(r.staffId) ?? []), plain(r.amount)]);
  }
  return new Map([...byStaff].map(([id, amounts]) => [id, sumAmounts(amounts)]));
}

/** D75: per person, the run's posted salary accrual and whether Cash Pabe was posted. */
async function runPostings(db: Db, runId: string) {
  const rows = await db.moneyEntry.findMany({
    where: {
      payrollRunId: runId,
      status: "posted",
      kind: { in: ["salaryAccrual", "salaryPaid"] },
    },
    select: { staffId: true, kind: true, amount: true },
  });
  const byStaff = new Map<string, { accrual: string; paid: boolean }>();
  for (const r of rows) {
    if (!r.staffId) continue;
    const now = byStaff.get(r.staffId) ?? { accrual: "0", paid: false };
    byStaff.set(
      r.staffId,
      r.kind === "salaryAccrual"
        ? { ...now, accrual: sumAmounts([now.accrual, plain(r.amount)]) }
        : { ...now, paid: true },
    );
  }
  return byStaff;
}

/** The monthly salary (salary master, else last month's payroll) of every eligible person. */
async function proposedSalaries(db: Db, companyId: string, month: string) {
  const previous = await db.payrollLine.findMany({
    where: { run: { companyId, status: { not: "reversed" }, month: { lt: month } } },
    orderBy: { run: { month: "desc" } },
    select: { staffId: true, salary: true },
  });
  const lastSalary = new Map<string, string>();
  for (const p of previous)
    if (!lastSalary.has(p.staffId)) lastSalary.set(p.staffId, plain(p.salary));
  return (await eligibleStaff(db, companyId, month)).map((p) => ({
    ...p,
    salary: p.monthlySalary ?? lastSalary.get(p.id) ?? "0",
  }));
}

function line(input: {
  staffId: string;
  staffName: string;
  roleName: string;
  salary: string;
  absent: string;
  owed: Owed;
  recovery: Owed;
  reason: string;
  paid: boolean;
}) {
  const net = salaryAfterAbsence(input.salary, input.absent);
  return {
    ...input,
    proposed: proposeRecovery(net, input.owed),
    recoveryTotal: recoveryTotal(input.recovery),
    cashPay: cashPay(net, input.recovery),
  };
}

function totalsOf(lines: ReturnType<typeof line>[]) {
  return {
    salary: sumAmounts(lines.map((l) => l.salary)),
    absent: sumAmounts(lines.map((l) => l.absent)),
    recovery: sumAmounts(lines.map((l) => l.recoveryTotal)),
    cashPay: sumAmounts(lines.map((l) => l.cashPay)),
  };
}

/** What the person owed when their salary was posted; null until then (D75: posted = paid now). */
const snapshotOf = (l: {
  owedAdvance: Prisma.Decimal | null;
  owedLoan: Prisma.Decimal | null;
  owedShortage: Prisma.Decimal | null;
}): Owed | null =>
  l.owedAdvance && l.owedLoan && l.owedShortage
    ? { advance: plain(l.owedAdvance), loan: plain(l.owedLoan), shortage: plain(l.owedShortage) }
    : null;

const recoveryOf = (l: {
  recoverAdvance: Prisma.Decimal;
  recoverLoan: Prisma.Decimal;
  recoverShortage: Prisma.Decimal;
}): Owed => ({
  advance: plain(l.recoverAdvance),
  loan: plain(l.recoverLoan),
  shortage: plain(l.recoverShortage),
});

async function viewOf(
  db: Db,
  access: CompanyAccess,
  month: string,
  row: RunRow | null,
): Promise<PayrollRun> {
  const active = await liveOpening(db, access.company.id);
  const cutoffDate = active?.cutoffDate ?? null;
  const date = row ? fromDbDate(row.date) : defaultDate(month);
  const live = !row || row.status === "draft";
  const owed =
    live && cutoffDate && date >= cutoffDate ? await owedOn(db, access, date) : new Map();

  const absent = live ? await absentFees(db, access.company.id, month) : new Map<string, string>();

  let lines: ReturnType<typeof line>[];
  if (row) {
    const posted = await runPostings(db, row.id);
    lines = row.lines.map((l) => {
      const snapshot = snapshotOf(l);
      const personOwed = snapshot ?? owed.get(l.staffId) ?? ZERO_OWED;
      const salary = plain(l.salary);
      const done = posted.get(l.staffId);
      const personAbsent = snapshot
        ? roundSettlement(toDecimal(salary).sub(toDecimal(done?.accrual ?? "0")))
        : (absent.get(l.staffId) ?? "0");
      const net = salaryAfterAbsence(salary, personAbsent);
      const roleName = (
        l.staff.assignments.find((a) => a.companyId === access.company.id) ?? l.staff.assignments[0]
      )?.role.name;
      return line({
        staffId: l.staffId,
        staffName: l.staff.name,
        roleName: roleName ?? "",
        salary,
        absent: personAbsent,
        owed: personOwed,
        recovery:
          live && !l.override && !snapshot ? proposeRecovery(net, personOwed) : recoveryOf(l),
        reason: l.reason,
        paid:
          row.status === "paid" ||
          (snapshot !== null && (row.status === "draft" || done?.paid === true)),
      });
    });
  } else {
    lines = (await proposedSalaries(db, access.company.id, month)).map((p) => {
      const personAbsent = absent.get(p.id) ?? "0";
      const personOwed = owed.get(p.id) ?? ZERO_OWED;
      return line({
        staffId: p.id,
        staffName: p.name,
        roleName: p.roleName,
        salary: p.salary,
        absent: personAbsent,
        owed: personOwed,
        recovery: proposeRecovery(salaryAfterAbsence(p.salary, personAbsent), personOwed),
        reason: "",
        paid: false,
      });
    });
  }

  return payrollRunSchema.parse({
    id: row?.id ?? null,
    month,
    status: row?.status ?? "none",
    version: row?.version ?? 0,
    date,
    payDate: row?.payDate ? fromDbDate(row.payDate) : null,
    cutoffDate,
    lines,
    totals: totalsOf(lines),
    approvedAt: row?.approvedAt?.toISOString() ?? null,
    paidAt: row?.paidAt?.toISOString() ?? null,
  });
}

async function liveRun(db: Db, companyId: string, month: string): Promise<RunRow | null> {
  return db.payrollRun.findFirst({
    where: { companyId, month, status: { not: "reversed" } },
    include: runInclude,
  });
}

/** The month's live run, or a proposal for every eligible person when there is none. */
export async function getPayrollRun(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
): Promise<PayrollRun> {
  const access = await requirePermission(ctx, companyId, "compensation.view");
  const month = parseMonth(monthInput);
  return viewOf(ctx.db, access, month, await liveRun(ctx.db, companyId, month));
}

function recoveryIssues(
  index: number,
  salary: string,
  owed: Owed,
  recovery: Owed,
): AppError | null {
  const issues = checkRecovery(salary, owed, recovery);
  if (!issues.length) return null;
  return new AppError(
    "VALIDATION_FAILED",
    issues.map((issue) =>
      issue.code === "exceedsSalary"
        ? { path: `lines.${index}.recovery`, code: "validation.payroll.exceedsSalary" }
        : {
            path: `lines.${index}.recovery.${issue.bucket}`,
            code:
              issue.code === "negative"
                ? "validation.opening.amount"
                : "validation.payroll.exceedsOwed",
          },
    ),
  );
}

/** Creates or replaces the month's draft run (version-checked). */
export async function savePayrollRun(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
  input: unknown,
  requestKey?: string,
): Promise<PayrollRun> {
  const month = parseMonth(monthInput);
  const request = parseInput(payrollSaveRequestSchema, input);
  const access = await requirePermission(ctx, companyId, "compensation.manage", { write: true });
  if (request.date.slice(0, 7) !== month)
    throw invalid("date", "validation.payroll.dateOutsideMonth");
  const seen = new Set<string>();
  request.lines.forEach((l, index) => {
    if (seen.has(l.staffId))
      throw invalid(`lines.${index}.staffId`, "validation.payroll.duplicateStaff");
    seen.add(l.staffId);
    if (l.recovery && !l.reason)
      throw invalid(`lines.${index}.reason`, "validation.payroll.reasonRequired");
  });

  return runIdempotent(
    ctx,
    { scope: companyId, action: `payroll.save:${month}`, requestKey },
    { month, ...request },
    async (tx) => {
      await postingGuard(tx, companyId, request.date);
      const live = await liveRun(tx, companyId, month);
      if (request.version === 0 ? live : live?.version !== request.version) {
        throw invalid("version", "validation.daily.stale");
      }
      if (live && live.status !== "draft") throw invalid("", "validation.payroll.notDraft");
      const paid = new Set(live?.lines.filter((l) => snapshotOf(l)).map((l) => l.staffId));
      const owed = await owedOn(tx, access, request.date);
      const absent = await absentFees(tx, companyId, month);
      const netOf = (l: { staffId: string; salary: string }) =>
        salaryAfterAbsence(l.salary, absent.get(l.staffId) ?? "0");
      const eligible = new Set((await eligibleStaff(tx, companyId, month)).map((p) => p.id));
      for (const [index, l] of request.lines.entries()) {
        if (paid.has(l.staffId)) continue;
        if (!eligible.has(l.staffId)) {
          throw invalid(`lines.${index}.staffId`, "validation.payroll.notEligible");
        }
        if (l.recovery) {
          const error = recoveryIssues(
            index,
            netOf(l),
            owed.get(l.staffId) ?? ZERO_OWED,
            l.recovery,
          );
          if (error) throw error;
        }
      }
      const lines = request.lines
        .filter((l) => !paid.has(l.staffId))
        .map((l) => {
          const recovery =
            l.recovery ?? proposeRecovery(netOf(l), owed.get(l.staffId) ?? ZERO_OWED);
          return {
            staffId: l.staffId,
            salary: l.salary,
            recoverAdvance: recovery.advance,
            recoverLoan: recovery.loan,
            recoverShortage: recovery.shortage,
            override: l.recovery !== null,
            reason: l.reason,
          };
        });
      let id: string;
      if (live) {
        const updated = await tx.payrollRun.updateMany({
          where: { id: live.id, version: request.version, status: "draft" },
          data: {
            date: toDbDate(request.date),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
        await tx.payrollLine.deleteMany({ where: { runId: live.id, owedAdvance: null } });
        await tx.payrollLine.createMany({ data: lines.map((l) => ({ ...l, runId: live.id })) });
        id = live.id;
      } else {
        const created = await tx.payrollRun.create({
          data: {
            tenantId: access.company.tenantId,
            companyId,
            month,
            date: toDbDate(request.date),
            createdById: ctx.actor.userId,
            lines: { create: lines },
          },
        });
        id = created.id;
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "payroll.save",
        resourceType: "payroll_run",
        resourceId: id,
        after: { month, ...request },
      });
      return viewOf(tx, access, month, await liveRun(tx, companyId, month));
    },
  );
}

const ACTION_PERMISSIONS: Record<PayrollAction, Parameters<typeof requireAll>[1]> = {
  approve: ["compensation.manage", "dsr_due.allocate_to_salary"],
  pay: ["compensation.manage", "payment.post"],
  reverse: ["compensation.manage", "payment.reverse"],
  discard: ["compensation.manage"],
  payStaff: ["compensation.manage", "dsr_due.allocate_to_salary", "payment.post"],
};

/** D75: a draft with every eligible person at the proposed salary, for the first Pay Now. */
async function openDraft(tx: Tx, ctx: AppContext, access: CompanyAccess, month: string) {
  const people = await proposedSalaries(tx, access.company.id, month);
  return tx.payrollRun.create({
    data: {
      tenantId: access.company.tenantId,
      companyId: access.company.id,
      month,
      date: toDbDate(defaultDate(month)),
      createdById: ctx.actor.userId,
      lines: { create: people.map((p) => ({ staffId: p.id, salary: p.salary })) },
    },
    include: runInclude,
  });
}

/** approve | pay | reverse | discard the month's live run, or pay one person now (D75). */
export async function payrollCommand(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
  actionInput: unknown,
  input: unknown,
  requestKey?: string,
): Promise<PayrollRun> {
  const month = parseMonth(monthInput);
  const action = payrollActions.find((a) => a === actionInput);
  if (!action) throw invalid("action", "validation.action");
  const request = parseInput(payrollTransitionRequestSchema, input);
  const access = await requirePermission(ctx, companyId, "compensation.manage", { write: true });
  requireAll(access, ACTION_PERMISSIONS[action]);

  return runIdempotent(
    ctx,
    { scope: companyId, action: `payroll.${action}:${month}`, requestKey },
    { month, ...request },
    async (tx) => {
      const found = await liveRun(tx, companyId, month);
      const fresh = !found && action === "payStaff" && request.version === 0;
      if (found ? found.version !== request.version : !fresh) {
        throw invalid("version", "validation.daily.stale");
      }
      const run = found ?? (await openDraft(tx, ctx, access, month));
      const date = fromDbDate(run.date);
      const bump = async (from: string, data: Prisma.PayrollRunUpdateManyMutationInput) => {
        const updated = await tx.payrollRun.updateMany({
          where: { id: run.id, version: run.version, status: from },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
      };
      const entry = (kind: string, staffId: string, amount: string, onDate: string) => ({
        tenantId: access.company.tenantId,
        companyId,
        date: toDbDate(onDate),
        kind,
        amount,
        staffId,
        payrollRunId: run.id,
        reference: `payroll ${month}`,
        createdById: ctx.actor.userId,
      });
      /** Posts salary − absent and the recovery, and freezes what the person owed. */
      const postSalary = async (
        index: number,
        l: RunRow["lines"][number],
        net: string,
        personOwed: Owed,
        onDate: string,
      ) => {
        const recovery = l.override ? recoveryOf(l) : proposeRecovery(net, personOwed);
        const error = recoveryIssues(index, net, personOwed, recovery);
        if (error) throw error;
        const total = recoveryTotal(recovery);
        if (toDecimal(net).gt(0)) {
          await tx.moneyEntry.create({ data: entry("salaryAccrual", l.staffId, net, onDate) });
        }
        if (toDecimal(total).gt(0)) {
          await tx.moneyEntry.create({
            data: {
              ...entry("salaryRecovery", l.staffId, total, onDate),
              allocAdvance: recovery.advance,
              allocLoan: recovery.loan,
              allocShortage: recovery.shortage,
            },
          });
        }
        await tx.payrollLine.update({
          where: { id: l.id },
          data: {
            recoverAdvance: recovery.advance,
            recoverLoan: recovery.loan,
            recoverShortage: recovery.shortage,
            owedAdvance: personOwed.advance,
            owedLoan: personOwed.loan,
            owedShortage: personOwed.shortage,
          },
        });
        return cashPay(net, recovery);
      };

      if (action === "discard") {
        if (run.status !== "draft") throw invalid("", "validation.payroll.notDraft");
        if (run.lines.some((l) => snapshotOf(l))) throw invalid("", "validation.payroll.hasPaid");
        await tx.payrollRun.delete({ where: { id: run.id } });
        await recordAudit(tx, ctx, {
          companyId,
          action: "payroll.discard",
          resourceType: "payroll_run",
          resourceId: run.id,
          before: { month, status: "draft", version: run.version },
        });
        return viewOf(tx, access, month, null);
      }

      if (action === "approve") {
        if (run.status !== "draft") throw invalid("", "validation.payroll.notDraft");
        await postingGuard(tx, companyId, date);
        const owed = await owedOn(tx, access, date);
        const absent = await absentFees(tx, companyId, month);
        for (const [index, l] of run.lines.entries()) {
          if (snapshotOf(l)) continue;
          const net = salaryAfterAbsence(plain(l.salary), absent.get(l.staffId) ?? "0");
          await postSalary(index, l, net, owed.get(l.staffId) ?? ZERO_OWED, date);
        }
        await bump("draft", {
          status: "approved",
          approvedAt: new Date(),
          approvedById: ctx.actor.userId,
        });
      }

      if (action === "pay") {
        if (run.status !== "approved") throw invalid("", "validation.payroll.notApproved");
        const payDate = request.payDate ?? todayBusinessDate();
        if (payDate < date) throw invalid("payDate", "validation.payroll.payBeforeRun");
        await postingGuard(tx, companyId, payDate);
        const posted = await runPostings(tx, run.id);
        for (const l of run.lines) {
          const done = posted.get(l.staffId);
          if (done?.paid) continue;
          const amount = cashPay(done?.accrual ?? "0", recoveryOf(l));
          if (toDecimal(amount).gt(0)) {
            await tx.moneyEntry.create({ data: entry("salaryPaid", l.staffId, amount, payDate) });
          }
        }
        await bump("approved", {
          status: "paid",
          payDate: toDbDate(payDate),
          paidAt: new Date(),
          paidById: ctx.actor.userId,
        });
      }

      if (action === "payStaff") {
        if (run.status !== "draft") throw invalid("", "validation.payroll.notDraft");
        const index = run.lines.findIndex((l) => l.staffId === request.staffId);
        const l = run.lines[index];
        if (!l) throw invalid("staffId", "validation.payroll.notEligible");
        if (snapshotOf(l)) throw invalid("staffId", "validation.payroll.alreadyPaid");
        const payDate = request.payDate ?? todayBusinessDate();
        if (payDate < firstOfMonth(month)) {
          throw invalid("payDate", "validation.payroll.payBeforeRun");
        }
        const onDate = payDate < lastOfMonth(month) ? payDate : lastOfMonth(month);
        await postingGuard(tx, companyId, onDate);
        if (payDate !== onDate) await postingGuard(tx, companyId, payDate);
        const absent = (await absentFees(tx, companyId, month)).get(l.staffId) ?? "0";
        const net = salaryAfterAbsence(plain(l.salary), absent);
        const owed = (await owedOn(tx, access, onDate)).get(l.staffId) ?? ZERO_OWED;
        const amount = await postSalary(index, l, net, owed, onDate);
        if (toDecimal(amount).gt(0)) {
          await tx.moneyEntry.create({ data: entry("salaryPaid", l.staffId, amount, payDate) });
        }
        const everyone = run.lines.every((other) => other.id === l.id || snapshotOf(other));
        await bump(
          "draft",
          everyone
            ? {
                status: "paid",
                approvedAt: new Date(),
                approvedById: ctx.actor.userId,
                payDate: toDbDate(payDate),
                paidAt: new Date(),
                paidById: ctx.actor.userId,
              }
            : {},
        );
      }

      if (action === "reverse") {
        const paidSome = run.status === "draft" && run.lines.some((l) => snapshotOf(l));
        if (run.status !== "approved" && run.status !== "paid" && !paidSome) {
          throw invalid("", "validation.payroll.notApproved");
        }
        const entries = await tx.moneyEntry.findMany({
          where: { payrollRunId: run.id, status: "posted" },
          select: { id: true, date: true },
        });
        for (const d of new Set(entries.map((e) => fromDbDate(e.date)))) {
          await postingGuard(tx, companyId, d);
        }
        await tx.moneyEntry.updateMany({
          where: { payrollRunId: run.id, status: "posted" },
          data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
        });
        await bump(run.status, {
          status: "reversed",
          reversedAt: new Date(),
          reversedById: ctx.actor.userId,
        });
      }

      await recordAudit(tx, ctx, {
        companyId,
        action: `payroll.${action}`,
        resourceType: "payroll_run",
        resourceId: run.id,
        before: { status: run.status, version: run.version },
        after: { month, ...request },
      });
      const after = await tx.payrollRun.findUniqueOrThrow({
        where: { id: run.id },
        include: runInclude,
      });
      return viewOf(tx, access, month, after.status === "reversed" ? null : after);
    },
  );
}
