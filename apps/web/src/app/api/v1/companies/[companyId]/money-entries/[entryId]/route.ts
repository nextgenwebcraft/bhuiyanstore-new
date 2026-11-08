import { deleteMoneyEntry } from "@bsd/application";
import { handle, idempotencyKey } from "@/server/api";

type Params = { params: Promise<{ companyId: string; entryId: string }> };

/** D123: hard-delete দোকানের বাকি / আদায় (ledger drops the posted amount). */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, entryId } = await params;
  return handle(request, async (ctx) =>
    deleteMoneyEntry(ctx, companyId, entryId, idempotencyKey(request)),
  );
}
