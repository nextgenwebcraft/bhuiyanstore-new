import {
  setupStatusSchema,
  type OpeningSectionId,
  type SetupStatus,
  type SetupStep,
  type SetupStepId,
} from "@bsd/contracts";
import { OPENING_KIND_EFFECTS, sectionOfKind } from "@bsd/domain";
import { requirePermission } from "./access";
import type { AppContext } from "./context";
import { fromDbDate, todayInDhaka } from "./dates";
import { openingView } from "./opening";

/**
 * The go-live checklist (PLAN §5.3). Every step is computed here from the database; the client
 * only shows it. Steps never block each other, so the owner can fill them in any order.
 */

type Missing = SetupStep["missing"][number];

const miss = (code: string, count: number | null = null): Missing => ({
  code: `setup.missing.${code}`,
  count,
});

/** Adds `code` with the count when `count` is above zero. */
const missCount = (out: Missing[], code: string, count: number) => {
  if (count > 0) out.push(miss(code, count));
};

export async function getSetupStatus(ctx: AppContext, companyId: string): Promise<SetupStatus> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const today = todayInDhaka();
  const [view, session, products, assignments, shops] = await Promise.all([
    openingView(ctx.db, access),
    ctx.db.openingSession.findUnique({ where: { companyId }, select: { status: true } }),
    ctx.db.product.findMany({
      where: { companyId, status: "active" },
      select: { id: true, packs: { select: { piecesPerCarton: true } } },
    }),
    ctx.db.staffAssignment.findMany({
      where: { companyId, staff: { status: "active" } },
      select: {
        staffId: true,
        from: true,
        to: true,
        monthlySalary: true,
        role: { select: { kind: true } },
      },
    }),
    ctx.db.shop.findMany({ where: { companyId, status: "active" }, select: { id: true } }),
  ]);

  const steps: Record<SetupStepId, Missing[]> = {
    company: [],
    products: [],
    staff: [],
    openingStock: [],
    supplierOpening: [],
    staffOpening: [],
    shops: [],
    businessOpening: [],
    activate: [],
  };

  if (access.company.status !== "active") steps.company.push(miss("companyInactive"));

  if (products.length === 0) steps.products.push(miss("noProducts"));
  missCount(
    steps.products,
    "cartonSize",
    products.filter((p) => !p.packs.some((pack) => pack.piecesPerCarton >= 1)).length,
  );

  const current = assignments.filter(
    (a) => fromDbDate(a.from) <= today && (a.to === null || fromDbDate(a.to) >= today),
  );
  if (!current.some((a) => a.role.kind === "dsr")) steps.staff.push(miss("noDsr"));
  missCount(
    steps.staff,
    "salary",
    current.filter((a) => a.role.kind !== "sr" && a.monthlySalary === null).length,
  );

  const stock = view.stock;
  if (!view.cutoffDate) steps.openingStock.push(miss("cutoffDate"));
  missCount(steps.openingStock, "pieces", stock.filter((l) => l.pieces === null).length);
  missCount(steps.openingStock, "orderPrice", stock.filter((l) => l.orderPrice === null).length);
  missCount(
    steps.openingStock,
    "unitCost",
    stock.filter((l) => l.pieces !== null && l.pieces !== "0" && l.unitCost === null).length,
  );
  const stockErrors = view.issues.filter(
    (i) => i.severity === "error" && i.productId && i.code !== "opening.issue.dueInvalid",
  ).length;
  missCount(steps.openingStock, "stockErrors", stockErrors);

  const balances = view.balances;
  const entered = (kind: string) => balances.some((b) => b.kind === kind && b.amount !== null);
  const sectionUnknown = (section: OpeningSectionId) =>
    balances.filter(
      (b) =>
        b.amount === null &&
        sectionOfKind(b.kind) === section &&
        OPENING_KIND_EFFECTS[b.kind].group !== "marketDue",
    ).length;
  const sectionErrors = (section: OpeningSectionId) =>
    view.issues.filter((i) => i.severity === "error" && i.kind && sectionOfKind(i.kind) === section)
      .length;
  if (!entered("company_payable") && !entered("company_advance")) {
    steps.supplierOpening.push(miss("companyBalance"));
  }
  missCount(
    steps.supplierOpening,
    "dueFromCompany",
    stock.filter((l) => l.dueFromCompany === null).length,
  );
  missCount(steps.supplierOpening, "errors", sectionErrors("company"));
  const staffWithBalance = new Set(
    balances
      .filter((b) => b.staffId && b.amount !== null && sectionOfKind(b.kind) === "staff")
      .map((b) => b.staffId),
  );
  if (current.length === 0) steps.staffOpening.push(miss("noStaff"));
  missCount(
    steps.staffOpening,
    "staffBalances",
    new Set(current.map((a) => a.staffId).filter((id) => !staffWithBalance.has(id))).size,
  );
  missCount(steps.staffOpening, "unknownAmounts", sectionUnknown("staff"));
  missCount(steps.staffOpening, "errors", sectionErrors("staff"));
  if (shops.length === 0) steps.shops.push(miss("noShops"));
  const dueShops = new Set(
    balances.filter((b) => b.kind === "shop_due" && b.amount !== null).map((b) => b.shopId),
  );
  missCount(steps.shops, "shopDue", shops.filter((s) => !dueShops.has(s.id)).length);
  missCount(steps.shops, "errors", sectionErrors("shops"));
  if (!balances.some((b) => b.kind === "cash" && b.amount !== null)) {
    steps.businessOpening.push(miss("cash"));
  }
  missCount(steps.businessOpening, "errors", sectionErrors("cash"));
  if (session?.status !== "active") steps.activate.push(miss("activate"));

  const list = (Object.keys(steps) as SetupStepId[]).map((id) => ({
    id,
    complete: steps[id].length === 0,
    missing: steps[id],
  }));
  const completed = list.filter((s) => s.complete).length;
  return setupStatusSchema.parse({
    steps: list,
    completed,
    ready: completed === list.length,
    openingStatus: session?.status ?? "none",
  });
}
