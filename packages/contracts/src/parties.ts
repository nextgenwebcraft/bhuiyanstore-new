import { z } from "zod";
import { businessDateSchema, idSchema } from "./primitives";

const nameSchema = z.string().trim().min(1).max(120);
const phoneSchema = z.string().trim().max(40);

export const recordStatuses = ["active", "inactive"] as const;

/** A supplier company account for one brand workspace (D01). No customer master exists (D03). */
export const supplierSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  name: z.string().min(1),
  phone: z.string().optional(),
  /** Deactivate instead of delete once referenced (guide §4.4). */
  status: z.enum(recordStatuses).default("active"),
});

export type Supplier = z.infer<typeof supplierSchema>;

export const supplierUpsertRequestSchema = z.object({
  name: nameSchema,
  phone: phoneSchema.optional(),
  status: z.enum(recordStatuses),
});

export type SupplierUpsertRequest = z.infer<typeof supplierUpsertRequestSchema>;

/**
 * What a staff role means to the fixed rules: only DSRs take product custody (D23), SRs are
 * supplier-employed and never salary-recovered (D02, D18). Role names are tenant data.
 */
export const staffRoleKinds = ["dsr", "sr", "general"] as const;

export type StaffRoleKind = (typeof staffRoleKinds)[number];

export const staffEmployers = ["distributor", "supplier"] as const;

export type StaffEmployer = (typeof staffEmployers)[number];

/**
 * A person as seen from one company, used by entry screens (guide 11.1). `kind` is the person's
 * current role kind in that company; DSRs may work for several brands (D09).
 */
export const staffMemberSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  kind: z.enum(staffRoleKinds),
  companyIds: z.array(idSchema).min(1),
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

/** One role in one company for a period; `to: null` is open-ended. */
export const staffAssignmentSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  roleId: idSchema,
  roleName: z.string(),
  roleKind: z.enum(staffRoleKinds),
  from: businessDateSchema,
  to: businessDateSchema.nullable(),
});

export type StaffAssignment = z.infer<typeof staffAssignmentSchema>;

/** The full person record for the staff master. Assignments in hidden companies are left out. */
export const staffRecordSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  employer: z.enum(staffEmployers),
  phone: z.string().optional(),
  status: z.enum(recordStatuses),
  assignments: z.array(staffAssignmentSchema),
});

export type StaffRecord = z.infer<typeof staffRecordSchema>;

export const staffUpsertRequestSchema = z.object({
  name: nameSchema,
  employer: z.enum(staffEmployers),
  phone: phoneSchema.optional(),
  status: z.enum(recordStatuses),
});

export type StaffUpsertRequest = z.infer<typeof staffUpsertRequestSchema>;

/** Creating a person also needs their first assignment in the current company. */
export const staffCreateRequestSchema = staffUpsertRequestSchema.extend({
  assignment: z.object({
    roleId: idSchema,
    from: businessDateSchema,
    to: businessDateSchema.nullable(),
  }),
});

export type StaffCreateRequest = z.infer<typeof staffCreateRequestSchema>;

export const staffAssignmentRequestSchema = z.object({
  roleId: idSchema,
  from: businessDateSchema,
  to: businessDateSchema.nullable(),
});

export type StaffAssignmentRequest = z.infer<typeof staffAssignmentRequestSchema>;
