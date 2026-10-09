/**
 * Canonical permission IDs (guide section 12.2). Leaf definitions: roles may only be composed
 * from these keys; admins cannot invent server actions by typing new strings.
 */
export const permissionIds = [
  "company.view",
  "company.manage",
  "company.switch",
  "product.view",
  "product.create",
  "product.edit",
  "product.archive",
  "supplier.manage",
  "staff.manage",
  "shop.manage",
  "purchase.view",
  "purchase.create",
  "purchase.approve",
  "purchase.post",
  "purchase.reverse",
  "sale.view",
  "sale.create",
  "sale.post",
  "sale.reverse",
  "sale.price_override",
  "collection.post",
  "inventory.view",
  "inventory.cost_view",
  "inventory.adjust",
  "return.create",
  "return.approve",
  "return.post",
  "damage.report",
  "damage.approve",
  "damage.claim_settle",
  "finance.view",
  "payment.create",
  "payment.post",
  "payment.reverse",
  "settlement.view",
  "settlement.create",
  "settlement.approve",
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
  "report.profit_view",
  "report.export",
  "opening.prepare",
  "opening.approve",
  "opening.activate",
  "period.close",
  "role.manage",
  "membership.manage",
  "audit.view",
  /** D40: a DSR's own shop visits on the field panel (only their own staff record). */
  "field.entry",
  /** D40: a DSR may add a shop from the field panel. */
  "field.shop_create",
] as const;

/** Permissions of the field panel; a member holding only these is sent to it. */
export const fieldPermissionIds = ["field.entry", "field.shop_create"] as const;

/** True when every permission held in a company is a field-panel permission. */
export function isFieldOnly(permissions: readonly string[]): boolean {
  const field = new Set<string>(fieldPermissionIds);
  return permissions.length > 0 && permissions.every((p) => field.has(p));
}

export type PermissionId = (typeof permissionIds)[number];
