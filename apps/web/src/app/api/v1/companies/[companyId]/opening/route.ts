import { getOpening, saveOpening } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, (ctx) => getOpening(ctx, companyId));
}

export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    saveOpening(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
