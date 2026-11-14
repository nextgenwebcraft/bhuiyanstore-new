import { deleteProduct, updateProduct } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; productId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, productId } = await params;
  return handle(request, async (ctx) =>
    updateProduct(ctx, companyId, productId, await readJson(request), idempotencyKey(request)),
  );
}

/** Hard delete of a record nothing refers to (D51); a used one is refused. */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, productId } = await params;
  return handle(request, async (ctx) => deleteProduct(ctx, companyId, productId));
}
