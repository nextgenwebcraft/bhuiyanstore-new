import { todayBusinessDate } from "@bsd/domain";
import {
  staffAssignmentRequestSchema,
  staffCreateRequestSchema,
  staffMemberSchema,
  staffRecordSchema,
  staffUpsertRequestSchema,
  type StaffEmployer,
  type StaffMember,
  type StaffRecord,
  type StaffRoleKind,
} from "@bsd/contracts";
import { requirePermission, requireSuperAdmin } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";

const withAssignments = {
  assignments: { include: { role: true }, orderBy: { from: "asc" } },
  user: { select: { email: true } },
} as const;

type AssignmentRow = {
  id: string;
  companyId: string;
  roleId: string;
  from: Date;
  to: Date | null;
  monthlySalary: Parameters<typeof plain>[0] | null;
  role: { name: string; kind: string };
};

type StaffRow = {
  id: string;
  name: string;
  employer: string;
  status: string;
  assignments: AssignmentRow[];
  user: { email: string } | null;
};

/** Companies whose staff assignments the actor may see (anti-enumeration, like COMPANY_NOT_FOUND). */
async function visibleCompanyIds(ctx: AppContext): Promise<Set<string>> {
  if (ctx.actor.isSuperAdmin) {
    const companies = await ctx.db.company.findMany({
      where: { tenantId: ctx.actor.tenantId },
      select: { id: true },
    });
    return new Set(companies.map((c) => c.id));
  }
  const memberships = await ctx.db.membership.findMany({
    where: { userId: ctx.actor.userId, company: { tenantId: ctx.actor.tenantId } },
    select: { companyId: true },
  });
  return new Set(memberships.map((m) => m.companyId));
}

function toRecord(row: StaffRow, visible: Set<string>): StaffRecord {
  return staffRecordSchema.parse({
    id: row.id,
    name: row.name,
    employer: row.employer,
    status: row.status,
    loginEmail: row.user?.email ?? null,
    assignments: row.assignments
      .filter((a) => visible.has(a.companyId))
      .map((a) => ({
        id: a.id,
        companyId: a.companyId,
        roleId: a.roleId,
        roleName: a.role.name,
        roleKind: a.role.kind,
        from: fromDbDate(a.from),
        to: a.to ? fromDbDate(a.to) : null,
        monthlySalary: a.monthlySalary === null ? null : plain(a.monthlySalary),
      })),
  });
}

function coversDate(a: { from: Date; to: Date | null }, businessDate: string): boolean {
  return fromDbDate(a.from) <= businessDate && (a.to === null || fromDbDate(a.to) >= businessDate);
}

/** SRs are supplier-employed (D02, D18); DSRs are distributor-employed and take custody (D23). */
function employerMismatch(kind: string, employer: StaffEmployer): boolean {
  return (
    (kind === "sr" && employer !== "supplier") || (kind === "dsr" && employer !== "distributor")
  );
}

async function activeRole(tx: Tx, ctx: AppContext, roleId: string, path: string) {
  const role = await tx.staffRole.findFirst({
    where: { id: roleId, tenantId: ctx.actor.tenantId, active: true },
  });
  if (!role) throw invalid(path, "validation.staffRole.unknown");
  return role;
}

type Period = { from: string; to: string | null };

function checkPeriod(period: Period, pathPrefix: string): void {
  if (period.to !== null && period.to < period.from) {
    throw invalid(`${pathPrefix}to`, "validation.period.endBeforeStart");
  }
}

/** One role per company at a time: periods of the same person in a company never overlap. */
async function checkNoOverlap(
  tx: Tx,
  staffId: string,
  companyId: string,
  period: Period,
  exceptId: string | undefined,
  pathPrefix: string,
): Promise<void> {
  const others = await tx.staffAssignment.findMany({
    where: { staffId, companyId, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  const end = period.to ?? "9999-12-31";
  const overlaps = others.some(
    (a) => fromDbDate(a.from) <= end && (a.to === null || fromDbDate(a.to) >= period.from),
  );
  if (overlaps) throw invalid(`${pathPrefix}from`, "validation.staffAssignment.overlap");
}

async function loadStaff(tx: Tx, ctx: AppContext, staffId: string) {
  const staff = await tx.staff.findFirst({
    where: { id: staffId, tenantId: ctx.actor.tenantId },
    include: withAssignments,
  });
  if (!staff) throw invalid("id", "validation.staff.unknown");
  return staff;
}

/** The person must work (or have worked) for this company, so other companies' staff stay hidden. */
async function loadCompanyStaff(tx: Tx, ctx: AppContext, companyId: string, staffId: string) {
  const staff = await loadStaff(tx, ctx, staffId);
  if (!staff.assignments.some((a) => a.companyId === companyId)) {
    throw invalid("id", "validation.staff.unknown");
  }
  return staff;
}

export async function listStaffRecords(ctx: AppContext, companyId: string): Promise<StaffRecord[]> {
  await requirePermission(ctx, companyId, "company.view");
  const [rows, visible] = await Promise.all([
    ctx.db.staff.findMany({
      where: { tenantId: ctx.actor.tenantId, assignments: { some: { companyId } } },
      include: withAssignments,
      orderBy: { name: "asc" },
    }),
    visibleCompanyIds(ctx),
  ]);
  return rows.map((row) => toRecord(row, visible));
}

export async function getStaffRecord(
  ctx: AppContext,
  companyId: string,
  staffId: string,
): Promise<StaffRecord> {
  await requirePermission(ctx, companyId, "company.view");
  const [row, visible] = await Promise.all([
    loadCompanyStaff(ctx.db, ctx, companyId, staffId),
    visibleCompanyIds(ctx),
  ]);
  return toRecord(row, visible);
}

/** Every person of the tenant, so a DSR can be assigned to a second brand (D09). Super-admin only. */
export async function listAllStaff(ctx: AppContext): Promise<StaffRecord[]> {
  requireSuperAdmin(ctx);
  const [rows, visible] = await Promise.all([
    ctx.db.staff.findMany({
      where: { tenantId: ctx.actor.tenantId },
      include: withAssignments,
      orderBy: { name: "asc" },
    }),
    visibleCompanyIds(ctx),
  ]);
  return rows.map((row) => toRecord(row, visible));
}

/**
 * Active people working for the company today, as entry screens need them: `kind` is their
 * current role kind here, `companyIds` the visible companies they currently work for.
 */
export async function listStaffMembers(ctx: AppContext, companyId: string): Promise<StaffMember[]> {
  await requirePermission(ctx, companyId, "company.view");
  const today = todayBusinessDate();
  const [rows, visible] = await Promise.all([
    ctx.db.staff.findMany({
      where: {
        tenantId: ctx.actor.tenantId,
        status: "active",
        assignments: { some: { companyId } },
      },
      include: withAssignments,
      orderBy: { name: "asc" },
    }),
    visibleCompanyIds(ctx),
  ]);
  const members: StaffMember[] = [];
  for (const row of rows) {
    const current = row.assignments.filter((a) => coversDate(a, today));
    const here = current.find((a) => a.companyId === companyId);
    if (!here) continue;
    members.push(
      staffMemberSchema.parse({
        id: row.id,
        name: row.name,
        kind: here.role.kind as StaffRoleKind,
        companyIds: [...new Set(current.map((a) => a.companyId).filter((id) => visible.has(id)))],
      }),
    );
  }
  return members;
}

export async function createStaff(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<StaffRecord> {
  await requirePermission(ctx, companyId, "staff.manage", { write: true });
  const data = parseInput(staffCreateRequestSchema, input);
  checkPeriod(data.assignment, "assignment.");
  const visible = await visibleCompanyIds(ctx);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "staff.create", requestKey },
    data,
    async (tx) => {
      const role = await activeRole(tx, ctx, data.assignment.roleId, "assignment.roleId");
      if (employerMismatch(role.kind, data.employer)) {
        throw invalid("employer", "validation.staff.employerRole");
      }
      if (role.kind === "sr" && data.assignment.monthlySalary !== null) {
        throw invalid("assignment.monthlySalary", "validation.staff.srSalary");
      }
      const created = await tx.staff.create({
        data: {
          tenantId: ctx.actor.tenantId,
          name: data.name,
          employer: data.employer,
          status: data.status,
          assignments: {
            create: {
              companyId,
              roleId: role.id,
              from: toDbDate(data.assignment.from),
              to: data.assignment.to ? toDbDate(data.assignment.to) : null,
              monthlySalary: data.assignment.monthlySalary,
            },
          },
        },
        include: withAssignments,
      });
      const record = toRecord(created, visible);
      await recordAudit(tx, ctx, {
        companyId,
        action: "staff.create",
        resourceType: "staff",
        resourceId: record.id,
        after: record,
      });
      return record;
    },
  );
}

/** Full replace of the person's own fields; assignments change through their own commands. */
export async function updateStaff(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  input: unknown,
  requestKey?: string,
): Promise<StaffRecord> {
  await requirePermission(ctx, companyId, "staff.manage", { write: true });
  const data = parseInput(staffUpsertRequestSchema, input);
  const visible = await visibleCompanyIds(ctx);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `staff.update:${staffId}`, requestKey },
    data,
    async (tx) => {
      const before = await loadCompanyStaff(tx, ctx, companyId, staffId);
      if (before.assignments.some((a) => employerMismatch(a.role.kind, data.employer))) {
        throw invalid("employer", "validation.staff.employerRole");
      }
      const updated = await tx.staff.update({
        where: { id: staffId },
        data: {
          name: data.name,
          employer: data.employer,
          status: data.status,
        },
        include: withAssignments,
      });
      const record = toRecord(updated, visible);
      await recordAudit(tx, ctx, {
        companyId,
        action: "staff.update",
        resourceType: "staff",
        resourceId: staffId,
        before: toRecord(before, visible),
        after: record,
      });
      return record;
    },
  );
}

async function writeAssignment(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  assignmentId: string | undefined,
  input: unknown,
  requestKey: string | undefined,
): Promise<StaffRecord> {
  await requirePermission(ctx, companyId, "staff.manage", { write: true });
  const data = parseInput(staffAssignmentRequestSchema, input);
  checkPeriod(data, "");
  const visible = await visibleCompanyIds(ctx);
  const action = assignmentId
    ? `staff.assignment_update:${assignmentId}`
    : `staff.assign:${staffId}`;
  return runIdempotent(ctx, { scope: companyId, action, requestKey }, data, async (tx) => {
    const staff = assignmentId
      ? await loadCompanyStaff(tx, ctx, companyId, staffId)
      : await loadStaff(tx, ctx, staffId);
    if (
      assignmentId &&
      !staff.assignments.some((a) => a.id === assignmentId && a.companyId === companyId)
    ) {
      throw invalid("id", "validation.staffAssignment.unknown");
    }
    const role = await activeRole(tx, ctx, data.roleId, "roleId");
    if (employerMismatch(role.kind, staff.employer as StaffEmployer)) {
      throw invalid("roleId", "validation.staff.employerRole");
    }
    if (role.kind === "sr" && data.monthlySalary !== null) {
      throw invalid("monthlySalary", "validation.staff.srSalary");
    }
    await checkNoOverlap(tx, staffId, companyId, data, assignmentId, "");
    const values = {
      roleId: role.id,
      from: toDbDate(data.from),
      to: data.to ? toDbDate(data.to) : null,
      monthlySalary: data.monthlySalary,
    };
    if (assignmentId) {
      await tx.staffAssignment.update({ where: { id: assignmentId }, data: values });
    } else {
      await tx.staffAssignment.create({ data: { ...values, staffId, companyId } });
    }
    const record = toRecord(await loadStaff(tx, ctx, staffId), visible);
    await recordAudit(tx, ctx, {
      companyId,
      action: assignmentId ? "staff.assignment_update" : "staff.assign",
      resourceType: "staff",
      resourceId: staffId,
      before: toRecord(staff, visible),
      after: record,
    });
    return record;
  });
}

/** Assigns any person of the tenant to this company (one DSR may serve several brands, D09). */
export function addStaffAssignment(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  input: unknown,
  requestKey?: string,
): Promise<StaffRecord> {
  return writeAssignment(ctx, companyId, staffId, undefined, input, requestKey);
}

/** Changes role or period of an assignment in this company, e.g. sets the end date. */
export function updateStaffAssignment(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  assignmentId: string,
  input: unknown,
  requestKey?: string,
): Promise<StaffRecord> {
  return writeAssignment(ctx, companyId, staffId, assignmentId, input, requestKey);
}
