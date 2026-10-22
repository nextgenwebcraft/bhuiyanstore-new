import type { ProductLot } from "@bsd/contracts";
import {
  batchUndelivered,
  samePiecePrice,
  sumQuantities,
  toDecimal,
  type BatchMove,
} from "@bsd/domain";
import type { AppContext, Tx } from "./context";
import { toDbDate } from "./dates";
import { invalid } from "./errors";
import { plain, type DecimalLike } from "./numeric";

/**
 * D68: product batches (order lots). An order line names the purchase and sale price per piece;
 * the product's latest batch with the same prices is reused, otherwise a new batch is created.
 * Receipts and DSR lines name a batch; a changed price there becomes the batch's from then on.
 */

type Db = AppContext["db"] | Tx;

export type BatchRow = {
  id: string;
  productId: string;
  seq: number;
  source: string;
  costPrice: string;
  salePrice: string;
};

const batchSelect = {
  id: true,
  productId: true,
  seq: true,
  source: true,
  costPrice: true,
  salePrice: true,
} as const;

function toRow(b: {
  id: string;
  productId: string;
  seq: number;
  source: string;
  costPrice: DecimalLike;
  salePrice: DecimalLike;
}): BatchRow {
  return { ...b, costPrice: plain(b.costPrice), salePrice: plain(b.salePrice) };
}

async function nextSeq(tx: Tx, productId: string): Promise<number> {
  const last = await tx.productBatch.findFirst({
    where: { productId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

/**
 * The batch an order line (its paid and free pieces) goes into: the product's latest batch when
 * its prices equal the line's, else a new one. A free-only line (no cost) takes the latest
 * batch's purchase price.
 */
export async function orderBatch(
  tx: Tx,
  owner: { tenantId: string; companyId: string },
  productId: string,
  prices: { costPrice: string | null; salePrice: string },
): Promise<BatchRow> {
  const latest = await tx.productBatch.findFirst({
    where: { productId },
    orderBy: { seq: "desc" },
    select: batchSelect,
  });
  const costPrice = prices.costPrice ?? (latest ? plain(latest.costPrice) : "0");
  if (
    latest &&
    samePiecePrice(plain(latest.costPrice), costPrice) &&
    samePiecePrice(plain(latest.salePrice), prices.salePrice)
  ) {
    return toRow(latest);
  }
  return toRow(
    await tx.productBatch.create({
      data: {
        ...owner,
        productId,
        seq: await nextSeq(tx, productId),
        costPrice,
        salePrice: prices.salePrice,
      },
      select: batchSelect,
    }),
  );
}

/** A batch of the company's product, or a validation error at `path`. */
export async function batchOf(
  db: Db,
  companyId: string,
  productId: string,
  id: string,
  path: string,
): Promise<BatchRow> {
  const batch = await db.productBatch.findFirst({
    where: { id, companyId, productId },
    select: batchSelect,
  });
  if (!batch) throw invalid(path, "validation.daily.batchUnknown");
  return toRow(batch);
}

/**
 * The prices a receipt or DSR line uses for its batch: entered ones win over the batch's, and a
 * changed price is stored on the batch for later use.
 */
export async function useBatchPrices(
  tx: Tx,
  batch: BatchRow,
  entered: { costPrice?: string | undefined; salePrice?: string | undefined },
): Promise<{ costPrice: string; salePrice: string }> {
  const costPrice = entered.costPrice ?? batch.costPrice;
  const salePrice = entered.salePrice ?? batch.salePrice;
  if (!samePiecePrice(costPrice, batch.costPrice) || !samePiecePrice(salePrice, batch.salePrice)) {
    await tx.productBatch.update({ where: { id: batch.id }, data: { costPrice, salePrice } });
    batch.costPrice = costPrice;
    batch.salePrice = salePrice;
  }
  return { costPrice, salePrice };
}

const AUTO_KEY = /^auto:([1-9]\d*)$/;

export type SheetLine = {
  productId: string;
  issued: DecimalLike;
  returned: DecimalLike;
  damaged: DecimalLike;
  batchSeq: number | null;
};

/** A sheet's pieces per product, over its batch lines (D68: one line per product and batch). */
export function linesByProduct(
  lines: readonly SheetLine[],
): Map<string, { issued: string; returned: string; damaged: string }> {
  const out = new Map<string, { issued: string; returned: string; damaged: string }>();
  for (const l of lines) {
    const t = out.get(l.productId) ?? { issued: "0", returned: "0", damaged: "0" };
    out.set(l.productId, {
      issued: sumQuantities([t.issued, plain(l.issued)]),
      returned: sumQuantities([t.returned, plain(l.returned)]),
      damaged: sumQuantities([t.damaged, plain(l.damaged)]),
    });
  }
  return out;
}

/**
 * D68: the line that takes a product's firot and damage from the field: the last batch issued
 * (highest batch number among lines with samari), else any line of the product.
 */
export function lastBatchLine<T extends SheetLine>(
  lines: readonly T[],
  productId: string,
): T | undefined {
  const own = lines.filter((l) => l.productId === productId);
  const issued = own.filter((l) => !toDecimal(plain(l.issued)).isZero());
  const pool = issued.length ? issued : own;
  return pool.reduce<T | undefined>(
    (best, l) => (best === undefined || (l.batchSeq ?? 0) > (best.batchSeq ?? 0) ? l : best),
    undefined,
  );
}

/**
 * The batch columns of a DSR line: a stored batch (its prices, changed ones saved on it), an
 * automatic batch (`auto:<n>`, prices left to the engine unless entered) or none ('').
 */
export async function dsrLineBatch(
  tx: Tx,
  companyId: string,
  canSeeCost: boolean,
  line: {
    productId: string;
    batchKey: string;
    costPrice?: string | undefined;
    salePrice?: string | undefined;
  },
  index: number,
): Promise<{
  batchKey: string;
  batchSeq: number | null;
  costPrice: string | null;
  salePrice: string | null;
}> {
  if (line.batchKey === "") {
    return { batchKey: "", batchSeq: null, costPrice: null, salePrice: null };
  }
  const auto = AUTO_KEY.exec(line.batchKey);
  if (auto) {
    return {
      batchKey: line.batchKey,
      batchSeq: Number(auto[1]),
      costPrice: canSeeCost ? (line.costPrice ?? null) : null,
      salePrice: line.salePrice ?? null,
    };
  }
  const batch = await batchOf(
    tx,
    companyId,
    line.productId,
    line.batchKey,
    `lines.${index}.batchKey`,
  );
  const prices = await useBatchPrices(tx, batch, {
    costPrice: canSeeCost ? line.costPrice : undefined,
    salePrice: line.salePrice,
  });
  return { batchKey: batch.id, batchSeq: batch.seq, ...prices };
}

/** Pieces still due from the company per batch, from posted orders and receipts up to `to`. */
export async function batchDue(
  db: Db,
  companyId: string,
  to: string,
  productIds?: readonly string[],
): Promise<Map<string, string>> {
  const product = productIds ? { productId: { in: [...productIds] } } : {};
  const [entries, opening] = await Promise.all([
    db.stockEntry.findMany({
      where: {
        companyId,
        status: "posted",
        kind: { in: ["order", "receipt"] },
        date: { lte: toDbDate(to) },
        batchId: { not: null },
      },
      select: { kind: true, pieces: true, freePieces: true, batchId: true },
    }),
    db.productBatch.findMany({
      where: { companyId, source: "opening", ...product },
      select: { id: true, productId: true },
    }),
  ]);
  const moves: BatchMove[] = [];
  if (opening.length) {
    const lines = await db.openingStockLine.findMany({
      where: { session: { companyId }, productId: { in: opening.map((b) => b.productId) } },
      select: { productId: true, dueFromCompany: true },
    });
    const due = new Map(lines.map((l) => [l.productId, plain(l.dueFromCompany) ?? "0"]));
    for (const b of opening) moves.push({ batchId: b.id, ordered: due.get(b.productId) ?? "0" });
  }
  for (const e of entries) {
    if (!e.batchId) continue;
    if (e.kind === "receipt") {
      moves.push({ batchId: e.batchId, received: plain(e.pieces) });
    } else {
      const ordered = sumQuantities([plain(e.pieces), plain(e.freePieces) ?? "0"]);
      moves.push({ batchId: e.batchId, ordered });
    }
  }
  return batchUndelivered(moves);
}

/** A receipt may not bring more pieces into a batch than are still due on it. */
export async function ensureBatchDue(
  tx: Tx,
  companyId: string,
  date: string,
  lines: readonly { batchId: string; productId: string; pieces: string; index: number }[],
): Promise<void> {
  if (lines.length === 0) return;
  const due = await batchDue(
    tx,
    companyId,
    date,
    lines.map((l) => l.productId),
  );
  const taken = new Map<string, ReturnType<typeof toDecimal>>();
  for (const line of lines) {
    const total = (taken.get(line.batchId) ?? toDecimal("0")).add(line.pieces);
    taken.set(line.batchId, total);
    if (total.gt(toDecimal(due.get(line.batchId) ?? "0"))) {
      throw invalid(`lines.${line.index}.pieces`, "validation.daily.batchOverDue");
    }
  }
}

/**
 * An order may be reversed only while none of its pieces were received: reversing it must not
 * leave a batch with more received than ordered.
 */
export async function ensureOrderReversible(
  tx: Tx,
  companyId: string,
  entry: { productId: string; batchId: string | null },
): Promise<void> {
  if (entry.batchId === null) return;
  const due = await batchDue(tx, companyId, "9999-12-31", [entry.productId]);
  if (toDecimal(due.get(entry.batchId) ?? "0").isNegative()) {
    throw invalid("", "validation.daily.batchReceived");
  }
}

/** The opening stock line of each product becomes its `opening` batch at the line's prices. */
export async function syncOpeningBatches(
  tx: Tx,
  owner: { tenantId: string; companyId: string },
): Promise<void> {
  const [lines, existing] = await Promise.all([
    tx.openingStockLine.findMany({
      where: { session: { companyId: owner.companyId } },
      select: {
        productId: true,
        pieces: true,
        dueFromCompany: true,
        unitCost: true,
        salePrice: true,
      },
    }),
    tx.productBatch.findMany({
      where: { companyId: owner.companyId, source: "opening" },
      select: { id: true, productId: true },
    }),
  ]);
  const byProduct = new Map(existing.map((b) => [b.productId, b.id]));
  for (const line of lines) {
    const held = [line.pieces, line.dueFromCompany].some(
      (v) => v !== null && !toDecimal(plain(v)).isZero(),
    );
    if (!held) continue;
    const prices = {
      costPrice: plain(line.unitCost) ?? "0",
      salePrice: plain(line.salePrice) ?? "0",
    };
    const id = byProduct.get(line.productId);
    if (id) {
      await tx.productBatch.update({ where: { id }, data: prices });
    } else {
      await tx.productBatch.create({
        data: {
          ...owner,
          productId: line.productId,
          seq: await nextSeq(tx, line.productId),
          source: "opening",
          ...prices,
        },
      });
    }
  }
}

/** The opening batch (key and number) of each product, for the engine's opening. */
export async function openingBatches(
  db: Db,
  companyId: string,
): Promise<Map<string, { key: string; seq: number }>> {
  const rows = await db.productBatch.findMany({
    where: { companyId, source: "opening" },
    select: { id: true, productId: true, seq: true },
  });
  return new Map(rows.map((b) => [b.productId, { key: b.id, seq: b.seq }]));
}

/**
 * D68: each product's batches worth choosing on `date`: still due from the company, in stock
 * (`inStock` = engine batch keys with pieces), and the latest one.
 */
export async function productLots(
  db: Db,
  companyId: string,
  date: string,
  inStock: ReadonlySet<string>,
  canSeeCost: boolean,
): Promise<Map<string, ProductLot[]>> {
  const [batches, due] = await Promise.all([
    db.productBatch.findMany({
      where: { companyId },
      select: batchSelect,
      orderBy: [{ productId: "asc" }, { seq: "asc" }],
    }),
    batchDue(db, companyId, date),
  ]);
  const latest = new Map<string, number>();
  for (const b of batches) latest.set(b.productId, b.seq);
  const out = new Map<string, ProductLot[]>();
  for (const raw of batches) {
    const b = toRow(raw);
    const undelivered = due.get(b.id) ?? "0";
    const keep =
      toDecimal(undelivered).gt(0) || inStock.has(b.id) || latest.get(b.productId) === b.seq;
    if (!keep) continue;
    const list = out.get(b.productId) ?? [];
    list.push({
      id: b.id,
      seq: b.seq,
      source: b.source === "opening" ? "opening" : "order",
      costPrice: canSeeCost ? b.costPrice : null,
      salePrice: b.salePrice,
      undelivered,
    });
    out.set(b.productId, list);
  }
  return out;
}
