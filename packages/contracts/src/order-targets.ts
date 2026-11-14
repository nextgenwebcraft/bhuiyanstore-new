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
const targetCartonsSchema = positiveAmountStringSchema("validation.target.cartons");

export const orderTargetUpsertRequestSchema = z
  .object({
    kind: z.enum(orderTargetKinds),
    /** Product-wise: one id = single product; two or more = combined carton target (D115). */
    productIds: z.array(idSchema).default([]),
    /** Overall only (টাকা). */
    amount: targetAmountSchema.nullable().optional(),
    /** Product-wise only (কার্টন). */
    quantityCartons: targetCartonsSchema.nullable().optional(),
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
    if (value.kind === "overall") {
      if (!value.amount) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "validation.target.amount" });
      }
      if (value.quantityCartons) {
        ctx.addIssue({
          code: "custom",
          path: ["quantityCartons"],
          message: "validation.target.overallNoCartons",
        });
      }
      if (value.productIds.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["productIds"],
          message: "validation.target.overallNoProduct",
        });
      }
    } else {
      if (!value.quantityCartons) {
        ctx.addIssue({
          code: "custom",
          path: ["quantityCartons"],
          message: "validation.target.cartons",
        });
      }
      if (value.amount) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: "validation.target.productNoAmount",
        });
      }
      if (value.productIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["productIds"],
          message: "validation.target.productRequired",
        });
      }
      const seen = new Set<string>();
      for (const [index, id] of value.productIds.entries()) {
        if (seen.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["productIds", index],
            message: "validation.target.duplicateProduct",
          });
        }
        seen.add(id);
      }
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

export const orderTargetProductSchema = z.object({
  id: idSchema,
  name: z.string(),
  sku: z.string(),
});

export type OrderTargetProduct = z.infer<typeof orderTargetProductSchema>;

export const orderTargetSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  kind: z.enum(orderTargetKinds),
  products: z.array(orderTargetProductSchema),
  /** Overall only; null for product-wise carton targets. */
  amount: amountSchema.nullable(),
  /** Product-wise only; null for overall amount targets. */
  quantityCartons: amountSchema.nullable(),
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
