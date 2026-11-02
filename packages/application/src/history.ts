import {
  historyDsrPageSchema,
  historyMoneyKindGroups,
  historyMoneyPageSchema,
  historyPageQuerySchema,
  historyStockKindGroups,
  historyStockPageSchema,
  moneyEntrySchema,
  type HistoryMoneyKindGroup,
  type HistoryStockKindGroup,
  type PermissionId,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import { requirePermission } from "./access";
import type { AppContext } from "./context";
import { fromDbDate } from "./dates";
import { invalid, parseInput } from "./errors";
import { allocationOf } from "./ledger";
import { plain } from "./numeric";

function pageArgs(input: unknown): { page: number; pageSize: number; skip: number } {
  const q = parseInput(historyPageQuerySchema, input ?? {});
  return { page: q.page, pageSize: q.pageSize, skip: (q.page - 1) * q.pageSize };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const stockInclude = {
  product: { select: { sku: true, name: true } },
  batch: { select: { seq: true } },
} as const;

const moneyInclude = {
  staff: { select: { name: true } },
  shop: { select: { name: true } },
  expenseCategory: { select: { name: true } },
  product: { select: { name: true } },
} as const;

const dsrInclude = {
  staff: { select: { name: true } },
  lines: {
    include: { product: { select: { sku: true, name: true } } },
    orderBy: [{ product: { sku: "asc" } }, { batchSeq: "asc" }],
  },
} satisfies Prisma.DsrDayInclude;

const VIEW: Record<HistoryStockKindGroup | HistoryMoneyKindGroup | "dsrSheets", PermissionId> = {
  orders: "purchase.view",
  stock: "purchase.view",
  damage: "purchase.view",
  shopDues: "sale.view",
  staffCash: "finance.view",
  srCash: "sr_loan.view",
  expenses: "finance.view",
  dsrSheets: "sale.view",
};

/** Paginated stock-entry history (latest first). */
export async function listHistoryStockEntries(
  ctx: AppContext,
  companyId: string,
  group: HistoryStockKindGroup,
  query: unknown,
) {
  const access = await requirePermission(ctx, companyId, VIEW[group]);
  const kinds = historyStockKindGroups[group];
  if (!kinds) throw invalid("group", "validation.history.unknownGroup");
  const { page, pageSize, skip } = pageArgs(query);
  const where = { companyId, kind: { in: [...kinds] } };
  const [total, rows] = await Promise.all([
    ctx.db.stockEntry.count({ where }),
    ctx.db.stockEntry.findMany({
      where,
      include: stockInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
  ]);
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  return historyStockPageSchema.parse({
    items: rows.map((row) => ({
      id: row.id,
      date: fromDbDate(row.date),
      kind: row.kind,
      productId: row.productId,
      sku: row.product.sku,
      productName: row.product.name,
      pieces: plain(row.pieces),
      freePieces: row.freePieces === null ? null : plain(row.freePieces),
      cartonRate: row.cartonRate === null ? null : plain(row.cartonRate),
      piecesPerCarton: row.piecesPerCarton,
      unitPrice: row.unitPrice === null ? null : plain(row.unitPrice),
      fundFrom: row.fundFrom,
      orderGroup: row.orderGroup,
      batchId: row.batchId,
      batchSeq: row.batch?.seq ?? null,
      costPrice: canSeeCost && row.costPrice !== null ? plain(row.costPrice) : null,
      salePrice: row.salePrice === null ? null : plain(row.salePrice),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reversedAt: iso(row.reversedAt),
    })),
    total,
    page,
    pageSize,
  });
}

/** Paginated money-entry history for one History tab (latest first). */
export async function listHistoryMoneyEntries(
  ctx: AppContext,
  companyId: string,
  group: HistoryMoneyKindGroup,
  query: unknown,
) {
  await requirePermission(ctx, companyId, VIEW[group]);
  const kinds = historyMoneyKindGroups[group];
  if (!kinds) throw invalid("group", "validation.history.unknownGroup");
  const { page, pageSize, skip } = pageArgs(query);
  const where = { companyId, kind: { in: [...kinds] } };
  const [total, rows] = await Promise.all([
    ctx.db.moneyEntry.count({ where }),
    ctx.db.moneyEntry.findMany({
      where,
      include: moneyInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
  ]);
  return historyMoneyPageSchema.parse({
    items: rows.map((row) =>
      moneyEntrySchema.parse({
        id: row.id,
        date: fromDbDate(row.date),
        kind: row.kind,
        amount: plain(row.amount),
        staffId: row.staffId,
        staffName: row.staff?.name ?? null,
        shopId: row.shopId,
        shopName: row.shop?.name ?? null,
        expenseCategoryId: row.expenseCategoryId,
        categoryName: row.expenseCategory?.name ?? null,
        productId: row.productId,
        productName: row.product?.name ?? null,
        allocation: allocationOf(row),
        srLoanType: row.srLoanType,
        payrollRunId: row.payrollRunId,
        dsrDayId: row.dsrDayId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        reversedAt: iso(row.reversedAt),
      }),
    ),
    total,
    page,
    pageSize,
  });
}

/** Paginated DSR sheet history (latest first). */
export async function listHistoryDsrDays(ctx: AppContext, companyId: string, query: unknown) {
  const access = await requirePermission(ctx, companyId, VIEW.dsrSheets);
  const { page, pageSize, skip } = pageArgs(query);
  const where = { companyId };
  const [total, rows] = await Promise.all([
    ctx.db.dsrDay.count({ where }),
    ctx.db.dsrDay.findMany({
      where,
      include: dsrInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
  ]);
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  return historyDsrPageSchema.parse({
    items: rows.map((row) => ({
      id: row.id,
      date: fromDbDate(row.date),
      staffId: row.staffId,
      staffName: row.staff.name,
      status: row.status,
      version: row.version,
      marketDueNew: plain(row.marketDueNew),
      marketDueCollected: plain(row.marketDueCollected),
      cashHandedOver: plain(row.cashHandedOver),
      lines: row.lines.map((line) => ({
        productId: line.productId,
        sku: line.product.sku,
        productName: line.product.name,
        piecesPerCarton: String(line.piecesPerCarton),
        issued: plain(line.issued),
        returned: plain(line.returned),
        damaged: plain(line.damaged),
        commission: plain(line.commission),
        batchKey: line.batchKey,
        batchSeq: line.batchSeq,
        costPrice: canSeeCost && line.costPrice !== null ? plain(line.costPrice) : null,
        salePrice: line.salePrice === null ? null : plain(line.salePrice),
        damageRate: line.damageRate === null ? null : plain(line.damageRate),
      })),
      postedAt: iso(row.postedAt),
      reversedAt: iso(row.reversedAt),
    })),
    total,
    page,
    pageSize,
  });
}
