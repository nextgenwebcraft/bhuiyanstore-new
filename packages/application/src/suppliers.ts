import { supplierSchema, supplierUpsertRequestSchema, type Supplier } from "@bsd/contracts";
import { requirePermission } from "./access";
import { recordAudit } from "./audit";
import type { AppContext } from "./context";
import { AppError, parseInput } from "./errors";
import { isUniqueViolation, runIdempotent } from "./idempotency";

type SupplierRow = {
  id: string;
  companyId: string;
  name: string;
  phone: string | null;
  status: string;
};

function toSupplier(row: SupplierRow): Supplier {
  return supplierSchema.parse({
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    ...(row.phone ? { phone: row.phone } : {}),
    status: row.status,
  });
}

const duplicateName = () =>
  new AppError("VALIDATION_FAILED", [{ path: "name", code: "validation.supplier.duplicateName" }]);

function parseSupplier(input: unknown) {
  const data = parseInput(supplierUpsertRequestSchema, input);
  return {
    request: data,
    row: { name: data.name, phone: data.phone || null, status: data.status },
  };
}

export async function listSuppliers(ctx: AppContext, companyId: string): Promise<Supplier[]> {
  await requirePermission(ctx, companyId, "company.view");
  const rows = await ctx.db.supplier.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  return rows.map(toSupplier);
}

export async function createSupplier(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Supplier> {
  const access = await requirePermission(ctx, companyId, "supplier.manage", { write: true });
  const { request, row } = parseSupplier(input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "supplier.create", requestKey },
      request,
      async (tx) => {
        if (await tx.supplier.findFirst({ where: { companyId, name: row.name } })) {
          throw duplicateName();
        }
        const supplier = toSupplier(
          await tx.supplier.create({
            data: { ...row, companyId, tenantId: access.company.tenantId },
          }),
        );
        await recordAudit(tx, ctx, {
          companyId,
          action: "supplier.create",
          resourceType: "supplier",
          resourceId: supplier.id,
          after: supplier,
        });
        return supplier;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

/** Full replace; deactivate instead of delete once referenced (guide §4.4). */
export async function updateSupplier(
  ctx: AppContext,
  companyId: string,
  supplierId: string,
  input: unknown,
  requestKey?: string,
): Promise<Supplier> {
  await requirePermission(ctx, companyId, "supplier.manage", { write: true });
  const { request, row } = parseSupplier(input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: `supplier.update:${supplierId}`, requestKey },
      request,
      async (tx) => {
        const existing = await tx.supplier.findFirst({ where: { id: supplierId, companyId } });
        if (!existing) {
          throw new AppError("VALIDATION_FAILED", [
            { path: "id", code: "validation.supplier.unknown" },
          ]);
        }
        const clash = await tx.supplier.findFirst({
          where: { companyId, name: row.name, id: { not: supplierId } },
        });
        if (clash) throw duplicateName();
        const supplier = toSupplier(
          await tx.supplier.update({ where: { id: supplierId }, data: row }),
        );
        await recordAudit(tx, ctx, {
          companyId,
          action: "supplier.update",
          resourceType: "supplier",
          resourceId: supplierId,
          before: toSupplier(existing),
          after: supplier,
        });
        return supplier;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}
