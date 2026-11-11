import { z } from "zod";
import { permissionIds } from "./definitions/permissions";
import { MIN_PASSWORD_LENGTH } from "./organization";
import { idSchema } from "./primitives";

export const loginRoleKinds = ["manager", "dsr", "tsm"] as const;
export type LoginRoleKind = (typeof loginRoleKinds)[number];

/** A role is a named set of fixed permission IDs (guide §12.2 / D112). */
export const roleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** Fixed login roles have a kind; ad-hoc/test roles may be null. */
  kind: z.enum(loginRoleKinds).nullable(),
  permissions: z.array(z.enum(permissionIds)),
});

export type Role = z.infer<typeof roleSchema>;

/** @deprecated D112: roles are fixed; create/update APIs refuse writes. */
export const roleUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.enum(permissionIds)),
});

export type RoleUpsertRequest = z.infer<typeof roleUpsertRequestSchema>;

/** Exactly one fixed login role per company membership (D112). */
export const membershipSchema = z.object({
  companyId: idSchema,
  roleIds: z.array(idSchema).length(1),
});

export type MembershipInput = z.infer<typeof membershipSchema>;

export const userSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  isSuperAdmin: z.boolean(),
  memberships: z.array(membershipSchema),
});

export type User = z.infer<typeof userSchema>;

const temporaryPassword = z.string().min(MIN_PASSWORD_LENGTH).max(128);

/** The administrator sets the sign-in password (D117: no forced change on first sign-in). */
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

/** Sets a new password and signs the user out everywhere (D117: no forced change gate). */
export const userPasswordResetRequestSchema = z.object({ password: temporaryPassword });

export type UserPasswordResetRequest = z.infer<typeof userPasswordResetRequestSchema>;
