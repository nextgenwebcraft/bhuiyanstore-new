import { todayBusinessDate } from "@bsd/domain";
import {
  setupStatusSchema,
  type OpeningSectionId,
  type SetupStatus,
  type SetupStep,
  type SetupStepId,
} from "@bsd/contracts";
import { requirePermission } from "./access";
import type { AppContext } from "./context";
import { fromDbDate } from "./dates";
import { staffCompanyIds } from "./master";
import { openingView } from "./opening";

/**
 * The go-live checklist (PLAN §5.3, D43). Every step is computed here from the database; the
 * client only shows it. Steps never block each other, so the owner can fill them in any order.
 * The opening steps come from the same section summary the opening page shows.
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

/** Which opening section each opening step follows. */
const OPENING_STEPS = {
  openingStock: "stock",
  marketDue: "marketDue",
  shopDue: "shopDue",
  staffOpening: "staff",
  companyOpening: "company",
  cashOpening: "cash",
} as const satisfies Partial<Record<SetupStepId, OpeningSectionId>>;

export async function getSetupStatus(ctx: AppContext, companyId: string): Promise<SetupStatus> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const today = todayBusinessDate();
  const [view, products, assignments, shops] = await Promise.all([
    openingView(ctx.db, access),
    ctx.db.product.findMany({
      where: { companyId, status: "active" },
      select: { id: true, packs: { select: { piecesPerCarton: true } } },
    }),
    ctx.db.staffAssignment.findMany({
      where: {
        companyId: { in: await staffCompanyIds(ctx.db, companyId) },
        staff: { status: "active" },
      },
      select: {
        staffId: true,
        from: true,
        to: true,
        monthlySalary: true,
        role: { select: { kind: true } },
      },
    }),
    ctx.db.shop.count({ where: { companyId, status: "active" } }),
  ]);

  const steps: Record<SetupStepId, Missing[]> = {
    products: [],
    staff: [],
    shops: [],
    cutoff: [],
    openingStock: [],
    marketDue: [],
    shopDue: [],
    staffOpening: [],
    companyOpening: [],
    cashOpening: [],
  };

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

  if (shops === 0) steps.shops.push(miss("noShops"));
  if (!view.cutoffDate) steps.cutoff.push(miss("cutoffDate"));

  for (const [step, section] of Object.entries(OPENING_STEPS) as [
    keyof typeof OPENING_STEPS,
    OpeningSectionId,
  ][]) {
    const summary = view.sections.find((s) => s.section === section);
    if (summary?.state === "pending") {
      steps[step].push(miss("blanks", Math.max(summary.total - summary.entered, 1)));
    }
  }

  const list = (Object.keys(steps) as SetupStepId[]).map((id) => ({
    id,
    complete: steps[id].length === 0,
    missing: steps[id],
  }));
  return setupStatusSchema.parse({
    steps: list,
    completed: list.filter((s) => s.complete).length,
    ready: view.cutoffDate !== null,
    live: view.cutoffDate !== null,
    locked: view.locked,
  });
}
