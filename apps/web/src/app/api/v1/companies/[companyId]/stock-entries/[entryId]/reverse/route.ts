import { reverseStockEntry } from "@bsd/application";
import { handle, idempotencyKey } from "@/server/api";

type Params = { params: Promise<{ companyId: string; entryId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, entryId } = await params;
  return handle(request, (ctx) =>
    reverseStockEntry(ctx, companyId, entryId, idempotencyKey(request)),
  );
}
