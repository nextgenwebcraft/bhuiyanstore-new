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
  /** D34: postings that would take a product's stock below zero are refused. */
  blockNegativeStock: z.boolean().default(false),
  /** D66: the tenant's hidden master company (global staff, payroll, all-company summary). */
  isMaster: z.boolean().default(false),
});

export type Company = z.infer<typeof companySchema>;

/** A company as seen by the current actor: its configuration plus their effective permissions. */
export const companyWorkspaceSchema = z.object({
  company: companySchema,
  permissions: z.array(z.enum(permissionIds)),
  /** A super-admin opens every module, also those the company has not enabled. */
  allModules: z.boolean().default(false),
  /**
   * D112: fixed login role for this membership. Null for Super Admin (full access via isSuperAdmin).
   */
  loginRoleKind: z.enum(["manager", "dsr"]).nullable().default(null),
});

export type CompanyWorkspace = z.infer<typeof companyWorkspaceSchema>;

/** Full-replace body for creating or updating a company; the tenant comes from the session. */
export const companyUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  theme: companyThemeSchema,
  modules: z.array(z.enum(workspaceModuleIds)),
  blockNegativeStock: z.boolean().default(false),
});

export type CompanyUpsertRequest = z.infer<typeof companyUpsertRequestSchema>;

/**
 * Creating a company (D51) may also clone the synthetic starter dataset (sample products, staff,
 * shops and standard lists) into it; updating never does, so the flag is not part of the upsert.
 */
export const companyCreateRequestSchema = companyUpsertRequestSchema.extend({
  starterData: z.boolean().default(true),
});

export type CompanyCreateRequest = z.input<typeof companyCreateRequestSchema>;

/** The signed-in person (`GET /api/v1/me`). */
export const meSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  isSuperAdmin: z.boolean(),
});

export type Me = z.infer<typeof meSchema>;

/** Guide §12.1; the auth server enforces the same minimum again (`@bsd/auth`). */
export const MIN_PASSWORD_LENGTH = 6;

export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;
