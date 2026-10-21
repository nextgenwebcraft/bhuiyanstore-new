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
 * Distributor employees (not SR) assigned to the company on some day of the month, with the
 * latest assignment's monthly salary as the payroll default (salary master).
 */
async function eligibleStaff(db: Db, companyId: string, month: string) {
  const from = toDbDate(firstOfMonth(month));
  const to = toDbDate(lastOfMonth(month));
  const assignments = await db.staffAssignment.findMany({
    where: {
      companyId,
      from: { lte: to },
      OR: [{ to: null }, { to: { gte: from } }],
      role: { kind: { not: "sr" } },
      staff: { employer: "distributor" },
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

function line(input: {
  staffId: string;
  staffName: string;
  roleName: string;
  salary: string;
  owed: Owed;
  recovery: Owed;
  reason: string;
}) {
  return {
    ...input,
    proposed: proposeRecovery(input.salary, input.owed),
    recoveryTotal: recoveryTotal(input.recovery),
    cashPay: cashPay(input.salary, input.recovery),
  };
}

function totalsOf(lines: ReturnType<typeof line>[]) {
  return {
    salary: sumAmounts(lines.map((l) => l.salary)),
    recovery: sumAmounts(lines.map((l) => l.recoveryTotal)),
    cashPay: sumAmounts(lines.map((l) => l.cashPay)),
  };
}

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

  let lines: ReturnType<typeof line>[];
  if (row) {
    lines = row.lines.map((l) => {
      const snapshot: Owed | null =
        l.owedAdvance && l.owedLoan && l.owedShortage
          ? {
              advance: plain(l.owedAdvance),
              loan: plain(l.owedLoan),
              shortage: plain(l.owedShortage),
            }
          : null;
      const personOwed = snapshot ?? owed.get(l.staffId) ?? ZERO_OWED;
      const salary = plain(l.salary);
      const roleName = l.staff.assignments.find((a) => a.companyId === access.company.id)?.role
        .name;
      return line({
        staffId: l.staffId,
        staffName: l.staff.name,
        roleName: roleName ?? "",
        salary,
        owed: personOwed,
        recovery: live && !l.override ? proposeRecovery(salary, personOwed) : recoveryOf(l),
        reason: l.reason,
      });
    });
  } else {
    const previous = await db.payrollLine.findMany({
      where: {
        run: { companyId: access.company.id, status: { not: "reversed" }, month: { lt: month } },
      },
      orderBy: { run: { month: "desc" } },
      select: { staffId: true, salary: true },
    });
    const lastSalary = new Map<string, string>();
    for (const p of previous)
      if (!lastSalary.has(p.staffId)) lastSalary.set(p.staffId, plain(p.salary));
    lines = (await eligibleStaff(db, access.company.id, month)).map((p) => {
      const salary = p.monthlySalary ?? lastSalary.get(p.id) ?? "0";
      const personOwed = owed.get(p.id) ?? ZERO_OWED;
      return line({
        staffId: p.id,
        staffName: p.name,
        roleName: p.roleName,
        salary,
        owed: personOwed,
        recovery: proposeRecovery(salary, personOwed),
        reason: "",
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
      const owed = await owedOn(tx, access, request.date);
      const eligible = new Set((await eligibleStaff(tx, companyId, month)).map((p) => p.id));
      for (const [index, l] of request.lines.entries()) {
        if (!eligible.has(l.staffId)) {
          throw invalid(`lines.${index}.staffId`, "validation.payroll.notEligible");
        }
        if (l.recovery) {
          const error = recoveryIssues(
            index,
            l.salary,
            owed.get(l.staffId) ?? ZERO_OWED,
            l.recovery,
          );
          if (error) throw error;
        }
      }
      const lines = request.lines.map((l) => {
        const recovery = l.recovery ?? proposeRecovery(l.salary, owed.get(l.staffId) ?? ZERO_OWED);
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
        await tx.payrollLine.deleteMany({ where: { runId: live.id } });
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
};

/** approve | pay | reverse | discard the month's live run. */
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
      const run = await liveRun(tx, companyId, month);
      if (!run || run.version !== request.version)
        throw invalid("version", "validation.daily.stale");
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

      if (action === "discard") {
        if (run.status !== "draft") throw invalid("", "validation.payroll.notDraft");
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
        for (const [index, l] of run.lines.entries()) {
          const salary = plain(l.salary);
          const personOwed = owed.get(l.staffId) ?? ZERO_OWED;
          const recovery = l.override ? recoveryOf(l) : proposeRecovery(salary, personOwed);
          const error = recoveryIssues(index, salary, personOwed, recovery);
          if (error) throw error;
          const total = recoveryTotal(recovery);
          if (toDecimal(salary).gt(0)) {
            await tx.moneyEntry.create({ data: entry("salaryAccrual", l.staffId, salary, date) });
          }
          if (toDecimal(total).gt(0)) {
            await tx.moneyEntry.create({
              data: {
                ...entry("salaryRecovery", l.staffId, total, date),
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
        for (const l of run.lines) {
          const amount = cashPay(plain(l.salary), recoveryOf(l));
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

      if (action === "reverse") {
        if (run.status !== "approved" && run.status !== "paid") {
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
