import { z } from "zod";
import {
  amountSchema,
  businessDateSchema,
  decimalStringSchema,
  idSchema,
  positiveAmountStringSchema,
} from "./primitives";

export const orderTargetKinds = ["overall", "product"] as const;
export type OrderTargetKind = (typeof orderTargetKinds)[number];

export const orderTargetStatuses = ["active", "archived"] as const;
export type OrderTargetStatus = (typeof orderTargetStatuses)[number];

export const orderTargetProgressStatuses = ["on_track", "behind", "met", "overdue"] as const;
export type OrderTargetProgressStatus = (typeof orderTargetProgressStatuses)[number];

const targetAmountSchema = positiveAmountStringSchema("validation.target.amount");

export const orderTargetUpsertRequestSchema = z
  .object({
    kind: z.enum(orderTargetKinds),
    productId: idSchema.nullable().optional(),
    amount: targetAmountSchema,
    startDate: businessDateSchema,
    endDate: businessDateSchema,
    showOnDashboard: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.startDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "validation.target.dateOrder",
      });
    }
    if (value.kind === "product" && !value.productId) {
      ctx.addIssue({
        code: "custom",
        path: ["productId"],
        message: "validation.target.productRequired",
      });
    }
    if (value.kind === "overall" && value.productId) {
      ctx.addIssue({
        code: "custom",
        path: ["productId"],
        message: "validation.target.overallNoProduct",
      });
    }
  });

export type OrderTargetUpsertRequest = z.infer<typeof orderTargetUpsertRequestSchema>;

export const orderTargetUpdateRequestSchema = orderTargetUpsertRequestSchema;
export type OrderTargetUpdateRequest = z.infer<typeof orderTargetUpdateRequestSchema>;

export const orderTargetProgressSchema = z.object({
  ordered: amountSchema,
  remaining: amountSchema,
  /** 0–1, capped at 1 when met or over. */
  ratio: decimalStringSchema,
  daysLeft: z.number().int().nonnegative(),
  daysTotal: z.number().int().positive(),
  status: z.enum(orderTargetProgressStatuses),
});

export type OrderTargetProgress = z.infer<typeof orderTargetProgressSchema>;

export const orderTargetSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  kind: z.enum(orderTargetKinds),
  productId: idSchema.nullable(),
  productName: z.string().nullable(),
  sku: z.string().nullable(),
  amount: amountSchema,
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  showOnDashboard: z.boolean(),
  status: z.enum(orderTargetStatuses),
  progress: orderTargetProgressSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OrderTarget = z.infer<typeof orderTargetSchema>;

export const orderTargetListSchema = z.object({
  items: z.array(orderTargetSchema),
  /** How many active targets are pinned to the dashboard (0–2). */
  dashboardPinned: z.number().int().nonnegative(),
});

export type OrderTargetList = z.infer<typeof orderTargetListSchema>;
