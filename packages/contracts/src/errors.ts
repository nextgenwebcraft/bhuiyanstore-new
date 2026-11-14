import { z } from "zod";
import { errorCodes } from "./definitions/error-codes";

/** The first day a product would go below zero; `stock` is that day's (negative) pieces. */
export const stockShortageSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  date: z.string(),
  stock: z.string(),
});

export type StockShortage = z.infer<typeof stockShortageSchema>;

export const apiErrorSchema = z.object({
  code: z.enum(errorCodes),
  requestId: z.string().optional(),
  retryable: z.boolean(),
  fieldErrors: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
  /** Set with INSUFFICIENT_STOCK. */
  stockShortages: z.array(stockShortageSchema).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
