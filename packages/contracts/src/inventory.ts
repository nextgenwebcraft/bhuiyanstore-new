import { z } from "zod";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * A receipt cost layer (guide sections 5.2, 5.3, 9; D05, D06, D10, D22). One shared godown for
 * v1 (D10); DSR custody locations arrive with the issue/return workflow. The
 * available+reserved+quarantine == received invariant is checked where seed data is already
 * validated (mock-service.test.ts), not as a schema-level cross-field refine: that would pull
 * @bsd/domain's Decimal into @bsd/contracts, against the guide section 21.3 dependency direction
 * (domain depends on contracts, not the reverse).
 */
export const batchSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  productId: idSchema,
  /** Manufacturer/receipt lot code, when known. */
  lotId: z.string().optional(),
  /** FEFO when set, otherwise FIFO by receivedDate (D05). */
  expiryDate: businessDateSchema.optional(),
  receivedDate: businessDateSchema,
  location: z.literal("godown"),
  /** Actual receipt cost for this layer (D06); shown only with inventory.cost_view. */
  unitCost: decimalStringSchema,
  receivedQuantity: decimalStringSchema,
  availableQuantity: decimalStringSchema,
  reservedQuantity: decimalStringSchema,
  quarantineQuantity: decimalStringSchema,
});

export type Batch = z.infer<typeof batchSchema>;
