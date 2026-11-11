import { todayBusinessDate } from "@bsd/domain";
import {
  staffAssignmentRequestSchema,
  masterPanelHireRole,
  staffCreateRequestSchema,
  staffDeleteImpactSchema,
  staffMemberSchema,
  staffRecordSchema,
  staffUpsertRequestSchema,
  type StaffDeleteImpact,
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
import { isForeignKeyViolation, runIdempotent } from "./idempotency";
import { masterCompanyId, staffCompanyIds } from "./master";
import { plain } from "./numeric";

const withAssignments = {
  assignments: { include: { role: true }, orderBy: { from: "asc" } },
  user: {
    select: {
      email: true,
      active: true,
      memberships: { include: { roles: { include: { role: true } } } },
    },
  },
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
  phone: string | null;
  status: string;
  companyId: string;
  assignments: AssignmentRow[];
  user: {
    email: string;
    active: boolean;
    memberships: { companyId: string; roles: { role: { kind: string | null } }[] }[];
  } | null;
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

/**
 * Membership companies plus the staff scope of the company being listed (D65): an operating
 * company's Managers must see master assignments so global DSRs keep `roleKind: "dsr"` in the
 * record (shop-due DSR pick, field day, etc.). Other companies stay hidden.
 */
function assignmentCompanyIds(visible: Set<string>, staffScope: readonly string[]): Set<string> {
  const scope = new Set(visible);
  for (const id of staffScope) scope.add(id);
  return scope;
}

function loginRoleKindOf(user: StaffRow["user"]): "manager" | "dsr" | "tsm" | null {
  if (!user) return null;
  for (const m of user.memberships) {
    for (const r of m.roles) {
      if (r.role.kind === "manager" || r.role.kind === "dsr" || r.role.kind === "tsm") {
        return r.role.kind;
      }
    }
  }
  return null;
}

function toRecord(row: StaffRow, visible: Set<string>): StaffRecord {
  return staffRecordSchema.parse({
    id: row.id,
    name: row.name,
    employer: row.employer,
    phone: row.phone ?? "",
    status: row.status,
    loginEmail: row.user?.email ?? null,
    loginRoleKind: loginRoleKindOf(row.user),
    loginActive: row.user ? row.user.active : null,
    loginCompanyIds: row.user
      ? [...new Set(row.user.memberships.map((m) => m.companyId))].sort()
      : [],
    companyId: row.companyId,
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

/**
 * The person must work (or have worked) for this company or be global staff (D65), so other
 * companies' SRs stay hidden.
 */
async function loadCompanyStaff(tx: Tx, ctx: AppContext, companyId: string, staffId: string) {
  const staff = await loadStaff(tx, ctx, staffId);
  const companyIds = await staffCompanyIds(tx, companyId);
  if (!staff.assignments.some((a) => companyIds.includes(a.companyId))) {
    throw invalid("id", "validation.staff.unknown");
  }
  return staff;
}

/**
 * D65: the master company takes global (non-SR) staff only; once a tenant has its master, a
 * company takes SRs only.
 */
async function checkRoleScope(tx: Tx, companyId: string, kind: string, path: string) {
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { isMaster: true, tenantId: true },
  });
  if (!company) return;
  if (company.isMaster && kind === "sr") throw invalid(path, "validation.staff.masterNoSr");
  if (!company.isMaster && kind !== "sr" && (await masterCompanyId(tx, company.tenantId))) {
    throw invalid(path, "validation.staff.globalOnly");
  }
}

export async function listStaffRecords(ctx: AppContext, companyId: string): Promise<StaffRecord[]> {
  await requirePermission(ctx, companyId, "company.view");
  const companyIds = await staffCompanyIds(ctx.db, companyId);
  const [rows, visible] = await Promise.all([
    ctx.db.staff.findMany({
      where: {
        tenantId: ctx.actor.tenantId,
        assignments: { some: { companyId: { in: companyIds } } },
      },
      include: withAssignments,
      orderBy: { name: "asc" },
    }),
    visibleCompanyIds(ctx),
  ]);
  const scope = assignmentCompanyIds(visible, companyIds);
  return rows.map((row) => toRecord(row, scope));
}

export async function getStaffRecord(
  ctx: AppContext,
  companyId: string,
  staffId: string,
): Promise<StaffRecord> {
  await requirePermission(ctx, companyId, "company.view");
  const companyIds = await staffCompanyIds(ctx.db, companyId);
  const [row, visible] = await Promise.all([
    loadCompanyStaff(ctx.db, ctx, companyId, staffId),
    visibleCompanyIds(ctx),
  ]);
  return toRecord(row, assignmentCompanyIds(visible, companyIds));
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
  const companyIds = await staffCompanyIds(ctx.db, companyId);
  const [rows, visible] = await Promise.all([
    ctx.db.staff.findMany({
      where: {
        tenantId: ctx.actor.tenantId,
        status: "active",
        assignments: { some: { companyId: { in: companyIds } } },
      },
      include: withAssignments,
      orderBy: { name: "asc" },
    }),
    visibleCompanyIds(ctx),
  ]);
  const members: StaffMember[] = [];
  for (const row of rows) {
    const current = row.assignments.filter((a) => coversDate(a, today));
    const here =
      current.find((a) => a.companyId === companyId) ??
      current.find((a) => companyIds.includes(a.companyId));
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
  const company = await ctx.db.company.findUnique({
    where: { id: companyId },
    select: { isMaster: true },
  });
  // D80: the master panel's start date is the day the person is entered, and the role stays open.
  const assignment = company?.isMaster
    ? { ...data.assignment, from: todayBusinessDate(), to: null }
    : data.assignment;
  checkPeriod(assignment, "assignment.");
  const visible = await visibleCompanyIds(ctx);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "staff.create", requestKey },
    data,
    async (tx) => {
      const role = await activeRole(tx, ctx, assignment.roleId, "assignment.roleId");
      await checkRoleScope(tx, companyId, role.kind, "assignment.roleId");
      if (company?.isMaster && !masterPanelHireRole(role)) {
        throw invalid("assignment.roleId", "validation.staff.masterRoles");
      }
      // D80: master-panel hires are always distributor-employed.
      const employer = company?.isMaster ? "distributor" : data.employer;
      if (employerMismatch(role.kind, employer)) {
        throw invalid("employer", "validation.staff.employerRole");
      }
      if (role.kind === "sr" && assignment.monthlySalary !== null) {
        throw invalid("assignment.monthlySalary", "validation.staff.srSalary");
      }
      // D93: the home company must be a real (non-master) company of this tenant.
      const home = await tx.company.findFirst({
        where: { id: data.companyId, tenantId: ctx.actor.tenantId, isMaster: false },
      });
      if (!home) throw invalid("companyId", "validation.company.unknown");
      const created = await tx.staff.create({
        data: {
          tenantId: ctx.actor.tenantId,
          name: data.name,
          employer,
          phone: data.phone?.trim() || null,
          status: data.status,
          companyId: data.companyId,
          assignments: {
            create: {
              companyId,
              roleId: role.id,
              from: toDbDate(assignment.from),
              to: assignment.to ? toDbDate(assignment.to) : null,
              monthlySalary: assignment.monthlySalary,
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

/**
 * An SR is deleted/edited from their own company, never from the master panel (D80, D110).
 * Role kind is the gate: employer alone is not enough — a mis-tagged আমাদের স্টাফ
 * hire (supplier + manager/DSR) must still be removable here; real SRs always have
 * an `sr` assignment (D02).
 */
function isSr(staff: { assignments: readonly { role: { kind: string } }[] }) {
  return staff.assignments.some((a) => a.role.kind === "sr");
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
      const acting = await tx.company.findUnique({
        where: { id: companyId },
        select: { isMaster: true },
      });
      // D110: the master panel may edit any non-SR person of the tenant.
      const before = acting?.isMaster
        ? await loadStaff(tx, ctx, staffId)
        : await loadCompanyStaff(tx, ctx, companyId, staffId);
      if (acting?.isMaster && isSr(before)) throw invalid("id", "validation.staff.unknown");
      // D80: master-panel people stay distributor-employed.
      const employer = acting?.isMaster ? "distributor" : data.employer;
      if (before.assignments.some((a) => employerMismatch(a.role.kind, employer))) {
        throw invalid("employer", "validation.staff.employerRole");
      }
      // D65/D79: supplier-employed people are company SRs — refuse a supplier tag while a
      // non-SR (master manager/DSR) assignment still exists.
      if (employer === "supplier" && before.assignments.some((a) => a.role.kind !== "sr")) {
        throw invalid("employer", "validation.staff.employerRole");
      }
      if (data.companyId !== before.companyId) {
        // D93: the home company must be a real (non-master) company of this tenant.
        const home = await tx.company.findFirst({
          where: { id: data.companyId, tenantId: ctx.actor.tenantId, isMaster: false },
        });
        if (!home) throw invalid("companyId", "validation.company.unknown");
      }
      const updated = await tx.staff.update({
        where: { id: staffId },
        data: {
          name: data.name,
          employer,
          status: data.status,
          companyId: data.companyId,
          ...(data.phone === undefined ? {} : { phone: data.phone.trim() || null }),
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
    await checkRoleScope(tx, companyId, role.kind, "roleId");
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { isMaster: true },
    });
    const keepingRole =
      assignmentId !== undefined &&
      staff.assignments.some((a) => a.id === assignmentId && a.roleId === role.id);
    if (company?.isMaster && !keepingRole && !masterPanelHireRole(role)) {
      throw invalid("roleId", "validation.staff.masterRoles");
    }
    // D65/D80: supplier-employed people belong on এসআর হিসাব, never on the master panel.
    if (company?.isMaster && staff.employer === "supplier") {
      throw invalid("roleId", "validation.staff.masterNoSr");
    }
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

/** Counts every hishab row that will go with the person (D116). */
async function countStaffImpact(tx: Tx, staffId: string) {
  const days = await tx.dsrDay.findMany({ where: { staffId }, select: { id: true } });
  const dayIds = days.map((d) => d.id);
  const damageWhere =
    dayIds.length > 0
      ? { OR: [{ staffId }, { dsrDayId: { in: dayIds } }] }
      : { staffId };
  const moneyWhere =
    dayIds.length > 0
      ? { OR: [{ staffId }, { dsrDayId: { in: dayIds } }] }
      : { staffId };
  const [moneyEntries, openingBalances, payrollLines, fieldVisits, fieldReports, damageCases, shopsAdded, staff] =
    await Promise.all([
      tx.moneyEntry.count({ where: moneyWhere }),
      tx.openingBalanceLine.count({ where: { staffId } }),
      tx.payrollLine.count({ where: { staffId } }),
      tx.fieldVisit.count({ where: { staffId } }),
      tx.fieldDayReport.count({ where: { staffId } }),
      tx.damageCase.count({ where: damageWhere }),
      tx.shop.count({ where: { addedByStaffId: staffId } }),
      tx.staff.findUnique({ where: { id: staffId }, select: { userId: true } }),
    ]);
  return {
    moneyEntries,
    openingBalances,
    payrollLines,
    dsrDays: days.length,
    fieldVisits,
    fieldReports,
    damageCases,
    shopsAdded,
    hasLogin: staff?.userId != null,
  };
}

/**
 * D116: wipe every posted fact tied to this person so the month engine recalculates without
 * them (money, opening, payroll lines, day sheets, field visits/reports, damage cases). Shop
 * "added by" is cleared; a linked login is unlinked (the User row stays).
 */
async function wipeStaffHistory(tx: Tx, staffId: string) {
  const days = await tx.dsrDay.findMany({ where: { staffId }, select: { id: true } });
  const dayIds = days.map((d) => d.id);
  const caseWhere =
    dayIds.length > 0
      ? { OR: [{ staffId }, { dsrDayId: { in: dayIds } }] }
      : { staffId };
  const cases = await tx.damageCase.findMany({ where: caseWhere, select: { id: true } });
  const caseIds = cases.map((c) => c.id);
  if (caseIds.length > 0) {
    await tx.damageEvent.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.damageCase.deleteMany({ where: { id: { in: caseIds } } });
  }
  const moneyWhere =
    dayIds.length > 0
      ? { OR: [{ staffId }, { dsrDayId: { in: dayIds } }] }
      : { staffId };
  await tx.moneyEntry.deleteMany({ where: moneyWhere });
  await tx.fieldVisit.deleteMany({ where: { staffId } });
  await tx.fieldDayReport.deleteMany({ where: { staffId } });
  await tx.dsrDay.deleteMany({ where: { staffId } });
  await tx.payrollLine.deleteMany({ where: { staffId } });
  await tx.openingBalanceLine.deleteMany({ where: { staffId } });
  await tx.shop.updateMany({ where: { addedByStaffId: staffId }, data: { addedByStaffId: null } });
  await tx.staff.update({ where: { id: staffId }, data: { userId: null } });
}

/** Preview for the delete confirm dialog (D116). */
export async function getStaffDeleteImpact(
  ctx: AppContext,
  companyId: string,
  staffId: string,
): Promise<StaffDeleteImpact> {
  await requirePermission(ctx, companyId, "staff.manage");
  const acting = await ctx.db.company.findUnique({
    where: { id: companyId },
    select: { isMaster: true },
  });
  const before = acting?.isMaster
    ? await loadStaff(ctx.db, ctx, staffId)
    : await loadCompanyStaff(ctx.db, ctx, companyId, staffId);
  if (acting?.isMaster && isSr(before)) throw invalid("id", "validation.staff.unknown");
  const counts = await countStaffImpact(ctx.db, staffId);
  return staffDeleteImpactSchema.parse({
    staffId,
    staffName: before.name,
    ...counts,
  });
}

/**
 * Hard delete of a person (D116, amends D51/D110): related hishab and day sheets are wiped in
 * the same transaction so balances and stock recalculate without them. An SR is still deleted
 * only from their company, never from the master panel (D80).
 */
export async function deleteStaff(
  ctx: AppContext,
  companyId: string,
  staffId: string,
): Promise<void> {
  await requirePermission(ctx, companyId, "staff.manage", { write: true });
  const visible = await visibleCompanyIds(ctx);
  try {
    await ctx.db.$transaction(async (tx) => {
      const acting = await tx.company.findUnique({
        where: { id: companyId },
        select: { isMaster: true },
      });
      const before = acting?.isMaster
        ? await loadStaff(tx, ctx, staffId)
        : await loadCompanyStaff(tx, ctx, companyId, staffId);
      if (acting?.isMaster && isSr(before)) throw invalid("id", "validation.staff.unknown");
      const impact = await countStaffImpact(tx, staffId);
      await wipeStaffHistory(tx, staffId);
      await tx.staff.delete({ where: { id: staffId } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "staff.delete",
        resourceType: "staff",
        resourceId: staffId,
        before: { ...toRecord(before, visible), impact },
      });
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw invalid("id", "validation.staff.inUse");
    throw error;
  }
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
