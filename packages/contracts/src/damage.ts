import { z } from "zod";
import { unitPriceSchema } from "./catalog";
import { documentStatuses, positivePiecesSchema } from "./daily";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";

/**
 * Damage cases (D17, guide §9.7): one case with independent buyer and company legs, tracked as
 * quantities. Same lists as `@bsd/domain` damage-case rules (asserted in `application/src/kinds.test.ts`).
 */

export const damageOrigins = ["buyerExchange", "ownedStock"] as const;
export type DamageOriginId = (typeof damageOrigins)[number];

export const damageEventKinds = [
  "buyerReplacement",
  "companyDispatch",
  "companyAccept",
  "companyReject",
  "companyReplacement",
  "writeOff",
  "companyRefund",
] as const;
export type DamageEventKindId = (typeof damageEventKinds)[number];

/** Kinds that need a price per piece: goods back (carrying cost) or money back (D33). */
export const damageUnitCostKinds: readonly DamageEventKindId[] = [
  "companyReplacement",
  "companyRefund",
];

export const damageCaseStatuses = ["open", "settled", "cancelled"] as const;

const qty = decimalStringSchema;

export const damageProgressSchema = z.object({
  received: qty,
  buyerReplaced: qty,
  buyerPending: qty,
  sent: qty,
  accepted: qty,
  rejected: qty,
  awaitingAcceptance: qty,
  companyReplaced: qty,
  companyRefunded: qty,
  companyPending: qty,
  writtenOff: qty,
  stillHere: qty,
});

export const damageCaseLineSchema = z.object({
  id: idSchema,
  productId: idSchema,
  sku: z.string(),
  productName: z.string(),
  piecesPerCarton: z.string(),
  quantity: qty,
  progress: damageProgressSchema,
});

export const damageEventSchema = z.object({
  id: idSchema,
  lineId: idSchema,
  productName: z.string(),
  date: businessDateSchema,
  kind: z.enum(damageEventKinds),
  quantity: qty,
  fromStock: z.boolean(),
  /** Null without `inventory.cost_view`, and for kinds other than company replacement or refund. */
  unitCost: decimalStringSchema.nullable(),
  reference: z.string(),
  note: z.string(),
  status: z.enum(documentStatuses),
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});
export type DamageEvent = z.infer<typeof damageEventSchema>;

export const damageCaseSchema = z.object({
  id: idSchema,
  caseNumber: z.string(),
  date: businessDateSchema,
  origin: z.enum(damageOrigins),
  staffId: idSchema.nullable(),
  staffName: z.string().nullable(),
  status: z.enum(damageCaseStatuses),
  note: z.string(),
  lines: z.array(damageCaseLineSchema),
  events: z.array(damageEventSchema),
  createdAt: z.string(),
});
export type DamageCase = z.infer<typeof damageCaseSchema>;

export const damageCaseCreateRequestSchema = z.object({
  /** Empty: the server numbers the case from its date. */
  caseNumber: z.string().trim().max(60).default(""),
  date: businessDateSchema,
  origin: z.enum(damageOrigins),
  /** The DSR who brought the buyer's damaged goods, when known. */
  staffId: idSchema.nullable().default(null),
  note: z.string().trim().max(500).default(""),
  /** Every line was handed to the company on `date` (posts the dispatch with the case). */
  sentToCompany: z.boolean().default(false),
  lines: z
    .array(z.object({ productId: idSchema, quantity: positivePiecesSchema }))
    .min(1, { message: "validation.daily.empty" })
    .max(100),
});
export type DamageCaseCreateRequest = z.input<typeof damageCaseCreateRequestSchema>;

export const damageEventRequestSchema = z.object({
  date: businessDateSchema,
  lineId: idSchema,
  kind: z.enum(damageEventKinds),
  quantity: positivePiecesSchema,
  /** Buyer replacement given from godown stock (moves saleable stock). */
  fromStock: z.boolean().default(false),
  /** Price per piece; required for company replacement (carrying cost) and refund (money back). */
  unitCost: unitPriceSchema.nullable().default(null),
  /** Company return only: accept the pieces still awaiting acceptance first, in the same step. */
  autoAccept: z.boolean().default(false),
  reference: z.string().trim().max(100).default(""),
  note: z.string().trim().max(500).default(""),
});
export type DamageEventRequest = z.input<typeof damageEventRequestSchema>;
