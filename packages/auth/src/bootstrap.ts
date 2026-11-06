import type { Database } from "@bsd/database";
import { hashPassword } from "better-auth/crypto";
import { MIN_PASSWORD_LENGTH } from "./auth";

export type BootstrapInput = {
  tenantName: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
};

export type BootstrapResult = { tenantId: string; adminId: string; created: boolean };

/**
 * One-time super-admin bootstrap (guide §12.1). Idempotent: when the admin already exists the
 * account is left unchanged (never a password reset, never re-enabled) and only missing default
 * staff roles are added.
 */
export async function bootstrapSuperAdmin(
  db: Database,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const email = input.adminEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new RangeError("invalid admin email");
  if (input.adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(`admin password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.tenantId) throw new Error("existing admin has no tenant");
    await ensureDefaultStaffRoles(db, existing.tenantId);
    // Fixed login roles are seeded by application `ensureFixedLoginRoles` on first listRoles /
    // createUser (D112); bootstrap only owns staff-role payroll kinds.
    return { tenantId: existing.tenantId, adminId: existing.id, created: false };
  }

  const passwordHash = await hashPassword(input.adminPassword);
  return db.$transaction(async (tx) => {
    const tenant =
      (await tx.tenant.findFirst({ orderBy: { createdAt: "asc" } })) ??
      (await tx.tenant.create({ data: { name: input.tenantName } }));
    if (!(await tx.legalEntity.findFirst({ where: { tenantId: tenant.id } }))) {
      await tx.legalEntity.create({ data: { tenantId: tenant.id, name: input.tenantName } });
    }
    const adminId = crypto.randomUUID();
    await tx.user.create({
      data: {
        id: adminId,
        name: input.adminName,
        email,
        emailVerified: true,
        tenantId: tenant.id,
        isSuperAdmin: true,
      },
    });
    await tx.account.create({
      data: {
        id: crypto.randomUUID(),
        accountId: adminId,
        providerId: "credential",
        userId: adminId,
        password: passwordHash,
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actorId: adminId,
        action: "user.bootstrap_super_admin",
        resourceType: "user",
        resourceId: adminId,
        after: { email, isSuperAdmin: true },
      },
    });
    await ensureDefaultStaffRoles(tx, tenant.id);
    return { tenantId: tenant.id, adminId, created: true };
  });
}

/**
 * Starter staff roles from the workbook (guide §11.1). Only added while the tenant has none, so
 * renamed or deactivated roles are never recreated.
 */
const DEFAULT_STAFF_ROLES = [
  { name: "ডিএসআর", kind: "dsr" },
  { name: "এসআর", kind: "sr" },
  { name: "ম্যানেজার", kind: "general" },
  { name: "ড্রাইভার", kind: "general" },
  { name: "হেলপার", kind: "general" },
] as const;

type StaffRoleWriter = Pick<Database, "staffRole">;

async function ensureDefaultStaffRoles(db: StaffRoleWriter, tenantId: string): Promise<void> {
  if ((await db.staffRole.count({ where: { tenantId } })) > 0) return;
  await db.staffRole.createMany({
    data: DEFAULT_STAFF_ROLES.map((role) => ({ ...role, tenantId })),
  });
}
