import { updateSupplier } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; supplierId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, supplierId } = await params;
  return handle(request, async (ctx) =>
    updateSupplier(ctx, companyId, supplierId, await readJson(request), idempotencyKey(request)),
  );
}
