import { z } from "zod";
import { staffRoleKinds } from "./parties";
import { idSchema } from "./primitives";

/** Tenant lists configured by authorized users (guide §4.4). Deactivate, never delete. */
const listName = z.string().trim().min(1).max(80);

export const staffRoleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  kind: z.enum(staffRoleKinds),
  active: z.boolean(),
});

export type StaffRole = z.infer<typeof staffRoleSchema>;

export const staffRoleUpsertRequestSchema = z.object({
  name: listName,
  kind: z.enum(staffRoleKinds),
  active: z.boolean(),
});

export type StaffRoleUpsertRequest = z.infer<typeof staffRoleUpsertRequestSchema>;

/** Godown rent, garage, load/unload, Eid bonus, … Amounts are dated entries, never stored here. */
export const expenseCategorySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  active: z.boolean(),
});

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const expenseCategoryUpsertRequestSchema = z.object({
  name: listName,
  active: z.boolean(),
});

export type ExpenseCategoryUpsertRequest = z.infer<typeof expenseCategoryUpsertRequestSchema>;

export const cashAccountKinds = ["cash", "bank", "mobile"] as const;

export type CashAccountKind = (typeof cashAccountKinds)[number];

/** Cash, bank and mobile-money accounts belong to the legal entity, shared by companies (D01). */
export const cashAccountSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  kind: z.enum(cashAccountKinds),
  active: z.boolean(),
});

export type CashAccount = z.infer<typeof cashAccountSchema>;

export const cashAccountUpsertRequestSchema = z.object({
  name: listName,
  kind: z.enum(cashAccountKinds),
  active: z.boolean(),
});

export type CashAccountUpsertRequest = z.infer<typeof cashAccountUpsertRequestSchema>;
