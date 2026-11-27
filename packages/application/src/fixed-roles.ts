import type { PermissionId } from "@bsd/contracts";
import type { Database } from "@bsd/database";
import type { Tx } from "./context";

export const loginRoleKinds = ["manager", "dsr", "tsm"] as const;
export type LoginRoleKind = (typeof loginRoleKinds)[number];

export const LOGIN_ROLE_NAMES: Record<LoginRoleKind, string> = {
  manager: "ম্যানেজার",
  dsr: "ডিএসআর",
  tsm: "টিএসএম",
};

/**
 * Fixed permission templates (D112, amended for TSM). Super Admin is User.isSuperAdmin
 * (all permissions), not a Role.
 * Manager: daily ops without reverse/delete, price override, master/role admin, or field panel.
 * DSR: draft sheet + limited dashboard (damage lots + staff balances).
 * TSM: orders (pending until approve) + stock / undelivered; no মাল গ্রহণ.
 */
export const MANAGER_PERMISSIONS: readonly PermissionId[] = [
  "company.view",
  "company.switch",
  "product.view",
  "product.create",
  "product.edit",
  "staff.manage",
  "shop.manage",
  "purchase.view",
  "purchase.create",
  "purchase.post",
  "purchase.approve",
  "sale.view",
  "sale.create",
  "sale.post",
  "sale.handover_submit",
  "collection.post",
  "inventory.view",
  "inventory.cost_view",
  "inventory.adjust",
  "return.create",
  "return.post",
  "damage.report",
  "finance.view",
  "payment.create",
  "payment.post",
  "settlement.view",
  "settlement.create",
  "settlement.post",
  "compensation.view",
  "compensation.manage",
  "sr_loan.view",
  "sr_loan.create",
  "sr_loan.repay",
  "sr_payable.settle",
  "sr_incentive.view",
  "sr_incentive.pay",
  "supplier_incentive.receive",
  "supplier_incentive.report_view",
  "dsr_due.view",
  "dsr_due.allocate_to_salary",
  "report.view",
  "report.export",
  /** D151: Manager dashboard shows the full সারসংক্ষেপ (sales profit, net profit) like Super Admin. */
  "report.profit_view",
  "opening.prepare",
  "membership.manage",
];

export const DSR_PERMISSIONS: readonly PermissionId[] = [
  "company.view",
  "company.switch",
  "sale.view",
  "sale.create",
  /** Needed for দোকানের বাকি money kind; sheet post is still refused for loginRoleKind=dsr. */
  "sale.post",
  "collection.post",
  "payment.post",
  "sr_loan.create",
  "sr_loan.repay",
  "finance.view",
  "report.view",
];

export const TSM_PERMISSIONS: readonly PermissionId[] = [
  "company.view",
  "company.switch",
  "purchase.view",
  "purchase.create",
  "inventory.view",
  /** D131: Floor stock damage — see purchase rate and post returns to company. */
  "inventory.cost_view",
  "damage.report",
];

const TEMPLATE: Record<LoginRoleKind, readonly PermissionId[]> = {
  manager: MANAGER_PERMISSIONS,
  dsr: DSR_PERMISSIONS,
  tsm: TSM_PERMISSIONS,
};

type RoleWriter = Pick<Database, "role" | "rolePermission"> | Pick<Tx, "role" | "rolePermission">;

/** Replace role permissions only when the set differs; skipDuplicates covers concurrent ensure. */
async function syncRolePermissions(
  db: RoleWriter,
  roleId: string,
  permissions: readonly PermissionId[],
): Promise<void> {
  const desired = [...new Set(permissions)];
  const existing = await db.rolePermission.findMany({
    where: { roleId },
    select: { permission: true },
  });
  if (
    existing.length === desired.length &&
    desired.every((permission) => existing.some((row) => row.permission === permission))
  ) {
    return;
  }
  await db.rolePermission.deleteMany({ where: { roleId } });
  if (desired.length === 0) return;
  await db.rolePermission.createMany({
    data: desired.map((permission) => ({ roleId, permission })),
    skipDuplicates: true,
  });
}

/** Idempotent: ensure each tenant has Manager, DSR and TSM roles with the coded permission sets. */
export async function ensureFixedLoginRoles(
  db: RoleWriter,
  tenantId: string,
): Promise<Record<LoginRoleKind, string>> {
  const ids = {} as Record<LoginRoleKind, string>;
  for (const kind of loginRoleKinds) {
    const permissions = TEMPLATE[kind];
    let role = await db.role.findFirst({ where: { tenantId, kind } });
    if (!role) {
      const byName = await db.role.findFirst({
        where: { tenantId, name: LOGIN_ROLE_NAMES[kind] },
      });
      if (byName) {
        role = await db.role.update({
          where: { id: byName.id },
          data: { kind },
        });
      } else {
        role = await db.role.create({
          data: { tenantId, name: LOGIN_ROLE_NAMES[kind], kind },
        });
      }
    } else if (role.name !== LOGIN_ROLE_NAMES[kind]) {
      role = await db.role.update({
        where: { id: role.id },
        data: { name: LOGIN_ROLE_NAMES[kind] },
      });
    }
    await syncRolePermissions(db, role.id, permissions);
    ids[kind] = role.id;
  }
  return ids;
}

export function isLoginRoleKind(value: string | null | undefined): value is LoginRoleKind {
  return value === "manager" || value === "dsr" || value === "tsm";
}
