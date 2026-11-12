import { deletePreviousDue, updatePreviousDue } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; previousDueId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, previousDueId } = await params;
  return handle(request, async (ctx) =>
    updatePreviousDue(
      ctx,
      companyId,
      previousDueId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}

export async function DELETE(_request: Request, { params }: Params) {
  const { companyId, previousDueId } = await params;
  return handle(_request, (ctx) => deletePreviousDue(ctx, companyId, previousDueId));
}
