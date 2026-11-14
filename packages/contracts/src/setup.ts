import { z } from "zod";

/**
 * The go-live setup steps in order (PLAN §5.3, D43); each is computed on the server. The first
 * four are what the opening needs before it can start; the rest follow the opening sections.
 */
export const setupStepIds = [
  "products",
  "staff",
  "shops",
  "cutoff",
  "openingStock",
  "marketDue",
  "shopDue",
  "staffOpening",
  "companyOpening",
  "cashOpening",
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
  /** The go-live date is saved: the opening is live (D43). */
  ready: z.boolean(),
  live: z.boolean(),
  /** A month is closed: the opening can no longer change. */
  locked: z.boolean(),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;
