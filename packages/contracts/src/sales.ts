import { z } from "zod";
import {
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  positiveIntegerStringSchema,
  requestKeySchema,
} from "./primitives";

const priceSplitRequestSchema = z.object({
  /** Base pieces sold at this actual price. */
  quantity: positiveIntegerStringSchema,
  unitPrice: decimalStringSchema,
});

/**
 * One product line of a DSR daily summary (D03, guide 9.5). Different actual prices for the same
 * product stay separate splits; batches are allocated by the service (D05), never chosen here.
 */
export const dailySalesLineRequestSchema = z.object({
  productId: idSchema,
  priceSplits: z.array(priceSplitRequestSchema).min(1),
});

export const dailySalesSummaryPostRequestSchema = z.object({
  requestKey: requestKeySchema,
  businessDate: businessDateSchema,
  dsrId: idSchema,
  lines: z.array(dailySalesLineRequestSchema).min(1),
  /** Collected today against this summary; the rest becomes বাজারের বকেয়া (guide 10.3). */
  cashCollected: decimalStringSchema,
});

export type DailySalesSummaryPostRequest = z.infer<typeof dailySalesSummaryPostRequestSchema>;

/** Cost fields are present only when the actor holds `inventory.cost_view`. */
const saleAllocationSchema = z.object({
  batchId: idSchema,
  lotId: z.string().optional(),
  quantity: decimalStringSchema,
  unitCost: decimalStringSchema.optional(),
  cost: decimalStringSchema.optional(),
});

export const dailySalesLineSchema = z.object({
  productId: idSchema,
  productName: z.string(),
  piecesPerCartonSnapshot: positiveIntegerStringSchema,
  quantity: decimalStringSchema,
  priceSplits: z.array(
    z.object({
      quantity: decimalStringSchema,
      unitPrice: decimalStringSchema,
      amount: decimalStringSchema,
    }),
  ),
  allocations: z.array(saleAllocationSchema),
  netSales: decimalStringSchema,
  cogs: decimalStringSchema.optional(),
});

export const dailySalesSummarySchema = z.object({
  id: idSchema,
  companyId: idSchema,
  number: z.string(),
  status: z.literal("posted"),
  businessDate: businessDateSchema,
  dsrId: idSchema,
  dsrName: z.string(),
  postingSequence: z.number().int().positive(),
  postedAt: z.iso.datetime(),
  lines: z.array(dailySalesLineSchema).min(1),
  netSales: decimalStringSchema,
  cogs: decimalStringSchema.optional(),
  grossProfit: decimalStringSchema.optional(),
  cashCollected: decimalStringSchema,
  marketDue: decimalStringSchema,
});

export type DailySalesSummary = z.infer<typeof dailySalesSummarySchema>;

/**
 * Aggregate unpaid market sales attributed to brand/DSR/date, without customer records (D21).
 * `sourceNumber` is absent for reviewed opening (legacy) dues. Never a DSR personal due.
 */
export const marketDueItemSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  dsrId: idSchema,
  dsrName: z.string(),
  businessDate: businessDateSchema,
  sourceSummaryId: idSchema.optional(),
  sourceNumber: z.string().optional(),
  originalAmount: decimalStringSchema,
  collectedAmount: decimalStringSchema,
  remainingAmount: decimalStringSchema,
});

export type MarketDueItem = z.infer<typeof marketDueItemSchema>;

/** Credit / আগের বকেয়া আদায়: settles existing market due; not new revenue (D04). */
export const oldDueCollectionPostRequestSchema = z.object({
  requestKey: requestKeySchema,
  dsrId: idSchema,
  collectedDate: businessDateSchema,
  amount: decimalStringSchema,
});

export type OldDueCollectionPostRequest = z.infer<typeof oldDueCollectionPostRequestSchema>;

export const oldDueCollectionSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  number: z.string(),
  dsrId: idSchema,
  dsrName: z.string(),
  collectedDate: businessDateSchema,
  amount: decimalStringSchema,
  postingSequence: z.number().int().positive(),
  postedAt: z.iso.datetime(),
  allocations: z
    .array(
      z.object({
        dueItemId: idSchema,
        dueDate: businessDateSchema,
        sourceNumber: z.string().optional(),
        amount: decimalStringSchema,
      }),
    )
    .min(1),
});

export type OldDueCollection = z.infer<typeof oldDueCollectionSchema>;
