import {
  orderTargetListSchema,
  orderTargetSchema,
  orderTargetUpdateRequestSchema,
  orderTargetUpsertRequestSchema,
  type OrderTarget,
  type OrderTargetList,
} from "@bsd/contracts";
import { orderTargetProgress, stockEntryAmount, sumAmounts, todayBusinessDate } from "@bsd/domain";
import { requirePermission } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";

const MAX_DASHBOARD_PINS = 2;
type Db = AppContext["db"] | Tx;

type TargetRow = {
  id: string;
  companyId: string;
  kind: string;
  productId: string | null;
  amount: { toFixed(): string };
  startDate: Date;
  endDate: Date;
  showOnDashboard: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  product: { name: string; sku: string } | null;
};

async function orderedAmountFor(
  ctx: AppContext,
  companyId: string,
  startDate: string,
  endDate: string,
  productId: string | null,
): Promise<string> {
  const rows = await ctx.db.stockEntry.findMany({
    where: {
      companyId,
      kind: "order",
      status: "posted",
      date: { gte: toDbDate(startDate), lte: toDbDate(endDate) },
      ...(productId ? { productId } : {}),
    },
    select: {
      pieces: true,
      cartonRate: true,
      piecesPerCarton: true,
      costPrice: true,
      unitPrice: true,
      kind: true,
    },
  });
  return sumAmounts(
    rows.map((row) =>
      stockEntryAmount({
        kind: row.kind,
        pieces: plain(row.pieces),
        cartonRate: row.cartonRate === null ? null : plain(row.cartonRate),
        piecesPerCarton: row.piecesPerCarton === null ? null : String(row.piecesPerCarton),
        costPrice: row.costPrice === null ? null : plain(row.costPrice),
        unitPrice: row.unitPrice === null ? null : plain(row.unitPrice),
      }),
    ),
  );
}

async function toTargetDto(ctx: AppContext, row: TargetRow, today: string): Promise<OrderTarget> {
  const startDate = fromDbDate(row.startDate);
  const endDate = fromDbDate(row.endDate);
  const ordered = await orderedAmountFor(
    ctx,
    row.companyId,
    startDate,
    endDate,
    row.kind === "product" ? row.productId : null,
  );
  const amount = plain(row.amount);
  return orderTargetSchema.parse({
    id: row.id,
    companyId: row.companyId,
    kind: row.kind,
    productId: row.productId,
    productName: row.product?.name ?? null,
    sku: row.product?.sku ?? null,
    amount,
    startDate,
    endDate,
    showOnDashboard: row.showOnDashboard,
    status: row.status,
    progress: orderTargetProgress({
      targetAmount: amount,
      orderedAmount: ordered,
      startDate,
      endDate,
      today,
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function countDashboardPins(db: Db, companyId: string, exceptId?: string): Promise<number> {
  return db.orderTarget.count({
    where: {
      companyId,
      status: "active",
      showOnDashboard: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
}

async function assertDashboardPinSlot(
  db: Db,
  companyId: string,
  showOnDashboard: boolean,
  exceptId?: string,
) {
  if (!showOnDashboard) return;
  const pinned = await countDashboardPins(db, companyId, exceptId);
  if (pinned >= MAX_DASHBOARD_PINS) {
    throw invalid("showOnDashboard", "validation.target.dashboardFull");
  }
}

async function assertProduct(
  db: Db,
  companyId: string,
  kind: string,
  productId: string | null | undefined,
) {
  if (kind !== "product") return null;
  if (!productId) throw invalid("productId", "validation.target.productRequired");
  const product = await db.product.findFirst({
    where: { id: productId, companyId, status: "active" },
    select: { id: true },
  });
  if (!product) throw invalid("productId", "validation.target.unknownProduct");
  return productId;
}

const includeProduct = { product: { select: { name: true, sku: true } } } as const;

/** Active (and optionally archived) targets with live progress. */
export async function listOrderTargets(
  ctx: AppContext,
  companyId: string,
  opts?: { dashboardOnly?: boolean; includeArchived?: boolean },
): Promise<OrderTargetList> {
  await requirePermission(ctx, companyId, "company.view");
  const today = todayBusinessDate();
  const rows = await ctx.db.orderTarget.findMany({
    where: {
      companyId,
      ...(opts?.dashboardOnly ? { showOnDashboard: true, status: "active" } : {}),
      ...(!opts?.includeArchived && !opts?.dashboardOnly ? { status: "active" } : {}),
      ...(opts?.includeArchived && !opts?.dashboardOnly
        ? { status: { in: ["active", "archived"] } }
        : {}),
    },
    include: includeProduct,
    orderBy: [{ showOnDashboard: "desc" }, { endDate: "asc" }, { createdAt: "desc" }],
  });
  const items = await Promise.all(rows.map((row) => toTargetDto(ctx, row, today)));
  const dashboardPinned = items.filter((t) => t.status === "active" && t.showOnDashboard).length;
  return orderTargetListSchema.parse({ items, dashboardPinned });
}

export async function createOrderTarget(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<OrderTarget> {
  const access = await requirePermission(ctx, companyId, "company.manage", { write: true });
  const data = parseInput(orderTargetUpsertRequestSchema, input);
  const productId = await assertProduct(ctx.db, companyId, data.kind, data.productId);
  await assertDashboardPinSlot(ctx.db, companyId, data.showOnDashboard);

  const created = await runIdempotent(
    ctx,
    { scope: companyId, action: "orderTarget.create", requestKey },
    data,
    async (tx) => {
      await assertDashboardPinSlot(tx, companyId, data.showOnDashboard);
      const row = await tx.orderTarget.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          kind: data.kind,
          productId: data.kind === "product" ? productId : null,
          amount: data.amount,
          startDate: toDbDate(data.startDate),
          endDate: toDbDate(data.endDate),
          showOnDashboard: data.showOnDashboard,
          status: "active",
        },
        include: includeProduct,
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "orderTarget.create",
        resourceType: "order_target",
        resourceId: row.id,
        after: {
          kind: row.kind,
          productId: row.productId,
          amount: data.amount,
          startDate: data.startDate,
          endDate: data.endDate,
          showOnDashboard: row.showOnDashboard,
        },
      });
      return row;
    },
  );

  return toTargetDto(ctx, created, todayBusinessDate());
}

export async function updateOrderTarget(
  ctx: AppContext,
  companyId: string,
  targetId: string,
  input: unknown,
): Promise<OrderTarget> {
  await requirePermission(ctx, companyId, "company.manage", { write: true });
  const data = parseInput(orderTargetUpdateRequestSchema, input);
  const productId = await assertProduct(ctx.db, companyId, data.kind, data.productId);

  const updated = await ctx.db.$transaction(async (tx) => {
    const existing = await tx.orderTarget.findFirst({
      where: { id: targetId, companyId },
      include: includeProduct,
    });
    if (!existing) throw invalid("id", "validation.target.unknown");
    if (existing.status !== "active") throw invalid("id", "validation.target.archived");

    await assertDashboardPinSlot(tx, companyId, data.showOnDashboard, targetId);

    const row = await tx.orderTarget.update({
      where: { id: targetId },
      data: {
        kind: data.kind,
        productId: data.kind === "product" ? productId : null,
        amount: data.amount,
        startDate: toDbDate(data.startDate),
        endDate: toDbDate(data.endDate),
        showOnDashboard: data.showOnDashboard,
      },
      include: includeProduct,
    });
    await recordAudit(tx, ctx, {
      companyId,
      action: "orderTarget.update",
      resourceType: "order_target",
      resourceId: targetId,
      before: {
        kind: existing.kind,
        productId: existing.productId,
        amount: plain(existing.amount),
        startDate: fromDbDate(existing.startDate),
        endDate: fromDbDate(existing.endDate),
        showOnDashboard: existing.showOnDashboard,
      },
      after: {
        kind: row.kind,
        productId: row.productId,
        amount: data.amount,
        startDate: data.startDate,
        endDate: data.endDate,
        showOnDashboard: row.showOnDashboard,
      },
    });
    return row;
  });

  return toTargetDto(ctx, updated, todayBusinessDate());
}

export async function archiveOrderTarget(
  ctx: AppContext,
  companyId: string,
  targetId: string,
): Promise<OrderTarget> {
  await requirePermission(ctx, companyId, "company.manage", { write: true });
  const archived = await ctx.db.$transaction(async (tx) => {
    const existing = await tx.orderTarget.findFirst({
      where: { id: targetId, companyId },
      include: includeProduct,
    });
    if (!existing) throw invalid("id", "validation.target.unknown");
    if (existing.status !== "active") throw invalid("id", "validation.target.archived");

    const row = await tx.orderTarget.update({
      where: { id: targetId },
      data: { status: "archived", showOnDashboard: false },
      include: includeProduct,
    });
    await recordAudit(tx, ctx, {
      companyId,
      action: "orderTarget.archive",
      resourceType: "order_target",
      resourceId: targetId,
      before: { status: existing.status, showOnDashboard: existing.showOnDashboard },
      after: { status: row.status, showOnDashboard: row.showOnDashboard },
    });
    return row;
  });
  return toTargetDto(ctx, archived, todayBusinessDate());
}
