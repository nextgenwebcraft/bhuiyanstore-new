import { createShop, listShops } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, (ctx) => listShops(ctx, companyId));
}

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(
    request,
    async (ctx) => createShop(ctx, companyId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
