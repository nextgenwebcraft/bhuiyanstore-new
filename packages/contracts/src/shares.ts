import { z } from "zod";
import { monthSchema } from "./month";
import { decimalStringSchema, idSchema } from "./primitives";

/** D76: 2% of the net, or 2% of the profit. */
export const danBases = ["net", "profit"] as const;
export type DanBasisName = (typeof danBases)[number];

/** Units ≥ 0 with at most 5 decimal places (a holding such as 27.88858). */
export const shareUnitsSchema = z
  .string()
  .regex(/^\d+(\.\d{1,5})?$/, { message: "validation.share.units" });

const shareName = z
  .string()
  .trim()
  .min(1, { message: "validation.share.name" })
  .max(80, { message: "validation.share.name" });

export const shareCompanySchema = z.object({
  companyId: idSchema,
  companyName: z.string(),
  profit: decimalStringSchema,
  khoroch: decimalStringSchema,
  danBasis: z.enum(danBases),
  dan: decimalStringSchema,
  total: decimalStringSchema,
});

export const shareHolderSchema = z.object({
  shareholderId: idSchema,
  name: z.string(),
  active: z.boolean(),
  units: decimalStringSchema,
  income: decimalStringSchema,
  yearIncome: decimalStringSchema,
});

export const shareMonthSchema = z.object({
  month: monthSchema,
  companies: z.array(shareCompanySchema),
  shareholders: z.array(shareHolderSchema),
  totals: z.object({
    profit: decimalStringSchema,
    khoroch: decimalStringSchema,
    dan: decimalStringSchema,
    distributable: decimalStringSchema,
    units: decimalStringSchema,
    perUnit: decimalStringSchema,
    unallocated: decimalStringSchema,
  }),
});
export type ShareMonth = z.infer<typeof shareMonthSchema>;

export const shareholderSchema = z.object({
  id: idSchema,
  name: z.string(),
  active: z.boolean(),
});
export type ShareholderRecord = z.infer<typeof shareholderSchema>;

export const shareholderCreateRequestSchema = z.object({ name: shareName });
export type ShareholderCreateRequest = z.input<typeof shareholderCreateRequestSchema>;

export const shareholderUpdateRequestSchema = z.object({
  name: shareName,
  active: z.boolean(),
});
export type ShareholderUpdateRequest = z.input<typeof shareholderUpdateRequestSchema>;

export const shareHoldingRequestSchema = z.object({
  fromMonth: monthSchema,
  units: shareUnitsSchema,
});
export type ShareHoldingRequest = z.input<typeof shareHoldingRequestSchema>;

export const sharePolicyRequestSchema = z.object({ danBasis: z.enum(danBases) });
export type SharePolicyRequest = z.input<typeof sharePolicyRequestSchema>;

/** A calendar year, the rows of the master page. */
export const shareYearParamSchema = z
  .string()
  .regex(/^\d{4}$/, { message: "validation.share.year" });

const shareYearCompanySchema = z.object({
  companyId: idSchema,
  total: decimalStringSchema,
  dan: decimalStringSchema,
});

const shareYearHolderSchema = z.object({
  shareholderId: idSchema,
  units: decimalStringSchema,
  income: decimalStringSchema,
});

/** D77: one year of the master page. Each month is the D76 statement, companies side by side. */
export const shareYearSchema = z.object({
  year: shareYearParamSchema,
  companies: z.array(z.object({ companyId: idSchema, companyName: z.string() })),
  shareholders: z.array(
    z.object({ shareholderId: idSchema, name: z.string(), active: z.boolean() }),
  ),
  months: z.array(
    z.object({
      month: monthSchema,
      companies: z.array(shareYearCompanySchema),
      totals: z.object({
        distributable: decimalStringSchema,
        dan: decimalStringSchema,
        units: decimalStringSchema,
        perUnit: decimalStringSchema,
      }),
      shareholders: z.array(shareYearHolderSchema),
    }),
  ),
});
export type ShareYear = z.infer<typeof shareYearSchema>;
