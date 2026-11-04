import { correctMoneyEntry } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; entryId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, entryId } = await params;
  return handle(request, async (ctx) =>
    correctMoneyEntry(ctx, companyId, entryId, await readJson(request), idempotencyKey(request)),
  );
}
