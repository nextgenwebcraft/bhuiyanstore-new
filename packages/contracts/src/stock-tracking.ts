import { z } from "zod";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/** One product card on the stock-tracking hub. */
export const stockTrackingProductSchema = z.object({
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  /** Engine closing stock in pieces (today). */
  stock: decimalStringSchema,
  dueFromCompany: decimalStringSchema,
});

export type StockTrackingProduct = z.infer<typeof stockTrackingProductSchema>;

export const stockTrackingProductListSchema = z.object({
  asOf: businessDateSchema,
  cutoffDate: businessDateSchema.nullable(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  products: z.array(stockTrackingProductSchema),
});

export type StockTrackingProductList = z.infer<typeof stockTrackingProductListSchema>;

/**
 * One calendar day of stock movement for a product: opening → order / মজুদ (receipt) /
 * সামারি / ফেরত → closing (engine fields only).
 */
export const stockTrackingDaySchema = z.object({
  date: businessDateSchema,
  /** True for the go-live opening snapshot row (no movements that day yet). */
  isOpening: z.boolean(),
  openingStock: decimalStringSchema,
  ordered: decimalStringSchema,
  received: decimalStringSchema,
  incentiveReceived: decimalStringSchema,
  issued: decimalStringSchema,
  returned: decimalStringSchema,
  godownDamaged: decimalStringSchema,
  replacedFromStock: decimalStringSchema,
  replacementReceived: decimalStringSchema,
  closingStock: decimalStringSchema,
  dueFromCompany: decimalStringSchema,
});

export type StockTrackingDay = z.infer<typeof stockTrackingDaySchema>;

export const stockTrackingProductDetailSchema = z.object({
  asOf: businessDateSchema,
  cutoffDate: businessDateSchema.nullable(),
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  currentStock: decimalStringSchema,
  dueFromCompany: decimalStringSchema,
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  days: z.array(stockTrackingDaySchema),
});

export type StockTrackingProductDetail = z.infer<typeof stockTrackingProductDetailSchema>;
