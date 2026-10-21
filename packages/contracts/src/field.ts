import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./organization";
import {
  amountSchema,
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  wholePiecesSchema,
} from "./primitives";

/**
 * DSR field panel (D40): a DSR records each shop visit on the phone. The sale price is the day's
 * price fixed by the server; delivered + exchanged pieces never exceed the samari still in hand.
 */

export const fieldVisitStatuses = ["open", "locked"] as const;
export type FieldVisitStatus = (typeof fieldVisitStatuses)[number];

export const fieldVisitLineSchema = z.object({
  productId: idSchema,
  productName: z.string(),
  piecesPerCarton: z.string(),
  unitPrice: decimalStringSchema,
  delivered: decimalStringSchema,
  exchanged: decimalStringSchema,
  /** delivered × unitPrice. */
  value: decimalStringSchema,
});

export const fieldVisitSchema = z.object({
  id: idSchema,
  staffId: idSchema,
  shopId: idSchema,
  shopName: z.string(),
  date: businessDateSchema,
  status: z.enum(fieldVisitStatuses),
  version: z.number().int().positive(),
  cashReceived: decimalStringSchema,
  dueCollected: decimalStringSchema,
  note: z.string(),
  /** Σ line values. */
  salesValue: decimalStringSchema,
  /** salesValue − cashReceived: the shop's new due. */
  dueCreated: decimalStringSchema,
  lines: z.array(fieldVisitLineSchema),
  createdAt: z.string(),
});

export type FieldVisit = z.infer<typeof fieldVisitSchema>;

/** One product of the DSR's day: samari from the office sheet and what the visits used. */
export const fieldProductSchema = z.object({
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  unitPrice: decimalStringSchema.nullable(),
  issued: decimalStringSchema,
  delivered: decimalStringSchema,
  exchanged: decimalStringSchema,
  /** issued − delivered − exchanged: what is still in hand (expected firot at day end). */
  remaining: decimalStringSchema,
  /** Firot and damage on the office sheet, as the DSR entered them at day end (draft). */
  returned: decimalStringSchema,
  damaged: decimalStringSchema,
});

export type FieldProduct = z.infer<typeof fieldProductSchema>;

export const fieldShopSchema = z.object({
  id: idSchema,
  name: z.string(),
  area: z.string(),
  /** Today's open due; null without `sale.view` or before activation. */
  due: decimalStringSchema.nullable(),
  addedByDsr: z.boolean(),
});

export const fieldTotalsSchema = z.object({
  sales: decimalStringSchema,
  cashReceived: decimalStringSchema,
  dueCreated: decimalStringSchema,
  dueCollected: decimalStringSchema,
  /** cashReceived + dueCollected: cash the DSR should hold from the field. */
  cashInHand: decimalStringSchema,
});

export type FieldTotals = z.infer<typeof fieldTotalsSchema>;

export const fieldDaySchema = z.object({
  date: businessDateSchema,
  staffId: idSchema,
  staffName: z.string(),
  /** The office DSR sheet for the date: none until samari is entered. */
  sheetStatus: z.enum(["none", "draft", "posted"]),
  /** True once the office posted the day; visits can no longer change. */
  locked: z.boolean(),
  products: z.array(fieldProductSchema),
  /** Every active product for the day end (firot and damage), with or without samari. */
  dayEnd: z.array(fieldProductSchema),
  visits: z.array(fieldVisitSchema),
  shops: z.array(fieldShopSchema),
  totals: fieldTotalsSchema,
});

export type FieldDay = z.infer<typeof fieldDaySchema>;

export const fieldVisitLineRequestSchema = z.object({
  productId: idSchema,
  delivered: wholePiecesSchema,
  exchanged: wholePiecesSchema,
});

export const fieldVisitSaveRequestSchema = z.object({
  date: businessDateSchema,
  shopId: idSchema,
  /** 0 creates a visit; otherwise the version being edited. */
  version: z.number().int().nonnegative(),
  cashReceived: amountSchema,
  dueCollected: amountSchema,
  note: z.string().trim().max(300).default(""),
  lines: z.array(fieldVisitLineRequestSchema).max(300),
  /** Super-admin only: the DSR the visit is for. A DSR's own login acts on itself. */
  staffId: idSchema.optional(),
});

export type FieldVisitSaveRequest = z.input<typeof fieldVisitSaveRequestSchema>;

export const fieldVisitDeleteRequestSchema = z.object({
  version: z.number().int().positive(),
  /** Super-admin only: the DSR whose visit it is. */
  staffId: idSchema.optional(),
});

export type FieldVisitDeleteRequest = z.infer<typeof fieldVisitDeleteRequestSchema>;

/**
 * The DSR's day end from the field: firot and damage per product, written into the office's draft
 * sheet (created when the office has not started one). The office reviews, edits and posts it; a
 * posted day refuses it.
 */
export const fieldDayEndRequestSchema = z.object({
  date: businessDateSchema,
  lines: z
    .array(
      z.object({
        productId: idSchema,
        returned: wholePiecesSchema,
        damaged: wholePiecesSchema,
      }),
    )
    .max(300),
  /** Super-admin only: the DSR the day is for. */
  staffId: idSchema.optional(),
});

export type FieldDayEndRequest = z.input<typeof fieldDayEndRequestSchema>;

/** A shop added from the field: the office completes the rest later. */
export const fieldShopCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  area: z.string().trim().max(120).default(""),
  /** Super-admin only: the DSR the shop is added for. */
  staffId: idSchema.optional(),
});

export type FieldShopCreateRequest = z.input<typeof fieldShopCreateRequestSchema>;

/** Creates a login for a staff member with the field role (D40). */
export const staffLoginCreateRequestSchema = z.object({
  email: z.email().max(200),
  /** One-time password; the DSR changes it at first sign-in. */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export type StaffLoginCreateRequest = z.infer<typeof staffLoginCreateRequestSchema>;
