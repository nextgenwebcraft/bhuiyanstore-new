import { deleteShop, updateShop } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; shopId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, shopId } = await params;
  return handle(request, async (ctx) =>
    updateShop(ctx, companyId, shopId, await readJson(request), idempotencyKey(request)),
  );
}

/** Hard delete of a record nothing refers to (D51); a used one is refused. */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, shopId } = await params;
  return handle(request, async (ctx) => deleteShop(ctx, companyId, shopId));
}
