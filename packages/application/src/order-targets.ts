import {
  orderTargetListSchema,
  orderTargetSchema,
  orderTargetUpdateRequestSchema,
  orderTargetUpsertRequestSchema,
  type OrderTarget,
  type OrderTargetList,
} from "@bsd/contracts";
import {
  orderTargetProgress,
  stockEntryAmount,
  stockEntryOrderCartons,
  sumAmounts,
  sumCartons,
  todayBusinessDate,
} from "@bsd/domain";
import { requirePermission } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";

const MAX_DASHBOARD_PINS = 2;
type Db = AppContext["db"] | Tx;

const includeProducts = {
  products: { include: { product: { select: { id: true, name: true, sku: true } } } },
} as const;

type TargetRow = {
  id: string;
  companyId: string;
  kind: string;
  amount: { toFixed(): string } | null;
  quantityCartons: { toFixed(): string } | null;
  startDate: Date;
  endDate: Date;
  showOnDashboard: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  products: { productId: string; product: { id: string; name: string; sku: string } }[];
};

async function loadTarget(db: Db, companyId: string, targetId: string): Promise<TargetRow> {
  const row = await db.orderTarget.findFirst({
    where: { id: targetId, companyId },
    include: includeProducts,
  });
  if (!row) throw invalid("id", "validation.target.unknown");
  return row;
}

async function orderedAmountOverall(
  ctx: AppContext,
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  const rows = await ctx.db.stockEntry.findMany({
    where: {
      companyId,
      kind: "order",
      status: "posted",
      date: { gte: toDbDate(startDate), lte: toDbDate(endDate) },
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

/** D115: sum of whole cartons from posted order lines for the named products. */
async function orderedCartonsFor(
  ctx: AppContext,
  companyId: string,
  startDate: string,
  endDate: string,
  productIds: string[],
): Promise<string> {
  if (productIds.length === 0) return "0";
  const rows = await ctx.db.stockEntry.findMany({
    where: {
      companyId,
      kind: "order",
      status: "posted",
      productId: { in: productIds },
      date: { gte: toDbDate(startDate), lte: toDbDate(endDate) },
    },
    select: { pieces: true, piecesPerCarton: true },
  });
  return sumCartons(
    rows.map((row) =>
      stockEntryOrderCartons(
        plain(row.pieces),
        row.piecesPerCarton === null ? null : String(row.piecesPerCarton),
      ),
    ),
  );
}

async function toTargetDto(ctx: AppContext, row: TargetRow, today: string): Promise<OrderTarget> {
  const startDate = fromDbDate(row.startDate);
  const endDate = fromDbDate(row.endDate);
  const products = row.products.map((link) => link.product);
  const productIds = products.map((p) => p.id);
  const isProduct = row.kind === "product";
  const targetValue = isProduct
    ? plain(row.quantityCartons as { toFixed(): string })
    : plain(row.amount as { toFixed(): string });
  const ordered = isProduct
    ? await orderedCartonsFor(ctx, row.companyId, startDate, endDate, productIds)
    : await orderedAmountOverall(ctx, row.companyId, startDate, endDate);
  return orderTargetSchema.parse({
    id: row.id,
    companyId: row.companyId,
    kind: row.kind,
    products,
    amount: isProduct ? null : targetValue,
    quantityCartons: isProduct ? targetValue : null,
    startDate,
    endDate,
    showOnDashboard: row.showOnDashboard,
    status: row.status,
    progress: orderTargetProgress({
      targetAmount: targetValue,
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

/** Validates product ids for a product-wise target; returns the sorted unique list. */
async function assertProducts(db: Db, companyId: string, kind: string, productIds: string[]) {
  if (kind !== "product") return [] as string[];
  if (productIds.length === 0) throw invalid("productIds", "validation.target.productRequired");
  const unique = [...new Set(productIds)];
  const found = await db.product.findMany({
    where: { id: { in: unique }, companyId, status: "active" },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw invalid("productIds", "validation.target.unknownProduct");
  }
  return unique;
}

function auditBody(
  kind: string,
  productIds: string[],
  amount: string | null | undefined,
  quantityCartons: string | null | undefined,
  startDate: string,
  endDate: string,
  showOnDashboard: boolean,
) {
  return {
    kind,
    productIds,
    amount: kind === "overall" ? (amount ?? null) : null,
    quantityCartons: kind === "product" ? (quantityCartons ?? null) : null,
    startDate,
    endDate,
    showOnDashboard,
  };
}

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
    include: includeProducts,
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
  const productIds = await assertProducts(ctx.db, companyId, data.kind, data.productIds);
  const amount: string | null = data.kind === "overall" ? (data.amount ?? null) : null;
  const quantityCartons: string | null =
    data.kind === "product" ? (data.quantityCartons ?? null) : null;
  if (data.kind === "overall" && amount === null) {
    throw invalid("amount", "validation.target.amount");
  }
  if (data.kind === "product" && quantityCartons === null) {
    throw invalid("quantityCartons", "validation.target.cartons");
  }
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
          amount,
          quantityCartons,
          startDate: toDbDate(data.startDate),
          endDate: toDbDate(data.endDate),
          showOnDashboard: data.showOnDashboard,
          status: "active",
          ...(data.kind === "product"
            ? { products: { create: productIds.map((productId) => ({ productId })) } }
            : {}),
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "orderTarget.create",
        resourceType: "order_target",
        resourceId: row.id,
        after: auditBody(
          data.kind,
          productIds,
          data.amount,
          data.quantityCartons,
          data.startDate,
          data.endDate,
          data.showOnDashboard,
        ),
      });
      return { id: row.id };
    },
  );

  return toTargetDto(ctx, await loadTarget(ctx.db, companyId, created.id), todayBusinessDate());
}

export async function updateOrderTarget(
  ctx: AppContext,
  companyId: string,
  targetId: string,
  input: unknown,
): Promise<OrderTarget> {
  await requirePermission(ctx, companyId, "company.manage", { write: true });
  const data = parseInput(orderTargetUpdateRequestSchema, input);
  const productIds = await assertProducts(ctx.db, companyId, data.kind, data.productIds);
  const amount: string | null = data.kind === "overall" ? (data.amount ?? null) : null;
  const quantityCartons: string | null =
    data.kind === "product" ? (data.quantityCartons ?? null) : null;
  if (data.kind === "overall" && amount === null) {
    throw invalid("amount", "validation.target.amount");
  }
  if (data.kind === "product" && quantityCartons === null) {
    throw invalid("quantityCartons", "validation.target.cartons");
  }

  await ctx.db.$transaction(async (tx) => {
    const existing = await tx.orderTarget.findFirst({
      where: { id: targetId, companyId },
      include: includeProducts,
    });
    if (!existing) throw invalid("id", "validation.target.unknown");
    if (existing.status !== "active") throw invalid("id", "validation.target.archived");

    await assertDashboardPinSlot(tx, companyId, data.showOnDashboard, targetId);

    await tx.orderTargetProduct.deleteMany({ where: { targetId } });
    await tx.orderTarget.update({
      where: { id: targetId },
      data: {
        kind: data.kind,
        amount,
        quantityCartons,
        startDate: toDbDate(data.startDate),
        endDate: toDbDate(data.endDate),
        showOnDashboard: data.showOnDashboard,
        ...(data.kind === "product"
          ? { products: { create: productIds.map((productId) => ({ productId })) } }
          : {}),
      },
    });
    await recordAudit(tx, ctx, {
      companyId,
      action: "orderTarget.update",
      resourceType: "order_target",
      resourceId: targetId,
      before: auditBody(
        existing.kind,
        existing.products.map((p) => p.productId),
        existing.amount === null ? null : plain(existing.amount),
        existing.quantityCartons === null ? null : plain(existing.quantityCartons),
        fromDbDate(existing.startDate),
        fromDbDate(existing.endDate),
        existing.showOnDashboard,
      ),
      after: auditBody(
        data.kind,
        productIds,
        data.amount,
        data.quantityCartons,
        data.startDate,
        data.endDate,
        data.showOnDashboard,
      ),
    });
  });

  return toTargetDto(ctx, await loadTarget(ctx.db, companyId, targetId), todayBusinessDate());
}

export async function archiveOrderTarget(
  ctx: AppContext,
  companyId: string,
  targetId: string,
): Promise<OrderTarget> {
  await requirePermission(ctx, companyId, "company.manage", { write: true });
  await ctx.db.$transaction(async (tx) => {
    const existing = await tx.orderTarget.findFirst({
      where: { id: targetId, companyId },
      include: includeProducts,
    });
    if (!existing) throw invalid("id", "validation.target.unknown");
    if (existing.status !== "active") throw invalid("id", "validation.target.archived");

    const row = await tx.orderTarget.update({
      where: { id: targetId },
      data: { status: "archived", showOnDashboard: false },
    });
    await recordAudit(tx, ctx, {
      companyId,
      action: "orderTarget.archive",
      resourceType: "order_target",
      resourceId: targetId,
      before: { status: existing.status, showOnDashboard: existing.showOnDashboard },
      after: { status: row.status, showOnDashboard: row.showOnDashboard },
    });
  });
  return toTargetDto(ctx, await loadTarget(ctx.db, companyId, targetId), todayBusinessDate());
}
