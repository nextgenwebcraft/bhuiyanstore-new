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
  type CompanyAccess,
} from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { AppError, parseInput } from "./errors";
import { isUniqueViolation, runIdempotent } from "./idempotency";
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

function toWorkspace(access: CompanyAccess): CompanyWorkspace {
  return companyWorkspaceSchema.parse({
    company: toCompany(access.company),
    permissions: access.permissions,
  });
}

const duplicateName = () =>
  new AppError("VALIDATION_FAILED", [{ path: "name", code: "validation.company.duplicateName" }]);

/** Active companies the actor can enter; a super-admin sees every company of the tenant. */
export async function listWorkspaces(ctx: AppContext): Promise<CompanyWorkspace[]> {
  const companies = await ctx.db.company.findMany({
    where: {
      tenantId: ctx.actor.tenantId,
      status: "active",
      ...(ctx.actor.isSuperAdmin ? {} : { memberships: { some: { userId: ctx.actor.userId } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  const workspaces: CompanyWorkspace[] = [];
  for (const { id } of companies) workspaces.push(toWorkspace(await loadCompanyAccess(ctx, id)));
  return workspaces;
}

export async function getWorkspace(ctx: AppContext, companyId: string): Promise<CompanyWorkspace> {
  return toWorkspace(await loadCompanyAccess(ctx, companyId));
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
