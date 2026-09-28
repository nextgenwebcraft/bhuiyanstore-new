import { z } from "zod";
import { idSchema, positiveIntegerStringSchema } from "./primitives";

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
