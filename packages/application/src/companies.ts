import { todayBusinessDate } from "@bsd/domain";
import {
  companySchema,
  companyCreateRequestSchema,
  companyUpsertRequestSchema,
  companyWorkspaceSchema,
  type Company,
  type CompanyWorkspace,
} from "@bsd/contracts";
import {
  loadCompanyAccess,
  requirePermission,
  requireSuperAdmin,
  requireSuperAdminView,
  type CompanyAccess,
} from "./access";
import { ensureMasterCompany } from "./master";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { AppError, invalid, parseInput } from "./errors";
import { isForeignKeyViolation, isUniqueViolation, runIdempotent } from "./idempotency";
import { runLedger } from "./ledger";
import { applyStarterDataset } from "./starter-dataset";

function toCompany(company: CompanyAccess["company"]): Company {
  return companySchema.parse({
    id: company.id,
    legalEntityId: company.legalEntityId,
    name: company.name,
    theme: {
      primary: company.themePrimary,
      primaryForeground: company.themePrimaryForeground,
      ...(company.themeAccent ? { accent: company.themeAccent } : {}),
      ...(company.logoRef ? { logoRef: company.logoRef } : {}),
    },
    modules: company.modules.map((m) => m.module).sort(),
    blockNegativeStock: company.blockNegativeStock,
    isMaster: company.isMaster,
  });
}

/** The block can only start from a godown with no product below zero today. */
async function ensureNoNegativeStock(tx: Tx, access: CompanyAccess): Promise<void> {
  const today = todayBusinessDate();
  const run = await runLedger(tx, access, today);
  if (!run) return;
  const negative = Object.entries(run.output.closing.products).filter(([, p]) =>
    String(p.stock).startsWith("-"),
  );
  if (negative.length === 0) return;
  const names = await tx.product.findMany({
    where: { id: { in: negative.map(([id]) => id) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  throw new AppError(
    "INSUFFICIENT_STOCK",
    [{ path: "blockNegativeStock", code: "validation.company.negativeStockNow" }],
    false,
    negative.map(([productId, p]) => ({
      productId,
      productName: nameOf.get(productId) ?? "",
      date: today,
      stock: String(p.stock),
    })),
  );
}

function toWorkspace(ctx: AppContext, access: CompanyAccess): CompanyWorkspace {
  return companyWorkspaceSchema.parse({
    company: toCompany(access.company),
    permissions: access.permissions,
    allModules: ctx.actor.isSuperAdmin,
  });
}

const duplicateName = () =>
  new AppError("VALIDATION_FAILED", [{ path: "name", code: "validation.company.duplicateName" }]);

/**
 * Active companies the actor can enter; a super-admin sees every company of the tenant. The
 * master company is not listed (D66): it opens through `getMasterWorkspace`.
 */
export async function listWorkspaces(ctx: AppContext): Promise<CompanyWorkspace[]> {
  const companies = await ctx.db.company.findMany({
    where: {
      tenantId: ctx.actor.tenantId,
      status: "active",
      isMaster: false,
      ...(ctx.actor.isSuperAdmin ? {} : { memberships: { some: { userId: ctx.actor.userId } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  const workspaces: CompanyWorkspace[] = [];
  for (const { id } of companies) {
    workspaces.push(toWorkspace(ctx, await loadCompanyAccess(ctx, id)));
  }
  return workspaces;
}

export async function getWorkspace(ctx: AppContext, companyId: string): Promise<CompanyWorkspace> {
  return toWorkspace(ctx, await loadCompanyAccess(ctx, companyId));
}

/** The master panel (D66), created on first open; super-admin only. */
export async function getMasterWorkspace(ctx: AppContext): Promise<CompanyWorkspace> {
  requireSuperAdminView(ctx);
  const companyId = await ensureMasterCompany(ctx.db, ctx.actor.tenantId);
  return getWorkspace(ctx, companyId);
}

/** Super-admin only: companies are tenant-level configuration (D28, guide §4.4). */
export async function createCompany(
  ctx: AppContext,
  input: unknown,
  requestKey?: string,
): Promise<CompanyWorkspace> {
  requireSuperAdmin(ctx);
  const { starterData, ...data } = parseInput(companyCreateRequestSchema, input);
  try {
    const companyId = await runIdempotent(
      ctx,
      { scope: "tenant", action: "company.create", requestKey },
      { ...data, starterData },
      async (tx) => {
        if (
          await tx.company.findFirst({ where: { tenantId: ctx.actor.tenantId, name: data.name } })
        ) {
          throw duplicateName();
        }
        const legalEntity = await tx.legalEntity.findFirst({
          where: { tenantId: ctx.actor.tenantId },
          orderBy: { createdAt: "asc" },
        });
        if (!legalEntity) throw new AppError("INTERNAL");
        const company = await tx.company.create({
          data: {
            tenantId: ctx.actor.tenantId,
            legalEntityId: legalEntity.id,
            name: data.name,
            blockNegativeStock: data.blockNegativeStock,
            themePrimary: data.theme.primary,
            themePrimaryForeground: data.theme.primaryForeground,
            themeAccent: data.theme.accent ?? null,
            logoRef: data.theme.logoRef ?? null,
            modules: { create: [...new Set(data.modules)].map((module) => ({ module })) },
          },
        });
        await recordAudit(tx, ctx, {
          companyId: company.id,
          action: "company.create",
          resourceType: "company",
          resourceId: company.id,
          after: { ...data, starterData },
        });
        // D51: sample masters in the same transaction, so a failure leaves no half-seeded company.
        if (starterData) await applyStarterDataset(tx, ctx, company);
        return company.id;
      },
    );
    return getWorkspace(ctx, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

/**
 * Hard delete of a company with no activity at all (D51's rule, applied tenant-wide: D90).
 * Any product, supplier, shop, field visit/report, staff assignment, opening session, stock
 * entry, DSR day, money entry, month close, payroll run or damage case/event makes it "used":
 * refused, suggest deactivating instead. A company that is some staff's home company (D93) is
 * also refused. The hidden master company is never deletable.
 * Super-admin only, like create (D28).
 */
export async function deleteCompany(ctx: AppContext, companyId: string): Promise<void> {
  requireSuperAdmin(ctx);
  const access = await loadCompanyAccess(ctx, companyId);
  if (access.company.isMaster) throw invalid("id", "validation.company.inUse");
  try {
    await ctx.db.$transaction(async (tx) => {
      const counts = await Promise.all([
        tx.product.count({ where: { companyId } }),
        tx.supplier.count({ where: { companyId } }),
        tx.shop.count({ where: { companyId } }),
        tx.fieldVisit.count({ where: { companyId } }),
        tx.fieldDayReport.count({ where: { companyId } }),
        tx.staffAssignment.count({ where: { companyId } }),
        tx.openingSession.count({ where: { companyId } }),
        tx.stockEntry.count({ where: { companyId } }),
        tx.dsrDay.count({ where: { companyId } }),
        tx.moneyEntry.count({ where: { companyId } }),
        tx.monthClose.count({ where: { companyId } }),
        tx.payrollRun.count({ where: { companyId } }),
        tx.damageCase.count({ where: { companyId } }),
        tx.damageEvent.count({ where: { companyId } }),
        tx.staff.count({ where: { companyId } }),
      ]);
      if (counts.some((n) => n > 0)) throw invalid("id", "validation.company.inUse");
      // CompanyModule, Membership and ShareholderInvestment cascade with the company row.
      await tx.company.delete({ where: { id: companyId } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "company.delete",
        resourceType: "company",
        resourceId: companyId,
        before: toCompany(access.company),
      });
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw invalid("id", "validation.company.inUse");
    throw error;
  }
}

/** Full replace of name, theme and modules; requires `company.manage`. */
export async function updateCompany(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<CompanyWorkspace> {
  const access = await requirePermission(ctx, companyId, "company.manage", { write: true });
  const data = parseInput(companyUpsertRequestSchema, input);
  try {
    await runIdempotent(
      ctx,
      { scope: companyId, action: "company.update", requestKey },
      data,
      async (tx) => {
        const clash = await tx.company.findFirst({
          where: { tenantId: ctx.actor.tenantId, name: data.name, id: { not: companyId } },
        });
        if (clash) throw duplicateName();
        if (data.blockNegativeStock && !access.company.blockNegativeStock) {
          await ensureNoNegativeStock(tx, access);
        }
        await tx.companyModule.deleteMany({ where: { companyId } });
        await tx.company.update({
          where: { id: companyId },
          data: {
            name: data.name,
            blockNegativeStock: data.blockNegativeStock,
            themePrimary: data.theme.primary,
            themePrimaryForeground: data.theme.primaryForeground,
            themeAccent: data.theme.accent ?? null,
            logoRef: data.theme.logoRef ?? null,
            modules: { create: [...new Set(data.modules)].map((module) => ({ module })) },
          },
        });
        await recordAudit(tx, ctx, {
          companyId,
          action: "company.update",
          resourceType: "company",
          resourceId: companyId,
          before: toCompany(access.company),
          after: data,
        });
        return companyId;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
  return getWorkspace(ctx, companyId);
}
