import { permissionIds, type PermissionId, type WorkspaceModuleId } from "@bsd/contracts";
import type { AppContext } from "./context";
import { AppError } from "./errors";

const companyInclude = { modules: true } as const;

export type CompanyAccess = {
  company: {
    id: string;
    tenantId: string;
    legalEntityId: string;
    name: string;
    themePrimary: string;
    themePrimaryForeground: string;
    themeAccent: string | null;
    logoRef: string | null;
    blockNegativeStock: boolean;
    status: string;
    modules: { module: string }[];
  };
  permissions: PermissionId[];
};

const knownPermissions = new Set<string>(permissionIds);

/**
 * Loads a company the actor may enter, with their effective permissions (union of roles,
 * default deny, guide §12.2). Unknown, other-tenant and non-member companies all fail with
 * COMPANY_NOT_FOUND so company IDs cannot be probed.
 */
export async function loadCompanyAccess(
  ctx: AppContext,
  companyId: string,
): Promise<CompanyAccess> {
  const [company, membership] = await Promise.all([
    ctx.db.company.findFirst({
      where: { id: companyId, tenantId: ctx.actor.tenantId },
      include: companyInclude,
    }),
    ctx.actor.isSuperAdmin
      ? null
      : ctx.db.membership.findUnique({
          where: { userId_companyId: { userId: ctx.actor.userId, companyId } },
          include: { roles: { include: { role: { include: { permissions: true } } } } },
        }),
  ]);
  if (!company) throw new AppError("COMPANY_NOT_FOUND");
  if (ctx.actor.isSuperAdmin) return { company, permissions: [...permissionIds] };
  if (!membership) throw new AppError("COMPANY_NOT_FOUND");
  const granted = new Set<PermissionId>();
  for (const { role } of membership.roles) {
    for (const { permission } of role.permissions) {
      if (knownPermissions.has(permission)) granted.add(permission as PermissionId);
    }
  }
  return { company, permissions: permissionIds.filter((p) => granted.has(p)) };
}

/** Company access plus one required permission; writes also need a changed password. */
export async function requirePermission(
  ctx: AppContext,
  companyId: string,
  permission: PermissionId,
  options: { write?: boolean; module?: WorkspaceModuleId } = {},
): Promise<CompanyAccess> {
  const access = await loadCompanyAccess(ctx, companyId);
  if (options.module && !access.company.modules.some((m) => m.module === options.module)) {
    throw new AppError("MODULE_UNAVAILABLE");
  }
  if (!access.permissions.includes(permission)) throw new AppError("FORBIDDEN");
  if (options.write) requireWriteReady(ctx);
  return access;
}

export function requireWriteReady(ctx: AppContext): void {
  if (ctx.actor.mustChangePassword) throw new AppError("PASSWORD_CHANGE_REQUIRED");
}

/** Super-admin writes; they also need the one-time password changed. */
export function requireSuperAdmin(ctx: AppContext): void {
  requireSuperAdminView(ctx);
  requireWriteReady(ctx);
}

export function requireSuperAdminView(ctx: AppContext): void {
  if (!ctx.actor.isSuperAdmin) throw new AppError("FORBIDDEN");
}
