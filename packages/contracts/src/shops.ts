import { z } from "zod";
import { recordStatuses } from "./parties";
import { amountSchema, businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * A shop (দোকান) the company distributes to (D35). Market due (বাকি) is given to and collected
 * from shops; each entry also names the DSR who handled it.
 */
export const shopSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  ownerName: z.string(),
  phone: z.string(),
  area: z.string(),
  address: z.string(),
  /** Warn when the shop's due goes above this; null = no limit. */
  dueLimit: decimalStringSchema.nullable(),
  status: z.enum(recordStatuses),
  /** Due open today; null without `sale.view`. */
  due: decimalStringSchema.nullable(),
});

export type Shop = z.infer<typeof shopSchema>;

const text = (max: number) => z.string().trim().max(max).default("");

export const shopUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ownerName: text(120),
  phone: text(40),
  area: text(120),
  address: text(300),
  dueLimit: amountSchema.nullable().default(null),
  status: z.enum(recordStatuses).default("active"),
});

export type ShopUpsertRequest = z.input<typeof shopUpsertRequestSchema>;

export const shopStatementLineSchema = z.object({
  entryId: idSchema,
  date: businessDateSchema,
  kind: z.enum(["marketDueNew", "marketDueCollected"]),
  amount: decimalStringSchema,
  staffId: idSchema.nullable(),
  staffName: z.string().nullable(),
  /** The shop's due after this entry. */
  balance: decimalStringSchema,
});

export type ShopStatementLine = z.infer<typeof shopStatementLineSchema>;

/** One shop's due over [from, to]: opening, movements with running balance, closing. */
export const shopStatementSchema = z.object({
  shopId: idSchema,
  from: businessDateSchema,
  to: businessDateSchema,
  opening: decimalStringSchema,
  added: decimalStringSchema,
  collected: decimalStringSchema,
  closing: decimalStringSchema,
  lines: z.array(shopStatementLineSchema),
});

export type ShopStatement = z.infer<typeof shopStatementSchema>;
