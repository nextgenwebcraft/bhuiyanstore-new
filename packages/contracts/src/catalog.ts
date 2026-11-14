import { z } from "zod";
import { businessDateSchema, idSchema, positiveIntegerStringSchema } from "./primitives";

export const productSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  sku: z.string().min(1),
  name: z.string().min(1),
  /** Searchable alternative names, including Bangla spellings (guide section 5.1.1). */
  aliases: z.array(z.string()),
  baseUnit: z.literal("piece"),
  /** Current pack definition; posted lines snapshot their own factor (guide section 9.2). */
  piecesPerCarton: positiveIntegerStringSchema,
  status: z.enum(["active", "archived"]),
});

export type Product = z.infer<typeof productSchema>;

/**
 * Body shape for both create and update (explicit full-replace, no PATCH semantics): the caller
 * always states the complete intended product record. `id`/`companyId` are assigned/verified by
 * the service, never taken from the client.
 */
export const productCreateRequestSchema = productSchema.omit({ id: true, companyId: true });

export type ProductCreateRequest = z.infer<typeof productCreateRequestSchema>;

/** Excel's three per-piece price columns: order (E), cost (H) and sale (O) (PLAN §2.2). */
export const priceKinds = ["order", "cost", "sale"] as const;

export type PriceKind = (typeof priceKinds)[number];

/** A per-piece price ≥ 0 with at most 6 decimals, e.g. a carton price divided by 24. */
export const unitPriceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, { message: "validation.unitPrice.invalid" });

/**
 * One carton size of a product. `effectiveFrom: null` is the size since the product was created;
 * a dated row applies from that business date on. Posted lines keep their own snapshot.
 */
export const productPackSchema = z.object({
  id: idSchema,
  productId: idSchema,
  piecesPerCarton: positiveIntegerStringSchema,
  effectiveFrom: businessDateSchema.nullable(),
});

export type ProductPack = z.infer<typeof productPackSchema>;

export const productPackRequestSchema = z.object({
  piecesPerCarton: positiveIntegerStringSchema,
  effectiveFrom: businessDateSchema,
});

export type ProductPackRequest = z.infer<typeof productPackRequestSchema>;

/** The price on a date is the latest change on or before it: Excel's carry-forward. */
export const priceChangeSchema = z.object({
  id: idSchema,
  productId: idSchema,
  kind: z.enum(priceKinds),
  price: unitPriceSchema,
  effectiveFrom: businessDateSchema,
});

export type PriceChange = z.infer<typeof priceChangeSchema>;

/** A second change for the same kind and date replaces the first (audited). */
export const priceChangeRequestSchema = priceChangeSchema.omit({ id: true, productId: true });

export type PriceChangeRequest = z.infer<typeof priceChangeRequestSchema>;

export const productHistorySchema = z.object({
  packs: z.array(productPackSchema),
  prices: z.array(priceChangeSchema),
});

export type ProductHistory = z.infer<typeof productHistorySchema>;
