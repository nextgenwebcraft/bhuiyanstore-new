import { todayBusinessDate } from "@bsd/domain";
import {
  priceChangeRequestSchema,
  priceChangeSchema,
  productCreateRequestSchema,
  productHistorySchema,
  productPackRequestSchema,
  productPackSchema,
  productSchema,
  type PriceChange,
  type Product,
  type ProductHistory,
  type ProductPack,
} from "@bsd/contracts";
import { requirePermission } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, parseInput } from "./errors";
import { isForeignKeyViolation, isUniqueViolation, runIdempotent } from "./idempotency";
import { releaseOpeningLines } from "./opening-lock";

const MAX_PIECES_PER_CARTON = 100_000;

type PackRow = {
  id: string;
  productId: string;
  piecesPerCarton: number;
  effectiveFrom: Date | null;
};

type ProductRow = {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  aliases: string[];
  status: string;
  packs: PackRow[];
};

const withPacks = { packs: true } as const;

/** The pack in force on a date: the latest dated pack on or before it, else the base pack. */
export function packOn(packs: readonly PackRow[], businessDate: string): PackRow | undefined {
  let best: PackRow | undefined;
  for (const pack of packs) {
    if (pack.effectiveFrom === null) {
      best ??= pack;
      continue;
    }
    if (fromDbDate(pack.effectiveFrom) > businessDate) continue;
    if (!best?.effectiveFrom || pack.effectiveFrom > best.effectiveFrom) best = pack;
  }
  return best;
}

function toProduct(row: ProductRow): Product {
  const pack = packOn(row.packs, todayBusinessDate());
  if (!pack) throw new AppError("INTERNAL");
  return productSchema.parse({
    id: row.id,
    companyId: row.companyId,
    sku: row.sku,
    name: row.name,
    aliases: row.aliases,
    baseUnit: "piece",
    piecesPerCarton: String(pack.piecesPerCarton),
    status: row.status,
  });
}

function toPack(row: PackRow): ProductPack {
  return productPackSchema.parse({
    id: row.id,
    productId: row.productId,
    piecesPerCarton: String(row.piecesPerCarton),
    effectiveFrom: row.effectiveFrom ? fromDbDate(row.effectiveFrom) : null,
  });
}

function toPrice(row: {
  id: string;
  productId: string;
  kind: string;
  price: { toFixed(): string };
  effectiveFrom: Date;
}): PriceChange {
  return priceChangeSchema.parse({
    id: row.id,
    productId: row.productId,
    kind: row.kind,
    // Prisma's Decimal prints trailing zeros of NUMERIC(20,6); the contract wants a plain decimal.
    price: row.price
      .toFixed()
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, ""),
    effectiveFrom: fromDbDate(row.effectiveFrom),
  });
}

const duplicateSku = () =>
  new AppError("VALIDATION_FAILED", [{ path: "sku", code: "validation.product.duplicateSku" }]);

function piecesFrom(value: string, path: string): number {
  const pieces = Number(value);
  if (!Number.isSafeInteger(pieces) || pieces < 1 || pieces > MAX_PIECES_PER_CARTON) {
    throw new AppError("VALIDATION_FAILED", [{ path, code: "validation.positiveInteger.invalid" }]);
  }
  return pieces;
}

function parseProduct(input: unknown) {
  const data = parseInput(productCreateRequestSchema, input);
  return {
    request: data,
    pieces: piecesFrom(data.piecesPerCarton, "piecesPerCarton"),
    row: {
      sku: data.sku.trim(),
      name: data.name.trim(),
      aliases: [...new Set(data.aliases.map((a) => a.trim()).filter(Boolean))],
      status: data.status,
    },
  };
}

async function assertUniqueSku(tx: Tx, companyId: string, sku: string, exceptId?: string) {
  const clash = await tx.product.findFirst({
    where: { companyId, sku, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw duplicateSku();
}

async function findProduct(tx: Tx, companyId: string, productId: string) {
  const product = await tx.product.findFirst({
    where: { id: productId, companyId },
    include: withPacks,
  });
  if (!product) {
    throw new AppError("VALIDATION_FAILED", [{ path: "id", code: "validation.product.unknown" }]);
  }
  return product;
}

export async function listProducts(ctx: AppContext, companyId: string): Promise<Product[]> {
  await requirePermission(ctx, companyId, "product.view");
  const rows = await ctx.db.product.findMany({
    where: { companyId },
    include: withPacks,
    orderBy: { name: "asc" },
  });
  return rows.map(toProduct);
}

export async function createProduct(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Product> {
  const access = await requirePermission(ctx, companyId, "product.create", { write: true });
  const { request, row, pieces } = parseProduct(input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "product.create", requestKey },
      request,
      async (tx) => {
        await assertUniqueSku(tx, companyId, row.sku);
        const created = await tx.product.create({
          data: {
            ...row,
            tenantId: access.company.tenantId,
            companyId,
            packs: { create: { piecesPerCarton: pieces, effectiveFrom: null } },
          },
          include: withPacks,
        });
        const product = toProduct(created);
        await recordAudit(tx, ctx, {
          companyId,
          action: "product.create",
          resourceType: "product",
          resourceId: product.id,
          after: product,
        });
        return product;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateSku();
    throw error;
  }
}

/**
 * Full replace (no PATCH semantics). Archiving also needs `product.archive`. The carton size may
 * only be corrected here while the product has no dated pack; later changes go through
 * `addProductPack` so history is never rewritten (guide §4.4).
 */
export async function updateProduct(
  ctx: AppContext,
  companyId: string,
  productId: string,
  input: unknown,
  requestKey?: string,
): Promise<Product> {
  const access = await requirePermission(ctx, companyId, "product.edit", { write: true });
  const { request, row, pieces } = parseProduct(input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: `product.update:${productId}`, requestKey },
      request,
      async (tx) => {
        const existing = await findProduct(tx, companyId, productId);
        if (
          existing.status !== row.status &&
          row.status === "archived" &&
          !access.permissions.includes("product.archive")
        ) {
          throw new AppError("FORBIDDEN");
        }
        await assertUniqueSku(tx, companyId, row.sku, productId);
        const current = packOn(existing.packs, todayBusinessDate());
        if (current && current.piecesPerCarton !== pieces) {
          const base = existing.packs.find((p) => p.effectiveFrom === null);
          if (existing.packs.length > 1 || !base) {
            throw new AppError("VALIDATION_FAILED", [
              { path: "piecesPerCarton", code: "validation.product.packHasHistory" },
            ]);
          }
          await tx.productPack.update({
            where: { id: base.id },
            data: { piecesPerCarton: pieces },
          });
        }
        const updated = toProduct(
          await tx.product.update({ where: { id: productId }, data: row, include: withPacks }),
        );
        await recordAudit(tx, ctx, {
          companyId,
          action: "product.update",
          resourceType: "product",
          resourceId: productId,
          before: toProduct(existing),
          after: updated,
        });
        return updated;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateSku();
    throw error;
  }
}

export async function getProductHistory(
  ctx: AppContext,
  companyId: string,
  productId: string,
): Promise<ProductHistory> {
  await requirePermission(ctx, companyId, "product.view");
  const product = await ctx.db.product.findFirst({
    where: { id: productId, companyId },
    include: {
      packs: { orderBy: { effectiveFrom: { sort: "asc", nulls: "first" } } },
      prices: { orderBy: [{ kind: "asc" }, { effectiveFrom: "asc" }] },
    },
  });
  if (!product) {
    throw new AppError("VALIDATION_FAILED", [{ path: "id", code: "validation.product.unknown" }]);
  }
  return productHistorySchema.parse({
    packs: product.packs.map(toPack),
    prices: product.prices.map(toPrice),
  });
}

/** A carton size from a date on. A second change for the same date replaces the first. */
export async function addProductPack(
  ctx: AppContext,
  companyId: string,
  productId: string,
  input: unknown,
  requestKey?: string,
): Promise<ProductPack> {
  await requirePermission(ctx, companyId, "product.edit", { write: true });
  const data = parseInput(productPackRequestSchema, input);
  const pieces = piecesFrom(data.piecesPerCarton, "piecesPerCarton");
  return runIdempotent(
    ctx,
    { scope: companyId, action: `product.pack:${productId}`, requestKey },
    data,
    async (tx) => {
      await findProduct(tx, companyId, productId);
      const effectiveFrom = toDbDate(data.effectiveFrom);
      const before = await tx.productPack.findUnique({
        where: { productId_effectiveFrom: { productId, effectiveFrom } },
      });
      const pack = toPack(
        await tx.productPack.upsert({
          where: { productId_effectiveFrom: { productId, effectiveFrom } },
          create: { productId, piecesPerCarton: pieces, effectiveFrom },
          update: { piecesPerCarton: pieces },
        }),
      );
      await recordAudit(tx, ctx, {
        companyId,
        action: "product.pack_set",
        resourceType: "product",
        resourceId: productId,
        ...(before ? { before: toPack(before) } : {}),
        after: pack,
      });
      return pack;
    },
  );
}

/** A per-piece order/cost/sale price from a date on; same kind and date replaces (audited). */
export async function setProductPrice(
  ctx: AppContext,
  companyId: string,
  productId: string,
  input: unknown,
  requestKey?: string,
): Promise<PriceChange> {
  await requirePermission(ctx, companyId, "product.edit", { write: true });
  const data = parseInput(priceChangeRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `product.price:${productId}`, requestKey },
    data,
    async (tx) => {
      await findProduct(tx, companyId, productId);
      const key = {
        productId_kind_effectiveFrom: {
          productId,
          kind: data.kind,
          effectiveFrom: toDbDate(data.effectiveFrom),
        },
      };
      const before = await tx.priceChange.findUnique({ where: key });
      const price = toPrice(
        await tx.priceChange.upsert({
          where: key,
          create: { ...key.productId_kind_effectiveFrom, price: data.price, source: "manual" },
          update: { price: data.price, source: "manual" },
        }),
      );
      await recordAudit(tx, ctx, {
        companyId,
        action: "product.price_set",
        resourceType: "product",
        resourceId: productId,
        ...(before ? { before: toPrice(before) } : {}),
        after: price,
      });
      return price;
    },
  );
}

const productInUse = () =>
  new AppError("VALIDATION_FAILED", [{ path: "id", code: "validation.product.inUse" }]);

/**
 * Hard delete of a product that nothing refers to (D51): no godown, DSR, field or damage line,
 * and no opening line once the opening is locked (an unlocked opening's line goes with it, D59).
 * Its own carton sizes and price history go with it (cascade); a used product is refused and
 * should be archived instead.
 */
export async function deleteProduct(
  ctx: AppContext,
  companyId: string,
  productId: string,
): Promise<void> {
  await requirePermission(ctx, companyId, "product.edit", { write: true });
  try {
    await ctx.db.$transaction(async (tx) => {
      const existing = await findProduct(tx, companyId, productId);
      const refs = await Promise.all([
        tx.stockEntry.count({ where: { productId } }),
        tx.dsrLine.count({ where: { productId } }),
        tx.fieldVisitLine.count({ where: { productId } }),
        tx.damageCaseLine.count({ where: { productId } }),
      ]);
      if (refs.some((n) => n > 0)) throw productInUse();
      const opening = await releaseOpeningLines(tx, companyId, { productId });
      if (!opening) throw productInUse();
      await tx.product.delete({ where: { id: productId } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "product.delete",
        resourceType: "product",
        resourceId: productId,
        before: { ...toProduct(existing), openingLinesRemoved: opening },
      });
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw productInUse();
    throw error;
  }
}
