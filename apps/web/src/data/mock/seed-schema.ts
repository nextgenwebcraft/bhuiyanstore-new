import {
  batchSchema,
  businessDateSchema,
  companySchema,
  decimalStringSchema,
  idSchema,
  permissionIds,
  productSchema,
  staffMemberSchema,
  supplierSchema,
} from "@bsd/contracts";
import { z } from "zod";

/**
 * Shape of the synthetic demo fixture (guide section 6.2). Public entities reuse the canonical
 * contract schemas; roles/users/memberships are demo-only until the Phase 3 identity module.
 * Opening layers carry quantities; the mock adapter turns them into opening stock movements, so
 * later balances are always derived from movements (guide 9.1).
 */
export const demoSeedSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("demo"),
  tenant: z.object({ id: idSchema, name: z.string() }),
  legalEntities: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      currency: z.literal("BDT"),
      timezone: z.literal("Asia/Dhaka"),
    }),
  ),
  companies: z.array(companySchema),
  products: z.array(productSchema),
  batches: z.array(batchSchema.omit({ origin: true })),
  suppliers: z.array(supplierSchema),
  staff: z.array(staffMemberSchema),
  /** Reviewed opening (legacy) market dues; synthetic amounts, not real balances (guide 6.1). */
  openingMarketDues: z.array(
    z.object({
      id: idSchema,
      companyId: idSchema,
      dsrId: idSchema,
      businessDate: businessDateSchema,
      amount: decimalStringSchema,
    }),
  ),
  roles: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      permissions: z.union([z.literal("all"), z.array(z.enum(permissionIds))]),
    }),
  ),
  users: z.array(z.object({ id: idSchema, name: z.string() })),
  memberships: z.array(
    z.object({ userId: idSchema, companyId: idSchema, roleIds: z.array(idSchema).min(1) }),
  ),
});

export type DemoSeed = z.infer<typeof demoSeedSchema>;
