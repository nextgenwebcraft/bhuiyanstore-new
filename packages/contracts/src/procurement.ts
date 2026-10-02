import { z } from "zod";
import {
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  nonNegativeIntegerStringSchema,
  positiveIntegerStringSchema,
  requestKeySchema,
} from "./primitives";

/**
 * `purchase` creates a paid cost layer; `supplier_incentive` is free company stock received as the
 * distributor's incentive (D16, guide 9.3a): same receipt workflow, no cash/bill/payable effect.
 */
export const goodsReceiptKinds = ["purchase", "supplier_incentive"] as const;

export type GoodsReceiptKind = (typeof goodsReceiptKinds)[number];

export const goodsReceiptLineRequestSchema = z.object({
  productId: idSchema,
  cartons: nonNegativeIntegerStringSchema,
  loosePieces: nonNegativeIntegerStringSchema,
  /** Per piece; purchase cost or reviewed incentive carrying value (D06, guide 9.3a). */
  unitCost: decimalStringSchema,
  lotId: z.string().optional(),
  expiryDate: businessDateSchema.optional(),
});

export const goodsReceiptPostRequestSchema = z.object({
  /** Idempotency key: a retry with the same key returns the original outcome (guide 13.2). */
  requestKey: requestKeySchema,
  kind: z.enum(goodsReceiptKinds),
  supplierId: idSchema,
  receivedDate: businessDateSchema,
  reference: z.string(),
  lines: z.array(goodsReceiptLineRequestSchema).min(1),
});

export type GoodsReceiptPostRequest = z.infer<typeof goodsReceiptPostRequestSchema>;

export const goodsReceiptLineSchema = z.object({
  productId: idSchema,
  /** Snapshots: later catalog edits never change a posted receipt (guide 21.2 R04). */
  productName: z.string(),
  piecesPerCartonSnapshot: positiveIntegerStringSchema,
  quantity: decimalStringSchema,
  unitCost: decimalStringSchema,
  lineValue: decimalStringSchema,
  batchId: idSchema,
  lotId: z.string().optional(),
  expiryDate: businessDateSchema.optional(),
});

export const goodsReceiptSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  number: z.string(),
  kind: z.enum(goodsReceiptKinds),
  supplierId: idSchema,
  supplierName: z.string(),
  receivedDate: businessDateSchema,
  reference: z.string(),
  postingSequence: z.number().int().positive(),
  postedAt: z.iso.datetime(),
  lines: z.array(goodsReceiptLineSchema).min(1),
  totalValue: decimalStringSchema,
});

export type GoodsReceipt = z.infer<typeof goodsReceiptSchema>;
