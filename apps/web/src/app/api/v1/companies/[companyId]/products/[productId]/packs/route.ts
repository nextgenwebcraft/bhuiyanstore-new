import { addProductPack } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; productId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, productId } = await params;
  return handle(
    request,
    async (ctx) =>
      addProductPack(ctx, companyId, productId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
