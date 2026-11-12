import {
  historyDsrPageSchema,
  historyMoneyKindGroups,
  historyMoneyPageSchema,
  historyPageQuerySchema,
  historyStatusQuerySchema,
  historyStockDateSummariesSchema,
  historyStockKindGroups,
  historyStockPageSchema,
  moneyEntrySchema,
  type HistoryMoneyKindGroup,
  type HistoryPageQuery,
  type HistoryStatusFilter,
  type HistoryStockKindGroup,
  type PermissionId,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  stockEntryAmount,
  stockEntryCartonParts,
  sumAmounts,
  sumCartons,
  sumQuantities,
} from "@bsd/domain";
import { requirePermission } from "./access";
import type { AppContext } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { invalid, parseInput } from "./errors";
import { allocationOf } from "./ledger";
import { plain } from "./numeric";
import { packOn } from "./products";

function pageQuery(input: unknown): HistoryPageQuery & { skip: number } {
  const q = parseInput(historyPageQuerySchema, input ?? {});
  return { ...q, skip: (q.page - 1) * q.pageSize };
}

function statusQuery(input: unknown): HistoryStatusFilter | undefined {
  return parseInput(historyStatusQuerySchema, input ?? {}).status;
}

function statusWhere(status: HistoryStatusFilter | undefined): { status?: string } {
  // UI default is posted; treat omit the same so a client that forgets `status` still filters.
  if (!status) return { status: "posted" };
  if (status === "all") return {};
  return { status };
}

function dateWhere(date: string | undefined): { date?: Date } {
  if (!date) return {};
  return { date: toDbDate(date) };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const stockInclude = {
  product: {
    select: {
      sku: true,
      name: true,
      packs: {
        select: { id: true, productId: true, piecesPerCarton: true, effectiveFrom: true },
      },
    },
  },
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

type StockRow = Prisma.StockEntryGetPayload<{ include: typeof stockInclude }>;

function effectivePpc(row: StockRow, businessDate: string): number | null {
  if (row.piecesPerCarton !== null) return row.piecesPerCarton;
  return packOn(row.product.packs, businessDate)?.piecesPerCarton ?? null;
}

function lineMetrics(row: StockRow, canSeeCost: boolean) {
  const date = fromDbDate(row.date);
  const basePieces = plain(row.pieces);
  const ppc = effectivePpc(row, date);
  const costPrice = row.costPrice === null ? null : plain(row.costPrice);
  const parts = stockEntryCartonParts(basePieces, ppc === null ? null : String(ppc));
  const amount = stockEntryAmount({
    kind: row.kind,
    pieces: basePieces,
    cartonRate: row.cartonRate === null ? null : plain(row.cartonRate),
    piecesPerCarton: ppc === null ? null : String(ppc),
    costPrice: row.kind === "receipt" && !canSeeCost ? null : costPrice,
    unitPrice: row.unitPrice === null ? null : plain(row.unitPrice),
  });
  return {
    basePieces,
    cartons: parts.cartons,
    loosePieces: parts.loosePieces,
    amount,
    costPrice: canSeeCost && costPrice !== null ? costPrice : null,
    piecesPerCarton: ppc,
  };
}

function toHistoryStockLine(row: StockRow, canSeeCost: boolean) {
  const metrics = lineMetrics(row, canSeeCost);
  return {
    id: row.id,
    date: fromDbDate(row.date),
    kind: row.kind,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    pieces: metrics.basePieces,
    freePieces: row.freePieces === null ? null : plain(row.freePieces),
    cartonRate: row.cartonRate === null ? null : plain(row.cartonRate),
    piecesPerCarton: metrics.piecesPerCarton,
    unitPrice: row.unitPrice === null ? null : plain(row.unitPrice),
    fundFrom: row.fundFrom,
    orderGroup: row.orderGroup,
    batchId: row.batchId,
    batchSeq: row.batch?.seq ?? null,
    costPrice: metrics.costPrice,
    salePrice: row.salePrice === null ? null : plain(row.salePrice),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reversedAt: iso(row.reversedAt),
    cartons: metrics.cartons,
    loosePieces: metrics.loosePieces,
    amount: metrics.amount,
  };
}

/** Paginated stock-entry history (latest first), with carton + amount columns. */
export async function listHistoryStockEntries(
  ctx: AppContext,
  companyId: string,
  group: HistoryStockKindGroup,
  query: unknown,
) {
  const access = await requirePermission(ctx, companyId, VIEW[group]);
  const kinds = historyStockKindGroups[group];
  if (!kinds) throw invalid("group", "validation.history.unknownGroup");
  const { page, pageSize, skip, date, status } = pageQuery(query);
  const where = {
    companyId,
    kind: { in: [...kinds] },
    ...dateWhere(date),
    ...statusWhere(status),
  };
  const canSeeCost = access.permissions.includes("inventory.cost_view");
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
  return historyStockPageSchema.parse({
    items: rows.map((row) => toHistoryStockLine(row, canSeeCost)),
    total,
    page,
    pageSize,
  });
}

/**
 * Dates that have stock entries for a History tab (orders / stock), with per-date totals.
 * Latest date first. Used for the date-card list (no pagination).
 */
export async function listHistoryStockDateSummaries(
  ctx: AppContext,
  companyId: string,
  group: HistoryStockKindGroup,
  query: unknown,
) {
  const access = await requirePermission(ctx, companyId, VIEW[group]);
  const kinds = historyStockKindGroups[group];
  if (!kinds) throw invalid("group", "validation.history.unknownGroup");
  const status = statusQuery(query);
  const where = {
    companyId,
    kind: { in: [...kinds] },
    ...statusWhere(status),
  };
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  const rows = await ctx.db.stockEntry.findMany({
    where,
    include: stockInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const byDate = new Map<
    string,
    { count: number; loosePieces: string[]; cartons: string[]; amounts: string[] }
  >();
  for (const row of rows) {
    const date = fromDbDate(row.date);
    const metrics = lineMetrics(row, canSeeCost);
    const bucket = byDate.get(date) ?? {
      count: 0,
      loosePieces: [],
      cartons: [],
      amounts: [],
    };
    bucket.count += 1;
    bucket.loosePieces.push(metrics.loosePieces);
    bucket.cartons.push(metrics.cartons);
    bucket.amounts.push(metrics.amount);
    byDate.set(date, bucket);
  }
  const items = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, bucket]) => ({
      date,
      count: bucket.count,
      // Loose pieces only — do not convert cartons into this total.
      pieces: sumQuantities(bucket.loosePieces),
      cartons: sumCartons(bucket.cartons),
      amount: sumAmounts(bucket.amounts),
    }));
  return historyStockDateSummariesSchema.parse({ items });
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
  const { page, pageSize, skip, date, status } = pageQuery(query);
  const where = {
    companyId,
    kind: { in: [...kinds] },
    ...dateWhere(date),
    ...statusWhere(status),
  };
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
        sheetStaffId: row.sheetStaffId,
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
  const { page, pageSize, skip, date, status } = pageQuery(query);
  const where = {
    companyId,
    ...dateWhere(date),
    ...statusWhere(status),
  };
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
