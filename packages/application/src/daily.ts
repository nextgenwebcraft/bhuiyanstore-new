import {
  dashboardDailySchema,
  dashboardMonthlySchema,
  dashboardSummarySchema,
  dayViewSchema,
  documentTransitionRequestSchema,
  dsrDaySaveRequestSchema,
  dsrDaySchema,
  dsrHandoverApproveRequestSchema,
  dsrHandoverSubmitRequestSchema,
  moneyAllocationKinds,
  moneyCategoryKinds,
  moneyProductKinds,
  moneyEntryPostRequestSchema,
  moneyEntrySchema,
  moneyKindPermission,
  moneyKindPerson,
  srLoanTypeKinds,
  orderPaymentCorrectRequestSchema,
  stockEntryPostRequestSchema,
  stockEntrySchema,
  type DashboardDaily,
  type DashboardMonthly,
  type DashboardSummary,
  type DayView,
  type DsrDay,
  type MoneyEntry,
  type MoneyEntryKind,
  type PermissionId,
  type ProductLot,
  type StockEntry,
  type StockEntryKind,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import { randomUUID } from "node:crypto";
import {
  MONEY_KIND_EFFECTS,
  datesBetween,
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shiftBusinessDate,
  sumAmounts,
  sumQuantities,
  summarizeDay,
  dashboardDamageTotal,
  dashboardTotals,
  srCost as srCostOf,
  orderBatchCostPrice,
  pieceFromCarton,
  toDecimal,
  todayBusinessDate,
  damageRateKey,
  type MonthOutput,
} from "@bsd/domain";
import { loadCompanyAccess, requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, invalid, parseInput } from "./errors";
import { hasFieldVisits, postFieldVisits, reverseFieldVisits } from "./field-posting";
import { listHandoverShorts } from "./handover-short";
import { isUniqueViolation, runIdempotent } from "./idempotency";
import { liveOpening, allocationOf, namesFor, rangeRun, runLedger } from "./ledger";
import { staffCompanyIds } from "./master";
import { staffRun } from "./staff-ledger";
import { parseReportRange } from "./report-range";
import { plain } from "./numeric";
import { insertShop } from "./shop-rows";
import { packOn } from "./products";

const isZero = (amount: string) => toDecimal(amount).isZero();
import { ensureDraftSalesCover, ensureStockCovers } from "./stock-guard";
import {
  batchOf,
  dsrLineBatch,
  ensureBatchDue,
  ensureOrderReversible,
  orderBatch,
  productLots,
  useBatchPrices,
} from "./batches";
import {
  assertCheckUsable,
  createCheckChargesForEntries,
  reverseCheckChargeForEntry,
} from "./company-check";

/**
 * Daily entry (PLAN §9 Phase E): posted raw facts only. Every figure shown back comes from the
 * month engine via `runLedger`. Posted rows never change; a correction reverses and re-enters.
 */

type Db = AppContext["db"] | Tx;

const iso = (value: Date | null) => (value ? value.toISOString() : null);
export const businessDate = (value: unknown, path = "date") => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid(path, "validation.date.invalid");
  }
  return value;
};

export function requireAll(access: CompanyAccess, permissions: Iterable<PermissionId>): void {
  for (const permission of permissions) {
    if (!access.permissions.includes(permission)) throw new AppError("FORBIDDEN");
  }
}

/**
 * Posting needs a live opening (a saved cutoff date, D43), a date from the cutoff to today and an open month. The shared
 * company lock makes a concurrent month close wait for in-flight postings.
 */
export async function postingGuard(tx: Tx, companyId: string, date: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR SHARE`;
  const session = await tx.openingSession.findUnique({
    where: { companyId },
    select: { cutoffDate: true },
  });
  if (!session?.cutoffDate) {
    throw invalid("date", "validation.daily.noOpening");
  }
  if (date < fromDbDate(session.cutoffDate)) throw invalid("date", "validation.daily.beforeCutoff");
  if (date > todayBusinessDate()) throw invalid("date", "validation.daily.future");
  const closed = await tx.monthClose.findUnique({
    where: { companyId_month: { companyId, month: monthOf(date) } },
    select: { id: true },
  });
  if (closed) throw invalid("date", "validation.daily.monthClosed");
}

type RoleKind = "dsr" | "sr" | "general";

export async function roleOn(
  db: Db,
  companyId: string,
  staffId: string,
  date: string,
): Promise<RoleKind | null> {
  const day = toDbDate(date);
  const companyIds = await staffCompanyIds(db, companyId);
  const assignments = await db.staffAssignment.findMany({
    where: {
      companyId: { in: companyIds },
      staffId,
      from: { lte: day },
      OR: [{ to: null }, { to: { gte: day } }],
    },
    include: { role: true },
  });
  const assignment =
    assignments.find((a) => a.companyId === companyId) ?? assignments.at(0) ?? null;
  return assignment ? (assignment.role.kind as RoleKind) : null;
}

async function staffEmployer(db: Db, staffId: string): Promise<string | null> {
  const staff = await db.staff.findFirst({
    where: { id: staffId },
    select: { employer: true },
  });
  return staff?.employer ?? null;
}

// ---------------------------------------------------------------- stock entries

const STOCK_PERMISSION: Record<StockEntryKind, PermissionId> = {
  order: "purchase.create",
  receipt: "purchase.post",
  damage: "damage.report",
  incentive: "purchase.post",
  damageDeposit: "payment.post",
  floorDamageDeposit: "damage.report",
};

const stockInclude = {
  product: { select: { sku: true, name: true } },
  batch: { select: { seq: true } },
} as const;
type StockRow = Prisma.StockEntryGetPayload<{ include: typeof stockInclude }>;

function toStockEntry(row: StockRow, canSeeCost: boolean): StockEntry {
  return stockEntrySchema.parse({
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
    companyCheckId: row.companyCheckId,
    batchId: row.batchId,
    batchSeq: row.batch?.seq ?? null,
    costPrice: canSeeCost && row.costPrice !== null ? plain(row.costPrice) : null,
    salePrice: row.salePrice === null ? null : plain(row.salePrice),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reversedAt: iso(row.reversedAt),
  });
}

const seesCost = (access: CompanyAccess) => access.permissions.includes("inventory.cost_view");

async function stockEntriesOn(db: Db, access: CompanyAccess, date: string): Promise<StockEntry[]> {
  const rows = await db.stockEntry.findMany({
    where: { companyId: access.company.id, date: toDbDate(date) },
    include: stockInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => toStockEntry(row, seesCost(access)));
}

export async function listStockEntries(
  ctx: AppContext,
  companyId: string,
  date: unknown,
): Promise<StockEntry[]> {
  const access = await requirePermission(ctx, companyId, "purchase.view");
  return stockEntriesOn(ctx.db, access, businessDate(date));
}

/** Posts a day's godown lines and price changes together (one Excel row edit). */
/** D109: a damage deposit can take only pieces still held at that product and rate. */
async function ensureDamageLots(
  db: Tx,
  access: CompanyAccess,
  date: string,
  lines: readonly {
    kind: string;
    productId: string;
    pieces: string;
    unitPrice?: string | undefined;
  }[],
): Promise<void> {
  const deposits = lines.flatMap((line, index) =>
    line.kind === "damageDeposit" && line.unitPrice !== undefined
      ? [{ index, productId: line.productId, pieces: line.pieces, rate: line.unitPrice }]
      : [],
  );
  if (deposits.length === 0) return;
  const run = await runLedger(db, access, date);
  const day = run?.output.days.find((d) => d.date === date);
  const held = new Map<string, ReturnType<typeof toDecimal>>();
  for (const product of day?.products ?? []) {
    for (const lot of product.damageLots) {
      held.set(`${product.productId}|${damageRateKey(lot.rate)}`, toDecimal(lot.pieces));
    }
  }
  const asked = new Map<string, { pieces: ReturnType<typeof toDecimal>; index: number }>();
  for (const row of deposits) {
    const key = `${row.productId}|${damageRateKey(row.rate)}`;
    const prev = asked.get(key);
    asked.set(key, {
      pieces: toDecimal(row.pieces).add(prev?.pieces ?? "0"),
      index: prev?.index ?? row.index,
    });
  }
  for (const [key, row] of asked) {
    if (row.pieces.gt(held.get(key) ?? "0")) {
      throw invalid(`lines.${row.index}.pieces`, "validation.daily.damageLot");
    }
  }
}

export async function postStockEntries(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<StockEntry[]> {
  const access = await loadCompanyAccess(ctx, companyId);
  const request = parseInput(stockEntryPostRequestSchema, input);
  requireAll(access, [
    ...new Set(request.lines.map((l) => STOCK_PERMISSION[l.kind] as PermissionId)),
    ...(request.prices.length ? (["product.edit"] as const) : []),
  ]);

  const priceKeys = new Set<string>();
  request.prices.forEach((price, index) => {
    const key = `${price.productId}|${price.kind}`;
    if (priceKeys.has(key)) throw invalid(`prices.${index}`, "validation.daily.duplicatePrice");
    priceKeys.add(key);
  });

  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.post", requestKey },
    request,
    async (tx) => {
      await postingGuard(tx, companyId, request.date);
      const productIds = [
        ...new Set([...request.lines, ...request.prices].map((l) => l.productId)),
      ];
      const known = await tx.product.findMany({
        where: { companyId, id: { in: productIds } },
        include: { packs: true },
      });
      if (known.length !== productIds.length) {
        throw invalid("lines", "validation.daily.unknownProduct");
      }
      const packOf = (productId: string) =>
        packOn(known.find((p) => p.id === productId)?.packs ?? [], request.date)?.piecesPerCarton ??
        1;

      const date = toDbDate(request.date);
      // D57: an order's per-piece price (carton rate ÷ carton size) becomes the current order
      // price, so excess receipts and the order price display follow the latest order.
      const orderPrices = new Map<string, string>();
      // D63: orders posted together share a group and the balance parts named to pay them.
      const orderGroup = randomUUID();
      const owner = { tenantId: access.company.tenantId, companyId };
      // D68: a receipt brings no more into a batch than is still due on it.
      const receipts = request.lines.flatMap((line, index) =>
        line.kind === "receipt" && line.batchId
          ? [
              {
                batchId: line.batchId,
                productId: line.productId,
                pieces: line.pieces,
                freePieces: line.freePieces ?? "0",
                index,
              },
            ]
          : [],
      );
      await ensureBatchDue(tx, companyId, request.date, receipts);
      await ensureDamageLots(tx, access, request.date, request.lines);

      const hasOrder = request.lines.some((l) => l.kind === "order");
      const paymentMethod = request.paymentMethod ?? "cash";
      const companyCheckId =
        hasOrder && paymentMethod === "check" ? (request.companyCheckId ?? null) : null;
      if (companyCheckId) await assertCheckUsable(tx, companyId, companyCheckId);
      // Cheque orders do not consume damage/incentive funds (those settle companyPayable).
      const fundFrom = companyCheckId ? [] : request.fundFrom;

      // TSM orders stay pending until Manager/Super Admin approve (no batch / ledger yet).
      if (access.loginRoleKind === "tsm") {
        if (request.lines.some((l) => l.kind !== "order") || request.prices.length > 0) {
          throw new AppError("FORBIDDEN");
        }
        for (const line of request.lines) {
          const piecesPerCarton = packOf(line.productId);
          const salePrice = line.salePrice ?? "0";
          const costPrice =
            line.cartonRate === undefined
              ? null
              : orderBatchCostPrice({
                  paid: line.pieces,
                  free: line.freePieces ?? "0",
                  cartonRate: line.cartonRate,
                  piecesPerCarton: String(piecesPerCarton),
                });
          await tx.stockEntry.create({
            data: {
              ...owner,
              date,
              kind: "order",
              productId: line.productId,
              pieces: line.pieces,
              freePieces: line.freePieces ?? "0",
              cartonRate: line.cartonRate ?? "0",
              piecesPerCarton,
              fundFrom,
              orderGroup,
              companyCheckId,
              costPrice,
              salePrice,
              status: "pending",
              createdById: ctx.actor.userId,
            },
          });
        }
        await recordAudit(tx, ctx, {
          companyId,
          action: "stock.pending",
          resourceType: "stock_day",
          resourceId: request.date,
          after: { lines: request.lines, status: "pending", companyCheckId },
        });
        return stockEntriesOn(tx, access, request.date);
      }

      const postedOrders: {
        id: string;
        pieces: { toFixed(): string };
        cartonRate: { toFixed(): string } | null;
        piecesPerCarton: number | null;
        kind: string;
      }[] = [];

      for (const [index, line] of request.lines.entries()) {
        const base = {
          ...owner,
          date,
          kind: line.kind,
          productId: line.productId,
          pieces: line.pieces,
          createdById: ctx.actor.userId,
        };
        if (line.kind === "receipt") {
          const batch = await batchOf(
            tx,
            companyId,
            line.productId,
            line.batchId ?? "",
            `lines.${index}.batchId`,
          );
          // Only Super Admin may reprice a batch on receive; Manager posts qty against batch rates.
          const prices = await useBatchPrices(
            tx,
            batch,
            ctx.actor.isSuperAdmin ? { costPrice: line.costPrice, salePrice: line.salePrice } : {},
          );
          const free =
            line.freePieces !== undefined && line.freePieces !== "0" ? line.freePieces : null;
          await tx.stockEntry.create({
            data: {
              ...base,
              batchId: batch.id,
              ...(free !== null ? { freePieces: free } : {}),
              ...prices,
            },
          });
          continue;
        }
        if (line.kind === "floorDamageDeposit") {
          const batch = await batchOf(
            tx,
            companyId,
            line.productId,
            line.batchId ?? "",
            `lines.${index}.batchId`,
          );
          await tx.stockEntry.create({
            data: {
              ...base,
              batchId: batch.id,
              unitPrice: line.unitPrice ?? "0",
            },
          });
          continue;
        }
        if (line.kind !== "order") {
          await tx.stockEntry.create({
            data: {
              ...base,
              ...(line.kind === "damageDeposit" ? { unitPrice: line.unitPrice ?? "0" } : {}),
            },
          });
          continue;
        }
        const piecesPerCarton = packOf(line.productId);
        const salePrice = line.salePrice ?? "0";
        // Order-price feed stays the carton rate (D57/D104); batch cost uses effective cost when
        // free pieces are present so a different free mix opens a new batch (D68, 2026-11-08).
        const nominal =
          line.cartonRate === undefined
            ? null
            : pieceFromCarton(line.cartonRate, String(piecesPerCarton));
        const costPrice =
          line.cartonRate === undefined
            ? null
            : orderBatchCostPrice({
                paid: line.pieces,
                free: line.freePieces ?? "0",
                cartonRate: line.cartonRate,
                piecesPerCarton: String(piecesPerCarton),
              });
        if (line.pieces !== "0" && nominal !== null) orderPrices.set(line.productId, nominal);
        const batch = await orderBatch(tx, owner, line.productId, { costPrice, salePrice });
        const created = await tx.stockEntry.create({
          data: {
            ...base,
            freePieces: line.freePieces ?? "0",
            cartonRate: line.cartonRate ?? "0",
            piecesPerCarton,
            fundFrom,
            orderGroup,
            companyCheckId,
            batchId: batch.id,
            costPrice: batch.costPrice,
            salePrice,
          },
        });
        postedOrders.push(created);
      }
      if (companyCheckId && postedOrders.length > 0) {
        await createCheckChargesForEntries(tx, {
          tenantId: access.company.tenantId,
          companyId,
          companyCheckId,
          orderGroup,
          entries: postedOrders,
        });
      }
      // D53/D131: godown damage and floor damage deposits leave saleable stock.
      const stockOut = request.lines
        .filter((l) => l.kind === "damage" || l.kind === "floorDamageDeposit")
        .map((l) => l.productId);
      await ensureStockCovers(tx, access, request.date, stockOut);
      const before: Record<string, string> = {};
      const explicit = new Set(request.prices.map((p) => `${p.productId}|${p.kind}`));
      const derived = [...orderPrices]
        .filter(([productId]) => !explicit.has(`${productId}|order`))
        .map(([productId, price]) => ({ productId, kind: "order" as const, price }));
      for (const price of [...derived, ...request.prices]) {
        const key = { productId: price.productId, kind: price.kind, effectiveFrom: date };
        const existing = await tx.priceChange.findUnique({
          where: { productId_kind_effectiveFrom: key },
        });
        if (existing) before[`${price.productId}|${price.kind}`] = plain(existing.price);
        await tx.priceChange.upsert({
          where: { productId_kind_effectiveFrom: key },
          create: { ...key, price: price.price, source: "manual" },
          update: { price: price.price, source: "manual" },
        });
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.post",
        resourceType: "stock_day",
        resourceId: request.date,
        ...(Object.keys(before).length ? { before: { prices: before } } : {}),
        after: { lines: request.lines, prices: request.prices },
      });
      return stockEntriesOn(tx, access, request.date);
    },
  );
}

/**
 * Approves TSM pending orders for a date: creates batches and marks lines posted so undelivered
 * and the month engine pick them up. Manager + Super Admin (`purchase.approve`).
 */
export async function approvePendingOrders(
  ctx: AppContext,
  companyId: string,
  dateInput: unknown,
  requestKey?: string,
): Promise<StockEntry[]> {
  const access = await requirePermission(ctx, companyId, "purchase.approve", { write: true });
  const date = businessDate(dateInput);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.approve", requestKey },
    { date },
    async (tx) => {
      await postingGuard(tx, companyId, date);
      const rows = await tx.stockEntry.findMany({
        where: {
          companyId,
          date: toDbDate(date),
          kind: "order",
          status: "pending",
        },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length === 0) return stockEntriesOn(tx, access, date);

      const productIds = [...new Set(rows.map((r) => r.productId))];
      const known = await tx.product.findMany({
        where: { companyId, id: { in: productIds } },
        include: { packs: true },
      });
      if (known.length !== productIds.length) {
        throw invalid("lines", "validation.daily.unknownProduct");
      }
      const owner = { tenantId: access.company.tenantId, companyId };
      const orderPrices = new Map<string, string>();
      const dbDate = toDbDate(date);

      const byCheck = new Map<string, typeof rows>();
      for (const row of rows) {
        const salePrice = row.salePrice === null ? "0" : plain(row.salePrice);
        const costPrice = row.costPrice === null ? null : plain(row.costPrice);
        const batch = await orderBatch(tx, owner, row.productId, { costPrice, salePrice });
        if (row.cartonRate !== null && plain(row.pieces) !== "0" && row.piecesPerCarton) {
          orderPrices.set(
            row.productId,
            pieceFromCarton(plain(row.cartonRate), String(row.piecesPerCarton)),
          );
        }
        await tx.stockEntry.update({
          where: { id: row.id },
          data: {
            status: "posted",
            batchId: batch.id,
            costPrice: batch.costPrice,
            salePrice,
          },
        });
        if (row.companyCheckId) {
          const list = byCheck.get(row.companyCheckId) ?? [];
          list.push(row);
          byCheck.set(row.companyCheckId, list);
        }
      }

      for (const [companyCheckId, entries] of byCheck) {
        await assertCheckUsable(tx, companyId, companyCheckId);
        await createCheckChargesForEntries(tx, {
          tenantId: access.company.tenantId,
          companyId,
          companyCheckId,
          orderGroup: entries[0]?.orderGroup ?? null,
          entries,
        });
      }

      for (const [productId, price] of orderPrices) {
        const key = { productId, kind: "order" as const, effectiveFrom: dbDate };
        await tx.priceChange.upsert({
          where: { productId_kind_effectiveFrom: key },
          create: { ...key, price, source: "manual" },
          update: { price, source: "manual" },
        });
      }

      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.approve",
        resourceType: "stock_day",
        resourceId: date,
        after: { ids: rows.map((r) => r.id), count: rows.length },
      });
      return stockEntriesOn(tx, access, date);
    },
  );
}

/** Deletes a pending TSM order line (creator, Manager, or Super Admin). */
export async function discardPendingOrder(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  requestKey?: string,
): Promise<void> {
  const access = await loadCompanyAccess(ctx, companyId);
  if (
    !access.permissions.includes("purchase.create") &&
    !access.permissions.includes("purchase.approve")
  ) {
    throw new AppError("FORBIDDEN");
  }
  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.discardPending", requestKey },
    { entryId },
    async (tx) => {
      const row = await tx.stockEntry.findFirst({
        where: { id: entryId, companyId, kind: "order", status: "pending" },
      });
      if (!row) throw invalid("", "validation.daily.notFound");
      if (
        access.loginRoleKind === "tsm" &&
        row.createdById !== ctx.actor.userId &&
        !ctx.actor.isSuperAdmin
      ) {
        throw new AppError("FORBIDDEN");
      }
      await tx.stockEntry.delete({ where: { id: row.id } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.discardPending",
        resourceType: "stock_entry",
        resourceId: entryId,
        before: { status: "pending", productId: row.productId },
      });
    },
  );
}

export async function reverseStockEntry(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  requestKey?: string,
): Promise<StockEntry> {
  const access = await requirePermission(ctx, companyId, "purchase.reverse", { write: true });
  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.reverse", requestKey },
    { entryId },
    async (tx) => {
      const row = await tx.stockEntry.findFirst({ where: { id: entryId, companyId } });
      if (!row) throw invalid("", "validation.daily.notFound");
      if (row.status !== "posted") throw invalid("", "validation.daily.alreadyReversed");
      await postingGuard(tx, companyId, fromDbDate(row.date));
      const updated = await tx.stockEntry.updateMany({
        where: { id: entryId, status: "posted" },
        data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("", "validation.daily.alreadyReversed");
      if (row.kind === "order") {
        await ensureOrderReversible(tx, companyId, row);
        await reverseCheckChargeForEntry(tx, entryId);
      }
      if (row.kind === "receipt" || row.kind === "incentive") {
        await ensureStockCovers(tx, access, fromDbDate(row.date), [row.productId]);
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.reverse",
        resourceType: "stock_entry",
        resourceId: entryId,
        before: { status: "posted" },
        after: { status: "reversed" },
      });
      return toStockEntry(
        await tx.stockEntry.findUniqueOrThrow({ where: { id: entryId }, include: stockInclude }),
        seesCost(access),
      );
    },
  );
}

/**
 * D130: Super Admin changes payment on a posted order group (নগদ ↔ চেক) without reversing
 * stock or undoing receipts. All posted order lines that share the entry's orderGroup update
 * together; cheque charges reverse/create as needed so কোম্পানিতে জমা / cheque dues follow.
 */
export async function correctOrderPayment(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  input: unknown,
  requestKey?: string,
): Promise<StockEntry[]> {
  if (!ctx.actor.isSuperAdmin) throw new AppError("FORBIDDEN");
  const access = await requirePermission(ctx, companyId, "purchase.create", { write: true });
  const request = parseInput(orderPaymentCorrectRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.correctPayment", requestKey },
    { entryId, ...request },
    async (tx) => {
      const seed = await tx.stockEntry.findFirst({ where: { id: entryId, companyId } });
      if (!seed) throw invalid("", "validation.daily.notFound");
      if (seed.kind !== "order") throw invalid("", "validation.daily.orderOnly");
      if (seed.status !== "posted") throw invalid("", "validation.daily.alreadyReversed");
      await postingGuard(tx, companyId, fromDbDate(seed.date));

      const rows = seed.orderGroup
        ? await tx.stockEntry.findMany({
            where: {
              companyId,
              kind: "order",
              status: "posted",
              orderGroup: seed.orderGroup,
            },
            orderBy: { createdAt: "asc" },
          })
        : [seed];
      if (rows.length === 0) throw invalid("", "validation.daily.notFound");

      const nextCheckId = request.paymentMethod === "check" ? (request.companyCheckId ?? null) : null;
      if (nextCheckId) await assertCheckUsable(tx, companyId, nextCheckId);

      for (const row of rows) {
        await reverseCheckChargeForEntry(tx, row.id);
      }

      await tx.stockEntry.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          companyCheckId: nextCheckId,
          fundFrom: [],
        },
      });

      if (nextCheckId) {
        const refreshed = await tx.stockEntry.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          orderBy: { createdAt: "asc" },
        });
        await createCheckChargesForEntries(tx, {
          tenantId: access.company.tenantId,
          companyId,
          companyCheckId: nextCheckId,
          orderGroup: seed.orderGroup,
          entries: refreshed,
        });
      }

      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.correctPayment",
        resourceType: "stock_entry",
        resourceId: entryId,
        before: {
          companyCheckId: seed.companyCheckId,
          fundFrom: seed.fundFrom,
          orderGroup: seed.orderGroup,
        },
        after: {
          paymentMethod: request.paymentMethod,
          companyCheckId: nextCheckId,
          fundFrom: [],
          orderGroup: seed.orderGroup,
          entryIds: rows.map((r) => r.id),
        },
      });

      const updated = await tx.stockEntry.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        include: stockInclude,
        orderBy: { createdAt: "asc" },
      });
      return updated.map((row) => toStockEntry(row, seesCost(access)));
    },
  );
}

// ---------------------------------------------------------------- DSR day sheets

const dsrInclude = {
  staff: { select: { name: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true } },
      dsrStaff: { select: { name: true } },
    },
    orderBy: [{ dsrStaff: { name: "asc" } }, { product: { sku: "asc" } }, { batchSeq: "asc" }],
  },
} satisfies Prisma.DsrDayInclude;
type DsrRow = Prisma.DsrDayGetPayload<{ include: typeof dsrInclude }>;

function toDsrDay(row: DsrRow, canSeeCost: boolean): DsrDay {
  return dsrDaySchema.parse({
    id: row.id,
    date: fromDbDate(row.date),
    staffId: row.staffId,
    staffName: row.staff.name,
    status: row.status,
    version: row.version,
    marketDueNew: plain(row.marketDueNew),
    marketDueCollected: plain(row.marketDueCollected),
    cashHandedOver: plain(row.cashHandedOver),
    handoverStatus:
      row.handoverStatus === "pending" || row.handoverStatus === "approved"
        ? row.handoverStatus
        : "none",
    lines: row.lines.map((line) => ({
      productId: line.productId,
      dsrStaffId: line.dsrStaffId,
      dsrStaffName: line.dsrStaff.name,
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
  });
}

export async function listDsrDays(
  ctx: AppContext,
  companyId: string,
  date: unknown,
): Promise<DsrDay[]> {
  const access = await requirePermission(ctx, companyId, "sale.view");
  const day = toDbDate(businessDate(date));
  const [rows, reports] = await Promise.all([
    ctx.db.dsrDay.findMany({
      where: { companyId, date: day },
      include: dsrInclude,
      orderBy: [{ staff: { name: "asc" } }, { createdAt: "asc" }],
    }),
    ctx.db.fieldDayReport.findMany({
      where: { companyId, date: day, status: "pending" },
      include: { lines: { include: { product: { select: { name: true, sku: true } } } } },
    }),
  ]);
  // D71: a pending field report shows on the DSR's live sheet.
  const reportOf = new Map(
    reports.map((r) => [
      r.staffId,
      {
        id: r.id,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        lines: [...r.lines]
          .sort((a, b) => a.product.sku.localeCompare(b.product.sku))
          .map((l) => ({
            productId: l.productId,
            productName: l.product.name,
            returned: plain(l.returned),
            damaged: plain(l.damaged),
          })),
      },
    ]),
  );
  return rows.map((row) => ({
    ...toDsrDay(row, seesCost(access)),
    fieldReport: row.status === "reversed" ? null : (reportOf.get(row.staffId) ?? null),
  }));
}

async function loadDsrDay(db: Db, companyId: string, id: string): Promise<DsrRow> {
  const row = await db.dsrDay.findFirst({ where: { id, companyId }, include: dsrInclude });
  if (!row) throw invalid("", "validation.daily.notFound");
  return row;
}

/**
 * Creates (version 0) or replaces the live draft for one DSR and date. Lines with nothing entered
 * are dropped. Every piece sells at the day's sale price, as in the workbook.
 */
export async function saveDsrDay(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<DsrDay> {
  const access = await requirePermission(ctx, companyId, "sale.create", { write: true });
  const request = parseInput(dsrDaySaveRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "dsr_day.save", requestKey },
    request,
    async (tx) => {
      const id = await saveDsrDayIn(tx, ctx, access, request);
      return toDsrDay(await loadDsrDay(tx, companyId, id), seesCost(access));
    },
  );
}

type DsrDaySaveInput = ReturnType<typeof dsrDaySaveRequestSchema.parse>;

/**
 * A sheet save inside the caller's transaction (also the D71 approval's correction); returns the
 * id of the sheet now live.
 */
export async function saveDsrDayIn(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  request: DsrDaySaveInput,
): Promise<string> {
  const companyId = access.company.id;
  const seen = new Set<string>();
  // D112: without sale.price_override, ignore client sale/cost so batches cannot be repriced
  // (UI already locks Manager; this closes the API gap found in the role audit).
  const canOverridePrice = access.permissions.includes("sale.price_override");
  const lines = request.lines.flatMap((line, index) => {
    if (
      line.issued === "0" &&
      line.returned === "0" &&
      line.damaged === "0" &&
      isZero(line.commission)
    ) {
      return [];
    }
    const safe =
      canOverridePrice || (line.salePrice === undefined && line.costPrice === undefined)
        ? line
        : (({ salePrice: _sale, costPrice: _cost, ...rest }) => rest)(line);
    return [{ line: safe, index }];
  });
  for (const { line, index } of lines) {
    // D122: one line per DSR, product and batch.
    const key = `${line.dsrStaffId}|${line.productId}|${line.batchKey}`;
    if (seen.has(key)) throw invalid(`lines.${index}`, "validation.daily.duplicateProduct");
    seen.add(key);
    const sold = toDecimal(line.issued).sub(line.returned).sub(line.damaged);
    if (!isZero(line.commission) && sold.lte(0)) {
      throw invalid(`lines.${index}.commission`, "validation.daily.commissionWithoutSale");
    }
  }

  await postingGuard(tx, companyId, request.date);
  const existingForLock = await tx.dsrDay.findFirst({
    where: {
      companyId,
      staffId: request.staffId,
      date: toDbDate(request.date),
      status: { not: "reversed" },
    },
    select: { handoverStatus: true, lines: true },
  });
  assertHandoverEditable(ctx, existingForLock?.handoverStatus);
  assertDsrSaveAllowed(access, request, existingForLock?.lines ?? []);
  // D79: the day sheet opens for everyone on এসআর হিসাব (supplier-employed), even when their
  // dated SR assignment has not started yet or has ended; a DSR/SR role on the date also
  // qualifies. A distributor who is neither stays refused.
  const role = await roleOn(tx, companyId, request.staffId, request.date);
  const employer = await staffEmployer(tx, request.staffId);
  if (role !== "sr" && role !== "dsr" && employer !== "supplier") {
    throw invalid("staffId", "validation.daily.dsrOnly");
  }
  // D122: every line names a selling DSR. Migration backfilled dsr_staff_id from the SR day
  // owner — keep those lines saveable so open sheets are not bricked; the UI only offers real
  // DSRs for new entry.
  for (const { line, index } of lines) {
    if (line.dsrStaffId === request.staffId) continue;
    const lineRole = await roleOn(tx, companyId, line.dsrStaffId, request.date);
    if (lineRole !== "dsr") {
      throw invalid(`lines.${index}.dsrStaffId`, "validation.daily.lineDsrOnly");
    }
  }
  const productIds = [...new Set(lines.map(({ line }) => line.productId))];
  const products = await tx.product.findMany({
    where: { companyId, id: { in: productIds } },
    include: { packs: true },
  });
  if (products.length !== productIds.length)
    throw invalid("lines", "validation.daily.unknownProduct");
  const packs = new Map(
    products.map((p) => [p.id, packOn(p.packs, request.date)?.piecesPerCarton ?? 1]),
  );

  const date = toDbDate(request.date);
  const live = await tx.dsrDay.findFirst({
    where: { companyId, staffId: request.staffId, date, status: { not: "reversed" } },
  });
  if ((live?.version ?? 0) !== request.version) {
    throw invalid("version", "validation.daily.stale");
  }
  // D56 / D135: saving a posted sheet corrects it (Super Admin always, incl. after হাতে জমা).
  // D126: Manager edits drafts only; after post locked. DSR never.
  const corrected = live?.status === "posted" ? await loadDsrDay(tx, companyId, live.id) : null;
  if (corrected) {
    const adminOk =
      access.loginRoleKind === null &&
      access.permissions.includes("sale.post") &&
      access.permissions.includes("sale.reverse");
    if (!adminOk) throw new AppError("FORBIDDEN");
    // A correction re-posts the same sheet, so the money entered on it stays.
    await moveDsrDay(tx, ctx, access, corrected, "reversed", { keepSheetMoney: true });
  } else {
    // D136 / D137: draft save blocks when this sheet + other SRs' draft reservations overdraw.
    await ensureDraftSalesCover(
      tx,
      access,
      request.date,
      lines.map(({ line }) => ({
        productId: line.productId,
        batchKey: line.batchKey,
        issued: line.issued,
        returned: line.returned,
      })),
      { excludeStaffId: request.staffId, excludeDate: request.date },
    );
  }
  const data = {
    ...(request.marketDueNew === undefined ? {} : { marketDueNew: request.marketDueNew }),
    ...(request.marketDueCollected === undefined
      ? {}
      : { marketDueCollected: request.marketDueCollected }),
    ...(request.cashHandedOver === undefined ? {} : { cashHandedOver: request.cashHandedOver }),
  };
  let id: string;
  if (live && !corrected) {
    const updated = await tx.dsrDay.updateMany({
      where: { id: live.id, version: live.version, status: "draft" },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
    await tx.dsrLine.deleteMany({ where: { dsrDayId: live.id } });
    id = live.id;
  } else {
    try {
      id = (
        await tx.dsrDay.create({
          data: {
            ...(corrected
              ? {
                  // Above the corrected sheet's, so a screen still holding it is stale.
                  version: corrected.version + 1,
                  marketDueNew: corrected.marketDueNew,
                  marketDueCollected: corrected.marketDueCollected,
                  cashHandedOver: corrected.cashHandedOver,
                }
              : {}),
            ...data,
            tenantId: access.company.tenantId,
            companyId,
            staffId: request.staffId,
            date,
            createdById: ctx.actor.userId,
          },
        })
      ).id;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw invalid("version", "validation.daily.stale");
      }
      throw error;
    }
  }
  for (const { line, index } of lines) {
    await tx.dsrLine.create({
      data: {
        dsrDayId: id,
        dsrStaffId: line.dsrStaffId,
        productId: line.productId,
        piecesPerCarton: packs.get(line.productId) ?? 1,
        issued: line.issued,
        returned: line.returned,
        damaged: line.damaged,
        commission: line.commission,
        damageRate: line.damaged === "0" ? null : (line.damageRate ?? null),
        ...(await dsrLineBatch(tx, companyId, seesCost(access), line, index)),
      },
    });
  }
  if (corrected) {
    const draft = await loadDsrDay(tx, companyId, id);
    await moveDsrDay(tx, ctx, access, draft, "posted");
    await ensureStockCovers(tx, access, request.date, [
      ...new Set([...stockTakenOut(corrected, "reversed"), ...stockTakenOut(draft, "posted")]),
    ]);
  }
  await recordAudit(tx, ctx, {
    companyId,
    action: corrected ? "dsr_day.correct" : "dsr_day.save",
    resourceType: "dsr_day",
    resourceId: id,
    ...(corrected ? { before: { id: corrected.id, version: corrected.version } } : {}),
    after: { ...data, staffId: request.staffId, date: request.date, lines },
  });
  return id;
}

/**
 * Money kinds shown on the daily sheet page next to the সামারি (shop due, staff cash, SR cash).
 * Reversing the sheet also reverses these for the sheet's person and date.
 */
const DSR_DAY_PAGE_MONEY_KINDS = [
  "marketDueNew",
  "marketDueCollected",
  "staffAdvance",
  "staffShortage",
  "staffRepayment",
  "staffAbsent",
  "srLoan",
  "srRepayment",
] as const;

/**
 * Posts or reverses a sheet with everything it owns: the field visits' dues and exchange case
 * (D40). The handover difference is shown only (D62); reversing still removes entries an earlier
 * posting created (D54 history). On a real reverse, also reverses the money entered on this SR
 * sheet (shop due, staff/SR cash, operating cost); `keepSheetMoney` leaves it for a correction
 * that re-posts the sheet. The stock check is left to the caller.
 */
async function moveDsrDay(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  row: DsrRow,
  to: "posted" | "reversed",
  options: { keepSheetMoney?: boolean } = {},
): Promise<void> {
  const now = new Date();
  const stamp =
    to === "posted"
      ? { postedAt: now, postedById: ctx.actor.userId }
      : { reversedAt: now, reversedById: ctx.actor.userId };
  const updated = await tx.dsrDay.updateMany({
    where: { id: row.id, version: row.version, status: to === "posted" ? "draft" : "posted" },
    data: { status: to, version: { increment: 1 }, ...stamp },
  });
  if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
  const day = { id: row.id, staffId: row.staffId, date: fromDbDate(row.date) };
  if (to === "posted") {
    await postFieldVisits(tx, ctx, access, { ...row, ...day });
  } else {
    await reverseFieldVisits(tx, ctx, access.company.id, day);
    if (options.keepSheetMoney) return;
    const moneyStamp = {
      status: "reversed" as const,
      reversedAt: now,
      reversedById: ctx.actor.userId,
    };
    // Hand-entered page money of this SR sheet (field-/sheet-owned rows already reversed). Rows
    // from before sheets owned their money (no sheetStaffId) fall back to the SR's own entries.
    await tx.moneyEntry.updateMany({
      where: {
        companyId: access.company.id,
        date: row.date,
        OR: [{ sheetStaffId: day.staffId }, { sheetStaffId: null, staffId: day.staffId }],
        status: "posted",
        payrollRunId: null,
        dsrDayId: null,
        kind: { in: [...DSR_DAY_PAGE_MONEY_KINDS] },
      },
      data: moneyStamp,
    });
    // খরচ entered on this sheet only; another SR's sheet keeps its own.
    await tx.moneyEntry.updateMany({
      where: {
        companyId: access.company.id,
        date: row.date,
        sheetStaffId: day.staffId,
        status: "posted",
        payrollRunId: null,
        kind: "expense",
      },
      data: moneyStamp,
    });
  }
}

/** Products whose stock a move takes out: posting takes issued − returned, reversing gives it back. */
function stockTakenOut(row: DsrRow, to: "posted" | "reversed"): string[] {
  return row.lines
    .filter((line) => {
      const net = toDecimal(line.issued).sub(toDecimal(line.returned));
      return to === "posted" ? net.gt(0) : net.lt(0);
    })
    .map((line) => line.productId);
}

/** D112 / D135: after হাতে জমা, only Super Admin may change the sheet (always, even when approved). */
function assertHandoverEditable(ctx: AppContext, status: string | null | undefined) {
  if (status === "pending" || status === "approved") {
    if (!ctx.actor.isSuperAdmin) {
      throw invalid("handoverStatus", "validation.daily.handoverLocked");
    }
  }
}

/**
 * D114: after হাতে জমা on any sheet for the date, only Super Admin may post/correct/reverse
 * that day's money entries (Manager and DSR are locked for the date).
 */
async function assertDateHandoverEditable(
  tx: Tx,
  ctx: AppContext,
  companyId: string,
  date: string,
) {
  if (ctx.actor.isSuperAdmin) return;
  const locked = await tx.dsrDay.findFirst({
    where: {
      companyId,
      date: toDbDate(date),
      status: { not: "reversed" },
      handoverStatus: { in: ["pending", "approved"] },
    },
    select: { id: true },
  });
  if (locked) throw invalid("handoverStatus", "validation.daily.handoverLocked");
}

/** D112: DSR may not change issued/summary qty; only return/damage/commission (and related money). */
function assertDsrSaveAllowed(
  access: CompanyAccess,
  request: DsrDaySaveInput,
  existingLines: {
    dsrStaffId: string;
    productId: string;
    batchKey: string;
    issued: { toFixed(): string } | string;
  }[],
) {
  if (access.loginRoleKind !== "dsr") return;
  const prev = new Map(
    existingLines.map((l) => [
      `${l.dsrStaffId}|${l.productId}|${l.batchKey}`,
      plain(l.issued as never),
    ]),
  );
  request.lines.forEach((line, index) => {
    const key = `${line.dsrStaffId}|${line.productId}|${line.batchKey}`;
    const was = prev.get(key) ?? "0";
    if (toDecimal(line.issued).eq(toDecimal(was))) return;
    throw invalid(`lines.${index}.issued`, "validation.daily.dsrCannotEditIssued");
  });
}

async function transitionDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey: string | undefined,
  move: { action: string; permission: PermissionId; from: string; to: string },
): Promise<DsrDay> {
  const access = await requirePermission(ctx, companyId, move.permission, { write: true });
  const { version } = parseInput(documentTransitionRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: move.action, requestKey },
    { id, version },
    async (tx) => {
      const row = await loadDsrDay(tx, companyId, id);
      if (row.status !== move.from || row.version !== version) {
        throw invalid("version", "validation.daily.stale");
      }
      assertHandoverEditable(ctx, row.handoverStatus);
      await postingGuard(tx, companyId, fromDbDate(row.date));
      await moveDsrDay(tx, ctx, access, row, move.to as "posted" | "reversed");
      await ensureStockCovers(
        tx,
        access,
        fromDbDate(row.date),
        stockTakenOut(row, move.to as "posted" | "reversed"),
      );
      await recordAudit(tx, ctx, {
        companyId,
        action: move.action,
        resourceType: "dsr_day",
        resourceId: id,
        before: { status: move.from, version },
        after: { status: move.to, version: version + 1 },
      });
      return toDsrDay(await loadDsrDay(tx, companyId, id), seesCost(access));
    },
  );
}

export async function postDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey?: string,
) {
  const access = await loadCompanyAccess(ctx, companyId);
  // D112: DSR may draft-save only; Manager/Super Admin post.
  if (access.loginRoleKind === "dsr") throw new AppError("FORBIDDEN");
  return transitionDsrDay(ctx, companyId, id, input, requestKey, {
    action: "dsr_day.post",
    permission: "sale.post",
    from: "draft",
    to: "posted",
  });
}

export function reverseDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey?: string,
) {
  return transitionDsrDay(ctx, companyId, id, input, requestKey, {
    action: "dsr_day.reverse",
    permission: "sale.reverse",
    from: "posted",
    to: "reversed",
  });
}

/** Deletes a draft sheet (never a posted one). */
export async function discardDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
): Promise<void> {
  await requirePermission(ctx, companyId, "sale.create", { write: true });
  const { version } = parseInput(documentTransitionRequestSchema, input);
  await ctx.db.$transaction(async (tx) => {
    const row = await tx.dsrDay.findFirst({
      where: { id, companyId },
      select: { handoverStatus: true, status: true, version: true },
    });
    if (!row || row.status !== "draft" || row.version !== version) {
      throw invalid("version", "validation.daily.stale");
    }
    assertHandoverEditable(ctx, row.handoverStatus);
    const deleted = await tx.dsrDay.deleteMany({
      where: { id, companyId, status: "draft", version },
    });
    if (deleted.count !== 1) throw invalid("version", "validation.daily.stale");
    await recordAudit(tx, ctx, {
      companyId,
      action: "dsr_day.discard",
      resourceType: "dsr_day",
      resourceId: id,
      before: { status: "draft", version },
    });
  });
}

/**
 * D112: Manager submits day-end হাতে জমা on a posted sheet → pending; locks Manager edits.
 */
export async function submitDsrHandover(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey?: string,
): Promise<DsrDay> {
  const access = await requirePermission(ctx, companyId, "sale.handover_submit", { write: true });
  const data = parseInput(dsrHandoverSubmitRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `dsr_day.handover_submit:${id}`, requestKey },
    { id, ...data },
    async (tx) => {
      const row = await loadDsrDay(tx, companyId, id);
      if (row.status !== "posted" || row.version !== data.version) {
        throw invalid("version", "validation.daily.stale");
      }
      if (row.handoverStatus === "pending" || row.handoverStatus === "approved") {
        throw invalid("handoverStatus", "validation.daily.handoverAlreadySubmitted");
      }
      const updated = await tx.dsrDay.updateMany({
        where: { id, companyId, status: "posted", version: data.version, handoverStatus: "none" },
        data: {
          cashHandedOver: data.cashHandedOver,
          handoverStatus: "pending",
          handoverSubmittedAt: new Date(),
          handoverSubmittedById: ctx.actor.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
      await recordAudit(tx, ctx, {
        companyId,
        action: "dsr_day.handover_submit",
        resourceType: "dsr_day",
        resourceId: id,
        after: { cashHandedOver: data.cashHandedOver, handoverStatus: "pending" },
      });
      return toDsrDay(await loadDsrDay(tx, companyId, id), seesCost(access));
    },
  );
}

/** D112: Super Admin approves a pending handover amount (accept figure only). Kept for API compat. */
export async function approveDsrHandover(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey?: string,
): Promise<DsrDay> {
  if (!ctx.actor.isSuperAdmin) throw new AppError("FORBIDDEN");
  const access = await loadCompanyAccess(ctx, companyId);
  const data = parseInput(dsrHandoverApproveRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `dsr_day.handover_approve:${id}`, requestKey },
    { id, ...data },
    async (tx) => {
      const row = await loadDsrDay(tx, companyId, id);
      if (row.status !== "posted" || row.version !== data.version) {
        throw invalid("version", "validation.daily.stale");
      }
      if (row.handoverStatus !== "pending") {
        throw invalid("handoverStatus", "validation.daily.handoverNotPending");
      }
      const updated = await tx.dsrDay.updateMany({
        where: {
          id,
          companyId,
          status: "posted",
          version: data.version,
          handoverStatus: "pending",
        },
        data: {
          handoverStatus: "approved",
          handoverApprovedAt: new Date(),
          handoverApprovedById: ctx.actor.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
      await recordAudit(tx, ctx, {
        companyId,
        action: "dsr_day.handover_approve",
        resourceType: "dsr_day",
        resourceId: id,
        after: { handoverStatus: "approved" },
      });
      return toDsrDay(await loadDsrDay(tx, companyId, id), seesCost(access));
    },
  );
}

/**
 * Dashboard date/range approve: all pending হাতে জমা sheets in [from, to] → approved
 * (owner 2026-11-11; replaces per-sheet Approve). Super Admin / `sale.handover_approve`.
 */
export async function approveDsrHandoversForRange(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<{ count: number }> {
  const access = await requirePermission(ctx, companyId, "sale.handover_approve", { write: true });
  const from = businessDate(
    typeof input === "object" && input && "from" in input
      ? (input as { from: unknown }).from
      : input,
    "from",
  );
  const toRaw =
    typeof input === "object" && input && "to" in input
      ? (input as { to?: unknown }).to
      : undefined;
  const to = toRaw === undefined || toRaw === null ? from : businessDate(toRaw, "to");
  return runIdempotent(
    ctx,
    { scope: companyId, action: `dsr_day.handover_approve_range:${from}:${to}`, requestKey },
    { from, to },
    async (tx) => {
      const rows = await tx.dsrDay.findMany({
        where: {
          companyId,
          date: { gte: toDbDate(from), lte: toDbDate(to) },
          status: "posted",
          OR: [
            { handoverStatus: "pending" },
            { handoverStatus: "none", cashHandedOver: { not: null } },
          ],
        },
        select: { id: true },
      });
      if (rows.length === 0) return { count: 0 };
      const updated = await tx.dsrDay.updateMany({
        where: {
          companyId,
          id: { in: rows.map((r) => r.id) },
          status: "posted",
          OR: [
            { handoverStatus: "pending" },
            { handoverStatus: "none", cashHandedOver: { not: null } },
          ],
        },
        data: {
          handoverStatus: "approved",
          handoverApprovedAt: new Date(),
          handoverApprovedById: ctx.actor.userId,
          version: { increment: 1 },
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "dsr_day.handover_approve_range",
        resourceType: "stock_day",
        resourceId: from === to ? from : `${from}/${to}`,
        after: { count: updated.count, ids: rows.map((r) => r.id) },
      });
      return { count: updated.count };
    },
  );
}

// ---------------------------------------------------------------- money entries

/** Who may post each entry type (guide §12.2). */

const MONEY_PERSON = moneyKindPerson;
const CATEGORY_KINDS = new Set<MoneyEntryKind>(moneyCategoryKinds);
const PRODUCT_KINDS = new Set<MoneyEntryKind>(moneyProductKinds);
const ALLOCATION_KINDS = new Set<MoneyEntryKind>(moneyAllocationKinds);
const MARKET_KINDS = new Set<MoneyEntryKind>(["marketDueNew", "marketDueCollected"]);
const SR_LOAN_TYPE_KINDS = new Set<MoneyEntryKind>(srLoanTypeKinds);

const moneyInclude = {
  staff: { select: { name: true } },
  shop: { select: { name: true } },
  expenseCategory: { select: { name: true } },
  product: { select: { name: true } },
} as const;
type MoneyRow = Prisma.MoneyEntryGetPayload<{ include: typeof moneyInclude }>;

function toMoneyEntry(row: MoneyRow): MoneyEntry {
  return moneyEntrySchema.parse({
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
  });
}

/**
 * An explicit allocation or offset may only take what the person owes on the date; an offset
 * also needs as much credit (or money owed to the SR) as it settles. Never netted silently (D27).
 */
async function checkOwedLimits(
  tx: Tx,
  access: CompanyAccess,
  request: { kind: MoneyEntryKind; amount: string; staffId: string | null; date: string },
  allocation: { advance: string; loan: string; shortage: string } | null,
): Promise<void> {
  const offset = request.kind === "staffOffset" || request.kind === "srOffset";
  if (!request.staffId || (!allocation && !offset)) return;
  const run = await staffRun(tx, access.company.tenantId, request.date);
  const b = run?.output.closing.staff[request.staffId];
  const owed = (key: "advance" | "loan" | "shortage" | "credit" | "srLoan" | "owedToSr") =>
    toDecimal(b?.[key] ?? "0");
  const amount = toDecimal(request.amount);
  if (allocation) {
    for (const key of ["advance", "loan", "shortage"] as const) {
      if (toDecimal(allocation[key]).gt(owed(key))) {
        throw invalid(`allocation.${key}`, "validation.money.allocationExceeds");
      }
    }
  }
  if (request.kind === "staffOffset") {
    const totalOwed = owed("advance").add(owed("loan")).add(owed("shortage"));
    if (amount.gt(totalOwed) || amount.gt(owed("credit"))) {
      throw invalid("amount", "validation.money.offsetExceeds");
    }
  }
  if (request.kind === "srOffset" && (amount.gt(owed("srLoan")) || amount.gt(owed("owedToSr")))) {
    throw invalid("amount", "validation.money.offsetExceeds");
  }
}

/**
 * Money entries from `from` to `to` (inclusive). Market due entries need `sale.view`; the others
 * need `finance.view`. Only the kinds the actor may see are returned.
 */
export async function listMoneyEntries(
  ctx: AppContext,
  companyId: string,
  query: {
    from: unknown;
    to?: unknown;
    staffId?: string | null;
    shopId?: string | null;
    /** Only entries entered on this SR's daily sheet. */
    sheetStaffId?: string | null;
  },
): Promise<MoneyEntry[]> {
  const access = await loadCompanyAccess(ctx, companyId);
  const from = businessDate(query.from, "from");
  const to = query.to === undefined || query.to === null ? from : businessDate(query.to, "to");
  const market = access.permissions.includes("sale.view");
  const finance = access.permissions.includes("finance.view");
  if (!market && !finance) throw new AppError("FORBIDDEN");
  const kinds = Object.keys(moneyKindPermission).filter((k) =>
    MARKET_KINDS.has(k as MoneyEntryKind) ? market : finance,
  );
  const rows = await ctx.db.moneyEntry.findMany({
    where: {
      companyId,
      kind: { in: kinds },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.shopId ? { shopId: query.shopId } : {}),
      ...(query.sheetStaffId ? { sheetStaffId: query.sheetStaffId } : {}),
    },
    include: moneyInclude,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toMoneyEntry);
}

type MoneyPostParsed = ReturnType<typeof moneyEntryPostRequestSchema.parse>;

/** Shape and cross-field checks shared by post and correct (D12 / D114). */
function parseMoneyPostRequest(input: unknown): MoneyPostParsed {
  const request = parseInput(moneyEntryPostRequestSchema, input);
  // D69: SR incentive paid in cash is retired; D72: so is a transfer between accounts (all money
  // is cash). Old entries stay in the history.
  if (
    request.kind === "srIncentive" ||
    request.kind === "cashTransfer" ||
    request.kind === "companyCheckPayment"
  ) {
    // companyCheckPayment is posted only via postCompanyCheckPayment (D129).
    throw invalid("kind", "validation.daily.kindRetired");
  }
  const effect = MONEY_KIND_EFFECTS[request.kind];
  const person = MONEY_PERSON[request.kind];
  if (effect.requiresStaff && !request.staffId) {
    throw invalid("staffId", "validation.daily.staffRequired");
  }
  if (!person && request.staffId) throw invalid("staffId", "validation.daily.noStaffForKind");
  const market = MARKET_KINDS.has(request.kind);
  if (market && !request.staffId) throw invalid("staffId", "validation.daily.staffRequired");
  if (market !== Boolean(request.shopId ?? request.newShop)) {
    throw invalid("shopId", market ? "validation.shop.required" : "validation.shop.notForKind");
  }
  if (CATEGORY_KINDS.has(request.kind) !== Boolean(request.expenseCategoryId)) {
    throw invalid(
      "expenseCategoryId",
      CATEGORY_KINDS.has(request.kind)
        ? "validation.daily.categoryRequired"
        : "validation.daily.noCategoryForKind",
    );
  }
  if (SR_LOAN_TYPE_KINDS.has(request.kind) !== Boolean(request.srLoanType)) {
    throw invalid(
      "srLoanType",
      SR_LOAN_TYPE_KINDS.has(request.kind)
        ? "validation.money.srLoanTypeRequired"
        : "validation.money.noSrLoanTypeForKind",
    );
  }
  // D105: optional even for a kind that may name a product (just not for any other kind).
  if (request.productId && !PRODUCT_KINDS.has(request.kind)) {
    throw invalid("productId", "validation.daily.noProductForKind");
  }
  const allocation = request.allocation;
  if (allocation) {
    if (!ALLOCATION_KINDS.has(request.kind)) {
      throw invalid("allocation", "validation.money.noAllocationForKind");
    }
    const parts = sumAmounts([allocation.advance, allocation.loan, allocation.shortage]);
    if (!toDecimal(parts).eq(toDecimal(request.amount))) {
      throw invalid("allocation", "validation.money.allocationSum");
    }
  }
  return request;
}

async function insertMoneyEntry(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  companyId: string,
  request: MoneyPostParsed,
  auditAction: "money.post" | "money.correct",
): Promise<MoneyEntry> {
  const person = MONEY_PERSON[request.kind];
  const market = MARKET_KINDS.has(request.kind);
  const allocation = request.allocation;
  if (request.staffId) {
    const role = await roleOn(tx, companyId, request.staffId, request.date);
    if (!role) throw invalid("staffId", "validation.daily.staffNotAssigned");
    const supplier = (await staffEmployer(tx, request.staffId)) === "supplier";
    if (person === "dsr" && role !== "dsr") throw invalid("staffId", "validation.daily.dsrOnly");
    // এসআর হিসাব is supplier-employed, even when the role kind is not sr (D79).
    if (person === "sr" && role !== "sr" && !supplier)
      throw invalid("staffId", "validation.daily.srOnly");
    if (person === "distributor" && (role === "sr" || supplier)) {
      throw invalid("staffId", "validation.daily.notForSr");
    }
  }
  if (request.expenseCategoryId) {
    const category = await tx.expenseCategory.findFirst({
      where: {
        id: request.expenseCategoryId,
        tenantId: access.company.tenantId,
        active: true,
      },
    });
    if (!category) throw invalid("expenseCategoryId", "validation.daily.unknownCategory");
  }
  if (request.productId) {
    const product = await tx.product.findFirst({
      where: { id: request.productId, companyId, status: "active" },
    });
    if (!product) throw invalid("productId", "validation.daily.unknownProduct");
  }
  let shopId = request.shopId;
  if (request.newShop) {
    // D50: the shop typed on the due page. An exact-name match is reused, never duplicated;
    // creating it needs only the posting permission of the kind, and rolls back with the entry.
    const { name } = request.newShop;
    const existing = await tx.shop.findFirst({ where: { companyId, name } });
    if (existing && existing.status !== "active") {
      throw invalid("newShop", "validation.shop.inactiveName");
    }
    shopId =
      existing?.id ?? (await insertShop(tx, ctx, access.company.tenantId, companyId, { name })).id;
  } else if (shopId) {
    const shop = await tx.shop.findFirst({
      where: { id: shopId, companyId, status: "active" },
    });
    if (!shop) throw invalid("shopId", "validation.shop.unknown");
  }
  if (
    market &&
    request.staffId &&
    (await hasFieldVisits(tx, companyId, request.staffId, request.date))
  ) {
    throw invalid("shopId", "validation.field.manualDueBlocked");
  }
  if (request.sheetStaffId) {
    const sheetOwner = await tx.staff.findFirst({
      where: { id: request.sheetStaffId, tenantId: access.company.tenantId },
      select: { id: true },
    });
    if (!sheetOwner) throw invalid("sheetStaffId", "validation.daily.staffNotAssigned");
  }
  await checkOwedLimits(tx, access, request, allocation);
  const row = await tx.moneyEntry.create({
    data: {
      tenantId: access.company.tenantId,
      companyId,
      date: toDbDate(request.date),
      kind: request.kind,
      amount: request.amount,
      staffId: request.staffId,
      shopId,
      expenseCategoryId: request.expenseCategoryId,
      productId: request.productId,
      allocAdvance: allocation?.advance ?? null,
      allocLoan: allocation?.loan ?? null,
      allocShortage: allocation?.shortage ?? null,
      srLoanType: request.srLoanType,
      sheetStaffId: request.sheetStaffId,
      createdById: ctx.actor.userId,
    },
    include: moneyInclude,
  });
  await recordAudit(tx, ctx, {
    companyId,
    action: auditAction,
    resourceType: "money_entry",
    resourceId: row.id,
    after: request,
  });
  return toMoneyEntry(row);
}

function assertMoneyEntryReversible(row: {
  status: string;
  payrollRunId: string | null;
  dsrDayId: string | null;
  kind: string;
}) {
  if (row.status !== "posted") throw invalid("", "validation.daily.alreadyReversed");
  if (row.payrollRunId) throw invalid("", "validation.money.payrollOwned");
  if (row.dsrDayId) {
    // D54: a handover shortage/excess belongs to its day sheet; field entries to the field day.
    const handover = row.kind === "staffShortage" || row.kind === "staffExcess";
    throw invalid("", handover ? "validation.money.dsrDayOwned" : "validation.money.fieldOwned");
  }
}

export async function postMoneyEntry(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<MoneyEntry> {
  const request = parseMoneyPostRequest(input);
  const access = await requirePermission(ctx, companyId, moneyKindPermission[request.kind], {
    write: true,
  });

  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "money.post", requestKey },
      request,
      async (tx) => {
        await postingGuard(tx, companyId, request.date);
        await assertDateHandoverEditable(tx, ctx, companyId, request.date);
        return insertMoneyEntry(tx, ctx, access, companyId, request, "money.post");
      },
    );
  } catch (error) {
    // Two requests creating the same new shop at once: the loser sees the name clash.
    if (request.newShop && isUniqueViolation(error)) {
      throw invalid("newShop", "validation.shop.duplicate");
    }
    throw error;
  }
}

/**
 * D114: correct a posted daily money row in one transaction (reverse + re-enter). Super Admin
 * always; Manager until হাতে জমা for that date; DSR never. Needs the kind's post permission, not
 * `payment.reverse`.
 */
export async function correctMoneyEntry(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  input: unknown,
  requestKey?: string,
): Promise<MoneyEntry> {
  const request = parseMoneyPostRequest(input);
  const access = await requirePermission(ctx, companyId, moneyKindPermission[request.kind], {
    write: true,
  });
  if (access.loginRoleKind === "dsr") throw new AppError("FORBIDDEN");

  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "money.correct", requestKey },
      { entryId, ...request },
      async (tx) => {
        const row = await tx.moneyEntry.findFirst({ where: { id: entryId, companyId } });
        if (!row) throw invalid("", "validation.daily.notFound");
        assertMoneyEntryReversible(row);
        const date = fromDbDate(row.date);
        if (request.date !== date) throw invalid("date", "validation.money.correctDateFixed");
        await postingGuard(tx, companyId, date);
        await assertDateHandoverEditable(tx, ctx, companyId, date);
        const reversed = await tx.moneyEntry.updateMany({
          where: { id: entryId, status: "posted" },
          data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
        });
        if (reversed.count !== 1) throw invalid("", "validation.daily.alreadyReversed");
        await recordAudit(tx, ctx, {
          companyId,
          action: "money.correct",
          resourceType: "money_entry",
          resourceId: entryId,
          before: { status: "posted", kind: row.kind, amount: plain(row.amount) },
          after: { status: "reversed" },
        });
        return insertMoneyEntry(tx, ctx, access, companyId, request, "money.correct");
      },
    );
  } catch (error) {
    if (request.newShop && isUniqueViolation(error)) {
      throw invalid("newShop", "validation.shop.duplicate");
    }
    throw error;
  }
}

export async function reverseMoneyEntry(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  requestKey?: string,
): Promise<MoneyEntry> {
  await requirePermission(ctx, companyId, "payment.reverse", { write: true });
  return runIdempotent(
    ctx,
    { scope: companyId, action: "money.reverse", requestKey },
    { entryId },
    async (tx) => {
      const row = await tx.moneyEntry.findFirst({ where: { id: entryId, companyId } });
      if (!row) throw invalid("", "validation.daily.notFound");
      assertMoneyEntryReversible(row);
      const date = fromDbDate(row.date);
      await postingGuard(tx, companyId, date);
      await assertDateHandoverEditable(tx, ctx, companyId, date);
      const updated = await tx.moneyEntry.updateMany({
        where: { id: entryId, status: "posted" },
        data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("", "validation.daily.alreadyReversed");
      await recordAudit(tx, ctx, {
        companyId,
        action: "money.reverse",
        resourceType: "money_entry",
        resourceId: entryId,
        before: { status: "posted" },
        after: { status: "reversed" },
      });
      return toMoneyEntry(
        await tx.moneyEntry.findUniqueOrThrow({ where: { id: entryId }, include: moneyInclude }),
      );
    },
  );
}

/**
 * D123: permanently delete a দোকানের বাকি / আদায় row. Posted rows drop out of the ledger (same
 * hishab effect as reverse). Super Admin always; Manager until হাতে জমা; DSR never. Needs the
 * kind's post permission, not `payment.reverse`.
 */
export async function deleteMoneyEntry(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  requestKey?: string,
): Promise<void> {
  const existing = await ctx.db.moneyEntry.findFirst({
    where: { id: entryId, companyId },
    select: { kind: true },
  });
  if (!existing) throw invalid("", "validation.daily.notFound");
  if (!MARKET_KINDS.has(existing.kind as MoneyEntryKind)) {
    throw invalid("kind", "validation.money.shopDueDeleteOnly");
  }
  const access = await requirePermission(
    ctx,
    companyId,
    moneyKindPermission[existing.kind as MoneyEntryKind],
    { write: true },
  );
  if (access.loginRoleKind === "dsr") throw new AppError("FORBIDDEN");

  await runIdempotent(
    ctx,
    { scope: companyId, action: `money.delete:${entryId}`, requestKey },
    { entryId },
    async (tx) => {
      const row = await tx.moneyEntry.findFirst({ where: { id: entryId, companyId } });
      if (!row) throw invalid("", "validation.daily.notFound");
      if (!MARKET_KINDS.has(row.kind as MoneyEntryKind)) {
        throw invalid("kind", "validation.money.shopDueDeleteOnly");
      }
      if (row.payrollRunId) throw invalid("", "validation.money.payrollOwned");
      if (row.dsrDayId) throw invalid("", "validation.money.fieldOwned");
      const date = fromDbDate(row.date);
      await postingGuard(tx, companyId, date);
      await assertDateHandoverEditable(tx, ctx, companyId, date);
      await recordAudit(tx, ctx, {
        companyId,
        action: "money.delete",
        resourceType: "money_entry",
        resourceId: entryId,
        before: {
          status: row.status,
          kind: row.kind,
          amount: plain(row.amount),
          date,
          staffId: row.staffId,
          shopId: row.shopId,
        },
      });
      await tx.moneyEntry.delete({ where: { id: entryId } });
    },
  );
}

// ---------------------------------------------------------------- views

const ZERO_MONEY = {
  sales: "0",
  commission: "0",
  marketDueNew: "0",
  marketDueCollected: "0",
  srIncentive: "0",
  expenses: "0",
  cashIn: "0",
  cashOut: "0",
  cashLeft: "0",
  banked: "0",
};

/** The engine's view of one date (PLAN §6): godown, DSR sales, money, dues and warnings. */
export async function getDayView(
  ctx: AppContext,
  companyId: string,
  dateInput: unknown,
): Promise<DayView> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const date = businessDate(dateInput);
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  const canSeeProfit = canSeeCost && access.permissions.includes("report.profit_view");
  const [active, names] = await Promise.all([
    liveOpening(ctx.db, companyId),
    namesFor(ctx.db, access, date),
  ]);
  const [run, handoverShorts] = await Promise.all([
    runLedger(ctx.db, access, date, active),
    listHandoverShorts(ctx.db, companyId, date, date),
  ]);
  const day = run?.output.days.find((d) => d.date === date);
  const byId = new Map(day?.products.map((p) => [p.productId, p]));
  const cost = (value: string) => (canSeeCost ? value : null);
  const inStock = new Set(
    (day?.products ?? []).flatMap((p) =>
      p.batches.filter((b) => !toDecimal(b.quantity).isZero()).map((b) => b.key),
    ),
  );
  const lots = day
    ? await productLots(ctx.db, companyId, date, inStock, canSeeCost)
    : new Map<string, ProductLot[]>();

  return dayViewSchema.parse({
    date,
    cutoffDate: active?.cutoffDate ?? null,
    products: day
      ? names.products.flatMap((product) => {
          const row = byId.get(product.id);
          if (!row) return [];
          return [
            {
              ...row,
              sku: product.sku,
              productName: product.name,
              piecesPerCarton: product.piecesPerCarton,
              costPrice: canSeeCost ? row.costPrice : null,
              cost: cost(row.cost),
              grossProfit: canSeeProfit ? row.grossProfit : null,
              damageValue: cost(row.damageValue),
              damageRecovery: cost(row.damageRecovery),
              stockValue: cost(row.stockValue),
              batches: row.batches.map((b) => ({
                ...b,
                costPrice: cost(b.costPrice),
                value: cost(b.value),
              })),
              lots: lots.get(product.id) ?? [],
            },
          ];
        })
      : [],
    persons: (day?.persons ?? []).map((p) => ({
      ...p,
      staffName: names.staff.get(p.staffId) ?? "",
      allocations: p.allocations.map((a) => ({ ...a, costPrice: cost(a.costPrice) })),
    })),
    money: day?.money ?? ZERO_MONEY,
    company:
      canSeeCost && run
        ? {
            balance: toDecimal(run.output.month.companyPayable.closing).neg().toString(),
            undeliveredValue: run.output.month.companyPayable.undeliveredClosing,
            undeliveredPieces: sumQuantities([
              "0",
              ...run.output.month.products.map((p) => p.dueFromCompany),
            ]),
            damageBalance: run.output.month.companyPayable.damageBalance,
            incentiveBalance: run.output.month.companyPayable.incentiveBalance,
            totalCash: sumAmounts(["0", ...run.output.month.cashBook.map((a) => a.closing)]),
          }
        : null,
    marketDueOutstanding: run?.output.month.marketDue.closing ?? "0",
    marketDueByDsr: (run?.output.month.marketDue.byDsr ?? [])
      .filter((d) => d.closing !== "0" && d.closing !== "0.00")
      .map((d) => ({
        staffId: d.staffId,
        staffName: names.staff.get(d.staffId) ?? "",
        amount: d.closing,
      })),
    handoverShorts,
    warnings: (run?.output.warnings ?? []).filter((w) => w.date === date),
    canSeeCost,
    canSeeProfit,
  });
}

/**
 * The dashboard's report for a range (guide 5.2): one engine run over [from, to], each day
 * summarised by the domain and summed here; `to` stops at today (same rules as reports).
 */
function damageLotsOf(run: { output: MonthOutput } | null, to: string, names: Map<string, string>) {
  const day = run?.output.days.find((d) => d.date === to) ?? run?.output.days.at(-1);
  return (day?.products ?? [])
    .flatMap((product) =>
      product.damageLots.map((lot) => ({
        productId: product.productId,
        productName: names.get(product.productId) ?? "",
        rate: lot.rate,
        pieces: lot.pieces,
        amount: toDecimal(lot.pieces).mul(lot.rate).toDecimalPlaces(2).toFixed(2),
      })),
    )
    .sort(
      (a, b) =>
        a.productName.localeCompare(b.productName, "bn") ||
        (toDecimal(a.rate).comparedTo(b.rate) ?? 0),
    );
}

export async function getDashboardSummary(
  ctx: AppContext,
  companyId: string,
  query: unknown,
): Promise<DashboardSummary> {
  const access = await requirePermission(ctx, companyId, "company.view");
  return (await dashboardOf(ctx, access, parseReportRange(query))).summary;
}

/**
 * Month-wise মোট বিক্রি for the company dashboard chart (D128). Reuses `dashboardOf` per month;
 * months after today are zero.
 */
export async function getDashboardMonthly(
  ctx: AppContext,
  companyId: string,
  yearInput: unknown,
): Promise<DashboardMonthly> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const year =
    typeof yearInput === "string" && /^\d{4}$/.test(yearInput)
      ? yearInput
      : todayBusinessDate().slice(0, 4);
  const today = monthOf(todayBusinessDate());
  const canSeeProfit =
    access.permissions.includes("inventory.cost_view") &&
    access.permissions.includes("report.profit_view");
  const months = await Promise.all(
    Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      return (async () => {
        if (month > today) {
          return {
            month,
            totalSales: "0.00",
            ...(canSeeProfit ? { salesProfit: "0.00" } : {}),
          };
        }
        const { summary } = await dashboardOf(ctx, access, {
          from: firstOfMonth(month),
          to: lastOfMonth(month),
        });
        return {
          month,
          totalSales: summary.totalSales,
          ...(canSeeProfit && summary.salesProfit !== undefined
            ? { salesProfit: summary.salesProfit }
            : {}),
        };
      })();
    }),
  );
  return dashboardMonthlySchema.parse({ year, months });
}

/**
 * Last 12 calendar days of মোট বিক্রি for the dashboard chart day tab (D128). One ledger run
 * over the window; days with no activity are zero.
 */
export async function getDashboardDaily(
  ctx: AppContext,
  companyId: string,
): Promise<DashboardDaily> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const to = todayBusinessDate();
  const from = shiftBusinessDate(to, -11);
  const labels = datesBetween(from, to);
  const canSeeProfit =
    access.permissions.includes("inventory.cost_view") &&
    access.permissions.includes("report.profit_view");
  const active = await liveOpening(ctx.db, companyId);
  const run = await rangeRun(ctx.db, access, from, to, active);
  const byDate = new Map<string, { totalSales: string; salesProfit?: string }>();
  if (run) {
    for (let index = 0; index < run.output.days.length; index += 1) {
      const day = run.output.days[index];
      const input = run.input[index];
      if (!day || !input) continue;
      const summary = summarizeDay(day, input);
      const totals = dashboardTotals({
        issuedValue: summary.issuedValue,
        returnValue: summary.returnValue,
        damageSaleValue: summary.damageSaleValue,
        commission: summary.commission,
        expenses: summary.expenses,
        staffCost: summary.staffCost,
        marketDueCreated: summary.marketDueCreated,
        oldDuesCollected: summary.oldDuesCollected,
        salesProfit: summary.salesProfit,
      });
      byDate.set(day.date, {
        totalSales: totals.totalSales,
        ...(canSeeProfit ? { salesProfit: summary.salesProfit } : {}),
      });
    }
  }
  const days = labels.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      totalSales: row?.totalSales ?? "0.00",
      ...(canSeeProfit ? { salesProfit: row?.salesProfit ?? "0.00" } : {}),
    };
  });
  return dashboardDailySchema.parse({ from, to, days });
}

/** The dashboard summary plus the engine's profit over the range (the master panel's P&L). */
export async function dashboardOf(
  ctx: AppContext,
  access: CompanyAccess,
  range: { from: string; to: string },
): Promise<{
  summary: DashboardSummary;
  profit: MonthOutput["month"]["profit"] | null;
}> {
  const companyId = access.company.id;
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  const canSeeProfit = canSeeCost && access.permissions.includes("report.profit_view");
  const dates = { gte: toDbDate(range.from), lte: toDbDate(range.to) };
  const active = await liveOpening(ctx.db, companyId);
  const [run, names, products, sheets, receipts, handoverShorts, handoverRows] = await Promise.all([
    rangeRun(ctx.db, access, range.from, range.to, active),
    ctx.db.staff.findMany({
      where: { tenantId: access.company.tenantId },
      select: { id: true, name: true },
    }),
    ctx.db.product.findMany({
      where: { companyId },
      select: { id: true, name: true },
    }),
    ctx.db.dsrDay.count({ where: { companyId, date: dates, status: "posted" } }),
    ctx.db.stockEntry.count({
      where: { companyId, date: dates, status: "posted", kind: "receipt" },
    }),
    listHandoverShorts(ctx.db, companyId, range.from, range.to),
    ctx.db.dsrDay.findMany({
      where: {
        companyId,
        date: dates,
        status: "posted",
        OR: [
          { handoverStatus: { in: ["pending", "approved"] } },
          { handoverStatus: "none", cashHandedOver: { not: null } },
        ],
      },
      select: { handoverStatus: true, cashHandedOver: true },
      orderBy: { date: "desc" },
    }),
  ]);
  const cashInHandHandover = (() => {
    // Pending: explicit submit, or হাতে জমা amount saved on a posted sheet not yet approved.
    const awaiting = (r: (typeof handoverRows)[number]) =>
      r.handoverStatus === "pending" || (r.handoverStatus === "none" && r.cashHandedOver != null);
    if (handoverRows.some(awaiting)) {
      const pending = handoverRows.find(awaiting);
      return {
        status: "pending" as const,
        amount: pending?.cashHandedOver != null ? plain(pending.cashHandedOver) : null,
      };
    }
    if (handoverRows.some((r) => r.handoverStatus === "approved")) {
      const approved = handoverRows.find((r) => r.handoverStatus === "approved");
      return {
        status: "approved" as const,
        amount: approved?.cashHandedOver != null ? plain(approved.cashHandedOver) : null,
      };
    }
    return { status: "none" as const, amount: null };
  })();
  const summaries = run
    ? run.output.days.flatMap((day, index) => {
        const input = run.input[index];
        return input ? [summarizeDay(day, input)] : [];
      })
    : [];
  const total = (pick: (s: (typeof summaries)[number]) => string) =>
    sumAmounts(summaries.map(pick));
  const staffName = new Map(names.map((s) => [s.id, s.name]));
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const dsrIds = [...new Set(summaries.flatMap((s) => s.byDsr.map((r) => r.staffId)))];
  const byDsr = dsrIds.map((staffId) => {
    const rows = summaries.flatMap((s) => s.byDsr.filter((r) => r.staffId === staffId));
    const sum = (pick: (r: (typeof rows)[number]) => string) => sumAmounts(rows.map(pick));
    return {
      dsrId: staffId,
      dsrName: staffName.get(staffId) ?? "",
      netSales: sum((r) => r.netSales),
      salesCash: sum((r) => r.salesCash),
      marketDueCreated: sum((r) => r.marketDueCreated),
      oldDuesCollected: sum((r) => r.oldDuesCollected),
      issuedValue: sum((r) => r.issuedValue),
      returnValue: sum((r) => r.returnValue),
      damageSaleValue: sum((r) => r.damageSaleValue),
      commission: sum((r) => r.commission),
      totalSales: sum((r) => r.totalSales),
      ...(canSeeProfit ? { salesProfit: sum((r) => r.salesProfit) } : {}),
    };
  });

  const seesFinance = access.permissions.includes("finance.view");
  const srCost = srCostOf(run?.output.month.staff ?? [], run !== null && run.from === run.to);
  const salesProfit = total((s) => s.salesProfit);
  const totals = dashboardTotals({
    issuedValue: total((s) => s.issuedValue),
    returnValue: total((s) => s.returnValue),
    damageSaleValue: total((s) => s.damageSaleValue),
    commission: total((s) => s.commission),
    expenses: total((s) => s.expenses),
    staffCost: total((s) => s.staffCost),
    marketDueCreated: total((s) => s.marketDueCreated),
    oldDuesCollected: total((s) => s.oldDuesCollected),
    salesProfit,
  });

  const damageLots = damageLotsOf(run, range.to, productName);
  const summary = dashboardSummarySchema.parse({
    from: range.from,
    to: range.to,
    cutoffDate: active?.cutoffDate ?? null,
    damageSaleValue: total((s) => s.damageSaleValue),
    // D133: card = held lots + deposits; cash still uses damageSaleValue above.
    damageTotal: dashboardDamageTotal({
      lots: damageLots,
      depositValue: run?.output.month.companyPayable.damageRefunds ?? "0",
    }),
    netSales: total((s) => s.netSales),
    salesCash: total((s) => s.salesCash),
    oldDuesCollected: total((s) => s.oldDuesCollected),
    cashCollected: total((s) => s.cashCollected),
    marketDueCreated: total((s) => s.marketDueCreated),
    marketDueOpening: run?.output.month.marketDue.opening ?? "0.00",
    marketDueOutstanding: run?.output.month.marketDue.closing ?? "0.00",
    issuedValue: total((s) => s.issuedValue),
    returnValue: total((s) => s.returnValue),
    commission: total((s) => s.commission),
    totalSales: totals.totalSales,
    handoverShort: sumAmounts(["0", ...handoverShorts.map((row) => row.amount)]),
    ...(seesFinance
      ? {
          expenses: total((s) => s.expenses),
          staffShortage: total((s) => s.staffShortage),
          staffCost: total((s) => s.staffCost),
          srCost,
          totalCost: totals.totalCost,
          profitCost: totals.profitCost,
          cashInHand: totals.cashInHand,
          cashInHandHandover,
        }
      : {}),
    postedSummaryCount: sheets,
    postedReceiptCount: receipts,
    byDsr,
    damageLots,
    ...(canSeeProfit && run
      ? {
          grossProfit: total((s) => s.grossProfit),
          salesProfit,
          ...(seesFinance && totals.netProfit !== null ? { netProfit: totals.netProfit } : {}),
        }
      : {}),
    ...(canSeeCost && run
      ? {
          receivedValue: total((s) => s.receivedValue),
          stockValue: summaries.at(-1)?.stockValue ?? "0.00",
          damageValue: total((s) => s.damageValue),
          undeliveredValue: run.output.month.companyPayable.undeliveredClosing,
        }
      : {}),
  });
  return { summary, profit: canSeeProfit && run ? run.output.month.profit : null };
}
