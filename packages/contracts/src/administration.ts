import { z } from "zod";
import { permissionIds } from "./definitions/permissions";
import { idSchema } from "./primitives";

/** A role is a named set of fixed permission IDs (guide §12.2). */
export const roleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  permissions: z.array(z.enum(permissionIds)),
});

export type Role = z.infer<typeof roleSchema>;

export const roleUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.enum(permissionIds)),
});

export type RoleUpsertRequest = z.infer<typeof roleUpsertRequestSchema>;

export const membershipSchema = z.object({
  companyId: idSchema,
  roleIds: z.array(idSchema).min(1),
});

export type MembershipInput = z.infer<typeof membershipSchema>;

export const userSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  isSuperAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
  memberships: z.array(membershipSchema),
});

export type User = z.infer<typeof userSchema>;

const temporaryPassword = z.string().min(12).max(128);

/** The administrator sets a one-time password; the user must change it at first sign-in. */
export const userCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  password: temporaryPassword,
  memberships: z.array(membershipSchema),
});

export type UserCreateRequest = z.infer<typeof userCreateRequestSchema>;

export const userUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean(),
  memberships: z.array(membershipSchema),
});

export type UserUpdateRequest = z.infer<typeof userUpdateRequestSchema>;

/** Sets a new one-time password, signs the user out everywhere and requires a change. */
export const userPasswordResetRequestSchema = z.object({ password: temporaryPassword });

export type UserPasswordResetRequest = z.infer<typeof userPasswordResetRequestSchema>;
