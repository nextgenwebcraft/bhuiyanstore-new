import { correctOrderPayment } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; entryId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, entryId } = await params;
  return handle(request, async (ctx) =>
    correctOrderPayment(ctx, companyId, entryId, await readJson(request), idempotencyKey(request)),
  );
}
