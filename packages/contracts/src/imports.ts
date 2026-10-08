import { z } from "zod";
import { businessDateSchema, decimalStringSchema, idSchema } from "./primitives";
import { staffRoleKinds } from "./parties";

/**
 * Excel month import (PLAN §8, §9 Phase H). An upload reads one month sheet by its headers and
 * keeps only its raw inputs and the comparison with Excel's saved values; the workbook itself is
 * never stored. The owner maps sheet labels to catalog records, then commits: a month from the
 * go-live date on is posted as documents and closed; an earlier month's closing becomes the
 * draft opening.
 */

export const importJobStatuses = ["ready", "committed", "discarded"] as const;
export type ImportJobStatus = (typeof importJobStatuses)[number];

export const importCommitModes = ["documents", "opening"] as const;
export type ImportCommitMode = (typeof importCommitModes)[number];

export const importWorkbookSheetsSchema = z.object({ sheets: z.array(z.string()) });
export type ImportWorkbookSheets = z.infer<typeof importWorkbookSheetsSchema>;

/** Sheet key → catalog ID; null (or missing) = not mapped yet. */
export const importMappingSchema = z.object({
  products: z.record(z.string(), idSchema.nullable()).default({}),
  staff: z.record(z.string(), idSchema.nullable()).default({}),
  categories: z.record(z.string(), idSchema.nullable()).default({}),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const importMappingRequestSchema = z.object({
  version: z.number().int().positive(),
  mapping: importMappingSchema,
});
export type ImportMappingRequest = z.input<typeof importMappingRequestSchema>;

export const importDifferenceSchema = z.object({
  where: z.string(),
  engine: z.string(),
  excel: z.string(),
  knownMistake: z.string().optional(),
});

/** One comparison check against Excel's saved values (PLAN §2.1, §8 step 4). */
export const importCheckSchema = z.object({
  check: z.string(),
  compared: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  /** Differences explained by a known workbook mistake (PLAN §2.6). */
  knownCount: z.number().int().nonnegative(),
  unexplainedCount: z.number().int().nonnegative(),
  /** The first differences of each kind (lists are capped; the counts are complete). */
  known: z.array(importDifferenceSchema),
  unexplained: z.array(importDifferenceSchema),
});
export type ImportCheck = z.infer<typeof importCheckSchema>;

/** `code` is an i18n key; errors block the commit, warnings need `acceptDifferences`. */
export const importIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  /** The sheet key (product, person or category) the issue is about. */
  key: z.string().optional(),
  date: businessDateSchema.optional(),
  detail: z.string().optional(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importOpeningDifferenceSchema = z.object({
  kind: z.enum(["stock", "dueFromCompany", "marketDue", "staff"]),
  label: z.string(),
  system: decimalStringSchema,
  sheet: decimalStringSchema,
});
export type ImportOpeningDifference = z.infer<typeof importOpeningDifferenceSchema>;

export const importJobSummarySchema = z.object({
  id: idSchema,
  status: z.enum(importJobStatuses),
  fileName: z.string(),
  sheet: z.string(),
  month: z.string(),
  /** Last imported date when only part of the month was read; that commit leaves it open. */
  through: z.string().nullable(),
  unexplained: z.number().int().nonnegative(),
  createdAt: z.string(),
  committedAt: z.string().nullable(),
  committedMode: z.enum(importCommitModes).nullable(),
});
export type ImportJobSummary = z.infer<typeof importJobSummarySchema>;

export const importJobSchema = importJobSummarySchema.extend({
  version: z.number().int().positive(),
  fileHash: z.string(),
  products: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      /** Pieces per carton read from the person grids; null when the sheet has none. */
      cartonSize: z.string().nullable(),
      /** Has an opening or any entry in the month; only these must be mapped. */
      active: z.boolean(),
      productId: idSchema.nullable(),
    }),
  ),
  people: z.array(z.object({ key: z.string(), label: z.string(), staffId: idSchema.nullable() })),
  categories: z.array(
    z.object({ key: z.string(), label: z.string(), categoryId: idSchema.nullable() }),
  ),
  checks: z.array(importCheckSchema),
  notes: z.array(z.string()),
  /** How this month can be committed now; null when neither is possible. */
  mode: z.enum(importCommitModes).nullable(),
  issues: z.array(importIssueSchema),
  documents: z.object({
    stockEntries: z.number().int().nonnegative(),
    prices: z.number().int().nonnegative(),
    dsrDays: z.number().int().nonnegative(),
    moneyEntries: z.number().int().nonnegative(),
  }),
  /** Documents mode: where the system's opening for the month differs from the sheet's. */
  openingDifferences: z.array(importOpeningDifferenceSchema),
  /** Opening mode: the draft opening version the commit must name. */
  openingVersion: z.number().int().nonnegative().nullable(),
  options: z.object({
    products: z.array(z.object({ id: idSchema, sku: z.string(), name: z.string() })),
    staff: z.array(
      z.object({ id: idSchema, name: z.string(), roleKind: z.enum(staffRoleKinds).nullable() }),
    ),
    categories: z.array(z.object({ id: idSchema, name: z.string() })),
  }),
  canCommit: z.boolean(),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importCommitRequestSchema = z.object({
  version: z.number().int().positive(),
  mode: z.enum(importCommitModes),
  /** Opening mode only: the draft opening version reviewed. */
  openingVersion: z.number().int().nonnegative().nullable().default(null),
  /** Required when the comparison or the opening shows differences. */
  acceptDifferences: z.boolean().default(false),
});
export type ImportCommitRequest = z.input<typeof importCommitRequestSchema>;

export const importDiscardRequestSchema = z.object({ version: z.number().int().positive() });
export type ImportDiscardRequest = z.infer<typeof importDiscardRequestSchema>;
