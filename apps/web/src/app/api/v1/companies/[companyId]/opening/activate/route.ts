import { activateOpening } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    activateOpening(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
