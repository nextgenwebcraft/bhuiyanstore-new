import { z } from "zod";
import { permissionIds } from "./definitions/permissions";
import { workspaceModuleIds } from "./definitions/workspace-modules";
import { idSchema } from "./primitives";

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: "validation.color.hex" });

/** Approved theme tokens only, never arbitrary CSS (guide section 4.3). */
export const companyThemeSchema = z.object({
  primary: hexColorSchema,
  primaryForeground: hexColorSchema,
  accent: hexColorSchema.optional(),
  logoRef: z.string().optional(),
});

export type CompanyTheme = z.infer<typeof companyThemeSchema>;

export const companySchema = z.object({
  id: idSchema,
  legalEntityId: idSchema,
  name: z.string().min(1),
  theme: companyThemeSchema,
  modules: z.array(z.enum(workspaceModuleIds)),
});

export type Company = z.infer<typeof companySchema>;

/** A company as seen by the current actor: its configuration plus their effective permissions. */
export const companyWorkspaceSchema = z.object({
  company: companySchema,
  permissions: z.array(z.enum(permissionIds)),
});

export type CompanyWorkspace = z.infer<typeof companyWorkspaceSchema>;

/** Full-replace body for creating or updating a company; the tenant comes from the session. */
export const companyUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  theme: companyThemeSchema,
  modules: z.array(z.enum(workspaceModuleIds)),
});

export type CompanyUpsertRequest = z.infer<typeof companyUpsertRequestSchema>;

/** The signed-in person (`GET /api/v1/me`). */
export const meSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  isSuperAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
});

export type Me = z.infer<typeof meSchema>;

/** Minimum length is enforced again by the auth server; 12 matches guide §12.1. */
export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(128),
});

export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;
