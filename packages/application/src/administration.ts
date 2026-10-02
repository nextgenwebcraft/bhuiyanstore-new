import { hashPassword } from "@bsd/auth";
import {
  roleSchema,
  roleUpsertRequestSchema,
  userCreateRequestSchema,
  userPasswordResetRequestSchema,
  userSchema,
  userUpdateRequestSchema,
  type MembershipInput,
  type Role,
  type User,
} from "@bsd/contracts";
import { requireSuperAdmin, requireSuperAdminView } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { AppError, parseInput } from "./errors";
import { isUniqueViolation, runIdempotent } from "./idempotency";

/**
 * Users and roles are tenant administration. Until delegated administration is designed
 * (guide §12.2: grant only what you hold), only the super-admin manages them.
 */

const invalid = (path: string, code: string) => new AppError("VALIDATION_FAILED", [{ path, code }]);

const roleInclude = { permissions: true } as const;

function toRole(row: { id: string; name: string; permissions: { permission: string }[] }): Role {
  return roleSchema.parse({
    id: row.id,
    name: row.name,
    permissions: row.permissions.map((p) => p.permission).sort(),
  });
}

export async function listRoles(ctx: AppContext): Promise<Role[]> {
  requireSuperAdminView(ctx);
  const rows = await ctx.db.role.findMany({
    where: { tenantId: ctx.actor.tenantId },
    include: roleInclude,
    orderBy: { name: "asc" },
  });
  return rows.map(toRole);
}

const duplicateRole = () => invalid("name", "validation.role.duplicateName");

async function writeRole(
  ctx: AppContext,
  roleId: string | undefined,
  input: unknown,
  requestKey: string | undefined,
): Promise<Role> {
  requireSuperAdmin(ctx);
  const data = parseInput(roleUpsertRequestSchema, input);
  const permissions = [...new Set(data.permissions)].sort();
  const action = roleId ? `role.update:${roleId}` : "role.create";
  try {
    return await runIdempotent(ctx, { scope: "tenant", action, requestKey }, data, async (tx) => {
      const clash = await tx.role.findFirst({
        where: {
          tenantId: ctx.actor.tenantId,
          name: data.name,
          ...(roleId ? { id: { not: roleId } } : {}),
        },
      });
      if (clash) throw duplicateRole();
      let before: Role | undefined;
      let id = roleId;
      if (roleId) {
        const existing = await tx.role.findFirst({
          where: { id: roleId, tenantId: ctx.actor.tenantId },
          include: roleInclude,
        });
        if (!existing) throw invalid("id", "validation.role.unknown");
        before = toRole(existing);
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.role.update({ where: { id: roleId }, data: { name: data.name } });
      } else {
        id = (await tx.role.create({ data: { tenantId: ctx.actor.tenantId, name: data.name } })).id;
      }
      if (!id) throw new AppError("INTERNAL");
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: id, permission })),
      });
      const role = toRole(await tx.role.findUniqueOrThrow({ where: { id }, include: roleInclude }));
      await recordAudit(tx, ctx, {
        action: roleId ? "role.update" : "role.create",
        resourceType: "role",
        resourceId: id,
        ...(before ? { before } : {}),
        after: role,
      });
      return role;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateRole();
    throw error;
  }
}

export function createRole(ctx: AppContext, input: unknown, requestKey?: string): Promise<Role> {
  return writeRole(ctx, undefined, input, requestKey);
}

export function updateRole(
  ctx: AppContext,
  roleId: string,
  input: unknown,
  requestKey?: string,
): Promise<Role> {
  return writeRole(ctx, roleId, input, requestKey);
}

const userInclude = { memberships: { include: { roles: true } } } as const;

type UserRow = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  memberships: { companyId: string; roles: { roleId: string }[] }[];
};

function toUser(row: UserRow): User {
  return userSchema.parse({
    id: row.id,
    name: row.name,
    email: row.email,
    active: row.active,
    isSuperAdmin: row.isSuperAdmin,
    mustChangePassword: row.mustChangePassword,
    memberships: row.memberships
      .filter((m) => m.roles.length > 0)
      .map((m) => ({ companyId: m.companyId, roleIds: m.roles.map((r) => r.roleId).sort() })),
  });
}

export async function listUsers(ctx: AppContext): Promise<User[]> {
  requireSuperAdminView(ctx);
  const rows = await ctx.db.user.findMany({
    where: { tenantId: ctx.actor.tenantId },
    include: userInclude,
    orderBy: { name: "asc" },
  });
  return rows.map(toUser);
}

/** Every company and role must belong to the actor's tenant; one entry per company. */
async function checkMemberships(tx: Tx, ctx: AppContext, memberships: MembershipInput[]) {
  const companyIds = memberships.map((m) => m.companyId);
  if (new Set(companyIds).size !== companyIds.length) {
    throw invalid("memberships", "validation.membership.duplicateCompany");
  }
  const roleIds = [...new Set(memberships.flatMap((m) => m.roleIds))];
  const [companies, roles] = await Promise.all([
    tx.company.count({ where: { id: { in: companyIds }, tenantId: ctx.actor.tenantId } }),
    tx.role.count({ where: { id: { in: roleIds }, tenantId: ctx.actor.tenantId } }),
  ]);
  if (companies !== companyIds.length)
    throw invalid("memberships", "validation.membership.company");
  if (roles !== roleIds.length) throw invalid("memberships", "validation.membership.role");
}

async function replaceMemberships(tx: Tx, userId: string, memberships: MembershipInput[]) {
  await tx.membership.deleteMany({ where: { userId } });
  for (const m of memberships) {
    await tx.membership.create({
      data: {
        userId,
        companyId: m.companyId,
        roles: { create: [...new Set(m.roleIds)].map((roleId) => ({ roleId })) },
      },
    });
  }
}

async function findUser(tx: Tx, ctx: AppContext, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, tenantId: ctx.actor.tenantId },
    include: userInclude,
  });
  if (!user) throw invalid("id", "validation.user.unknown");
  return user;
}

const duplicateEmail = () => invalid("email", "validation.user.duplicateEmail");

/** Creates a sign-in account with a one-time password the user must change (guide §12.1). */
export async function createUser(
  ctx: AppContext,
  input: unknown,
  requestKey?: string,
): Promise<User> {
  requireSuperAdmin(ctx);
  const data = parseInput(userCreateRequestSchema, input);
  const email = data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(data.password);
  // The password never enters the idempotency hash or the audit log.
  const fingerprint = { name: data.name, email, memberships: data.memberships };
  try {
    return await runIdempotent(
      ctx,
      { scope: "tenant", action: "user.create", requestKey },
      fingerprint,
      async (tx) => {
        if (await tx.user.findUnique({ where: { email } })) throw duplicateEmail();
        await checkMemberships(tx, ctx, data.memberships);
        const id = crypto.randomUUID();
        await tx.user.create({
          data: {
            id,
            name: data.name,
            email,
            emailVerified: true,
            tenantId: ctx.actor.tenantId,
            mustChangePassword: true,
          },
        });
        await tx.account.create({
          data: {
            id: crypto.randomUUID(),
            accountId: id,
            providerId: "credential",
            userId: id,
            password: passwordHash,
          },
        });
        await replaceMemberships(tx, id, data.memberships);
        const user = toUser(await findUser(tx, ctx, id));
        await recordAudit(tx, ctx, {
          action: "user.create",
          resourceType: "user",
          resourceId: id,
          after: user,
        });
        return user;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateEmail();
    throw error;
  }
}

/** Name, active flag and memberships (full replace). Deactivation ends every session. */
export async function updateUser(
  ctx: AppContext,
  userId: string,
  input: unknown,
  requestKey?: string,
): Promise<User> {
  requireSuperAdmin(ctx);
  const data = parseInput(userUpdateRequestSchema, input);
  if (userId === ctx.actor.userId && !data.active) {
    throw invalid("active", "validation.user.cannotDeactivateSelf");
  }
  return runIdempotent(
    ctx,
    { scope: "tenant", action: `user.update:${userId}`, requestKey },
    data,
    async (tx) => {
      const before = toUser(await findUser(tx, ctx, userId));
      await checkMemberships(tx, ctx, data.memberships);
      await tx.user.update({
        where: { id: userId },
        data: { name: data.name, active: data.active },
      });
      await replaceMemberships(tx, userId, data.memberships);
      if (!data.active) await tx.session.deleteMany({ where: { userId } });
      const user = toUser(await findUser(tx, ctx, userId));
      await recordAudit(tx, ctx, {
        action: "user.update",
        resourceType: "user",
        resourceId: userId,
        before,
        after: user,
      });
      return user;
    },
  );
}

/** Sets a new one-time password for someone else and signs them out everywhere. */
export async function resetUserPassword(
  ctx: AppContext,
  userId: string,
  input: unknown,
  requestKey?: string,
): Promise<User> {
  requireSuperAdmin(ctx);
  const data = parseInput(userPasswordResetRequestSchema, input);
  if (userId === ctx.actor.userId) throw invalid("id", "validation.user.resetOwnPassword");
  const passwordHash = await hashPassword(data.password);
  return runIdempotent(
    ctx,
    { scope: "tenant", action: `user.password_reset:${userId}`, requestKey },
    { userId },
    async (tx) => {
      await findUser(tx, ctx, userId);
      const updated = await tx.account.updateMany({
        where: { userId, providerId: "credential" },
        data: { password: passwordHash },
      });
      if (updated.count === 0) {
        await tx.account.create({
          data: {
            id: crypto.randomUUID(),
            accountId: userId,
            providerId: "credential",
            userId,
            password: passwordHash,
          },
        });
      }
      await tx.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
      await tx.session.deleteMany({ where: { userId } });
      const user = toUser(await findUser(tx, ctx, userId));
      await recordAudit(tx, ctx, {
        action: "user.password_reset",
        resourceType: "user",
        resourceId: userId,
        after: { mustChangePassword: true },
      });
      return user;
    },
  );
}
