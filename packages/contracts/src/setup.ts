import { z } from "zod";

/** The nine go-live setup steps in order (PLAN §5.3); each is computed on the server. */
export const setupStepIds = [
  "company",
  "products",
  "staff",
  "openingStock",
  "supplierOpening",
  "staffOpening",
  "shops",
  "businessOpening",
  "activate",
] as const;

export type SetupStepId = (typeof setupStepIds)[number];

/** What is still missing, as i18n keys (`setup.missing.*`) with an optional count. */
export const setupMissingSchema = z.object({
  code: z.string(),
  count: z.number().int().nonnegative().nullable(),
});

export const setupStepSchema = z.object({
  id: z.enum(setupStepIds),
  complete: z.boolean(),
  missing: z.array(setupMissingSchema),
});

export type SetupStep = z.infer<typeof setupStepSchema>;

export const setupStatusSchema = z.object({
  steps: z.array(setupStepSchema),
  completed: z.number().int().nonnegative(),
  ready: z.boolean(),
  openingStatus: z.enum(["none", "draft", "approved", "active"]),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;
