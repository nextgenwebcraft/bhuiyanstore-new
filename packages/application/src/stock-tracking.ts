import {
  stockTrackingProductDetailSchema,
  stockTrackingProductListSchema,
  type StockTrackingDay,
  type StockTrackingProductDetail,
  type StockTrackingProductList,
} from "@bsd/contracts";
import { toDecimal, todayBusinessDate, type ProductDayResult } from "@bsd/domain";
import { requirePermission } from "./access";
import type { AppContext } from "./context";
import { invalid } from "./errors";
import { liveOpening, namesFor, runLedger } from "./ledger";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

function pageQuery(input: unknown): { page: number; pageSize: number; q: string } {
  const raw =
    input && typeof input === "object"
      ? (input as { page?: unknown; pageSize?: unknown; q?: unknown })
      : {};
  const page = Math.max(1, Number.parseInt(String(raw.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(String(raw.pageSize ?? String(DEFAULT_PAGE_SIZE)), 10) || DEFAULT_PAGE_SIZE),
  );
  const q = typeof raw.q === "string" ? raw.q.trim() : "";
  return { page, pageSize, q };
}

/** Name / SKU search: every whitespace-separated term must appear in name or sku. */
function matchesProductSearch(q: string, name: string, sku: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${name} ${sku}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

function hasMovement(p: ProductDayResult): boolean {
  return (
    !toDecimal(p.ordered).isZero() ||
    !toDecimal(p.received).isZero() ||
    !toDecimal(p.incentiveReceived).isZero() ||
    !toDecimal(p.issued).isZero() ||
    !toDecimal(p.returned).isZero() ||
    !toDecimal(p.godownDamaged).isZero() ||
    !toDecimal(p.replacedFromStock).isZero() ||
    !toDecimal(p.replacementReceived).isZero()
  );
}

function dayRow(
  date: string,
  openingStock: string,
  p: ProductDayResult | null,
  isOpening: boolean,
): StockTrackingDay {
  return {
    date,
    isOpening,
    openingStock,
    ordered: p?.ordered ?? "0",
    received: p?.received ?? "0",
    incentiveReceived: p?.incentiveReceived ?? "0",
    issued: p?.issued ?? "0",
    returned: p?.returned ?? "0",
    godownDamaged: p?.godownDamaged ?? "0",
    replacedFromStock: p?.replacedFromStock ?? "0",
    replacementReceived: p?.replacementReceived ?? "0",
    closingStock: p?.stock ?? openingStock,
    dueFromCompany: p?.dueFromCompany ?? "0",
  };
}

/**
 * Product cards for stock tracking: current engine stock per product (inventory.view).
 */
export async function listStockTrackingProducts(
  ctx: AppContext,
  companyId: string,
  query: unknown,
): Promise<StockTrackingProductList> {
  const access = await requirePermission(ctx, companyId, "inventory.view");
  const { page, pageSize, q } = pageQuery(query);
  const asOf = todayBusinessDate();
  const active = await liveOpening(ctx.db, companyId);
  const [run, names] = await Promise.all([
    runLedger(ctx.db, access, asOf, active),
    namesFor(ctx.db, access, asOf),
  ]);
  const closing = run?.output.closing.products ?? {};
  const all = names.products
    .map((product) => {
      const row = closing[product.id];
      return {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        piecesPerCarton: product.piecesPerCarton,
        stock: row?.stock ?? "0",
        dueFromCompany: row?.dueFromCompany ?? "0",
      };
    })
    .filter((p) => matchesProductSearch(q, p.productName, p.sku));
  const total = all.length;
  const start = (page - 1) * pageSize;
  return stockTrackingProductListSchema.parse({
    asOf,
    cutoffDate: active?.cutoffDate ?? null,
    page,
    pageSize,
    total,
    products: all.slice(start, start + pageSize),
  });
}

/**
 * Date-wise stock trail for one product: opening → order → মজুদ → সামারি → closing.
 */
export async function getStockTrackingProduct(
  ctx: AppContext,
  companyId: string,
  productId: string,
  query: unknown,
): Promise<StockTrackingProductDetail> {
  const access = await requirePermission(ctx, companyId, "inventory.view");
  const { page, pageSize } = pageQuery(query);
  const asOf = todayBusinessDate();
  const active = await liveOpening(ctx.db, companyId);
  const [run, names] = await Promise.all([
    runLedger(ctx.db, access, asOf, active),
    namesFor(ctx.db, access, asOf),
  ]);
  const product = names.products.find((p) => p.id === productId);
  if (!product) throw invalid("productId", "validation.product.unknown");

  const openingPieces = toDecimal(
    active?.opening.products[productId]?.stock ?? "0",
  ).toString();
  const openingDue = toDecimal(
    active?.opening.products[productId]?.dueFromCompany ?? "0",
  ).toString();
  const days: StockTrackingDay[] = [];
  if (active?.cutoffDate) {
    days.push({
      ...dayRow(active.cutoffDate, openingPieces, null, true),
      dueFromCompany: openingDue,
    });
  }

  let prev = openingPieces;
  for (const day of run?.output.days ?? []) {
    const p = day.products.find((x) => x.productId === productId);
    if (!p) {
      // no product row that day — stock unchanged
      continue;
    }
    if (!hasMovement(p) && toDecimal(p.stock).eq(prev)) {
      prev = p.stock;
      continue;
    }
    days.push(dayRow(day.date, prev, p, false));
    prev = p.stock;
  }

  const closing = run?.output.closing.products[productId];
  const total = days.length;
  const start = (page - 1) * pageSize;
  return stockTrackingProductDetailSchema.parse({
    asOf,
    cutoffDate: active?.cutoffDate ?? null,
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    piecesPerCarton: product.piecesPerCarton,
    currentStock: closing?.stock ?? prev,
    dueFromCompany: closing?.dueFromCompany ?? openingDue,
    page,
    pageSize,
    total,
    days: days.slice(start, start + pageSize),
  });
}
