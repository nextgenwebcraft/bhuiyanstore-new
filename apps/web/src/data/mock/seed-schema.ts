import {
  companySchema,
  idSchema,
  permissionIds,
  productSchema,
  staffMemberSchema,
} from "@bsd/contracts";
import { z } from "zod";

/**
 * Shape of the synthetic demo fixture (guide section 6.2). Public entities reuse the canonical
 * contract schemas; roles/users/memberships are demo-only.
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
  staff: z.array(staffMemberSchema),
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
