import { updateShop } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; shopId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, shopId } = await params;
  return handle(request, async (ctx) =>
    updateShop(ctx, companyId, shopId, await readJson(request), idempotencyKey(request)),
  );
}
