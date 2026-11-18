import { toDecimal, todayBusinessDate } from "@bsd/domain";
import type { CompanyAccess } from "./access";
import type { Tx } from "./context";
import { toDbDate } from "./dates";
import { AppError, type StockShortage } from "./errors";
import { rangeRun } from "./ledger";
import { plain } from "./numeric";

export type DraftStockTake = {
  productId: string;
  batchKey: string;
  /** Pieces leaving the godown: issued − returned (ড্যামেজ stays out of saleable). */
  issued: string;
  returned: string;
};

/**
 * A product/batch this posting touches (D138). Named `batchKey` → only that batch is checked;
 * omit / empty → product-level stock only (sibling ≤0 batches ignored).
 */
export type StockCoverTouch = {
  productId: string;
  batchKey?: string;
};

/**
 * Net pieces a draft/post would take from each product and named batch (D34 / D136).
 * Negative nets (more return than issue) count as zero take.
 */
export function draftStockTakes(
  lines: readonly DraftStockTake[],
): { byProduct: Map<string, string>; byBatch: Map<string, { productId: string; net: string }> } {
  const byProduct = new Map<string, ReturnType<typeof toDecimal>>();
  const byBatch = new Map<string, { productId: string; net: ReturnType<typeof toDecimal> }>();
  for (const line of lines) {
    const net = toDecimal(line.issued).sub(toDecimal(line.returned));
    if (net.lte(0)) continue;
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? toDecimal("0")).add(net));
    if (!line.batchKey) continue;
    const key = `${line.productId}|${line.batchKey}`;
    const prev = byBatch.get(key);
    byBatch.set(key, {
      productId: line.productId,
      net: (prev?.net ?? toDecimal("0")).add(net),
    });
  }
  return {
    byProduct: new Map([...byProduct].map(([id, n]) => [id, n.toFixed()])),
    byBatch: new Map(
      [...byBatch].map(([key, v]) => [key, { productId: v.productId, net: v.net.toFixed() }]),
    ),
  };
}

/** D138: peer soft-reserve only competes on the same productId|batchKey as this sheet. */
export function competingPeerDraftTakes(
  sheetLines: readonly DraftStockTake[],
  peerLines: readonly DraftStockTake[],
): DraftStockTake[] {
  const keys = new Set(draftStockTakes(sheetLines).byBatch.keys());
  if (keys.size === 0) return [];
  return peerLines.filter((l) => l.batchKey && keys.has(`${l.productId}|${l.batchKey}`));
}

type LedgerDay = {
  date: string;
  products: readonly {
    productId: string;
    stock: string;
    batches: readonly { key: string; quantity: string; seq: number }[];
  }[];
};

/**
 * Shortages if `takes` were applied on `from` and carried through each ledger day (draft is not in
 * the engine yet, so we subtract from posted balances).
 */
export function draftStockShortages(
  days: readonly LedgerDay[],
  lines: readonly DraftStockTake[],
): StockShortage[] {
  const { byProduct, byBatch } = draftStockTakes(lines);
  if (byProduct.size === 0) return [];
  const worst = new Map<string, StockShortage>();
  for (const day of days) {
    for (const p of day.products) {
      const take = byProduct.get(p.productId);
      if (!take || worst.has(p.productId)) continue;
      // Named batch first (D34): overdraw on one batch even when another still has stock.
      let batchHit = false;
      for (const [key, batchTake] of byBatch) {
        if (batchTake.productId !== p.productId) continue;
        const batchKey = key.slice(p.productId.length + 1);
        const batch = p.batches.find((b) => b.key === batchKey);
        const qty = toDecimal(batch?.quantity ?? "0");
        if (qty.sub(toDecimal(batchTake.net)).lt(0)) {
          worst.set(p.productId, {
            productId: p.productId,
            productName: "",
            date: day.date,
            stock: qty.sub(toDecimal(batchTake.net)).toFixed(),
            ...(batch ? { batchSeq: batch.seq } : {}),
          });
          batchHit = true;
          break;
        }
      }
      if (batchHit) continue;
      if (toDecimal(p.stock).sub(toDecimal(take)).lt(0)) {
        worst.set(p.productId, {
          productId: p.productId,
          productName: "",
          date: day.date,
          stock: toDecimal(p.stock).sub(toDecimal(take)).toFixed(),
        });
      }
    }
  }
  return [...worst.values()];
}

function normalizeTouches(touches: Iterable<string | StockCoverTouch>): {
  productOnly: Set<string>;
  namedBatches: Map<string, { productId: string; batchKey: string }>;
} {
  const productOnly = new Set<string>();
  const namedBatches = new Map<string, { productId: string; batchKey: string }>();
  for (const t of touches) {
    if (typeof t === "string") {
      productOnly.add(t);
      continue;
    }
    if (t.batchKey) {
      namedBatches.set(`${t.productId}|${t.batchKey}`, {
        productId: t.productId,
        batchKey: t.batchKey,
      });
    } else {
      productOnly.add(t.productId);
    }
  }
  return { productOnly, namedBatches };
}

/**
 * D34 / D138: after a write that takes stock, refuse when a **touched** named batch ends below
 * zero, or product stock ends below zero for a product-level take. Pre-existing ≤0 sibling
 * batches (inactive / history) do not block. Receipts are never checked here.
 */
export async function ensureStockCovers(
  tx: Tx,
  access: CompanyAccess,
  from: string,
  touches: Iterable<string | StockCoverTouch>,
): Promise<void> {
  const { productOnly, namedBatches } = normalizeTouches(touches);
  if (productOnly.size === 0 && namedBatches.size === 0) return;
  const run = await rangeRun(tx, access, from, todayBusinessDate());
  if (!run) return;
  const productIds = new Set<string>([
    ...productOnly,
    ...[...namedBatches.values()].map((b) => b.productId),
  ]);
  const worst = new Map<string, StockShortage>();
  for (const day of run.output.days) {
    for (const p of day.products) {
      if (!productIds.has(p.productId) || worst.has(p.productId)) continue;
      let batchHit = false;
      for (const [, touch] of namedBatches) {
        if (touch.productId !== p.productId) continue;
        const batch = p.batches.find((b) => b.key === touch.batchKey);
        if (batch && batch.quantity.startsWith("-")) {
          worst.set(p.productId, {
            productId: p.productId,
            productName: "",
            date: day.date,
            stock: batch.quantity,
            batchSeq: batch.seq,
          });
          batchHit = true;
          break;
        }
      }
      if (batchHit) continue;
      if (productOnly.has(p.productId) && p.stock.startsWith("-")) {
        worst.set(p.productId, {
          productId: p.productId,
          productName: "",
          date: day.date,
          stock: p.stock,
        });
      }
    }
  }
  if (worst.size === 0) return;
  await throwInsufficient(tx, [...worst.values()]);
}

/**
 * D137: live draft lines for other SRs (soft reservation). Excludes the sheet being saved
 * (`staffId` + `date`); every other `status: draft` in the company counts.
 */
export async function peerDraftStockTakes(
  tx: Tx,
  companyId: string,
  exclude: { staffId: string; date: string },
): Promise<DraftStockTake[]> {
  const date = toDbDate(exclude.date);
  const drafts = await tx.dsrDay.findMany({
    where: {
      companyId,
      status: "draft",
      OR: [{ staffId: { not: exclude.staffId } }, { date: { not: date } }],
    },
    select: {
      lines: { select: { productId: true, batchKey: true, issued: true, returned: true } },
    },
  });
  return drafts.flatMap((d) =>
    d.lines.map((l) => ({
      productId: l.productId,
      batchKey: l.batchKey,
      issued: plain(l.issued),
      returned: plain(l.returned),
    })),
  );
}

/**
 * D136 / D137 / D138: draft save refuses when this sheet's issued−returned plus **competing**
 * peer draft reservations (same productId|batchKey only) would overdraw from the sheet date
 * through today.
 */
export async function ensureDraftSalesCover(
  tx: Tx,
  access: CompanyAccess,
  from: string,
  lines: readonly DraftStockTake[],
  peers?: { excludeStaffId: string; excludeDate: string },
): Promise<void> {
  const peerLines = peers
    ? await peerDraftStockTakes(tx, access.company.id, {
        staffId: peers.excludeStaffId,
        date: peers.excludeDate,
      })
    : [];
  const competing = competingPeerDraftTakes(lines, peerLines);
  const combined = [...competing, ...lines];
  const { byProduct } = draftStockTakes(combined);
  if (byProduct.size === 0) return;
  const run = await rangeRun(tx, access, from, todayBusinessDate());
  if (!run) return;
  const shortages = draftStockShortages(run.output.days, combined);
  if (shortages.length === 0) return;
  await throwInsufficient(tx, shortages);
}

async function throwInsufficient(tx: Tx, shortages: StockShortage[]): Promise<never> {
  const names = await tx.product.findMany({
    where: { id: { in: [...new Set(shortages.map((s) => s.productId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  throw new AppError(
    "INSUFFICIENT_STOCK",
    undefined,
    false,
    shortages.map((s) => ({ ...s, productName: nameOf.get(s.productId) ?? "" })),
  );
}
