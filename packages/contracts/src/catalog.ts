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
